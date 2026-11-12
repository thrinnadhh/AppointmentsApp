-- =============================================================================
-- Migration: 20261104000001_reconcile_merged_stored_procedures.sql
-- Description:
--   Semantic reconciliation of stored procedures overwritten during merge of main
--   into fix/production-readiness branch.
--   Rebases branch-specific security enhancements onto main's authoritative logic:
--     1. record_no_show: Restores main's tiered no-show policy (strikes 1-2 courtesy
--        refund; strikes 3-5 doctor ₹50 / platform ₹10 fee split; strike 6+ 7-day
--        account block and counter reset) while keeping resource-scoped authorization.
--     2. generate_appointment_checkin_code_for_booking: Restores customer's permanent
--        lifetime 4-digit check-in PIN while preserving caller authorization checks.
--     3. verify_checkin_code: Restores permanent PIN resolution and APPOINTMENT_FUTURE
--        guidance, while retaining Phase 3 queue R7 (skipped_at) and 5-min grace window.
--     4. cancel_doctor_emergency: Restores p_doctor_arrived parameter, emergency flags,
--        and dual signatures while maintaining resource-scoped authorization.
--     5. Grants: Ensures authenticated role can execute create_booking_hold and
--        choose_emergency_option.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RECORD_NO_SHOW: TIERED POLICY + 7-DAY ACCOUNT BLOCK + RESOURCE SCOPING
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_no_show(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_current_count INT := 0;
    v_new_count INT := 1;
    v_final_count INT := 1;
    v_payment_status public.payment_status;
    v_penalty BOOLEAN := FALSE;
    v_refund_amount NUMERIC(10, 2) := 0;
    v_merchant_credit NUMERIC(10, 2) := 0;
    v_is_blocked BOOLEAN := FALSE;
    v_blocked_until TIMESTAMPTZ := NULL;
    v_deposit NUMERIC(10, 2) := 0;
BEGIN
    -- Atomic single-winner row lock
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    -- Reject non-active terminal or already-refunded/forfeited states
    IF v_booking.status IN ('CANCELLED', 'NO_SHOW', 'COMPLETED') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot record a no-show for a booking in state: ' || v_booking.status::text
        );
    END IF;

    IF v_booking.payment_status IN ('REFUNDED', 'REFUND_PENDING', 'FORFEITED') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot record a no-show for a booking with payment status: ' || v_booking.payment_status::text
        );
    END IF;

    -- Caller Authorization Guard: venue owner, authorized staff/consultant, or admin
    IF auth.role() = 'authenticated' THEN
      IF NOT (
        public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, auth.uid())
        OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
        OR public.is_admin(auth.uid())
      ) THEN
        RAISE EXCEPTION 'Only the owning merchant, authorized consultant/staff, or an admin can record a no-show';
      END IF;
    END IF;

    -- Read current strike count of customer with row lock
    SELECT COALESCE(no_show_count, 0) INTO v_current_count
    FROM public.profiles
    WHERE id = v_booking.customer_id
    FOR UPDATE;

    v_new_count := v_current_count + 1;
    v_deposit := COALESCE(v_booking.deposit_amount, 100.00);

    -- TIERED NO-SHOW POLICY:
    -- Strikes 1 & 2: Courtesy 100% refund, no penalty
    IF v_new_count <= 2 THEN
        v_payment_status := 'REFUND_PENDING'::public.payment_status;
        v_penalty := FALSE;
        v_refund_amount := v_deposit;
        v_merchant_credit := 0;
        v_final_count := v_new_count;
        v_is_blocked := FALSE;
        v_blocked_until := NULL;

    -- Strikes 3 to 5: ₹50 to doctor, ₹10 to platform, remainder (deposit - 60) refunded
    ELSIF v_new_count <= 5 THEN
        v_penalty := TRUE;
        v_merchant_credit := 50.00;
        v_final_count := v_new_count;
        v_is_blocked := FALSE;
        v_blocked_until := NULL;

        IF v_deposit > 60.00 THEN
            v_refund_amount := v_deposit - 60.00;
            v_payment_status := 'REFUND_PENDING'::public.payment_status;
        ELSE
            v_refund_amount := 0.00;
            v_payment_status := 'FORFEITED'::public.payment_status;
        END IF;

    -- Exceeded 5 Strikes (6th strike):
    -- Account blocked for 7 days, counter reset to 0, same fee split
    ELSE
        v_penalty := TRUE;
        v_merchant_credit := 50.00;
        v_final_count := 0; -- Reset strike counter per product spec
        v_is_blocked := TRUE;
        v_blocked_until := NOW() + INTERVAL '7 days';

        IF v_deposit > 60.00 THEN
            v_refund_amount := v_deposit - 60.00;
            v_payment_status := 'REFUND_PENDING'::public.payment_status;
        ELSE
            v_refund_amount := 0.00;
            v_payment_status := 'FORFEITED'::public.payment_status;
        END IF;
    END IF;

    PERFORM set_config('app.trusted_write', 'true', true);

    -- Update customer profile strikes & block
    UPDATE public.profiles
    SET no_show_count = v_final_count,
        blocked_until = CASE WHEN v_is_blocked THEN v_blocked_until ELSE blocked_until END,
        is_flagged = CASE WHEN v_is_blocked OR v_new_count >= 3 THEN TRUE ELSE is_flagged END,
        updated_at = NOW()
    WHERE id = v_booking.customer_id;

    -- Update booking status and payment status atomically
    UPDATE public.bookings
    SET status = 'NO_SHOW',
        payment_status = v_payment_status,
        updated_at = NOW()
    WHERE id = p_booking_id;

    -- If monetary penalty applied, credit merchant penalty_balance
    IF v_merchant_credit > 0 THEN
        UPDATE public.providers
        SET penalty_balance = COALESCE(penalty_balance, 0) + v_merchant_credit,
            updated_at = NOW()
        WHERE id = v_booking.provider_id;

        IF v_payment_status = 'FORFEITED' THEN
            UPDATE public.payments
            SET status = 'FORFEITED',
                updated_at = NOW()
            WHERE booking_id = p_booking_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'no_show_count', v_final_count,
        'penalty_applied', v_penalty,
        'payment_status', v_payment_status::text,
        'refund_amount', v_refund_amount,
        'is_blocked', v_is_blocked,
        'blocked_until', v_blocked_until,
        'flagged', v_is_blocked OR v_new_count >= 3,
        'is_flagged', v_is_blocked OR v_new_count >= 3
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_no_show(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_no_show(UUID) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. GENERATE_APPOINTMENT_CHECKIN_CODE_FOR_BOOKING: RESTORE PERMANENT PIN
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Verify caller authorization if in authenticated context
  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
    IF auth.uid() <> v_booking.customer_id AND NOT public.is_admin(auth.uid()) THEN
      IF NOT (
        public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, auth.uid())
        OR v_booking.provider_id IN (SELECT provider_id FROM public.merchant_memberships WHERE user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.providers WHERE id = v_booking.provider_id AND owner_id = auth.uid())
      ) THEN
        RAISE EXCEPTION 'Forbidden: Not authorized to access check-in code for this booking' USING ERRCODE = '42501';
      END IF;
    END IF;
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

