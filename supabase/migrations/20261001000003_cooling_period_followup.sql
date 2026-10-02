-- Migration: 20261001000003_cooling_period_followup.sql
-- Description:
--   1. Adds cooling_period_days to public.providers (e.g. 20 days for clinics/hospitals, 0 = disabled).
--   2. Adds is_followup and followup_original_booking_id to public.bookings.
--   3. Updates create_booking_hold RPC:
--      - Detects if customer has an active confirmed/completed booking within cooling_period_days.
--      - If valid follow-up, waives deposit_amount, platform_fee, and total_amount (₹0).
--      - Flags booking with is_followup = true and links followup_original_booking_id.
--   4. Adds check_cooling_period_eligibility RPC for client pre-checks.
--   5. Adds merchant_update_cooling_period RPC with authorization guards.

-- =============================================================================
-- 1. SCHEMA EXTENSIONS
-- =============================================================================
ALTER TABLE public.providers 
ADD COLUMN IF NOT EXISTS cooling_period_days INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.providers.cooling_period_days IS 
'Number of days from an appointment date where subsequent follow-up visits with the same provider are completely free (₹0 deposit and ₹0 platform fee). 0 = disabled.';

ALTER TABLE public.bookings 
ADD COLUMN IF NOT EXISTS is_followup BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.bookings 
ADD COLUMN IF NOT EXISTS followup_original_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bookings.is_followup IS 
'True if this booking was created as a zero-fee follow-up within the provider cooling period.';

COMMENT ON COLUMN public.bookings.followup_original_booking_id IS 
'Reference to the original confirmed/completed appointment that validated this cooling period follow-up.';

CREATE INDEX IF NOT EXISTS idx_bookings_cooling_lookup 
ON public.bookings(customer_id, provider_id, status, slot_start DESC);


-- =============================================================================
-- 2. HARDENED CREATE_BOOKING_HOLD WITH COOLING PERIOD SUPPORT
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id   UUID,
    p_slot_start    TIMESTAMPTZ,
    p_slot_end      TIMESTAMPTZ,
    p_customer_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_provider_id                  UUID;
    v_deposit_amount               NUMERIC;
    v_platform_fee                 NUMERIC;
    v_total_amount                 NUMERIC;
    v_is_active                    BOOLEAN;
    v_provider_status              TEXT;
    v_category_id                  TEXT;
    v_daily_booking_limit          INTEGER;
    v_cooling_period_days          INTEGER;
    v_daily_count                  BIGINT;
    v_slot_date_ist                DATE;
    v_existing_id                  UUID;
    v_new_booking_id               UUID;
    v_reference_code               TEXT;
    v_hold_expiry                  TIMESTAMPTZ;
    v_is_followup                  BOOLEAN := FALSE;
    v_followup_original_booking_id UUID := NULL;
BEGIN
    -- Verify caller identity: Client callers cannot forge customer_id
    IF auth.role() != 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_customer_id THEN
            RAISE EXCEPTION 'Unauthorized: customer_id must match authenticated user' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Validate slot times
    IF p_slot_end <= p_slot_start THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: slot_end must be after slot_start');
    END IF;

    IF p_slot_start < (NOW() - INTERVAL '5 minutes') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: cannot book slots in the past');
    END IF;

    -- Auto-clean expired holds
    UPDATE public.bookings
    SET status = 'CANCELLED', updated_at = NOW()
    WHERE status = 'HELD' AND hold_expires_at < NOW();

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

    -- Daily Booking Limit Concurrency Guard:
    -- Evaluate in operational timezone (Asia/Kolkata) inside advisory-locked transaction to prevent TOCTOU race
    IF v_daily_booking_limit IS NOT NULL AND v_daily_booking_limit > 0 THEN
        v_slot_date_ist := (p_slot_start AT TIME ZONE 'Asia/Kolkata')::date;

        -- Transaction-level advisory lock on provider + IST calendar day
        PERFORM pg_advisory_xact_lock(hashtext('daily_limit:' || v_provider_id::text || ':' || v_slot_date_ist::text));

        SELECT COUNT(*) INTO v_daily_count
        FROM public.bookings
        WHERE provider_id = v_provider_id
          AND (slot_start AT TIME ZONE 'Asia/Kolkata')::date = v_slot_date_ist
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
    -- If merchant offers cooling period (e.g. 20-day hospital follow-up)
    -- and customer had a CONFIRMED or COMPLETED appointment within that window,
    -- the follow-up appointment is completely free (₹0 deposit, ₹0 platform fee).
    -- =========================================================================
    IF v_cooling_period_days IS NOT NULL AND v_cooling_period_days > 0 THEN
        SELECT id INTO v_followup_original_booking_id
        FROM public.bookings
        WHERE customer_id = p_customer_id
          AND provider_id = v_provider_id
          AND status IN ('CONFIRMED', 'COMPLETED')
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

REVOKE ALL ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated, service_role;


