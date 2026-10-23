-- =============================================================================
-- Migration: 20261024000003_permanent_pin_and_one_hour_patient_gap.sql
-- Description:
--   1. Permanent Lifetime Customer Check-In PIN:
--      - Add permanent_checkin_pin column to public.profiles.
--      - Auto-generate permanent 4-digit PIN for existing & new customer profiles.
--      - Bind booking check-in codes directly to customer's permanent lifetime PIN.
--      - Drop unique_shop_date_checkin_code and enforce unique_booking_checkin_code.
--      - Update verify_checkin_code to match closest CONFIRMED booking for the PIN.
--   2. 1-Hour Time Gap for Same Patient & Family/Friend Booking:
--      - Add booking_for_someone_else, patient_name, patient_phone, patient_relationship to bookings.
--      - Update create_booking_hold with 1-hour gap enforcement for same patient.
--      - Bypass 1-hour gap when booking for family or friend (someone else).
--   3. Doctor Emergency Mid-Day Leave & Cancellation:
--      - Add emergency_cancelled, emergency_doctor_arrived, emergency_patient_choice to bookings.
--      - Update cancel_doctor_emergency to record doctor arrival state and emergency flags.
--      - Add choose_emergency_option RPC (Wait/Reschedule/Refund for arrived; Reschedule/Refund otherwise).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PERMANENT LIFETIME CUSTOMER CHECK-IN PIN
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS permanent_checkin_pin TEXT;

-- Backfill existing profiles with a 4-digit numeric PIN if missing
UPDATE public.profiles
SET permanent_checkin_pin = lpad((floor(random() * 10000))::int::text, 4, '0')
WHERE permanent_checkin_pin IS NULL;

