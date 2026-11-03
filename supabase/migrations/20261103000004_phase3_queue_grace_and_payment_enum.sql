-- =============================================================================
-- Migration: 20261103000004_phase3_queue_grace_and_payment_enum.sql
-- Description:
--   1. Add 'REFUND_IN_PROGRESS' and 'REFUND_FAILED' to public.payment_status
--      enum so atomic refund claims and failures persist cleanly in payments (C5a).
--   2. Align no_overlapping_active_bookings exclusion constraint with shared
--      ACTIVE_SLOT_BOOKING_STATUSES ('HELD', 'PENDING_PAYMENT', 'CONFIRMED',
--      'CHECKED_IN', 'IN_CONSULTATION') (C6).
--   3. Add nullable skipped_at TIMESTAMPTZ column to public.bookings with backfill
--      to persist R7 (skipped while absent -> late queue even if arriving before
--      nominal slot) across stateless rebuilds (Phase 3 Item 3).
--   4. Unify SQL late-arrival grace window to 5 minutes (ON_TIME_GRACE_MINUTES = 5)
--      across expire_stale_standby_queue, mark_present_manually, and
--      verify_checkin_code (Phase 3 Item 1).
--   5. Add public.atomic_assign_checkin_arrival(UUID, TIMESTAMPTZ) to atomically
--      mark arrival and assign sequential display queue_position without "+2"
--      buffer jumps or race conditions under concurrent check-ins (Phase 3 Item 7).
-- =============================================================================

-- 1. Extend public.payment_status enum (C5a)
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'REFUND_IN_PROGRESS';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'REFUND_FAILED';

BEGIN;

-- 2. Align no_overlapping_active_bookings exclusion constraint (C6)
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS no_overlapping_active_bookings;