REVOKE ALL ON FUNCTION public.generate_appointment_checkin_code_for_booking(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_appointment_checkin_code_for_booking(UUID) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VERIFY_CHECKIN_CODE: PERMANENT PIN + FUTURE GUIDANCE + PHASE 3 R7 QUEUE
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

  -- ───────────────────────────────────────────────────────────────────────────
  -- NON-HOSPITAL PROVIDERS
  -- ───────────────────────────────────────────────────────────────────────────
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
      -- Permanent Lifetime PIN fallback: check profiles.permanent_checkin_pin
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
        -- Check if code exists on other dates for future guidance
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
    -- Fallback: Permanent Lifetime Customer PIN
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
      -- Check future dates for upcoming guidance
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

  -- Enforce per-consultant resource access
  IF v_hosp_role != 'admin' THEN
    IF NOT public.is_caller_authorized_for_resource(p_shop_id, v_booking.resource_id, v_staff_id) THEN
      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INVALID_CODE',
        'message', 'Staff is not authorized for this doctor'
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
      'message', 'Check-in opens 60 minutes before scheduled time'
    );
  END IF;

  -- Phase 3 queue R7 logic: Determine if patient was skipped while absent
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
$$;

REVOKE ALL ON FUNCTION public.verify_checkin_code(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_checkin_code(UUID, TEXT) TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CANCEL_DOCTOR_EMERGENCY: SUPPORT P_DOCTOR_ARRIVED & DUAL SIGNATURES
-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CANCEL_DOCTOR_EMERGENCY: SUPPORT P_DOCTOR_ARRIVED & DUAL SIGNATURES
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.cancel_doctor_emergency(UUID, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.cancel_doctor_emergency(UUID, BOOLEAN, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.cancel_doctor_emergency(UUID, TIMESTAMPTZ, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.build_template_params(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.cancel_doctor_emergency(
  p_doctor_resource_id UUID,
  p_effective_from TIMESTAMPTZ DEFAULT NULL,
  p_reason TEXT DEFAULT 'Doctor emergency unavailable',
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

  -- 2. Authorization Check (support admin, venue owner/manager, and active department members)
  IF auth.role() = 'authenticated' THEN
    IF NOT (
      public.is_caller_authorized_for_resource(v_doctor_res.provider_id, v_doctor_res.id, auth.uid())
      OR v_doctor_res.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
      OR public.is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.department_members m
        WHERE m.user_id = auth.uid()
          AND m.merchant_id = v_doctor_res.provider_id
          AND m.status = 'active'
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. GRANTS FOR CLIENT-FACING / RPC FLOWS
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_booking(UUID) TO authenticated, service_role;
UPDATE public.bookings b SET department_id = r.department_id FROM public.resources r WHERE b.resource_id = r.id AND b.department_id IS NULL;
REVOKE ALL ON FUNCTION public.choose_emergency_option(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.choose_emergency_option(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. GET_MASKED_CUSTOMER_INFO: AUTHORIZE POSTGRES SUPERUSER & SERVICE_ROLE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_masked_customer_info(p_customer_id UUID)
RETURNS TABLE(customer_name TEXT, customer_phone TEXT, no_show_count INTEGER)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF v_caller_role = 'service_role' OR session_user = 'postgres' THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = p_customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.customer_id = p_customer_id
        AND b.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id))
    ) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      COALESCE(pr.full_name, 'Walk-in / Guest')::TEXT AS customer_name,
      public.mask_customer_phone(pr.phone)::TEXT AS customer_phone,
      COALESCE(pr.no_show_count, 0)::INTEGER AS no_show_count
    FROM public.profiles pr
    WHERE pr.id = p_customer_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_masked_customer_info(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_masked_customer_info(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. GET_USER_AUTHORIZED_PROVIDERS: RESTORE CALLER-BINDING OVERWRITE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_authorized_providers(p_user_id UUID DEFAULT auth.uid())
RETURNS SETOF UUID
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_target_id UUID := CASE 
    WHEN auth.role() = 'authenticated' THEN auth.uid() 
    ELSE COALESCE(p_user_id, auth.uid()) 
  END;
BEGIN
  IF v_target_id IS NULL THEN
    RETURN;
  END IF;

  IF public.is_admin(v_target_id) THEN
    RETURN QUERY SELECT id FROM public.providers;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT provider_id FROM public.merchant_memberships WHERE user_id = v_target_id
    UNION
    SELECT id FROM public.providers WHERE owner_id = v_target_id
    UNION
    SELECT p.id FROM public.providers p
    JOIN auth.users u ON lower(trim(u.email)) = lower(trim(p.email))
    WHERE u.id = v_target_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_authorized_providers(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_authorized_providers(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. GET_OR_CREATE_CUSTOMER_CHECKIN_PIN: SCHEMA-QUALIFY GEN_RANDOM_BYTES
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_bytes := extensions.gen_random_bytes(4);
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

REVOKE ALL ON FUNCTION public.get_or_create_customer_checkin_pin(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_customer_checkin_pin(UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. RESCHEDULE_BOOKING_SLOT: FIX ENUM LITERAL ('CAPTURED' INSTEAD OF 'PAID')
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reschedule_booking_slot(
  p_booking_id UUID,
  p_new_slot_start TIMESTAMPTZ,
  p_new_slot_end TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_conflict_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_target_status public.booking_status;
  v_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard (resource-scoped for hospital staff)
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND (SESSION_USER = 'postgres' OR CURRENT_USER = 'postgres')) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_caller_id) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not authorized to reschedule this booking');
  END IF;

  IF v_booking.status::text IN ('CHECKED_IN', 'WAITING', 'UP_NEXT', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW', 'CANCELLED')
     OR v_booking.is_present = TRUE
     OR v_booking.status::text NOT IN ('CONFIRMED', 'HELD') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);

  IF p_new_slot_start < v_now THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule to a slot in the past');
  END IF;

  IF v_caller_role <> 'service_role'
     AND v_caller_id IS NOT NULL
     AND v_caller_id = v_booking.customer_id
     AND v_booking.slot_start < v_now + INTERVAL '60 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Late reschedule: appointments within 60 minutes of their slot cannot be rescheduled.');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);
  UPDATE public.bookings
  SET status = 'CANCELLED', payment_status = 'FORFEITED', updated_at = v_now
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND status = 'HELD'
    AND hold_expires_at < v_now;

  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND (
      status = 'CONFIRMED'
      OR (status = 'HELD' AND (hold_expires_at IS NULL OR hold_expires_at >= v_now))
    )
    AND id != p_booking_id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'The requested new slot is already booked or held');
  END IF;

  IF v_booking.status = 'HELD' THEN
    IF COALESCE(v_booking.deposit_amount, 0) > 0 AND (v_booking.payment_status != 'CAPTURED' OR v_booking.gateway_payment_id IS NULL) THEN
      v_target_status := 'HELD'::public.booking_status;
    ELSE
      v_target_status := 'CONFIRMED'::public.booking_status;
    END IF;
  ELSIF v_booking.status = 'CONFIRMED' THEN
    v_target_status := 'CONFIRMED'::public.booking_status;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET slot_start = p_new_slot_start,
      slot_end = p_new_slot_end,
      status = v_target_status,
      updated_at = v_now
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'slot_start', p_new_slot_start,
    'slot_end', p_new_slot_end,
    'status', v_target_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. DROP OBSOLETE EXPIRE_STANDBY_BOOKINGS (STANDBY PATIENTS ARE NEVER DROPPED)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.expire_standby_bookings(integer);
DROP FUNCTION IF EXISTS public.expire_standby_bookings(integer, uuid);
DROP FUNCTION IF EXISTS public.expire_standby_bookings();