-- Helper function to fetch or initialize customer's permanent lifetime PIN
CREATE OR REPLACE FUNCTION public.get_or_create_customer_checkin_pin(p_customer_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_pin TEXT;
  v_bytes BYTEA;
  v_rand_val BIGINT;
BEGIN
  SELECT permanent_checkin_pin INTO v_pin
  FROM public.profiles
  WHERE id = p_customer_id;

  IF v_pin IS NOT NULL AND v_pin ~ '^[0-9]{4}$' THEN
    RETURN v_pin;
  END IF;

  -- Generate 4-digit CSPRNG PIN
  v_bytes := gen_random_bytes(4);
  v_rand_val := (
    (get_byte(v_bytes, 0)::bigint << 24) |
    (get_byte(v_bytes, 1)::bigint << 16) |
    (get_byte(v_bytes, 2)::bigint << 8)  |
    (get_byte(v_bytes, 3)::bigint)
  ) & 2147483647;
  v_pin := lpad((v_rand_val % 10000)::text, 4, '0');

  UPDATE public.profiles
  SET permanent_checkin_pin = v_pin,
      updated_at = NOW()
  WHERE id = p_customer_id;

  RETURN v_pin;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_customer_checkin_pin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_customer_checkin_pin(UUID) TO authenticated, service_role;
GRANT SELECT (permanent_checkin_pin) ON public.profiles TO authenticated, anon;

-- Update handle_new_auth_user to assign permanent_checkin_pin on account signup
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_pin TEXT;
  v_bytes BYTEA;
  v_rand_val BIGINT;
BEGIN
  v_bytes := gen_random_bytes(4);
  v_rand_val := (
    (get_byte(v_bytes, 0)::bigint << 24) |
    (get_byte(v_bytes, 1)::bigint << 16) |
    (get_byte(v_bytes, 2)::bigint << 8)  |
    (get_byte(v_bytes, 3)::bigint)
  ) & 2147483647;
  v_pin := lpad((v_rand_val % 10000)::text, 4, '0');

  INSERT INTO public.profiles (id, phone, full_name, role, email, permanent_checkin_pin)
  VALUES (
    NEW.id,
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Customer ' || right(COALESCE(NEW.phone, NEW.id::text), 4)),
    'customer',
    NEW.email,
    v_pin
  )
  ON CONFLICT (id) DO UPDATE SET
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    permanent_checkin_pin = COALESCE(public.profiles.permanent_checkin_pin, v_pin),
    updated_at = now();
  RETURN NEW;
END;
$$;

-- Adjust constraints on appointment_checkin_codes:
-- Drop unique_shop_date_checkin_code because a customer's permanent lifetime PIN
-- can be used across multiple bookings on the same date or venue.
ALTER TABLE public.appointment_checkin_codes
DROP CONSTRAINT IF EXISTS unique_shop_date_checkin_code;

ALTER TABLE public.appointment_checkin_codes
DROP CONSTRAINT IF EXISTS unique_booking_checkin_code;

ALTER TABLE public.appointment_checkin_codes
ADD CONSTRAINT unique_booking_checkin_code UNIQUE (booking_id);

-- Update generate_appointment_checkin_code_for_booking to use customer's permanent lifetime PIN
CREATE OR REPLACE FUNCTION public.generate_appointment_checkin_code_for_booking(p_booking_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_appt_date DATE;
  v_existing_code TEXT;
  v_customer_pin TEXT;
BEGIN
  SELECT code INTO v_existing_code
  FROM public.appointment_checkin_codes
  WHERE booking_id = p_booking_id;

  IF v_existing_code IS NOT NULL THEN
    RETURN v_existing_code;
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_appt_date := (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date;
  v_customer_pin := public.get_or_create_customer_checkin_pin(v_booking.customer_id);

  INSERT INTO public.appointment_checkin_codes (
    booking_id,
    provider_id,
    customer_id,
    appointment_date,
    code
  ) VALUES (
    v_booking.id,
    v_booking.provider_id,
    v_booking.customer_id,
    v_appt_date,
    v_customer_pin
  )
  ON CONFLICT (booking_id) DO UPDATE
  SET code = EXCLUDED.code,
      appointment_date = EXCLUDED.appointment_date;

  RETURN v_customer_pin;
END;
$$;

-- Update verify_checkin_code to resolve closest confirmed booking for the customer's permanent PIN
CREATE OR REPLACE FUNCTION public.verify_checkin_code(
    p_shop_id UUID,
    p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_staff_id UUID := auth.uid();
  v_now TIMESTAMPTZ := public.get_test_clock(p_shop_id);
  v_today_ist DATE := (v_now AT TIME ZONE 'Asia/Kolkata')::date;
  v_clean_code TEXT := trim(p_code);
  v_rate_limit public.staff_checkin_rate_limits%ROWTYPE;
  v_checkin_record public.appointment_checkin_codes%ROWTYPE;
  v_other_date_record public.appointment_checkin_codes%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_patient_name TEXT;
  v_service_doctor TEXT;
  v_slot_time_str TEXT;
  v_is_late BOOLEAN;
  v_window_start TIMESTAMPTZ;
  v_is_hospital BOOLEAN;
  v_hosp_role TEXT;
  v_caller_dept_id UUID;
  v_dept_modules TEXT[];
  v_is_owner BOOLEAN;
BEGIN
  -- 1. Authentication check
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Authentication required'
    );
  END IF;

  v_is_hospital := public.is_hospital_provider(p_shop_id);

  -- 2. Rate limit check: 5 failed attempts locks staff for 60 seconds
  SELECT * INTO v_rate_limit
  FROM public.staff_checkin_rate_limits
  WHERE user_id = v_staff_id;

  IF FOUND THEN
    IF v_rate_limit.locked_until IS NOT NULL AND v_rate_limit.locked_until > v_now THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'RATE_LIMITED',
        'message', 'Too many failed attempts. Locked for 60 seconds.',
        'locked_until', v_rate_limit.locked_until
      );
    ELSIF v_rate_limit.locked_until IS NOT NULL AND v_rate_limit.locked_until <= v_now THEN
      UPDATE public.staff_checkin_rate_limits
      SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
      WHERE user_id = v_staff_id;
    END IF;
  ELSE
    INSERT INTO public.staff_checkin_rate_limits (user_id, failed_attempts, locked_until, updated_at)
    VALUES (v_staff_id, 0, NULL, v_now)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- ───────────────────────────────────────────────────────────────────────────
  -- NON-HOSPITAL PROVIDERS
  -- ───────────────────────────────────────────────────────────────────────────
  IF NOT v_is_hospital THEN
    v_is_owner := (p_shop_id IN (SELECT public.get_user_authorized_providers(v_staff_id)))
                  OR public.is_admin(v_staff_id);

    IF NOT v_is_owner THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'UNAUTHORIZED',
        'message', 'Staff is not authorized for this shop'
      );
    END IF;

    -- Lookup checkin code for this shop today, prioritizing CONFIRMED closest to now
    SELECT c.* INTO v_checkin_record
    FROM public.appointment_checkin_codes c
    JOIN public.bookings b ON b.id = c.booking_id
    WHERE c.provider_id = p_shop_id
      AND c.appointment_date = v_today_ist
      AND c.code = v_clean_code
    ORDER BY (b.status = 'CONFIRMED') DESC, ABS(EXTRACT(EPOCH FROM (b.slot_start - v_now))) ASC
    LIMIT 1
    FOR UPDATE OF b;

    IF NOT FOUND THEN
      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'Invalid check-in code');
    END IF;

    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = v_checkin_record.booking_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'BOOKING_NOT_FOUND', 'message', 'Associated appointment record not found');
    END IF;

    IF v_booking.status = 'CHECKED_IN' OR v_booking.is_present = TRUE THEN
      -- Check if customer has an active CONFIRMED booking in the future
      SELECT c.* INTO v_other_date_record
      FROM public.appointment_checkin_codes c
      JOIN public.bookings b ON b.id = c.booking_id
      WHERE c.provider_id = p_shop_id
        AND c.code = v_clean_code
        AND c.appointment_date > v_today_ist
        AND b.status = 'CONFIRMED'
      ORDER BY c.appointment_date ASC
      LIMIT 1;

      IF v_other_date_record.id IS NOT NULL THEN
        PERFORM public._record_checkin_failure(v_staff_id, v_now);
        RETURN jsonb_build_object(
          'success', false,
          'error', 'APPOINTMENT_FUTURE',
          'message', 'This check-in code is scheduled for a future date: ' || to_char(v_other_date_record.appointment_date, 'YYYY-MM-DD') || '. Check-in opens on the scheduled appointment date.',
          'appointment_date', v_other_date_record.appointment_date
        );
      END IF;

      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'This appointment is already checked in');
    END IF;

    IF v_booking.status != 'CONFIRMED' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Appointment is not in confirmed status (current: ' || v_booking.status || ')');
    END IF;

    v_window_start := v_booking.slot_start - interval '60 minutes';
    IF v_now < v_window_start THEN
      RETURN jsonb_build_object('success', false, 'error', 'TOO_EARLY', 'message', 'Check-in opens 60 minutes before scheduled time');
    END IF;

    v_is_late := v_now > (v_booking.slot_start + interval '10 minutes');

    PERFORM set_config('app.trusted_write', 'true', true);

    UPDATE public.bookings
    SET status = 'CHECKED_IN',
        is_present = TRUE,
        checked_in_at = v_now,
        checked_in_by = v_staff_id,
        checked_in_method = 'code',
        customer_arrived_at = COALESCE(customer_arrived_at, v_now),
        updated_at = v_now
    WHERE id = v_booking.id
      AND status = 'CONFIRMED'
      AND is_present = FALSE;

    UPDATE public.staff_checkin_rate_limits
    SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
    WHERE user_id = v_staff_id;

    SELECT COALESCE(v_booking.patient_name, full_name, 'Patient') INTO v_patient_name FROM public.profiles WHERE id = v_booking.customer_id;
    SELECT name INTO v_service_doctor FROM public.resources WHERE id = v_booking.resource_id;
    v_slot_time_str := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');

    RETURN jsonb_build_object(
      'success', true,
      'booking_id', v_booking.id,
      'patient_name', v_patient_name,
      'service_doctor', v_service_doctor,
      'slot_time', v_slot_time_str,
      'is_late', v_is_late,
      'checked_in_at', v_now
    );
  END IF;

  -- ───────────────────────────────────────────────────────────────────────────
  -- HOSPITAL PROVIDERS
  -- ───────────────────────────────────────────────────────────────────────────
  v_hosp_role := public.hospital_role(p_shop_id, v_staff_id);

  IF v_hosp_role = 'none' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Staff is not authorized for this hospital'
    );
  END IF;

  -- Department check-in module verification for non-admin hospital staff
  IF v_hosp_role != 'admin' THEN
    SELECT d.id, d.allowed_modules INTO v_caller_dept_id, v_dept_modules
    FROM public.departments d
    JOIN public.department_members dm ON dm.department_id = d.id
    WHERE dm.user_id = v_staff_id
      AND dm.merchant_id = p_shop_id
      AND dm.status = 'active'
    LIMIT 1;

    IF v_caller_dept_id IS NULL OR NOT ('check_in' = ANY(v_dept_modules)) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'MODULE_DISABLED',
        'message', 'Check-in desk module is not enabled for your department'
      );
    END IF;
  END IF;

  -- Lookup today's checkin code for this hospital, prioritizing CONFIRMED closest to now
  SELECT c.* INTO v_checkin_record
  FROM public.appointment_checkin_codes c
  JOIN public.bookings b ON b.id = c.booking_id
  WHERE c.provider_id = p_shop_id
    AND c.appointment_date = v_today_ist
    AND c.code = v_clean_code
  ORDER BY (b.status = 'CONFIRMED') DESC, ABS(EXTRACT(EPOCH FROM (b.slot_start - v_now))) ASC
  LIMIT 1
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    -- Check other dates for bookings accessible to this caller
    SELECT c.* INTO v_other_date_record
    FROM public.appointment_checkin_codes c
    JOIN public.bookings b ON b.id = c.booking_id
    WHERE c.provider_id = p_shop_id
      AND c.code = v_clean_code
      AND (
        v_hosp_role = 'admin'
        OR (
          b.resource_id IN (SELECT public.hospital_accessible_resource_ids(p_shop_id, v_staff_id))
          AND (v_caller_dept_id IS NULL OR COALESCE(b.department_id, (SELECT r.department_id FROM public.resources r WHERE r.id = b.resource_id)) = v_caller_dept_id)
        )
      )
    ORDER BY (c.appointment_date > v_today_ist) DESC, c.appointment_date DESC
    LIMIT 1;

    PERFORM public._record_checkin_failure(v_staff_id, v_now);

    IF v_other_date_record.id IS NOT NULL THEN
      IF v_other_date_record.appointment_date > v_today_ist THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'APPOINTMENT_FUTURE',
          'message', 'This check-in code is scheduled for a future date: ' || to_char(v_other_date_record.appointment_date, 'YYYY-MM-DD') || '. Check-in opens on the scheduled appointment date.',
          'appointment_date', v_other_date_record.appointment_date
        );
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'error', 'EXPIRED',
          'message', 'This check-in code was for ' || to_char(v_other_date_record.appointment_date, 'YYYY-MM-DD') || ' and has expired',
          'appointment_date', v_other_date_record.appointment_date
        );
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_CODE',
      'message', 'Invalid check-in code'
    );
  END IF;

  -- Fetch associated booking (already locked via FOR UPDATE OF b)
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_checkin_record.booking_id;

  IF NOT FOUND THEN
    PERFORM public._record_checkin_failure(v_staff_id, v_now);
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_CODE',
      'message', 'Invalid check-in code'
    );
  END IF;

  -- Enforce per-consultant access & department boundary
  IF v_hosp_role != 'admin' THEN
    IF COALESCE(v_booking.department_id, (SELECT r.department_id FROM public.resources r WHERE r.id = v_booking.resource_id)) IS DISTINCT FROM v_caller_dept_id
       OR v_booking.resource_id NOT IN (SELECT public.hospital_accessible_resource_ids(p_shop_id, v_staff_id)) THEN
      -- Unauthorized doctor or department: count toward rate limit and return uniform INVALID_CODE
      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INVALID_CODE',
        'message', 'Invalid check-in code'
      );
    END IF;
  END IF;

  -- State validation
  IF v_booking.status = 'CHECKED_IN' OR v_booking.is_present = TRUE THEN
    -- Check if the patient has an active CONFIRMED booking in the future accessible to this caller
    SELECT c.* INTO v_other_date_record
    FROM public.appointment_checkin_codes c
    JOIN public.bookings b ON b.id = c.booking_id
    WHERE c.provider_id = p_shop_id
      AND c.code = v_clean_code
      AND c.appointment_date > v_today_ist
      AND b.status = 'CONFIRMED'
      AND (
        v_hosp_role = 'admin'
        OR (
          b.resource_id IN (SELECT public.hospital_accessible_resource_ids(p_shop_id, v_staff_id))
          AND (v_caller_dept_id IS NULL OR COALESCE(b.department_id, (SELECT r.department_id FROM public.resources r WHERE r.id = b.resource_id)) = v_caller_dept_id)
        )
      )
    ORDER BY c.appointment_date ASC
    LIMIT 1;

    IF v_other_date_record.id IS NOT NULL THEN
      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object(
        'success', false,
        'error', 'APPOINTMENT_FUTURE',
        'message', 'This check-in code is scheduled for a future date: ' || to_char(v_other_date_record.appointment_date, 'YYYY-MM-DD') || '. Check-in opens on the scheduled appointment date.',
        'appointment_date', v_other_date_record.appointment_date
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'ALREADY_CHECKED_IN',
      'message', 'This appointment is already checked in'
    );
  END IF;

  IF v_booking.status != 'CONFIRMED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_STATUS',
      'message', 'Appointment is not in confirmed status (current: ' || v_booking.status || ')'
    );
  END IF;

  -- Time window validation: max 60 minutes before slot_start
  v_window_start := v_booking.slot_start - interval '60 minutes';
  IF v_now < v_window_start THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TOO_EARLY',
      'message', 'Check-in opens 60 minutes before scheduled time (opens at ' || to_char(v_window_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') || ')'
    );
  END IF;

  v_is_late := v_now > (v_booking.slot_start + interval '10 minutes');

  -- Atomic state transition
  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CHECKED_IN',
      is_present = TRUE,
      checked_in_at = v_now,
      checked_in_by = v_staff_id,
      checked_in_method = 'code',
      customer_arrived_at = COALESCE(customer_arrived_at, v_now),
      updated_at = v_now
  WHERE id = v_booking.id
    AND status = 'CONFIRMED'
    AND is_present = FALSE;

  -- Reset rate limit failure counter on successful check-in
  UPDATE public.staff_checkin_rate_limits
  SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
  WHERE user_id = v_staff_id;

  SELECT COALESCE(v_booking.patient_name, full_name, 'Patient') INTO v_patient_name
  FROM public.profiles WHERE id = v_booking.customer_id;

  SELECT name INTO v_service_doctor FROM public.resources WHERE id = v_booking.resource_id;
  v_slot_time_str := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'patient_name', v_patient_name,
    'service_doctor', v_service_doctor,
    'slot_time', v_slot_time_str,
    'is_late', v_is_late,
    'checked_in_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_checkin_code(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_checkin_code(UUID, TEXT) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 1-HOUR TIME GAP & FAMILY / FRIEND BOOKING COLUMNS & ENFORCEMENT
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS booking_for_someone_else BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS patient_name TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS patient_phone TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS patient_relationship TEXT DEFAULT NULL;

