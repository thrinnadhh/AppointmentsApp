-- Migration: 20261113000001_enforce_provider_active_in_create_booking_hold.sql
-- Description: Enforces provider active/paused status directly in private.create_booking_hold RPC
--              prior to slot and time gap validation, replicating the check from the deprecated
--              Next.js proxy route with zero-hop latency.

BEGIN;

CREATE OR REPLACE FUNCTION private.create_booking_hold(
    p_resource_id uuid,
    p_slot_start timestamp with time zone,
    p_slot_end timestamp with time zone,
    p_customer_id uuid,
    p_booking_for_someone_else boolean DEFAULT false,
    p_patient_name text DEFAULT NULL::text,
    p_patient_phone text DEFAULT NULL::text,
    p_patient_relationship text DEFAULT NULL::text,
    p_booked_for text DEFAULT 'self'::text,
    p_patient_age smallint DEFAULT NULL::smallint,
    p_booking_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_provider_id UUID;
    v_category_id TEXT;
    v_deposit_amount NUMERIC(10, 2);
    v_platform_fee NUMERIC(10, 2);
    v_total_amount NUMERIC(10, 2);
    v_consultation_fee NUMERIC(10, 2);
    v_is_active BOOLEAN;
    v_provider_status TEXT;
    v_provider_is_active BOOLEAN;
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
    v_customer_blocked_until TIMESTAMPTZ := NULL;
    v_target_phone TEXT;
    v_target_name TEXT;
    v_gap_conflict_id UUID;
    v_booked_for TEXT;
    v_is_minor BOOLEAN;
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

    -- Resolve booked_for value
    v_booked_for := COALESCE(NULLIF(trim(p_booked_for), ''), 'self');
    IF COALESCE(p_booking_for_someone_else, false) AND v_booked_for = 'self' THEN
        v_booked_for := 'family';
    END IF;

    IF v_booked_for NOT IN ('self', 'family') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid booked_for parameter: must be "self" or "family"');
    END IF;

    -- Strict validation for family booking
    IF v_booked_for = 'family' THEN
        v_target_name := NULLIF(trim(COALESCE(p_patient_name, '')), '');
        IF v_target_name IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Patient name is required when booking for family / minor'
            );
        END IF;

        IF length(v_target_name) > 100 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Patient name must not exceed 100 characters'
            );
        END IF;

        IF p_patient_age IS NOT NULL THEN
            IF p_patient_age < 0 OR p_patient_age > 120 THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Patient age must be between 0 and 120'
                );
            END IF;
        END IF;

        IF p_patient_relationship IS NOT NULL THEN
            IF lower(trim(p_patient_relationship)) IN ('child', 'spouse', 'parent', 'sibling', 'other') THEN
                p_patient_relationship := lower(trim(p_patient_relationship));
            ELSE
                p_patient_relationship := 'other';
            END IF;
        END IF;

        IF p_booking_note IS NOT NULL AND length(p_booking_note) > 200 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Booking note must not exceed 200 characters'
            );
        END IF;
    ELSE
        p_patient_name := NULL;
        p_patient_phone := NULL;
        p_patient_relationship := NULL;
        p_patient_age := NULL;
        p_booking_note := NULL;
        v_target_name := NULL;
        v_target_phone := NULL;
    END IF;

    -- ACCOUNT BLOCK ENFORCEMENT
    SELECT blocked_until
    INTO v_customer_blocked_until
    FROM public.profiles
    WHERE id = p_customer_id;

    IF v_customer_blocked_until IS NOT NULL AND v_customer_blocked_until > NOW() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Your account is blocked for 7 days due to excessive no-shows',
            'blocked_until', v_customer_blocked_until
        );
    END IF;

    -- Validate slot times
    IF p_slot_end <= p_slot_start THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: slot_end must be after slot_start');
    END IF;

    IF p_slot_start < (NOW() - INTERVAL '5 minutes') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: cannot book slots in the past');
    END IF;

    -- Fetch resource
    SELECT provider_id, deposit_amount, is_active, price
    INTO v_provider_id, v_deposit_amount, v_is_active, v_consultation_fee
    FROM public.resources
    WHERE id = p_resource_id;

    IF NOT FOUND OR NOT v_is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Resource not found or inactive');
    END IF;

    -- Fetch provider status, category, operational daily booking limit, cooling period, and is_active
    SELECT status, category_id, daily_booking_limit, COALESCE(cooling_period_days, 0), is_active
    INTO v_provider_status, v_category_id, v_daily_booking_limit, v_cooling_period_days, v_provider_is_active
    FROM public.providers 
    WHERE id = v_provider_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Provider not found');
    END IF;

    IF v_provider_status = 'SUSPENDED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Merchant provider is suspended');
    END IF;

    IF v_provider_is_active = FALSE OR v_provider_status = 'PAUSED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This venue is temporarily paused and not accepting new appointments right now.');
    END IF;

    -- 1-HOUR TIME GAP ENFORCEMENT
    IF v_booked_for = 'family' THEN
        v_target_phone := NULLIF(trim(COALESCE(p_patient_phone, '')), '');

        -- For family, check collision only if phone or identical name is provided
        IF v_target_phone IS NOT NULL OR v_target_name IS NOT NULL THEN
            SELECT b.id INTO v_gap_conflict_id
            FROM public.bookings b
            WHERE b.customer_id = p_customer_id
              AND (b.booked_for = 'family' OR b.booking_for_someone_else = TRUE)
              AND (
                (v_target_phone IS NOT NULL AND b.patient_phone = v_target_phone)
                OR (v_target_name IS NOT NULL AND LOWER(TRIM(b.patient_name)) = LOWER(TRIM(v_target_name)))
              )
              AND (
                b.status = 'CONFIRMED'
                OR (b.status = 'HELD' AND b.hold_expires_at >= NOW())
              )
              AND (p_slot_start < b.slot_end + INTERVAL '60 minutes')
              AND (b.slot_start < p_slot_end + INTERVAL '60 minutes')
            LIMIT 1;

            IF v_gap_conflict_id IS NOT NULL THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Appointments for the same patient must be at least 1 hour apart.'
                );
            END IF;
        END IF;
    ELSE
        SELECT b.id INTO v_gap_conflict_id
        FROM public.bookings b
        WHERE b.customer_id = p_customer_id
          AND b.booked_for = 'self'
          AND b.booking_for_someone_else = FALSE
          AND (
            b.status = 'CONFIRMED'
            OR (b.status = 'HELD' AND b.hold_expires_at >= NOW())
          )
          AND (p_slot_start < b.slot_end + INTERVAL '60 minutes')
          AND (b.slot_start < p_slot_end + INTERVAL '60 minutes')
        LIMIT 1;

        IF v_gap_conflict_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Appointments for the same patient must be at least 1 hour apart. To book for a family member or friend, select ''Booking for someone else'' (or select ''Booking for family / minor'').'
            );
        END IF;
    END IF;

    -- Auto-clean expired holds scoped to requested resource & slot
    PERFORM set_config('app.trusted_write', 'true', true);
    UPDATE public.bookings
    SET status = 'CANCELLED', payment_status = 'FORFEITED', updated_at = NOW()
    WHERE resource_id = p_resource_id
      AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end)
      AND status = 'HELD'
      AND hold_expires_at < NOW();

    -- Daily Booking Limit Concurrency Guard
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
          AND (
            status IN ('CONFIRMED', 'COMPLETED')
            OR (status = 'HELD' AND hold_expires_at >= NOW())
          );

        IF v_daily_count >= v_daily_booking_limit THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'This venue has reached its daily booking limit (' || v_daily_booking_limit || ') for this date. Please choose another day.'
            );
        END IF;
    END IF;

    -- Cooling period evaluation
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
            v_consultation_fee := 0.00;
        END IF;
    END IF;

    -- SPLIT PAYMENT LOGIC:
    -- Platform fee is paid online now to reserve slot.
    -- Consultation fee is paid directly at hospital desk.
    IF NOT v_is_followup THEN
        v_platform_fee := CASE WHEN v_category_id IN ('gaming', 'turf') THEN 50.00 ELSE 10.00 END;
        v_deposit_amount := v_platform_fee;
        v_total_amount := v_platform_fee;
        v_consultation_fee := COALESCE(v_consultation_fee, 500.00);
    END IF;

    -- Overlap exclusion check
    SET LOCAL lock_timeout = '3s';
    SELECT id INTO v_existing_id
    FROM public.bookings
    WHERE resource_id = p_resource_id
      AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end)
      AND (
        status = 'CONFIRMED'
        OR (status = 'HELD' AND hold_expires_at >= NOW())
      )
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
            disclaimer_version, is_followup, followup_original_booking_id,
            booking_for_someone_else, booked_for, patient_name, patient_phone, patient_relationship,
            patient_age, booking_note,
            platform_fee_amount, consultation_fee_amount,
            platform_payment_status, consultation_payment_status
        ) VALUES (
            p_customer_id, v_provider_id, p_resource_id,
            p_slot_start, p_slot_end, 'HELD', 'PENDING',
            v_deposit_amount, v_platform_fee, v_total_amount, v_hold_expiry,
            'v1', v_is_followup, v_followup_original_booking_id,
            (v_booked_for = 'family'),
            v_booked_for,
            v_target_name,
            v_target_phone,
            p_patient_relationship,
            p_patient_age,
            p_booking_note,
            v_platform_fee,
            v_consultation_fee,
            'PENDING',
            'PENDING_OFFLINE'
        )
        RETURNING id, reference_code INTO v_new_booking_id, v_reference_code;
    EXCEPTION
        WHEN exclusion_violation OR unique_violation THEN
            RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked');
    END;

    v_is_minor := (p_patient_age IS NOT NULL AND p_patient_age < 18);

    RETURN jsonb_build_object(
        'success',                      true,
        'booking_id',                   v_new_booking_id,
        'reference_code',               v_reference_code,
        'deposit_amount',               v_deposit_amount,
        'platform_fee',                 v_platform_fee,
        'total_amount',                 v_total_amount,
        'platform_fee_amount',          v_platform_fee,
        'consultation_fee_amount',      v_consultation_fee,
        'platform_payment_status',      'PENDING',
        'consultation_payment_status',  'PENDING_OFFLINE',
        'hold_expires_at',              v_hold_expiry,
        'is_followup',                  v_is_followup,
        'followup_original_booking_id', v_followup_original_booking_id,
        'booking_for_someone_else',      (v_booked_for = 'family'),
        'booked_for',                   v_booked_for,
        'patient_name',                 v_target_name,
        'patient_age',                  p_patient_age,
        'patient_relationship',         p_patient_relationship,
        'is_minor',                     v_is_minor,
        'booking_note',                 p_booking_note
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id uuid,
    p_slot_start timestamp with time zone,
    p_slot_end timestamp with time zone,
    p_customer_id uuid,
    p_booking_for_someone_else boolean DEFAULT false,
    p_patient_name text DEFAULT NULL::text,
    p_patient_phone text DEFAULT NULL::text,
    p_patient_relationship text DEFAULT NULL::text,
    p_booked_for text DEFAULT 'self'::text,
    p_patient_age smallint DEFAULT NULL::smallint,
    p_booking_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.create_booking_hold(p_resource_id, p_slot_start, p_slot_end, p_customer_id, p_booking_for_someone_else, p_patient_name, p_patient_phone, p_patient_relationship, p_booked_for, p_patient_age, p_booking_note);
$$;

REVOKE ALL ON FUNCTION private.create_booking_hold FROM PUBLIC;
REVOKE ALL ON FUNCTION private.create_booking_hold FROM anon;
GRANT EXECUTE ON FUNCTION private.create_booking_hold TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_booking_hold FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_booking_hold FROM anon;
GRANT EXECUTE ON FUNCTION public.create_booking_hold TO authenticated, service_role;

COMMIT;

