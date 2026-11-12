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


-- 4. Restore idempotent dispatch_booking_notification with ON CONFLICT DO NOTHING and log ID resolution
CREATE OR REPLACE FUNCTION public.dispatch_booking_notification(p_booking_id uuid, p_event_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking RECORD;
  v_normalized_phone TEXT;
  v_template_name TEXT;
  v_template_params JSONB;
  v_msg_content TEXT;
  v_whatsapp_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_has_consent BOOLEAN := FALSE;
  v_booking_json JSONB;
  v_display_name TEXT;
BEGIN
  -- Strict allowlist of event types
  IF p_event_type NOT IN (
    'BOOKING_CONFIRMED',
    'BOOKING_REMINDER_1H',
    'BOOKING_CANCELLED',
    'REFUND_PROCESSED'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid event_type for WhatsApp notifications');
  END IF;

  -- Fetch booking details with provider and resource info
  SELECT 
    b.id,
    b.reference_code,
    b.slot_start,
    b.slot_end,
    b.status,
    b.payment_status,
    b.deposit_amount,
    b.total_amount,
    b.customer_id,
    b.provider_id,
    b.booked_for,
    b.patient_name,
    p.name AS provider_name,
    p.address AS provider_address,
    p.phone AS provider_phone,
    r.name AS resource_name,
    prof.phone AS customer_phone,
    prof.full_name AS customer_name
  INTO v_booking
  FROM public.bookings b
  JOIN public.providers p ON b.provider_id = p.id
  JOIN public.resources r ON b.resource_id = r.id
  LEFT JOIN public.profiles prof ON b.customer_id = prof.id
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND (SESSION_USER = 'postgres' OR CURRENT_USER = 'postgres')) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not authorized for this booking');
  END IF;

  -- Phone normalization (always sends to booker's account phone)
  v_normalized_phone := public.normalize_phone_number(v_booking.customer_phone);
  IF v_normalized_phone IS NULL THEN
    PERFORM set_config('app.trusted_write', 'true', true);
    INSERT INTO public.notification_logs (
      booking_id,
      recipient_phone,
      recipient_name,
      event_type,
      channel,
      status,
      last_error,
      message_content
    ) VALUES (
      p_booking_id,
      COALESCE(v_booking.customer_phone, 'unknown'),
      COALESCE(v_booking.customer_name, 'there'),
      p_event_type,
      'whatsapp',
      'FAILED',
      'Invalid or missing recipient phone number',
      'Phone normalization failed'
    )
    ON CONFLICT (booking_id, event_type, channel) DO NOTHING;

    RETURN jsonb_build_object('success', false, 'error', 'Invalid recipient phone number');
  END IF;

  -- If booked for family, name the patient in the message copy
  IF v_booking.booked_for = 'family' AND v_booking.patient_name IS NOT NULL AND trim(v_booking.patient_name) <> '' THEN
    v_display_name := trim(v_booking.patient_name);
  ELSE
    v_display_name := v_booking.customer_name;
  END IF;

  -- Prepare booking JSON for build_template_params
  v_booking_json := jsonb_build_object(
    'id', v_booking.id,
    'reference_code', v_booking.reference_code,
    'provider_name', v_booking.provider_name,
    'customer_name', v_display_name,
    'slot_start', v_booking.slot_start,
    'amount', COALESCE(v_booking.deposit_amount, 0)::text
  );

  v_template_name := public.get_template_name(p_event_type);
  v_template_params := public.build_template_params(p_event_type, v_booking_json);

  -- Standard message description for audit
  v_msg_content := format(
    'WhatsApp notification [%s] for %s at %s (Ref: %s)',
    v_template_name,
    COALESCE(v_display_name, 'there'),
    v_booking.provider_name,
    COALESCE(v_booking.reference_code, p_booking_id::text)
  );

  -- Opt-in check: Verify customer has granted whatsapp_notifications consent
  IF v_booking.customer_id IS NOT NULL THEN
    SELECT granted INTO v_has_consent
    FROM public.user_consents
    WHERE user_id = v_booking.customer_id
      AND purpose = 'whatsapp_notifications'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- If no consent recorded, log as SKIPPED
  IF NOT COALESCE(v_has_consent, false) THEN
    PERFORM set_config('app.trusted_write', 'true', true);
    INSERT INTO public.notification_logs (
      booking_id,
      recipient_phone,
      recipient_name,
      event_type,
      channel,
      status,
      last_error,
      message_content
    ) VALUES (
      p_booking_id,
      v_normalized_phone,
      COALESCE(v_display_name, 'there'),
      p_event_type,
      'whatsapp',
      'SKIPPED',
      'User has not consented to WhatsApp notifications',
      v_msg_content
    )
    ON CONFLICT (booking_id, event_type, channel) DO NOTHING;

    RETURN jsonb_build_object(
      'success', true,
      'channel', 'whatsapp',
      'status', 'SKIPPED',
      'queued', false,
      'skipped', true,
      'reason', 'Consent not granted'
    );
  END IF;

  -- Enqueue notification directly into public.notification_logs (idempotent ON CONFLICT DO NOTHING)
  PERFORM set_config('app.trusted_write', 'true', true);

  INSERT INTO public.notification_logs (
    booking_id,
    recipient_phone,
    recipient_name,
    event_type,
    channel,
    status,
    template_name,
    template_params,
    attempts,
    next_attempt_at,
    message_content,
    provider_response
  ) VALUES (
    p_booking_id,
    v_normalized_phone,
    COALESCE(v_display_name, 'there'),
    p_event_type,
    'whatsapp',
    'QUEUED',
    v_template_name,
    v_template_params,
    0,
    NOW(),
    v_msg_content,
    '{}'::jsonb
  )
  ON CONFLICT (booking_id, event_type, channel) DO NOTHING
  RETURNING id INTO v_whatsapp_id;

  -- If duplicate was ignored, fetch the existing row id
  IF v_whatsapp_id IS NULL THEN
    SELECT id INTO v_whatsapp_id
    FROM public.notification_logs
    WHERE booking_id = p_booking_id
      AND event_type = p_event_type
      AND channel = 'whatsapp';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'whatsapp_id', v_whatsapp_id,
    'whatsapp_log_id', v_whatsapp_id,
    'queued', true,
    'skipped', false,
    'channel', 'whatsapp',
    'status', 'QUEUED',
    'template_name', v_template_name
  );
END;
$function$;

-- 5. Align private.submit_city_waitlist contract (duplicate boolean and INVALID_PHONE error)
CREATE OR REPLACE FUNCTION private.submit_city_waitlist(
  p_city_name text,
  p_phone text,
  p_vertical_interest text DEFAULT 'all'::text,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_clean_city text;
  v_clean_phone text;
  v_digits text;
  v_existing_id uuid;
  v_new_id uuid;
BEGIN
  -- 1. Validate City Name
  v_clean_city := trim(COALESCE(p_city_name, ''));
  IF length(v_clean_city) < 2 OR length(v_clean_city) > 100 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_CITY',
      'message', 'City name must be between 2 and 100 characters'
    );
  END IF;

  -- 2. Validate & Normalize Phone Number
  v_clean_phone := trim(COALESCE(p_phone, ''));
  v_digits := regexp_replace(v_clean_phone, '\D', '', 'g');

  IF length(v_digits) < 10 OR length(v_digits) > 15 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_PHONE',
      'message', 'Phone number must contain between 10 and 15 digits'
    );
  END IF;

  -- Format national 10-digit Indian numbers with +91 if needed
  IF length(v_digits) = 10 THEN
    v_clean_phone := '+91' || v_digits;
  ELSIF NOT v_clean_phone LIKE '+%' THEN
    v_clean_phone := '+' || v_digits;
  END IF;

  -- 3. Deduplication Check (same city and phone)
  SELECT id INTO v_existing_id
  FROM public.city_waitlist
  WHERE lower(city_name) = lower(v_clean_city)
    AND (
      phone = v_clean_phone
      OR regexp_replace(phone, '\D', '', 'g') = v_digits
    )
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'already_registered', true,
      'id', v_existing_id,
      'city_name', initcap(v_clean_city),
      'message', 'Waitlist interest already recorded for this city and phone'
    );
  END IF;

  -- 4. Atomic Insert
  INSERT INTO public.city_waitlist (
    city_name,
    phone,
    vertical_interest,
    notes,
    consent_given,
    consent_timestamp
  ) VALUES (
    initcap(v_clean_city),
    v_clean_phone,
    COALESCE(substring(trim(p_vertical_interest) from 1 for 50), 'customer'),
    substring(trim(p_notes) from 1 for 500),
    true,
    clock_timestamp()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'already_registered', false,
    'id', v_new_id,
    'city_name', initcap(v_clean_city),
    'message', 'Successfully joined expansion waitlist'
  );