ALTER TABLE public.bookings
  ADD CONSTRAINT no_overlapping_active_bookings
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(slot_start, slot_end) WITH &&
  ) WHERE (status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION'));

-- 3. Add skipped_at column for R7 persistence and backfill historical rows (Phase 3 Item 3)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS skipped_at TIMESTAMPTZ NULL;

SELECT set_config('app.trusted_write', 'true', true);

UPDATE public.bookings b
SET skipped_at = COALESCE(b.skipped_at, later.updated_at, b.slot_start)
FROM (
  SELECT
    b1.id AS skipped_booking_id,
    MIN(b2.updated_at) AS updated_at
  FROM public.bookings b1
  JOIN public.bookings b2
    ON b2.resource_id = b1.resource_id
   AND (b2.slot_start AT TIME ZONE 'Asia/Kolkata')::date = (b1.slot_start AT TIME ZONE 'Asia/Kolkata')::date
   AND b2.slot_start > b1.slot_start
   AND b2.status IN ('IN_CONSULTATION', 'COMPLETED')
  WHERE b1.status NOT IN ('CANCELLED', 'NO_SHOW', 'COMPLETED', 'IN_CONSULTATION')
    AND (
      b1.customer_arrived_at IS NULL
      OR b1.customer_arrived_at > b2.updated_at
    )
  GROUP BY b1.id
) AS later
WHERE b.id = later.skipped_booking_id
  AND b.skipped_at IS NULL;

-- 4a. expire_stale_standby_queue: 5-minute grace window + 45m absent expiry; present patients never expire
CREATE OR REPLACE FUNCTION public.expire_stale_standby_queue(
  p_threshold_minutes INT DEFAULT 45,
  p_provider_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired_count INT := 0;
  v_expired_ids UUID[] := ARRAY[]::UUID[];
  v_rec RECORD;
  v_clock TIMESTAMPTZ;
  v_cutoff TIMESTAMPTZ;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  FOR v_rec IN
    SELECT 
      b.id,
      b.customer_id,
      b.provider_id,
      b.slot_start,
      COALESCE(b.checked_in_at, b.customer_arrived_at, b.updated_at) AS checkin_timestamp,
      p.full_name AS customer_name,
      p.phone AS customer_phone,
      pr.name AS provider_name
    FROM public.bookings b
    LEFT JOIN public.profiles p ON p.id = b.customer_id
    LEFT JOIN public.providers pr ON pr.id = b.provider_id
    WHERE b.is_present = FALSE
      AND b.status IN ('WAITING', 'CONFIRMED')
      AND (b.checked_in_at IS NOT NULL OR b.customer_arrived_at IS NOT NULL OR b.queue_position IS NOT NULL OR b.skipped_at IS NOT NULL)
      AND (p_provider_id IS NULL OR b.provider_id = p_provider_id)
      AND (
        b.skipped_at IS NOT NULL
        OR COALESCE(b.checked_in_at, b.customer_arrived_at, b.updated_at) > b.slot_start + INTERVAL '5 minutes'
      )
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    v_clock := public.get_test_clock(v_rec.provider_id);
    v_cutoff := v_rec.checkin_timestamp + (COALESCE(p_threshold_minutes, 45) || ' minutes')::INTERVAL;

    IF v_clock >= v_cutoff THEN
      UPDATE public.bookings
      SET 
        status = 'NO_SHOW',
        is_present = FALSE,
        updated_at = v_clock
      WHERE id = v_rec.id
        AND is_present = FALSE;

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
        v_rec.id,
        COALESCE(v_rec.customer_name, 'Patient'),
        COALESCE(v_rec.customer_phone, '+919999999999'),
        'STANDBY_EXPIRED',
        'SMS',
        'SENT',
        format('Hello %s, your standby reservation at %s has exceeded %s minutes without physical check-in. Please reschedule at your convenience.', 
               COALESCE(v_rec.customer_name, 'Patient'), 
               COALESCE(v_rec.provider_name, 'the clinic'), 
               p_threshold_minutes),
        v_clock
      );

      v_expired_count := v_expired_count + 1;
      v_expired_ids := array_append(v_expired_ids, v_rec.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'expired_count', v_expired_count,
    'threshold_minutes', p_threshold_minutes,
    'expired_booking_ids', to_jsonb(v_expired_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_standby_queue(INT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_standby_queue(INT, UUID) TO service_role;

-- 4b. mark_present_manually: 5-minute grace window + R7 skipped check
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

  v_is_late := v_was_skipped OR (v_now > (v_booking.slot_start + interval '5 minutes'));

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
$$;

REVOKE ALL ON FUNCTION public.mark_present_manually(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_present_manually(UUID) TO authenticated, service_role;

-- 4c. verify_checkin_code: 5-minute grace window + R7 skipped check
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
  v_was_skipped BOOLEAN;
  v_window_start TIMESTAMPTZ;
  v_is_hospital BOOLEAN;
  v_hosp_role TEXT;
  v_caller_dept_id UUID;
  v_dept_modules TEXT[];
  v_is_owner BOOLEAN;
BEGIN
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Authentication required'
    );
  END IF;

  v_is_hospital := public.is_hospital_provider(p_shop_id);

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

  IF NOT v_is_hospital THEN
    v_is_owner := public.is_caller_authorized_for_resource(p_shop_id, NULL, v_staff_id);

    IF NOT v_is_owner THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'UNAUTHORIZED',
        'message', 'Staff is not authorized for this shop'
      );
    END IF;

    SELECT * INTO v_checkin_record
    FROM public.appointment_checkin_codes
    WHERE provider_id = p_shop_id
      AND appointment_date = v_today_ist
      AND code = v_clean_code;

    IF NOT FOUND THEN
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
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INVALID_CODE',
        'message', 'Invalid check-in code'
      );
    END IF;

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

    v_window_start := v_booking.slot_start - interval '60 minutes';
    IF v_now < v_window_start THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TOO_EARLY',
        'message', 'Check-in opens 60 minutes before scheduled time (opens at ' || to_char(v_window_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') || ')'
      );
    END IF;

    v_was_skipped := (v_booking.skipped_at IS NOT NULL) OR EXISTS (
      SELECT 1
      FROM public.bookings b2
      WHERE b2.resource_id = v_booking.resource_id
        AND (b2.slot_start AT TIME ZONE 'Asia/Kolkata')::date = (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date
        AND b2.slot_start > v_booking.slot_start
        AND b2.status IN ('IN_CONSULTATION', 'COMPLETED')
    );

    v_is_late := v_was_skipped OR (v_now > (v_booking.slot_start + interval '5 minutes'));

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
      RETURN jsonb_build_object(
        'success', false,
        'error', 'ALREADY_CHECKED_IN',
        'message', 'This appointment is already checked in'
      );
    END IF;

    UPDATE public.staff_checkin_rate_limits
    SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
    WHERE user_id = v_staff_id;

    SELECT COALESCE(full_name, 'Customer') INTO v_patient_name
    FROM public.profiles WHERE id = v_booking.customer_id;

    SELECT name INTO v_service_doctor
    FROM public.resources WHERE id = v_booking.resource_id;

    v_slot_time_str := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');

    RETURN jsonb_build_object(
      'success', true,
      'booking_id', v_booking.id,
      'customer_name', v_patient_name,
      'service_name', v_service_doctor,
      'slot_time', v_slot_time_str,
      'is_late', v_is_late,
      'checked_in_at', v_now
    );
  END IF;

  -- HOSPITAL PROVIDERS
  v_hosp_role := public.hospital_role(p_shop_id, v_staff_id);

  IF v_hosp_role = 'none' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Staff is not authorized for this hospital'
    );
  END IF;

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

  SELECT * INTO v_checkin_record
  FROM public.appointment_checkin_codes
  WHERE provider_id = p_shop_id
    AND appointment_date = v_today_ist
    AND code = v_clean_code;

  IF NOT FOUND THEN
    SELECT c.* INTO v_other_date_record
    FROM public.appointment_checkin_codes c
    JOIN public.bookings b ON b.id = c.booking_id
    WHERE c.provider_id = p_shop_id
      AND c.code = v_clean_code
      AND (
        v_hosp_role = 'admin'
        OR (
          public.is_caller_authorized_for_resource(p_shop_id, b.resource_id, v_staff_id)
          AND COALESCE(b.department_id, (SELECT r.department_id FROM public.resources r WHERE r.id = b.resource_id)) = v_caller_dept_id
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

    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_CODE',
      'message', 'Invalid check-in code'
    );
  END IF;

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

  IF v_hosp_role != 'admin' THEN
    IF COALESCE(v_booking.department_id, (SELECT department_id FROM public.resources WHERE id = v_booking.resource_id)) IS DISTINCT FROM v_caller_dept_id
       OR NOT public.is_caller_authorized_for_resource(p_shop_id, v_booking.resource_id, v_staff_id) THEN
      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INVALID_CODE',
        'message', 'Invalid check-in code'
      );
    END IF;
  END IF;

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

  v_window_start := v_booking.slot_start - interval '60 minutes';
  IF v_now < v_window_start THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TOO_EARLY',
      'message', 'Check-in opens 60 minutes before scheduled time (opens at ' || to_char(v_window_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') || ')'
    );
  END IF;

  v_was_skipped := (v_booking.skipped_at IS NOT NULL) OR EXISTS (
    SELECT 1
    FROM public.bookings b2
    WHERE b2.resource_id = v_booking.resource_id
      AND (b2.slot_start AT TIME ZONE 'Asia/Kolkata')::date = (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date
      AND b2.slot_start > v_booking.slot_start
      AND b2.status IN ('IN_CONSULTATION', 'COMPLETED')
  );

  v_is_late := v_was_skipped OR (v_now > (v_booking.slot_start + interval '5 minutes'));

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
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ALREADY_CHECKED_IN',
      'message', 'This appointment is already checked in'
    );
  END IF;

  UPDATE public.staff_checkin_rate_limits
  SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
  WHERE user_id = v_staff_id;

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

