-- =============================================================================
-- Migration: 20261021000003_harden_cancel_and_reschedule_non_cancellable_statuses.sql
-- Description:
--   Harden cancel_booking and reschedule_booking_slot to strictly reject:
--   CHECKED_IN, WAITING, UP_NEXT, IN_CONSULTATION, COMPLETED, NO_SHOW and already
--   CANCELLED bookings, ensuring zero refund, penalty or forfeit side effects.
-- =============================================================================

-- Ensure enum values WAITING and UP_NEXT exist in booking_status enum
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'WAITING';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'UP_NEXT';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. HARDEN cancel_booking RPC
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

  -- 1. Rejection of already cancelled bookings
  IF v_booking.status = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Booking is already cancelled',
      'message', 'Booking is already cancelled'
    );
  END IF;

  -- 2. Strict rejection of checked-in, in-progress, or terminal booking statuses
  IF v_booking.status::text IN ('CHECKED_IN', 'WAITING', 'UP_NEXT', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW')
     OR v_booking.is_present = TRUE
     OR v_booking.status::text NOT IN ('CONFIRMED', 'HELD') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot cancel booking in status ' || v_booking.status::text,
      'message', 'Bookings in status ' || v_booking.status::text || ' cannot be cancelled'
    );
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. HARDEN reschedule_booking_slot RPC
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
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not authorized to reschedule this booking');
  END IF;

  -- Reject non-cancellable/non-reschedulable statuses
  IF v_booking.status::text IN ('CHECKED_IN', 'WAITING', 'UP_NEXT', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW', 'CANCELLED')
     OR v_booking.is_present = TRUE
     OR v_booking.status::text NOT IN ('CONFIRMED', 'HELD') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);

  -- Prevent rescheduling to a slot in the past
  IF p_new_slot_start < v_now THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule to a slot in the past');
  END IF;

  -- Late-window enforcement: customer cannot reset cancellation cutoff by rescheduling
  IF v_caller_role <> 'service_role'
     AND v_caller_id IS NOT NULL
     AND v_caller_id = v_booking.customer_id
     AND v_booking.slot_start < v_now + INTERVAL '30 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Late reschedule: appointments within 30 minutes of their slot cannot be rescheduled.');
  END IF;

  -- Range overlap check against other active bookings for the same resource
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND status IN ('HELD', 'CONFIRMED')
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