GRANT SELECT (booking_for_someone_else, patient_name, patient_phone, patient_relationship) ON public.bookings TO authenticated, anon;

DROP FUNCTION IF EXISTS public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id uuid,
    p_slot_start timestamp with time zone,
    p_slot_end timestamp with time zone,
    p_customer_id uuid,
    p_booking_for_someone_else boolean DEFAULT false,
    p_patient_name text DEFAULT NULL,
    p_patient_phone text DEFAULT NULL,
    p_patient_relationship text DEFAULT NULL
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
    v_customer_blocked_until TIMESTAMPTZ := NULL;
    v_customer_phone TEXT;
    v_customer_name TEXT;
    v_target_phone TEXT;
    v_target_name TEXT;
    v_gap_conflict_id UUID;
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

    -- ACCOUNT BLOCK ENFORCEMENT
    SELECT blocked_until, phone, full_name
    INTO v_customer_blocked_until, v_customer_phone, v_customer_name
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

    -- ─────────────────────────────────────────────────────────────────────────
    -- 1-HOUR TIME GAP ENFORCEMENT
    -- ─────────────────────────────────────────────────────────────────────────
    -- Determine target patient details
    IF COALESCE(p_booking_for_someone_else, false) THEN
        v_target_phone := NULLIF(trim(COALESCE(p_patient_phone, '')), '');
        v_target_name := NULLIF(trim(COALESCE(p_patient_name, '')), '');

        -- For family or friend bookings, bypass gap check against customer's self-appointments.
        -- Only check if this exact same family member has another appointment < 1 hour away.
        IF v_target_phone IS NOT NULL THEN
            SELECT b.id INTO v_gap_conflict_id
            FROM public.bookings b
            WHERE b.customer_id = p_customer_id
              AND b.booking_for_someone_else = TRUE
              AND b.patient_phone = v_target_phone
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
        -- Self-booking: must have >= 1 hour gap between appointments for the same patient
        SELECT b.id INTO v_gap_conflict_id
        FROM public.bookings b
        WHERE b.customer_id = p_customer_id
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
                'error', 'Appointments for the same patient must be at least 1 hour apart. To book for a family member or friend, select ''Booking for someone else''.'
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
        END IF;
    END IF;

    IF NOT v_is_followup THEN
        IF COALESCE(v_deposit_amount, 0) < 100 THEN
            v_deposit_amount := 100.00;
        END IF;

        v_platform_fee := CASE WHEN v_category_id IN ('gaming', 'turf') THEN 50.00 ELSE 10.00 END;
        v_total_amount := v_deposit_amount + v_platform_fee;
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
            booking_for_someone_else, patient_name, patient_phone, patient_relationship
        ) VALUES (
            p_customer_id, v_provider_id, p_resource_id,
            p_slot_start, p_slot_end, 'HELD', 'PENDING',
            v_deposit_amount, v_platform_fee, v_total_amount, v_hold_expiry,
            'v1', v_is_followup, v_followup_original_booking_id,
            COALESCE(p_booking_for_someone_else, false),
            v_target_name,
            v_target_phone,
            p_patient_relationship
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
        'followup_original_booking_id', v_followup_original_booking_id,
        'booking_for_someone_else',      COALESCE(p_booking_for_someone_else, false),
        'patient_name',                 v_target_name
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DOCTOR EMERGENCY CANCELLATION & PATIENT TRIAGE (WAIT / RESCHEDULE / REFUND)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS emergency_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS emergency_doctor_arrived BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS emergency_patient_choice TEXT DEFAULT NULL;

GRANT SELECT (emergency_cancelled, emergency_doctor_arrived, emergency_patient_choice) ON public.bookings TO authenticated, anon;

DROP FUNCTION IF EXISTS public.cancel_doctor_emergency(UUID, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.cancel_doctor_emergency(
  p_doctor_resource_id UUID,
  p_effective_from TIMESTAMPTZ DEFAULT NULL,
  p_reason TEXT DEFAULT 'Doctor Emergency / Unscheduled Medical Departure',
  p_doctor_arrived BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doctor_res RECORD;
  v_provider RECORD;
  v_effective_time TIMESTAMPTZ;
  v_cancelled_count INT := 0;
  v_total_refund NUMERIC(10, 2) := 0.00;
  v_affected_ids UUID[] := ARRAY[]::UUID[];
  v_booking RECORD;
  v_refund_amt NUMERIC(10, 2);
  v_now TIMESTAMPTZ;
BEGIN
  -- 1. Validate Doctor Resource
  SELECT r.id, r.provider_id, r.name, r.type
  INTO v_doctor_res
  FROM public.resources r
  WHERE r.id = p_doctor_resource_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Doctor resource not found');
  END IF;

  SELECT * INTO v_provider
  FROM public.providers
  WHERE id = v_doctor_res.provider_id;

  -- 2. Authorization Check
  IF auth.role() = 'authenticated' THEN
    IF NOT (
      v_doctor_res.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
      OR public.is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.hospital_department_members m
        WHERE m.user_id = auth.uid() AND m.role IN ('ADMIN', 'DOCTOR')
      )
    ) THEN
      RAISE EXCEPTION 'Access denied: You are not authorized to cancel doctor schedule';
    END IF;
  END IF;

  v_now := public.get_test_clock(v_doctor_res.provider_id);
  v_effective_time := COALESCE(p_effective_from, v_now);

  -- Enable trusted write
  PERFORM set_config('app.trusted_write', 'true', true);

  -- 3. Bulk cancel all upcoming active appointments for this doctor resource
  FOR v_booking IN
    SELECT 
      b.id,
      b.customer_id,
      b.provider_id,
      b.slot_start,
      b.slot_end,
      b.status,
      b.payment_status,
      b.deposit_amount,
      b.platform_fee,
      b.platform_fee_gst,
      b.total_amount,
      p.full_name AS customer_name,
      p.phone AS customer_phone
    FROM public.bookings b
    LEFT JOIN public.profiles p ON p.id = b.customer_id
    WHERE b.resource_id = p_doctor_resource_id
      AND b.slot_start >= v_effective_time
      AND b.status IN ('HELD', 'CONFIRMED', 'WAITING', 'UP_NEXT')
    FOR UPDATE OF b
  LOOP
    -- 100% Full Refund Policy including platform fee
    v_refund_amt := COALESCE(v_booking.deposit_amount, 0.00) +
                    COALESCE(v_booking.platform_fee, 0.00) +
                    COALESCE(v_booking.platform_fee_gst, 0.00);

    IF v_refund_amt = 0.00 AND v_booking.total_amount IS NOT NULL THEN
      v_refund_amt := v_booking.total_amount;
    END IF;

    -- Update booking status to CANCELLED with REFUND_PENDING and mark emergency flags
    UPDATE public.bookings
    SET 
      status = 'CANCELLED',
      payment_status = CASE 
        WHEN v_booking.payment_status = 'CAPTURED' THEN 'REFUND_PENDING'::public.payment_status
        ELSE v_booking.payment_status
      END,
      emergency_cancelled = TRUE,
      emergency_doctor_arrived = p_doctor_arrived,
      emergency_patient_choice = NULL,
      is_present = FALSE,
      updated_at = v_now
    WHERE id = v_booking.id;

    -- Emits high-priority SMS / WhatsApp notification log
    INSERT INTO public.notification_logs (
      booking_id,
      recipient_name,
      recipient_phone,
      event_type,
      channel,
      status,
      message_content,
      created_at
    ) VALUES (
      v_booking.id,
      COALESCE(v_booking.customer_name, 'Patient'),
      COALESCE(v_booking.customer_phone, '+919999999999'),
      'DOCTOR_EMERGENCY_CANCELLED',
      'SMS',
      'SENT',
      format('Due to an emergency, %s is not available. Your appointment has been cancelled and a 100%% full refund of ₹%s (including deposit and platform fee) has been initiated. Open your app to reschedule or choose available options.',
             v_doctor_res.name,
             v_refund_amt),
      v_now
    );

    v_cancelled_count := v_cancelled_count + 1;
    v_total_refund := v_total_refund + v_refund_amt;
    v_affected_ids := array_append(v_affected_ids, v_booking.id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'doctor_resource_id', p_doctor_resource_id,
    'doctor_name', v_doctor_res.name,
    'provider_id', v_doctor_res.provider_id,
    'doctor_arrived', p_doctor_arrived,
    'cancelled_count', v_cancelled_count,
    'total_refund_amount', v_total_refund,
    'affected_booking_ids', to_jsonb(v_affected_ids),
    'merchant_strikes_applied', 0,
    'reason', p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_doctor_emergency(UUID, TIMESTAMPTZ, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_doctor_emergency(UUID, TIMESTAMPTZ, TEXT, BOOLEAN) TO authenticated, service_role;

-- RPC for affected customer to submit emergency option (Wait / Reschedule / Refund)
CREATE OR REPLACE FUNCTION public.choose_emergency_option(
    p_booking_id UUID,
    p_choice TEXT,
    p_new_slot_start TIMESTAMPTZ DEFAULT NULL,
    p_new_slot_end TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_choice_upper TEXT := upper(trim(p_choice));
    v_now TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    -- Ensure caller is the booking customer or admin
    IF auth.role() = 'authenticated' AND auth.uid() != v_booking.customer_id THEN
        IF NOT public.is_admin(auth.uid()) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
        END IF;
    END IF;

    IF NOT v_booking.emergency_cancelled THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking was not emergency cancelled');
    END IF;

    v_now := public.get_test_clock(v_booking.provider_id);

    -- Validate choice:
    -- If doctor arrived mid-session: WAIT, RESCHEDULE, REFUND
    -- If doctor did not arrive: RESCHEDULE, REFUND only
    IF v_choice_upper = 'WAIT' THEN
        IF NOT v_booking.emergency_doctor_arrived THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Wait option is only available when doctor arrived at clinic. Please choose Reschedule or Refund.'
            );
        END IF;
    ELSIF v_choice_upper NOT IN ('RESCHEDULE', 'REFUND') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid choice. Must be WAIT, RESCHEDULE, or REFUND');
    END IF;

    PERFORM set_config('app.trusted_write', 'true', true);

    IF v_choice_upper = 'REFUND' THEN
        UPDATE public.bookings
        SET emergency_patient_choice = 'REFUND',
            payment_status = 'REFUND_PENDING',
            updated_at = v_now
        WHERE id = p_booking_id;
    ELSIF v_choice_upper = 'WAIT' THEN
        UPDATE public.bookings
        SET emergency_patient_choice = 'WAIT',
            status = 'WAITING',
            updated_at = v_now
        WHERE id = p_booking_id;
    ELSIF v_choice_upper = 'RESCHEDULE' THEN
        IF p_new_slot_start IS NOT NULL AND p_new_slot_end IS NOT NULL THEN
            UPDATE public.bookings
            SET emergency_patient_choice = 'RESCHEDULE',
                status = 'CONFIRMED',
                slot_start = p_new_slot_start,
                slot_end = p_new_slot_end,
                updated_at = v_now
            WHERE id = p_booking_id;
        ELSE
            UPDATE public.bookings
            SET emergency_patient_choice = 'RESCHEDULE',
                updated_at = v_now
            WHERE id = p_booking_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'choice', v_choice_upper,
        'doctor_arrived', v_booking.emergency_doctor_arrived
    );
END;
$$;

REVOKE ALL ON FUNCTION public.choose_emergency_option(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.choose_emergency_option(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