-- 5. Atomic check-in & sequential display queue_position assignment (Phase 3 Item 7)
CREATE OR REPLACE FUNCTION public.atomic_assign_checkin_arrival(
  p_booking_id UUID,
  p_arrived_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_slot_date_ist DATE;
  v_arrived TIMESTAMPTZ;
  v_was_skipped BOOLEAN;
  v_is_late BOOLEAN;
  v_new_pos INT;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status IN ('CANCELLED', 'NO_SHOW') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot mark arrived for ' || v_booking.status::text || ' booking');
  END IF;

  v_slot_date_ist := (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date;

  -- Serialize queue_position assignment per consultant (resource_id) + IST date
  PERFORM pg_advisory_xact_lock(
    hashtext('checkin_pos:' || v_booking.resource_id::text || ':' || v_slot_date_ist::text)
  );

  v_arrived := COALESCE(v_booking.customer_arrived_at, p_arrived_at, public.get_test_clock(v_booking.provider_id));

  v_was_skipped := (v_booking.skipped_at IS NOT NULL) OR EXISTS (
    SELECT 1
    FROM public.bookings b2
    WHERE b2.resource_id = v_booking.resource_id
      AND (b2.slot_start AT TIME ZONE 'Asia/Kolkata')::date = v_slot_date_ist
      AND b2.slot_start > v_booking.slot_start
      AND b2.status IN ('IN_CONSULTATION', 'COMPLETED')
  );

  v_is_late := v_was_skipped OR (v_arrived > (v_booking.slot_start + INTERVAL '5 minutes'));

  IF v_booking.is_present = TRUE AND v_booking.customer_arrived_at IS NOT NULL AND v_booking.queue_position IS NOT NULL AND v_booking.queue_position > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'booking_id', v_booking.id,
      'already_checked_in', true,
      'is_present', true,
      'customer_arrived_at', v_booking.customer_arrived_at,
      'is_late_arrival', v_is_late,
      'was_skipped', v_was_skipped,
      'queue_position', v_booking.queue_position
    );
  END IF;

  IF v_booking.queue_position IS NOT NULL AND v_booking.queue_position > 0 THEN
    v_new_pos := v_booking.queue_position;
  ELSE
    SELECT COALESCE(MAX(b.queue_position), 0) + 1
    INTO v_new_pos
    FROM public.bookings b
    WHERE b.resource_id = v_booking.resource_id
      AND (b.slot_start AT TIME ZONE 'Asia/Kolkata')::date = v_slot_date_ist
      AND b.status NOT IN ('CANCELLED', 'NO_SHOW');
  END IF;

  UPDATE public.bookings
  SET status = CASE WHEN status = 'CONFIRMED' THEN 'CHECKED_IN'::public.booking_status ELSE status END,
      is_present = TRUE,
      customer_arrived_at = v_arrived,
      checked_in_at = COALESCE(checked_in_at, v_arrived),
      skipped_at = CASE WHEN v_was_skipped THEN COALESCE(skipped_at, v_arrived) ELSE skipped_at END,
      queue_position = v_new_pos,
      updated_at = v_arrived
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'already_checked_in', false,
    'is_present', true,
    'customer_arrived_at', v_arrived,
    'is_late_arrival', v_is_late,
    'was_skipped', v_was_skipped,
    'queue_position', v_new_pos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_assign_checkin_arrival(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_assign_checkin_arrival(UUID, TIMESTAMPTZ) TO service_role;

COMMIT;
