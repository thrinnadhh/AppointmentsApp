-- =============================================================================
-- Migration: 20261022000005_sargable_daily_booking_limit.sql
-- Description: Fix 6 - Replace non-sargable daily-limit date cast with sargable
--               range predicate on slot_start (start and end of the IST day).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id uuid,
    p_slot_start timestamp with time zone,
    p_slot_end timestamp with time zone,
    p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_provider_id UUID;
    v_category_id TEXT;
    v_deposit_amount NUMERIC(10, 2);
    v_platform_fee NUMERIC(10, 2);
    v_total_amount NUMERIC(10, 2);
    v_is_active BOOLEAN;
    v_provider_status TEXT;
    v_existing_id UUID;
    v_new_booking_id UUID;
    v_reference_code TEXT;
    v_hold_expiry TIMESTAMPTZ;
    v_daily_booking_limit INTEGER;
    v_daily_count INTEGER;
    v_slot_date_ist DATE;
    v_day_start TIMESTAMPTZ;
    v_day_end TIMESTAMPTZ;
    v_cooling_period_days INTEGER := 0;
    v_is_followup BOOLEAN := FALSE;
    v_followup_original_booking_id UUID := NULL;
BEGIN
    -- Only authenticated users or service_role can create holds
    IF auth.role() = 'anon' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required to create a booking hold');
    END IF;

    -- Verify customer ownership if authenticated
    IF auth.role() = 'authenticated' AND auth.uid() != p_customer_id THEN
        IF NOT (
            public.is_admin(auth.uid()) OR
            EXISTS (
                SELECT 1 FROM public.providers p
                JOIN public.resources r ON r.provider_id = p.id
                WHERE r.id = p_resource_id
                  AND (p.owner_id = auth.uid() OR p.id IN (SELECT public.get_user_authorized_providers(auth.uid())))
            )
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You cannot book on behalf of another user');
        END IF;
    END IF;

    -- Validate slot times
    IF p_slot_end <= p_slot_start THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: slot_end must be after slot_start');
    END IF;

    IF p_slot_start < (NOW() - INTERVAL '5 minutes') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: cannot book slots in the past');
    END IF;

    -- Auto-clean expired holds scoped STRICTLY to the requested resource and overlapping slot range
    PERFORM set_config('app.trusted_write', 'true', true);
    UPDATE public.bookings
    SET status = 'CANCELLED', payment_status = 'FORFEITED', updated_at = NOW()
    WHERE resource_id = p_resource_id
      AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end)
      AND status = 'HELD'
      AND hold_expires_at < NOW();

    -- Fetch resource
    SELECT provider_id, deposit_amount, is_active
    INTO v_provider_id, v_deposit_amount, v_is_active
    FROM public.resources
    WHERE id = p_resource_id;

    IF NOT FOUND OR NOT v_is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Resource not found or inactive');
    END IF;

    -- Fetch provider status, category, operational daily booking limit, and cooling period
    SELECT status, category_id, daily_booking_limit, COALESCE(cooling_period_days, 0)
    INTO v_provider_status, v_category_id, v_daily_booking_limit, v_cooling_period_days
    FROM public.providers 
    WHERE id = v_provider_id;

    IF v_provider_status = 'SUSPENDED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Merchant provider is suspended');
    END IF;

    -- Daily Booking Limit Concurrency Guard with Sargable Range Predicate
    IF v_daily_booking_limit IS NOT NULL AND v_daily_booking_limit > 0 THEN
        v_slot_date_ist := (p_slot_start AT TIME ZONE 'Asia/Kolkata')::date;
        v_day_start := (v_slot_date_ist::timestamp AT TIME ZONE 'Asia/Kolkata');
        v_day_end := v_day_start + INTERVAL '1 day';

        PERFORM pg_advisory_xact_lock(hashtext('daily_limit:' || v_provider_id::text || ':' || v_slot_date_ist::text));

        SELECT COUNT(*) INTO v_daily_count
        FROM public.bookings
        WHERE provider_id = v_provider_id
          AND slot_start >= v_day_start
          AND slot_start < v_day_end
          AND status IN ('HELD', 'CONFIRMED', 'COMPLETED');

        IF v_daily_count >= v_daily_booking_limit THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'This venue has reached its daily booking limit (' || v_daily_booking_limit || ') for this date. Please choose another day.'
            );
        END IF;
    END IF;

    -- =========================================================================
    -- COOLING PERIOD EVALUATION:
    -- Restrict qualifying anchor strictly to a genuine, non-followup visit (is_followup = FALSE)
    -- to prevent unbounded free chains that roll forward past the policy window (vuln-0025).
    -- =========================================================================
    IF v_cooling_period_days IS NOT NULL AND v_cooling_period_days > 0 THEN
        SELECT id INTO v_followup_original_booking_id
        FROM public.bookings
        WHERE customer_id = p_customer_id
          AND provider_id = v_provider_id
          AND status IN ('CONFIRMED', 'COMPLETED')
          AND is_followup = FALSE
          AND slot_start <= p_slot_start
          AND p_slot_start <= (slot_start + (v_cooling_period_days || ' days')::INTERVAL)
          AND NOW() <= (slot_start + (v_cooling_period_days || ' days')::INTERVAL)
        ORDER BY slot_start DESC
        LIMIT 1;

        IF v_followup_original_booking_id IS NOT NULL THEN
            v_is_followup := TRUE;
            v_deposit_amount := 0.00;
            v_platform_fee := 0.00;
            v_total_amount := 0.00;
        END IF;
    END IF;

    IF NOT v_is_followup THEN
        -- Enforce ₹100 minimum deposit floor for regular paid bookings
        IF COALESCE(v_deposit_amount, 0) < 100 THEN
            v_deposit_amount := 100.00;
        END IF;

        -- Platform fee: ₹50 for Gaming & Turf, ₹10 for all others
        v_platform_fee := CASE WHEN v_category_id IN ('gaming', 'turf') THEN 50.00 ELSE 10.00 END;
        v_total_amount := v_deposit_amount + v_platform_fee;
    END IF;

    -- Overlap exclusion check with 3-second lock timeout
    SET LOCAL lock_timeout = '3s';
    SELECT id INTO v_existing_id
    FROM public.bookings
    WHERE resource_id = p_resource_id
      AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end)
      AND status IN ('HELD', 'CONFIRMED')
    FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked');
    END IF;

    v_hold_expiry := NOW() + INTERVAL '5 minutes';

    BEGIN
        INSERT INTO public.bookings (
            customer_id, provider_id, resource_id,
            slot_start, slot_end, status, payment_status,
            deposit_amount, platform_fee, total_amount, hold_expires_at,
            disclaimer_version, is_followup, followup_original_booking_id
        ) VALUES (
            p_customer_id, v_provider_id, p_resource_id,
            p_slot_start, p_slot_end, 'HELD', 'PENDING',
            v_deposit_amount, v_platform_fee, v_total_amount, v_hold_expiry,
            'v1', v_is_followup, v_followup_original_booking_id
        )
        RETURNING id, reference_code INTO v_new_booking_id, v_reference_code;
    EXCEPTION
        WHEN exclusion_violation OR unique_violation THEN
            RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked');
    END;

    RETURN jsonb_build_object(
        'success',                      true,
        'booking_id',                   v_new_booking_id,
        'reference_code',               v_reference_code,
        'deposit_amount',               v_deposit_amount,
        'platform_fee',                 v_platform_fee,
        'total_amount',                 v_total_amount,
        'hold_expires_at',              v_hold_expiry,
        'is_followup',                  v_is_followup,
        'followup_original_booking_id', v_followup_original_booking_id
    );
END;
$function$;
