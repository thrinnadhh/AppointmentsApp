-- =============================================================================
-- Migration: 20261103000003_phase1_security_lockdown.sql
-- Description:
--   1. Ensure service_role has full DML & sequence grants on public schema.
--   2. Add FOR UPDATE OF b SKIP LOCKED to expire_stale_standby_queue and
--      FOR UPDATE SKIP LOCKED to process_expired_account_deletions.
--   3. Revoke EXECUTE from PUBLIC, anon, authenticated and grant only to
--      service_role on expire_stale_standby_queue, release_expired_holds,
--      and process_expired_account_deletions (Phase 1.3).
--   4. Wire public.is_caller_authorized_for_resource(provider_id, resource_id, user_id)
--      into cancel_booking, reschedule_booking_slot, complete_booking,
--      record_no_show, mark_present_manually, and verify_checkin_code; revoke
--      EXECUTE on record_no_show from authenticated (Phase 1.4).
--   5. Keep newly created venues in PENDING_APPROVAL status in admin_create_venue (Phase 1.8).
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ENSURE service_role TABLE & SEQUENCE GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CRON / MAINTENANCE RPCS: SKIP LOCKED & SERVICE_ROLE LOCKDOWN (Phase 1.3)
-- ─────────────────────────────────────────────────────────────────────────────
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
      AND (b.checked_in_at IS NOT NULL OR b.customer_arrived_at IS NOT NULL OR b.queue_position IS NOT NULL)
      AND (p_provider_id IS NULL OR b.provider_id = p_provider_id)
      AND COALESCE(b.checked_in_at, b.customer_arrived_at, b.updated_at) > b.slot_start + INTERVAL '10 minutes'
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

CREATE OR REPLACE FUNCTION public.process_expired_account_deletions()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_processed_count INT := 0;
BEGIN
    FOR r IN
        SELECT user_id
        FROM public.account_deletion_requests
        WHERE scheduled_for <= NOW()
          AND completed_at IS NULL
          AND cancelled_at IS NULL
        ORDER BY scheduled_for ASC
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            PERFORM public.anonymize_user_data(r.user_id);
            v_processed_count := v_processed_count + 1;
        EXCEPTION WHEN OTHERS THEN
            UPDATE public.account_deletion_requests
            SET last_error = SQLERRM,
                retry_count = COALESCE(retry_count, 0) + 1
            WHERE user_id = r.user_id AND completed_at IS NULL;

            INSERT INTO public.admin_audit_logs (
                action, target_type, target_id, details
            ) VALUES (
                'ACCOUNT_DELETION_FAILED',
                'USER',
                r.user_id::text,
                jsonb_build_object('error', SQLERRM, 'time', NOW())
            );

            RAISE WARNING 'Failed to anonymize user %: %', r.user_id, SQLERRM;
        END;
    END LOOP;

    RETURN v_processed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_expired_account_deletions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_expired_account_deletions() TO service_role;

REVOKE ALL ON FUNCTION public.release_expired_holds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_expired_holds() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RESOURCE-LEVEL RBAC IN BOOKING & CHECK-IN RPCS (Phase 1.4)
-- ─────────────────────────────────────────────────────────────────────────────

-- 3a. cancel_booking: Use is_caller_authorized_for_resource for merchant/staff checks
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
  
  v_is_merchant BOOLEAN := FALSE;
  v_strike_increment INT := 1;
  v_new_merchant_strikes INT := 0;
  v_penalty_applied BOOLEAN := FALSE;
  v_penalty_amount NUMERIC(10, 2) := 0.00;
  v_is_frozen BOOLEAN := FALSE;
  v_customer_name TEXT;
  v_customer_phone TEXT;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Booking is already cancelled',
      'message', 'Booking is already cancelled'
    );
  END IF;

  IF v_booking.status::text IN ('CHECKED_IN', 'WAITING', 'UP_NEXT', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW')
     OR v_booking.is_present = TRUE
     OR v_booking.status::text NOT IN ('CONFIRMED', 'HELD') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot cancel booking in status ' || v_booking.status::text,
      'message', 'Bookings in status ' || v_booking.status::text || ' cannot be cancelled'
    );
  END IF;

  -- Caller Authorization Guard (resource-scoped for hospital staff)
  IF auth.role() = 'authenticated' THEN
    IF NOT (
      auth.uid() = v_booking.customer_id
      OR public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, auth.uid())
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
    ELSIF public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, auth.uid()) THEN
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
    v_eligible := (v_minutes_to_slot >= 60.0);
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
      COALESCE(public.normalize_phone_number(v_customer_phone), '919848000000'),
      COALESCE(v_customer_name, 'Valued Customer'),
      'MERCHANT_CANCELLED',
      'whatsapp',
      'QUEUED',
      format('Your appointment has been cancelled by the venue due to an emergency. A full 100%% refund of ₹%s has been issued.', v_refund_amount),
      jsonb_build_object(
        'initiated_by', 'MERCHANT',
        'reason', p_reason,
        'refund_amount', v_refund_amount,
        'merchant_strikes', v_new_merchant_strikes,
        'penalty_applied', v_penalty_applied,
        'penalty_amount', v_penalty_amount
      )
    )
    ON CONFLICT (booking_id, event_type, channel) DO NOTHING;
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

