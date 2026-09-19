-- =============================================================================
-- Migration: 20260916000002_merchant_strike_and_reassignment.sql
-- Description:
--   1. Adds cancellation strike and penalty columns to public.providers:
--      - cancellation_strikes INT DEFAULT 0
--      - strike_reset_date TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
--      - penalty_balance NUMERIC(10, 2) DEFAULT 0.00
--      - is_booking_frozen BOOLEAN DEFAULT FALSE
--   2. RPC: reassign_booking_resource:
--      - Allows transferring a booking to a different active resource of the same provider
--      - Enforces slot conflict checks
--      - Emits RESOURCE_REASSIGNED log in notification_logs
--   3. RPC: cancel_booking:
--      - Enhanced to track merchant strikes, apply ₹100 penalty on strike 3+,
--        reset strikes after rolling 30-day window, and apply 2 strikes for last-minute (<= 30m) cancellations
--   4. Test utility RPC: reset_test_provider_strikes:
--      - Deterministic reset helper for testing
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add Merchant Reliability Columns to public.providers
-- -----------------------------------------------------------------------------
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS cancellation_strikes INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS strike_reset_date TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  ADD COLUMN IF NOT EXISTS penalty_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS is_booking_frozen BOOLEAN NOT NULL DEFAULT FALSE;