END;
$function$;

-- 6. Backfill missing city_id and ensure get_admin_velocity_analytics uses LEFT JOIN
DO $$
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);
  UPDATE public.providers
  SET city_id = 'tirupati'
  WHERE city_id IS NULL OR city ILIKE '%tirupati%';
END $$;

CREATE OR REPLACE FUNCTION public.get_admin_velocity_analytics(
    p_time_window text DEFAULT 'today'::text,
    p_city_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
    v_start_time TIMESTAMPTZ;
    v_result JSONB;
BEGIN
    IF auth.role() != 'service_role' AND NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Access Denied: Administrator authority required to view velocity analytics' USING ERRCODE = '42501';
    END IF;

    IF p_time_window = 'today' THEN
        v_start_time := date_trunc('day', NOW());
    ELSIF p_time_window = '3days' THEN
        v_start_time := NOW() - INTERVAL '3 days';
    ELSIF p_time_window = '7days' THEN
        v_start_time := NOW() - INTERVAL '7 days';
    ELSIF p_time_window = '30days' THEN
        v_start_time := NOW() - INTERVAL '30 days';
    ELSE
        v_start_time := '2020-01-01'::TIMESTAMPTZ;
    END IF;

    WITH filtered_bookings AS (
        SELECT
            b.id,
            b.status,
            b.payment_status,
            b.deposit_amount,
            p.city_id,
            COALESCE(c.name, 'Unassigned') AS city_name
        FROM public.bookings b
        JOIN public.resources r ON b.resource_id = r.id
        JOIN public.providers p ON r.provider_id = p.id
        LEFT JOIN public.cities c ON p.city_id = c.id
        WHERE b.created_at >= v_start_time
          AND (p_city_id IS NULL OR p.city_id = p_city_id)
    ),
    city_density AS (
        SELECT
            city_id,
            city_name,
            COUNT(*) AS booking_count,
            COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed_count,
            COALESCE(SUM(deposit_amount) FILTER (WHERE payment_status IN ('CAPTURED', 'FORFEITED')), 0) AS total_revenue
        FROM filtered_bookings
        GROUP BY city_id, city_name
    ),
    hourly_trends AS (
        SELECT
            to_char(date_trunc('hour', b.created_at), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS hour_bucket,
            COUNT(*) AS booking_velocity
        FROM public.bookings b
        JOIN public.resources r ON b.resource_id = r.id
        JOIN public.providers p ON r.provider_id = p.id
        WHERE b.created_at >= v_start_time
          AND (p_city_id IS NULL OR p.city_id = p_city_id)
        GROUP BY date_trunc('hour', b.created_at)
        ORDER BY date_trunc('hour', b.created_at) ASC
    )
    SELECT jsonb_build_object(
        'window', p_time_window,
        'city_id', p_city_id,
        'total_bookings', (SELECT COUNT(*) FROM filtered_bookings),
        'total_revenue', (SELECT COALESCE(SUM(deposit_amount) FILTER (WHERE payment_status IN ('CAPTURED', 'FORFEITED')), 0) FROM filtered_bookings),
        'by_city', COALESCE((SELECT jsonb_agg(row_to_json(cd)) FROM city_density cd), '[]'::JSONB),
        'velocity_trend', COALESCE((SELECT jsonb_agg(row_to_json(ht)) FROM hourly_trends ht), '[]'::JSONB)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;
