-- Migration: 20261108000002_spec_arrival_window_and_trigger_privileges.sql
-- Description: Enforce SPEC.md arrival window (+/- 10 minutes) in check-in RPCs and tighten trigger function execution privileges.

-- 1. Tighten trigger function execution privileges
REVOKE ALL ON FUNCTION public.sync_booking_for_family() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_booking_for_family() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_booking_for_family() TO service_role;

-- 2. Update private.mark_present_manually to align with SPEC.md arrival window (10 minutes)
CREATE OR REPLACE FUNCTION private.mark_present_manually(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_staff_id UUID := auth.uid();
  v_now TIMESTAMPTZ;
  v_booking public.bookings%ROWTYPE;
  v_patient_name TEXT;
  v_service_doctor TEXT;
  v_slot_time_str TEXT;
  v_is_late BOOLEAN;
  v_was_skipped BOOLEAN;
  v_is_hospital BOOLEAN;
  v_hosp_role TEXT;
BEGIN
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Authentication required');
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Booking not found');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);
  v_is_hospital := public.is_hospital_provider(v_booking.provider_id);

  IF v_is_hospital THEN
    v_hosp_role := public.hospital_role(v_booking.provider_id, v_staff_id);
    IF v_hosp_role = 'none' THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Not authorized for this hospital');
    END IF;

    IF NOT public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_staff_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Staff is not authorized for this doctor');
    END IF;
  ELSE
    IF NOT public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_staff_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Staff is not authorized for this shop');
    END IF;
  END IF;

  IF v_booking.status = 'CHECKED_IN' OR v_booking.is_present = TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'Booking is already checked in');
  END IF;

  IF v_booking.status != 'CONFIRMED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Only confirmed bookings can be marked present');
  END IF;

  v_was_skipped := (v_booking.skipped_at IS NOT NULL) OR EXISTS (
    SELECT 1
    FROM public.bookings b2
    WHERE b2.resource_id = v_booking.resource_id
      AND (b2.slot_start AT TIME ZONE 'Asia/Kolkata')::date = (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date
      AND b2.slot_start > v_booking.slot_start
      AND b2.status IN ('IN_CONSULTATION', 'COMPLETED')
  );

  -- Per SPEC.md: Arrival window is +/- 10 minutes. A patient is Late only if checked in > 10 min after slot_start.
  v_is_late := v_was_skipped OR (v_now > (v_booking.slot_start + interval '10 minutes'));

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CHECKED_IN',
      is_present = TRUE,
      checked_in_at = v_now,
      checked_in_by = v_staff_id,
      checked_in_method = 'manual',
      customer_arrived_at = COALESCE(customer_arrived_at, v_now),
      skipped_at = CASE WHEN v_was_skipped THEN COALESCE(skipped_at, v_now) ELSE skipped_at END,
      updated_at = v_now
  WHERE id = v_booking.id
    AND status = 'CONFIRMED'
    AND is_present = FALSE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'Booking is already checked in');
  END IF;

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
$function$;

