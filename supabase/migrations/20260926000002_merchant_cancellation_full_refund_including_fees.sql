-- =============================================================================
-- Migration: 20260926000002_merchant_cancellation_full_refund_including_fees.sql
-- Description:
--   Explicitly enforce published cancellation policy:
--   When a merchant initiates cancellation of a booking, the customer receives
--   a full 100% refund of deposit_amount + platform_fee + platform_fee_gst.
-- =============================================================================

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

  v_is_merchant := (upper(p_initiated_by) = 'MERCHANT');
  v_minutes_to_slot := EXTRACT(EPOCH FROM (v_booking.slot_start - NOW())) / 60;

  IF v_is_merchant THEN
    -- Merchant cancellations ALWAYS fully refund customer: deposit + platform_fee + platform_fee_gst
    v_eligible := true;
    v_payment_status := 'REFUND_PENDING'::public.payment_status;
    v_refund_amount := COALESCE(v_booking.deposit_amount, 0.00) +
                       COALESCE(v_booking.platform_fee, 0.00) +
                       COALESCE(v_booking.platform_fee_gst, 0.00);

    -- Fallback if deposit/fees are null
    IF v_refund_amount = 0 THEN
      v_refund_amount := COALESCE(v_booking.total_amount, 100.00);
    END IF;

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
    -- Customer cancellation: 60-minute cutoff policy (> 60m = full deposit refund, <= 60m = forfeited)
    v_eligible := (v_minutes_to_slot > 60);
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

REVOKE ALL ON FUNCTION public.cancel_booking(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT, TEXT) TO authenticated, service_role;
