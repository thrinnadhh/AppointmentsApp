-- Migration: 20261004000001_unique_gateway_payment_and_atomicity.sql
-- Description: Enforce unique constraint on gateway_payment_id and atomic anti-double-spend guards

-- 1. Unique index on payments.gateway_payment_id to prevent concurrent reuse/replay
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_gateway_payment_id_unique 
ON public.payments (gateway_payment_id) 
WHERE gateway_payment_id IS NOT NULL;

-- 2. Enhanced confirm_booking_payment RPC with atomic anti-replay validation
CREATE OR REPLACE FUNCTION public.confirm_booking_payment(
  p_booking_id UUID,
  p_gateway_payment_id TEXT,
  p_deposit_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_amount NUMERIC(10,2);
BEGIN
  -- Strict server-only guard: PostgREST clients cannot call this
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'payment settlement restricted to service role' USING ERRCODE = '42501';
  END IF;

  -- Anti-Replay Guard: Immediately check if gateway_payment_id is already assigned to a different booking
  IF p_gateway_payment_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.payments
      WHERE gateway_payment_id = p_gateway_payment_id
        AND booking_id <> p_booking_id
    ) OR EXISTS (
      SELECT 1 FROM public.bookings
      WHERE gateway_payment_id = p_gateway_payment_id
        AND id <> p_booking_id
    )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payment identifier has already been used for another booking'
    );
  END IF;

  -- Lock the target booking row for update
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Idempotency check: If already confirmed with this identical payment ID, return idempotent success
  IF v_booking.status = 'CONFIRMED' AND v_booking.gateway_payment_id = p_gateway_payment_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'booking_id', p_booking_id,
      'status', 'CONFIRMED',
      'payment_status', 'CAPTURED',
      'idempotent', true
    );
  END IF;

  IF v_booking.status NOT IN ('HELD', 'PENDING_PAYMENT') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not in a payable state');
  END IF;

  v_amount := COALESCE(p_deposit_amount, v_booking.deposit_amount);

  IF v_amount IS DISTINCT FROM v_booking.deposit_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch with held deposit');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CONFIRMED',
      payment_status = 'CAPTURED',
      gateway_payment_id = p_gateway_payment_id,
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- Record payment with unique violation handling
  BEGIN
    INSERT INTO public.payments (
      booking_id, gateway_payment_id, amount, currency, status
    ) VALUES (
      p_booking_id, p_gateway_payment_id, v_amount, 'INR', 'CAPTURED'
    );
  EXCEPTION WHEN unique_violation THEN
    -- If duplicate on gateway_payment_id belongs to another booking, reject
    IF EXISTS (
      SELECT 1 FROM public.payments
      WHERE gateway_payment_id = p_gateway_payment_id
        AND booking_id <> p_booking_id
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Payment identifier has already been used for another booking'
      );
    END IF;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'CONFIRMED',
    'payment_status', 'CAPTURED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_booking_payment(UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_payment(UUID, TEXT, NUMERIC) TO service_role;