-- =============================================================================
-- 3. CLIENT PRE-CHECK RPC: check_cooling_period_eligibility
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_cooling_period_eligibility(
    p_customer_id UUID,
    p_provider_id UUID,
    p_target_slot TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cooling_days INTEGER;
    v_orig_id      UUID;
    v_orig_slot    TIMESTAMPTZ;
    v_valid_until  TIMESTAMPTZ;
    v_days_left    NUMERIC;
BEGIN
    SELECT COALESCE(cooling_period_days, 0) INTO v_cooling_days
    FROM public.providers
    WHERE id = p_provider_id;

    IF v_cooling_days IS NULL OR v_cooling_days <= 0 THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'cooling_period_days', 0,
            'reason', 'Cooling period not configured or disabled'
        );
    END IF;

    SELECT id, slot_start, slot_start + (v_cooling_days || ' days')::INTERVAL
    INTO v_orig_id, v_orig_slot, v_valid_until
    FROM public.bookings
    WHERE customer_id = p_customer_id
      AND provider_id = p_provider_id
      AND status IN ('CONFIRMED', 'COMPLETED')
      AND slot_start <= p_target_slot
      AND p_target_slot <= (slot_start + (v_cooling_days || ' days')::INTERVAL)
      AND NOW() <= (slot_start + (v_cooling_days || ' days')::INTERVAL)
    ORDER BY slot_start DESC
    LIMIT 1;

    IF v_orig_id IS NOT NULL THEN
        v_days_left := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_valid_until - NOW())) / 86400.0, 1));
        RETURN jsonb_build_object(
            'eligible', true,
            'cooling_period_days', v_cooling_days,
            'original_booking_id', v_orig_id,
            'original_slot_start', v_orig_slot,
            'valid_until', v_valid_until,
            'days_remaining', v_days_left,
            'reason', 'Target appointment date is within the ' || v_cooling_days || '-day cooling period'
        );
    END IF;

    -- Check if they had a previous appointment that expired or is past the cooling window
    SELECT id, slot_start, slot_start + (v_cooling_days || ' days')::INTERVAL
    INTO v_orig_id, v_orig_slot, v_valid_until
    FROM public.bookings
    WHERE customer_id = p_customer_id
      AND provider_id = p_provider_id
      AND status IN ('CONFIRMED', 'COMPLETED')
    ORDER BY slot_start DESC
    LIMIT 1;

    IF v_orig_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'cooling_period_days', v_cooling_days,
            'prior_booking_id', v_orig_id,
            'prior_slot_start', v_orig_slot,
            'prior_valid_until', v_valid_until,
            'reason', 'Target appointment date exceeds the ' || v_cooling_days || '-day cooling window from prior visit'
        );
    END IF;

    RETURN jsonb_build_object(
        'eligible', false,
        'cooling_period_days', v_cooling_days,
        'reason', 'No prior visit found at this venue'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_cooling_period_eligibility(UUID, UUID, TIMESTAMPTZ) TO authenticated, anon, service_role;


-- =============================================================================
-- 4. MERCHANT SETTINGS RPC: merchant_update_cooling_period
-- =============================================================================
CREATE OR REPLACE FUNCTION public.merchant_update_cooling_period(
    p_provider_id UUID,
    p_cooling_period_days INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_role TEXT := auth.role();
    v_authorized BOOLEAN := FALSE;
BEGIN
    IF v_role = 'service_role' THEN
        v_authorized := TRUE;
    ELSIF v_caller_id IS NOT NULL THEN
        -- Check if caller is owner
        SELECT (owner_id = v_caller_id) INTO v_authorized
        FROM public.providers
        WHERE id = p_provider_id;

        IF NOT COALESCE(v_authorized, false) THEN
            -- Check if caller is active member of merchant team
            SELECT EXISTS (
                SELECT 1 FROM public.merchant_memberships
                WHERE provider_id = p_provider_id
                  AND user_id = v_caller_id
                  AND status = 'ACTIVE'
            ) INTO v_authorized;
        END IF;

        IF NOT COALESCE(v_authorized, false) THEN
            -- Check if caller is platform admin
            SELECT public.is_admin(v_caller_id) INTO v_authorized;
        END IF;
    END IF;

    IF NOT v_authorized THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized to modify this provider');
    END IF;

    IF p_cooling_period_days < 0 OR p_cooling_period_days > 365 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cooling period must be between 0 and 365 days');
    END IF;

    UPDATE public.providers
    SET cooling_period_days = p_cooling_period_days,
        updated_at = NOW()
    WHERE id = p_provider_id;

    RETURN jsonb_build_object(
        'success', true,
        'provider_id', p_provider_id,
        'cooling_period_days', p_cooling_period_days
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merchant_update_cooling_period(UUID, INTEGER) TO authenticated, service_role;

-- =============================================================================
-- 5. GRANTS FOR PUBLIC DIRECTORY / DETAIL ACCESS
-- =============================================================================
GRANT SELECT (id, name, category_id, sub_category_id, description, address, city, latitude, longitude, phone, email, opening_time, closing_time, photos, status, weekly_hours, cooling_period_days, created_at, updated_at) ON public.providers TO anon, authenticated;
GRANT SELECT ON public.resources TO anon, authenticated;
GRANT SELECT ON public.categories TO anon, authenticated;
