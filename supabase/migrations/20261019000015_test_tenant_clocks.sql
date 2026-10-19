-- =============================================================================
-- Migration: 20261019000015_test_tenant_clocks.sql
-- Description:
--   Phase 0: Shared Foundation - Per-Tenant Virtual Test Clocks.
--   Allows isolated sub-agent test workstreams (SA1-SA8) to independently
--   control current time in 'Asia/Kolkata' without interfering with other
--   tenants or real system time.
--   When no virtual clock exists for a tenant, falls back to clock_timestamp().
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.test_tenant_clocks (
    tenant_prefix TEXT PRIMARY KEY,
    simulated_time TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.test_provider_clock_links (
    provider_id UUID PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
    tenant_prefix TEXT NOT NULL REFERENCES public.test_tenant_clocks(tenant_prefix) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: Resolves the effective current time for a given provider or tenant.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_test_clock(p_provider_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_simulated TIMESTAMPTZ;
BEGIN
  IF p_provider_id IS NOT NULL THEN
    -- 1. Explicit link lookup
    SELECT c.simulated_time INTO v_simulated
    FROM public.test_provider_clock_links l
    JOIN public.test_tenant_clocks c ON c.tenant_prefix = l.tenant_prefix
    WHERE l.provider_id = p_provider_id;

    IF FOUND AND v_simulated IS NOT NULL THEN
      RETURN v_simulated;
    END IF;

    -- 2. Name prefix matching (e.g. '[SA1] Apex Hospital')
    SELECT c.simulated_time INTO v_simulated
    FROM public.providers p
    JOIN public.test_tenant_clocks c 
      ON p.name ILIKE ('[' || c.tenant_prefix || ']%')
    WHERE p.id = p_provider_id
    LIMIT 1;

    IF FOUND AND v_simulated IS NOT NULL THEN
      RETURN v_simulated;
    END IF;
  END IF;

  RETURN clock_timestamp();
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: Sets or overrides a tenant's virtual time.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_test_clock(
    p_prefix TEXT,
    p_time TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.test_tenant_clocks (tenant_prefix, simulated_time, updated_at)
  VALUES (p_prefix, p_time, clock_timestamp())
  ON CONFLICT (tenant_prefix)
  DO UPDATE SET simulated_time = EXCLUDED.simulated_time, updated_at = clock_timestamp();

  RETURN p_time;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: Advances a tenant's virtual time by N minutes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.advance_test_clock(
    p_prefix TEXT,
    p_minutes INT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_current TIMESTAMPTZ;
  v_new TIMESTAMPTZ;
BEGIN
  SELECT simulated_time INTO v_current
  FROM public.test_tenant_clocks
  WHERE tenant_prefix = p_prefix;

  IF NOT FOUND THEN
    v_current := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata');
  END IF;

  v_new := v_current + (p_minutes || ' minutes')::interval;

  INSERT INTO public.test_tenant_clocks (tenant_prefix, simulated_time, updated_at)
  VALUES (p_prefix, v_new, clock_timestamp())
  ON CONFLICT (tenant_prefix)
  DO UPDATE SET simulated_time = EXCLUDED.simulated_time, updated_at = clock_timestamp();

  RETURN v_new;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: Gets the current simulated time for a prefix directly.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_test_clock_for_prefix(p_prefix TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_simulated TIMESTAMPTZ;
BEGIN
  SELECT simulated_time INTO v_simulated
  FROM public.test_tenant_clocks
  WHERE tenant_prefix = p_prefix;

  IF FOUND AND v_simulated IS NOT NULL THEN
    RETURN v_simulated;
  END IF;

  RETURN clock_timestamp();
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Update verify_checkin_code to utilize per-tenant test clock.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_other_shop_record public.appointment_checkin_codes%ROWTYPE;
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
  v_dept_member RECORD;
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
  -- NON-HOSPITAL PROVIDERS (Legacy Salon / Turf / Dining logic)
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

    -- Lookup checkin code for this shop today
    SELECT * INTO v_checkin_record
    FROM public.appointment_checkin_codes
    WHERE provider_id = p_shop_id
      AND appointment_date = v_today_ist
      AND code = v_clean_code;

    IF NOT FOUND THEN
      -- Check if code belongs to another shop
      SELECT * INTO v_other_shop_record
      FROM public.appointment_checkin_codes
      WHERE appointment_date = v_today_ist
        AND code = v_clean_code
        AND provider_id != p_shop_id
      LIMIT 1;

      IF FOUND THEN
        PERFORM public._record_checkin_failure(v_staff_id, v_now);
        RETURN jsonb_build_object(
          'success', false,
          'error', 'WRONG_SHOP',
          'message', 'This check-in code belongs to another clinic or venue'
        );
      END IF;

      -- Check if code belongs to this shop on a different date
      SELECT * INTO v_checkin_record
      FROM public.appointment_checkin_codes
      WHERE provider_id = p_shop_id
        AND code = v_clean_code
      ORDER BY appointment_date DESC
      LIMIT 1;

      IF FOUND THEN
        PERFORM public._record_checkin_failure(v_staff_id, v_now);
        IF v_checkin_record.appointment_date > v_today_ist THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'APPOINTMENT_FUTURE',
            'message', 'This check-in code is scheduled for a future date: ' || to_char(v_checkin_record.appointment_date, 'YYYY-MM-DD') || '. Check-in opens on the scheduled appointment date.',
            'appointment_date', v_checkin_record.appointment_date
          );
        ELSE
          RETURN jsonb_build_object(
            'success', false,
            'error', 'EXPIRED',
            'message', 'This check-in code was for ' || to_char(v_checkin_record.appointment_date, 'YYYY-MM-DD') || ' and has expired',
            'appointment_date', v_checkin_record.appointment_date
          );
        END IF;
      END IF;

      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'Invalid check-in code');
    END IF;

    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = v_checkin_record.booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'BOOKING_NOT_FOUND', 'message', 'Associated appointment record not found');
    END IF;

    IF v_booking.status = 'CHECKED_IN' OR v_booking.is_present = TRUE THEN
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

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'This appointment is already checked in');
    END IF;

    UPDATE public.staff_checkin_rate_limits
    SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
    WHERE user_id = v_staff_id;

    SELECT COALESCE(full_name, 'Patient') INTO v_patient_name FROM public.profiles WHERE id = v_booking.customer_id;
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
  -- HOSPITAL PROVIDERS (Per-Consultant Hardened RBAC)
  -- ───────────────────────────────────────────────────────────────────────────
  v_hosp_role := public.hospital_role(p_shop_id);

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

  -- Lookup today's checkin code for this hospital
  SELECT * INTO v_checkin_record
  FROM public.appointment_checkin_codes
  WHERE provider_id = p_shop_id
    AND appointment_date = v_today_ist
    AND code = v_clean_code;

  IF NOT FOUND THEN
    -- Check if this code belongs to an accessible doctor for this caller on another date
    SELECT c.* INTO v_other_date_record
    FROM public.appointment_checkin_codes c
    JOIN public.bookings b ON b.id = c.booking_id
    WHERE c.provider_id = p_shop_id
      AND c.code = v_clean_code
      AND (
        v_hosp_role = 'admin'
        OR (
          b.resource_id IN (SELECT public.hospital_accessible_resource_ids(p_shop_id))
          AND b.department_id = v_caller_dept_id
        )
      )
    ORDER BY c.appointment_date DESC
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

    -- Return uniform INVALID_CODE: never leak WRONG_SHOP or UNAUTHORIZED_DEPARTMENT
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_CODE',
      'message', 'Invalid check-in code'
    );
  END IF;

  -- Fetch associated booking with ROW LOCK for atomic concurrency
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_checkin_record.booking_id
  FOR UPDATE;

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
    IF v_booking.department_id IS DISTINCT FROM v_caller_dept_id
       OR v_booking.resource_id NOT IN (SELECT public.hospital_accessible_resource_ids(p_shop_id)) THEN
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

  -- Atomic state transition with trusted write context
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

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ALREADY_CHECKED_IN',
      'message', 'This appointment is already checked in'
    );
  END IF;

  -- Reset rate limit failure counter on successful check-in
  UPDATE public.staff_checkin_rate_limits
  SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
  WHERE user_id = v_staff_id;

  -- Fetch metadata for response
  SELECT COALESCE(full_name, 'Patient') INTO v_patient_name
  FROM public.profiles WHERE id = v_booking.customer_id;

  SELECT name INTO v_service_doctor
  FROM public.resources WHERE id = v_booking.resource_id;

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
-- Update mark_present_manually to utilize per-tenant test clock.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_present_manually(
    p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_staff_id UUID := auth.uid();
  v_now TIMESTAMPTZ;
  v_booking public.bookings%ROWTYPE;
  v_patient_name TEXT;
  v_service_doctor TEXT;
  v_slot_time_str TEXT;
  v_is_late BOOLEAN;
  v_is_hospital BOOLEAN;
  v_hosp_role TEXT;
BEGIN
  -- 1. Authentication check
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Authentication required');
  END IF;

  -- 2. Lookup booking with row lock
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Booking not found');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);
  v_is_hospital := public.is_hospital_provider(v_booking.provider_id);

  -- 3. Authorization check
  IF v_is_hospital THEN
    v_hosp_role := public.hospital_role(v_booking.provider_id);
    IF v_hosp_role = 'none' THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Not authorized for this hospital');
    END IF;

    -- Non-admin must be assigned Front Desk or that Consultant
    IF v_hosp_role != 'admin' THEN
      IF v_booking.resource_id NOT IN (SELECT public.hospital_accessible_resource_ids(v_booking.provider_id)) THEN
        RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Staff is not authorized for this doctor');
      END IF;
    END IF;
  ELSE
    -- Legacy non-hospital authorization
    IF NOT (v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_staff_id))) THEN
      RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Staff is not authorized for this shop');
    END IF;
  END IF;

  -- 4. Check already checked in
  IF v_booking.status = 'CHECKED_IN' OR v_booking.is_present = TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'Booking is already checked in');
  END IF;

  -- 5. Only CONFIRMED bookings can be manually marked present
  IF v_booking.status != 'CONFIRMED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Only confirmed bookings can be marked present');
  END IF;

  -- 6. Atomic state transition
  v_is_late := v_now > (v_booking.slot_start + interval '10 minutes');

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CHECKED_IN',
      is_present = TRUE,
      checked_in_at = v_now,
      checked_in_by = v_staff_id,
      checked_in_method = 'manual',
      customer_arrived_at = COALESCE(customer_arrived_at, v_now),
      updated_at = v_now
  WHERE id = v_booking.id
    AND status = 'CONFIRMED'
    AND is_present = FALSE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'Booking is already checked in');
  END IF;

  -- Fetch metadata for response
  SELECT COALESCE(full_name, 'Patient') INTO v_patient_name
  FROM public.profiles WHERE id = v_booking.customer_id;

  SELECT name INTO v_service_doctor
  FROM public.resources WHERE id = v_booking.resource_id;

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