-- 3. Update private.verify_checkin_code to align with SPEC.md arrival window (10 minutes)
CREATE OR REPLACE FUNCTION private.verify_checkin_code(p_shop_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
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
  v_was_skipped BOOLEAN;
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

  -- NON-HOSPITAL PROVIDERS
  IF NOT v_is_hospital THEN
    v_is_owner := (p_shop_id IN (SELECT public.get_user_authorized_providers(v_staff_id)))
                  OR public.is_caller_authorized_for_resource(p_shop_id, NULL, v_staff_id)
                  OR public.is_admin(v_staff_id);

    IF NOT v_is_owner THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'UNAUTHORIZED',
        'message', 'Staff is not authorized for this shop'
      );
    END IF;

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
      SELECT b.* INTO v_booking
      FROM public.bookings b
      JOIN public.profiles p ON p.id = b.customer_id
      WHERE p.permanent_checkin_pin = v_clean_code
        AND b.provider_id = p_shop_id
        AND (b.slot_start AT TIME ZONE 'Asia/Kolkata')::date = v_today_ist
      ORDER BY (b.status = 'CONFIRMED') DESC, ABS(EXTRACT(EPOCH FROM (b.slot_start - v_now))) ASC
      LIMIT 1
      FOR UPDATE OF b;

      IF v_booking.id IS NULL THEN
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

        PERFORM public._record_checkin_failure(v_staff_id, v_now);
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'Invalid check-in code');
      END IF;
    ELSE
      SELECT * INTO v_booking
      FROM public.bookings
      WHERE id = v_checkin_record.booking_id;
    END IF;

    IF v_booking.status = 'CHECKED_IN' OR v_booking.is_present = TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'Appointment is already checked in');
    END IF;

    IF v_booking.status != 'CONFIRMED' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Appointment is not in confirmed status');
    END IF;

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

    SELECT COALESCE(v_booking.patient_name, full_name, 'Customer') INTO v_patient_name
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
      'is_late', false,
      'checked_in_at', v_now
    );
  END IF;

  -- ───────────────────────────────────────────────────────────────────────────
  -- HOSPITAL PROVIDERS
  -- ───────────────────────────────────────────────────────────────────────────
  v_hosp_role := public.hospital_role(p_shop_id, v_staff_id);
  IF v_hosp_role = 'none' THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Staff is not authorized for this hospital');
  END IF;

  IF v_hosp_role = 'department_member' THEN
    SELECT department_id INTO v_caller_dept_id
    FROM public.department_members
    WHERE merchant_id = p_shop_id AND user_id = v_staff_id AND status = 'active'
    LIMIT 1;

    IF v_caller_dept_id IS NOT NULL THEN
      SELECT allowed_modules INTO v_dept_modules
      FROM public.departments WHERE id = v_caller_dept_id;
      IF v_dept_modules IS NOT NULL AND NOT ('check_in' = ANY(v_dept_modules)) THEN
        RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Your department is not permitted to perform check-in');
      END IF;
    END IF;
  END IF;

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
    SELECT b.* INTO v_booking
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.customer_id
    WHERE p.permanent_checkin_pin = v_clean_code
      AND b.provider_id = p_shop_id
      AND (b.slot_start AT TIME ZONE 'Asia/Kolkata')::date = v_today_ist
    ORDER BY (b.status = 'CONFIRMED') DESC, ABS(EXTRACT(EPOCH FROM (b.slot_start - v_now))) ASC
    LIMIT 1
    FOR UPDATE OF b;

    IF v_booking.id IS NULL THEN
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

      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'Invalid check-in code');
    END IF;
  ELSE
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = v_checkin_record.booking_id;
  END IF;

  IF v_booking.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BOOKING_NOT_FOUND', 'message', 'Associated appointment record not found');
  END IF;

  IF v_hosp_role != 'admin' THEN
    IF NOT public.is_caller_authorized_for_resource(p_shop_id, v_booking.resource_id, v_staff_id) THEN
      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'Staff is not authorized for this doctor');
    END IF;
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

  v_was_skipped := (v_booking.skipped_at IS NOT NULL) OR EXISTS (
    SELECT 1
    FROM public.bookings b2
    WHERE b2.resource_id = v_booking.resource_id
      AND (b2.slot_start AT TIME ZONE 'Asia/Kolkata')::date = (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date
      AND b2.slot_start > v_booking.slot_start
      AND b2.status IN ('IN_CONSULTATION', 'COMPLETED')
  );

  -- Per SPEC.md: Arrival window is +/- 10 minutes. A patient is Late only if checked in > 10 min after slot_start.
  v_is_late := v_was_skipped OR (v_now > (v_booking.slot_start + interval '10 minutes'));

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CHECKED_IN',
      is_present = TRUE,
      checked_in_at = v_now,
      checked_in_by = v_staff_id,
      checked_in_method = 'code',
      customer_arrived_at = COALESCE(customer_arrived_at, v_now),
      skipped_at = CASE WHEN v_was_skipped THEN COALESCE(skipped_at, v_now) ELSE skipped_at END,
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

  SELECT COALESCE(v_booking.patient_name, full_name, 'Patient') INTO v_patient_name
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
    'was_skipped', v_was_skipped,
    'checked_in_at', v_now
  );
END;
$function$;

