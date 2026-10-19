-- =============================================================================
-- Migration: 20261019000006_harden_hospital_checkin_rpcs.sql
-- Description:
--   Subtask 4: Harden check-in RPCs for hospital vertical:
--   1. verify_checkin_code:
--      - Require caller to be Admin, or the assigned Front Desk, or that Consultant.
--      - Return uniform INVALID_CODE (no WRONG_SHOP or UNAUTHORIZED_DEPARTMENT).
--      - Count unauthorized attempts toward rate limit.
--      - Atomic update with row lock (FOR UPDATE) so exactly one caller succeeds.
--      - Non-hospital providers behave exactly as before.
--   2. mark_present_manually:
--      - Allow only Admin, assigned Front Desk, or that Consultant for hospitals.
--      - Reject unassigned staff with FORBIDDEN.
--      - Atomic update with row lock.
-- =============================================================================

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
  v_now TIMESTAMPTZ := clock_timestamp();
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
-- 2. HARDEN mark_present_manually
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
  v_now TIMESTAMPTZ := clock_timestamp();
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