REVOKE ALL ON FUNCTION public.mark_present_manually(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_present_manually(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Update cancel_booking to utilize per-tenant test clock.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id UUID,
  p_reason TEXT DEFAULT 'Standard cancellation',
  p_initiated_by TEXT DEFAULT 'CUSTOMER'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_provider public.providers%ROWTYPE;
  v_minutes_to_slot NUMERIC;
  v_eligible BOOLEAN;
  v_payment_status public.payment_status;
  v_refund_amount NUMERIC(10, 2) := 0;
  v_now TIMESTAMPTZ;
  
  -- Merchant strike variables
  v_is_merchant BOOLEAN := FALSE;
  v_strike_increment INT := 1;
  v_new_merchant_strikes INT := 0;
  v_penalty_applied BOOLEAN := FALSE;
  v_penalty_amount NUMERIC(10, 2) := 0.00;
  v_is_frozen BOOLEAN := FALSE;
  v_customer_name TEXT;
  v_customer_phone TEXT;
BEGIN
  -- Atomic row lock to serialize concurrent cancellation requests
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking is already cancelled');
  END IF;

  -- Caller Authorization Guard: Caller must be the booking's customer, authorized merchant, admin, or service_role
  IF auth.role() = 'authenticated' THEN
    IF NOT (
      auth.uid() = v_booking.customer_id
      OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
      OR public.is_admin(auth.uid())
    ) THEN
      RAISE EXCEPTION 'Access denied: You are not authorized to cancel this booking';
    END IF;
  END IF;

  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
    IF public.is_admin(auth.uid()) THEN
      v_is_merchant := (upper(COALESCE(p_initiated_by, 'CUSTOMER')) = 'MERCHANT');
    ELSIF auth.uid() = v_booking.customer_id THEN
      v_is_merchant := FALSE;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid())) THEN
      v_is_merchant := TRUE;
    ELSE
      v_is_merchant := FALSE;
    END IF;
  ELSE
    v_is_merchant := (upper(COALESCE(p_initiated_by, 'CUSTOMER')) = 'MERCHANT');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);

  PERFORM set_config('app.trusted_write', 'true', true);

  v_minutes_to_slot := EXTRACT(EPOCH FROM (v_booking.slot_start - v_now)) / 60;

  IF v_is_merchant THEN
    v_eligible := true;
    v_payment_status := 'REFUND_PENDING'::public.payment_status;
    v_refund_amount := COALESCE(v_booking.deposit_amount, 0.00) +
                       COALESCE(v_booking.platform_fee, 0.00) +
                       COALESCE(v_booking.platform_fee_gst, 0.00);

    IF v_refund_amount = 0 THEN
      v_refund_amount := COALESCE(v_booking.total_amount, 100.00);
    END IF;

    SELECT * INTO v_provider
    FROM public.providers
    WHERE id = v_booking.provider_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_now > v_provider.strike_reset_date THEN
        v_provider.cancellation_strikes := 0;
        v_provider.strike_reset_date := v_now + INTERVAL '30 days';
      END IF;

      IF v_minutes_to_slot <= 30 THEN
        v_strike_increment := 2;
      ELSE
        v_strike_increment := 1;
      END IF;

      v_new_merchant_strikes := v_provider.cancellation_strikes + v_strike_increment;

      IF v_new_merchant_strikes >= 3 THEN
        v_penalty_applied := TRUE;
        v_penalty_amount := 100.00;
      ELSE
        v_penalty_applied := FALSE;
        v_penalty_amount := 0.00;
      END IF;

      IF v_new_merchant_strikes >= 5 THEN
        v_is_frozen := TRUE;
      ELSE
        v_is_frozen := v_provider.is_booking_frozen;
      END IF;

      UPDATE public.providers
      SET cancellation_strikes = v_new_merchant_strikes,
          penalty_balance = penalty_balance + v_penalty_amount,
          is_booking_frozen = v_is_frozen,
          strike_reset_date = v_provider.strike_reset_date,
          updated_at = v_now
      WHERE id = v_booking.provider_id;
    END IF;

  ELSE
    -- Customer cancellation: 30-minute cutoff policy
    v_eligible := (v_minutes_to_slot > 30);
    IF v_eligible THEN
      v_payment_status := 'REFUND_PENDING'::public.payment_status;
      v_refund_amount := COALESCE(v_booking.deposit_amount, 100.00);
    ELSE
      v_payment_status := 'FORFEITED'::public.payment_status;
      v_refund_amount := 0.00;
    END IF;
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CANCELLED',
      payment_status = v_payment_status,
      updated_at = v_now
  WHERE id = p_booking_id;

  IF v_booking.gateway_payment_id IS NOT NULL AND v_payment_status <> 'REFUND_PENDING' THEN
    UPDATE public.payments
    SET status = v_payment_status,
        updated_at = v_now,
        metadata = jsonb_build_object(
          'cancellation_reason', p_reason,
          'initiated_by', CASE WHEN v_is_merchant THEN 'MERCHANT' ELSE 'CUSTOMER' END,
          'refund_amount', v_refund_amount,
          'minutes_before_slot', v_minutes_to_slot,
          'merchant_strikes', v_new_merchant_strikes,
          'merchant_penalty', v_penalty_amount
        )
    WHERE booking_id = p_booking_id;
  END IF;

  IF v_is_merchant THEN
    SELECT full_name, phone INTO v_customer_name, v_customer_phone
    FROM public.profiles
    WHERE id = v_booking.customer_id;

    INSERT INTO public.notification_logs (
      booking_id,
      recipient_phone,
      recipient_name,
      event_type,
      channel,
      status,
      message_content,
      provider_response
    ) VALUES (
      p_booking_id,
      COALESCE(v_customer_phone, '+919848000000'),
      COALESCE(v_customer_name, 'Valued Customer'),
      'MERCHANT_CANCELLED',
      'SMS_WHATSAPP',
      'SENT',
      format('Your appointment has been cancelled by the venue due to an emergency. A full 100%% refund of ₹%s has been issued.', v_refund_amount),
      jsonb_build_object(
        'initiated_by', 'MERCHANT',
        'reason', p_reason,
        'refund_amount', v_refund_amount,
        'merchant_strikes', v_new_merchant_strikes,
        'penalty_applied', v_penalty_applied,
        'penalty_amount', v_penalty_amount
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'CANCELLED',
    'payment_status', v_payment_status,
    'refund_eligible', v_eligible,
    'refund_amount', v_refund_amount,
    'merchant_strikes', v_new_merchant_strikes,
    'penalty_applied', v_penalty_applied,
    'penalty_amount', v_penalty_amount,
    'is_booking_frozen', v_is_frozen
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_booking(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT, TEXT) TO authenticated, service_role;

-- Permissions for test clock
GRANT EXECUTE ON FUNCTION public.get_test_clock(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_test_clock(TEXT, TIMESTAMPTZ) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_test_clock(TEXT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_test_clock_for_prefix(TEXT) TO anon, authenticated, service_role;