-- 3b. reschedule_booking_slot: Use is_caller_authorized_for_resource
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
    IF COALESCE(v_booking.deposit_amount, 0) > 0 AND (v_booking.payment_status != 'PAID' OR v_booking.gateway_payment_id IS NULL) THEN
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

-- 3c. complete_booking: Use is_caller_authorized_for_resource
CREATE OR REPLACE FUNCTION public.complete_booking(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_booking RECORD;
  v_is_authorized BOOLEAN;
BEGIN
  IF v_caller_id IS NULL AND auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Authentication required to complete booking' USING ERRCODE = '42501';
  END IF;

  SELECT id, provider_id, resource_id, status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Verify resource-level authorization if called by user
  IF auth.role() != 'service_role' THEN
    SELECT (
      public.is_admin(v_caller_id)
      OR public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_caller_id)
    ) INTO v_is_authorized;

    IF NOT v_is_authorized THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You are not authorized for this venue or doctor');
    END IF;
  END IF;

  IF v_booking.status != 'CONFIRMED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid transition: Only CONFIRMED bookings can be completed (current: ' || v_booking.status || ')');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'COMPLETED', updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'COMPLETED');
END;
$$;

REVOKE ALL ON FUNCTION public.complete_booking(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_booking(UUID) TO authenticated, service_role;

-- 3d. record_no_show: Use is_caller_authorized_for_resource AND revoke EXECUTE from authenticated
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
    v_payment_status public.payment_status;
    v_penalty BOOLEAN := FALSE;
    v_refund_amount NUMERIC(10, 2) := 0;
BEGIN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

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

    IF auth.role() = 'authenticated' THEN
      IF NOT (
        public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, auth.uid())
        OR public.is_admin(auth.uid())
      ) THEN
        RAISE EXCEPTION 'Only the owning merchant, authorized consultant/staff, or an admin can record a no-show';
      END IF;
    END IF;

    SELECT COALESCE(no_show_count, 0) INTO v_current_count
    FROM public.profiles
    WHERE id = v_booking.customer_id;

    v_new_count := v_current_count + 1;

    IF v_new_count <= 2 THEN
        v_payment_status := 'REFUND_PENDING'::public.payment_status;
        v_penalty := FALSE;
        v_refund_amount := COALESCE(v_booking.deposit_amount, 100.00);
    ELSE
        v_payment_status := 'FORFEITED'::public.payment_status;
        v_penalty := TRUE;
        v_refund_amount := 0;
    END IF;

    PERFORM set_config('app.trusted_write', 'true', true);

    UPDATE public.profiles
    SET no_show_count = v_new_count,
        is_flagged = CASE WHEN v_new_count >= 3 THEN TRUE ELSE is_flagged END,
        updated_at = NOW()
    WHERE id = v_booking.customer_id;

    UPDATE public.bookings
    SET status = 'NO_SHOW',
        payment_status = v_payment_status,
        updated_at = NOW()
    WHERE id = p_booking_id;

    IF v_penalty THEN
        UPDATE public.payments
        SET status = 'FORFEITED',
            updated_at = NOW()
        WHERE booking_id = p_booking_id;

        UPDATE public.providers
        SET penalty_balance = COALESCE(penalty_balance, 0) + COALESCE(v_booking.deposit_amount, 100.00),
            updated_at = NOW()
        WHERE id = v_booking.provider_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'no_show_count', v_new_count,
        'penalty_applied', v_penalty,
        'payment_status', v_payment_status::text,
        'refund_amount', v_refund_amount,
        'flagged', v_new_count >= 3,
        'is_flagged', v_new_count >= 3
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_no_show(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_no_show(UUID) TO service_role;

-- 3e. mark_present_manually: Use is_caller_authorized_for_resource
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

-- 3f. verify_checkin_code: Use is_caller_authorized_for_resource
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. KEEP NEWLY CREATED VENUES IN PENDING_APPROVAL STATUS (Phase 1.8)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_venue(
  p_name text,
  p_category_id text,
  p_address text,
  p_phone text,
  p_opening_time time DEFAULT '09:00:00',
  p_closing_time time DEFAULT '21:00:00',
  p_description text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_latitude numeric DEFAULT 13.6288,
  p_longitude numeric DEFAULT 79.4192
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_provider_id uuid := gen_random_uuid();
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin') THEN
      RAISE EXCEPTION 'Only an admin can create a venue';
    END IF;
  END IF;

  INSERT INTO public.providers (
    id, name, category_id, address, city, phone, email, opening_time,
    closing_time, description, owner_id, latitude, longitude, status
  )
  VALUES (
    v_provider_id, p_name, p_category_id, p_address, 'Tirupati', p_phone, p_email,
    p_opening_time, p_closing_time, p_description, p_owner_id, p_latitude, p_longitude, 'PENDING_APPROVAL'
  );

  RETURN jsonb_build_object(
    'id', v_provider_id,
    'name', p_name,
    'category_id', p_category_id,
    'address', p_address,
    'phone', p_phone,
    'opening_time', p_opening_time,
    'closing_time', p_closing_time,
    'status', 'PENDING_APPROVAL'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_venue(text, text, text, text, time, time, text, text, uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_venue(text, text, text, text, time, time, text, text, uuid, numeric, numeric) TO authenticated, service_role;

COMMIT;