-- -----------------------------------------------------------------------------
-- 2. RPC: reassign_booking_resource
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_booking_resource(
  p_booking_id UUID,
  p_new_resource_id UUID,
  p_reason TEXT DEFAULT 'Emergency staff reassignment'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_old_resource public.resources%ROWTYPE;
  v_new_resource public.resources%ROWTYPE;
  v_conflict_id UUID;
  v_customer_phone TEXT;
  v_customer_name TEXT;
BEGIN
  -- 1. Fetch booking
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status IN ('CANCELLED', 'COMPLETED', 'NO_SHOW') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reassign a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  -- 2. Fetch current resource
  SELECT * INTO v_old_resource
  FROM public.resources
  WHERE id = v_booking.resource_id;

  -- 3. Fetch target resource
  SELECT * INTO v_new_resource
  FROM public.resources
  WHERE id = p_new_resource_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target resource not found');
  END IF;

  -- 4. Verify target resource belongs to same provider
  IF v_new_resource.provider_id != v_booking.provider_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target resource belongs to a different business/provider');
  END IF;

  -- 5. Verify target resource is active
  IF NOT v_new_resource.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target resource is not currently active');
  END IF;

  -- 6. Check slot conflict for new resource
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = p_new_resource_id
    AND slot_start = v_booking.slot_start
    AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
    AND id != p_booking_id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'The target resource already has a booking during this slot');
  END IF;

  -- 7. Perform update
  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET resource_id = p_new_resource_id,
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- 8. Fetch customer details for notification
  SELECT full_name, phone INTO v_customer_name, v_customer_phone
  FROM public.profiles
  WHERE id = v_booking.customer_id;

  -- 9. Log notification event
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
    'RESOURCE_REASSIGNED',
    'SMS_WHATSAPP',
    'SENT',
    format('Staff reassigned: Your appointment has been transferred from %s to %s due to an emergency.', COALESCE(v_old_resource.name, 'Staff'), v_new_resource.name),
    jsonb_build_object(
      'old_resource_id', v_booking.resource_id,
      'old_resource_name', v_old_resource.name,
      'new_resource_id', p_new_resource_id,
      'new_resource_name', v_new_resource.name,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'old_resource_id', v_booking.resource_id,
    'old_resource_name', v_old_resource.name,
    'new_resource_id', p_new_resource_id,
    'new_resource_name', v_new_resource.name,
    'slot_start', v_booking.slot_start,
    'slot_end', v_booking.slot_end,
    'status', v_booking.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reassign_booking_resource(uuid, uuid, text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Enhanced cancel_booking RPC with Merchant 3-Strike Policy
-- -----------------------------------------------------------------------------
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
  
  -- Merchant strike variables
  v_is_merchant BOOLEAN;
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
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking is already cancelled');
  END IF;

  v_is_merchant := (upper(p_initiated_by) = 'MERCHANT');
  v_minutes_to_slot := EXTRACT(EPOCH FROM (v_booking.slot_start - NOW())) / 60;

  IF v_is_merchant THEN
    -- Merchant cancellations ALWAYS fully refund the customer
    v_eligible := true;
    v_payment_status := 'REFUNDED'::public.payment_status;
    v_refund_amount := COALESCE(v_booking.deposit_amount, 100.00);

    -- Load provider details
    SELECT * INTO v_provider
    FROM public.providers
    WHERE id = v_booking.provider_id
    FOR UPDATE;

    IF FOUND THEN
      -- Check rolling 30-day window reset
      IF NOW() > v_provider.strike_reset_date THEN
        v_provider.cancellation_strikes := 0;
        v_provider.strike_reset_date := NOW() + INTERVAL '30 days';
      END IF;

      -- Last-minute penalty multiplier: cancellations <= 30 minutes before slot incur 2 strikes
      IF v_minutes_to_slot <= 30 THEN
        v_strike_increment := 2;
      ELSE
        v_strike_increment := 1;
      END IF;

      v_new_merchant_strikes := v_provider.cancellation_strikes + v_strike_increment;

      -- Strike 1 & 2: Courtesy Grace Period (no monetary penalty to merchant)
      -- Strike 3+: ₹100 penalty debited to merchant payout / penalty_balance
      IF v_new_merchant_strikes >= 3 THEN
        v_penalty_applied := TRUE;
        v_penalty_amount := 100.00;
      ELSE
        v_penalty_applied := FALSE;
        v_penalty_amount := 0.00;
      END IF;

      -- At 5 strikes: Booking Freeze (requires admin review)
      IF v_new_merchant_strikes >= 5 THEN
        v_is_frozen := TRUE;
      ELSE
        v_is_frozen := v_provider.is_booking_frozen;
      END IF;

      -- Update provider record
      UPDATE public.providers
      SET cancellation_strikes = v_new_merchant_strikes,
          penalty_balance = penalty_balance + v_penalty_amount,
          is_booking_frozen = v_is_frozen,
          strike_reset_date = v_provider.strike_reset_date,
          updated_at = NOW()
      WHERE id = v_booking.provider_id;
    END IF;

  ELSE
    -- Customer cancellation: 30-minute cutoff applies
    v_eligible := (v_minutes_to_slot > 30);
    IF v_eligible THEN
      v_payment_status := 'REFUNDED'::public.payment_status;
      v_refund_amount := COALESCE(v_booking.deposit_amount, 100.00);
    ELSE
      v_payment_status := 'FORFEITED'::public.payment_status;
      v_refund_amount := 0;
    END IF;
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CANCELLED',
      payment_status = v_payment_status,
      updated_at = NOW()
  WHERE id = p_booking_id;

  IF v_booking.gateway_payment_id IS NOT NULL THEN
    UPDATE public.payments
    SET status = v_payment_status,
        updated_at = NOW(),
        metadata = jsonb_build_object(
          'cancellation_reason', p_reason,
          'initiated_by', p_initiated_by,
          'refund_amount', v_refund_amount,
          'minutes_before_slot', v_minutes_to_slot,
          'merchant_strikes', v_new_merchant_strikes,
          'merchant_penalty', v_penalty_amount
        )
    WHERE booking_id = p_booking_id;
  END IF;

  -- If merchant cancelled, log an alert notification for the customer
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

GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Test Utility RPC: reset_test_provider_strikes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_test_provider_strikes(
  p_provider_id UUID,
  p_count INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.providers
  SET cancellation_strikes = p_count,
      penalty_balance = CASE WHEN p_count = 0 THEN 0.00 ELSE penalty_balance END,
      is_booking_frozen = (p_count >= 5),
      updated_at = NOW()
  WHERE id = p_provider_id;

  RETURN jsonb_build_object(
    'success', true,
    'provider_id', p_provider_id,
    'cancellation_strikes', p_count,
    'is_booking_frozen', p_count >= 5
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_test_provider_strikes(uuid, int) TO anon, authenticated, service_role;
