-- Migration: 20260916000001_grace_no_show_and_30m_cancellation.sql
-- Description:
-- 1. 3-Strike No-Show Courtesy System: First 2 missed appointments get full deposit refund (grace period).
--    3rd missed appointment forfeits the ₹100 deposit to the provider/merchant.
-- 2. 30-Minute Cancellation Cutoff: Cancellations > 30 minutes before slot start get 100% refund.
--    Cancellations within 30 minutes forfeit deposit.

-- -----------------------------------------------------------------------------
-- 1. Updated record_no_show RPC (3-Strike Courtesy Policy)
-- -----------------------------------------------------------------------------
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
    FROM public.bookings WHERE id = p_booking_id;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    IF auth.role() = 'authenticated' THEN
      IF NOT (
        EXISTS (SELECT 1 FROM public.providers WHERE id = v_booking.provider_id AND owner_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
      ) THEN
        RAISE EXCEPTION 'Only the owning merchant or an admin can record a no-show';
      END IF;
    END IF;

    -- Read current strike count of customer
    SELECT COALESCE(no_show_count, 0) INTO v_current_count
    FROM public.profiles
    WHERE id = v_booking.customer_id;

    v_new_count := v_current_count + 1;

    -- 3-Strike Courtesy Policy:
    -- Strike 1 or 2: Courtesy Grace Period -> Full deposit refund
    -- Strike 3+: Deposit forfeited and retained by the merchant
    IF v_new_count <= 2 THEN
        v_payment_status := 'REFUNDED'::public.payment_status;
        v_penalty := FALSE;
        v_refund_amount := COALESCE(v_booking.deposit_amount, 100.00);
    ELSE
        v_payment_status := 'FORFEITED'::public.payment_status;
        v_penalty := TRUE;
        v_refund_amount := 0;
    END IF;

    PERFORM set_config('app.trusted_write', 'true', true);

    UPDATE public.bookings
    SET status = 'NO_SHOW',
        payment_status = v_payment_status,
        updated_at = NOW()
    WHERE id = p_booking_id;

    -- Update payment ledger entry if present
    IF v_booking.gateway_payment_id IS NOT NULL THEN
      UPDATE public.payments
      SET status = v_payment_status,
          updated_at = NOW(),
          metadata = jsonb_build_object(
            'no_show_strike', v_new_count,
            'penalty_applied', v_penalty,
            'refund_amount', v_refund_amount,
            'recorded_at', NOW()
          )
      WHERE booking_id = p_booking_id;
    END IF;

    UPDATE public.profiles
    SET no_show_count = v_new_count,
        is_flagged = CASE WHEN v_new_count >= 3 THEN TRUE ELSE is_flagged END,
        updated_at = NOW()
    WHERE id = v_booking.customer_id;

    RETURN jsonb_build_object(
      'success', true,
      'booking_id', p_booking_id,
      'no_show_count', v_new_count,
      'penalty_applied', v_penalty,
      'payment_status', v_payment_status,
      'refund_amount', v_refund_amount,
      'flagged', v_new_count >= 3
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_no_show(uuid) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Updated cancel_booking RPC (30-Minute Cancellation Cutoff)
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
  v_minutes_to_slot NUMERIC;
  v_eligible BOOLEAN;
  v_payment_status public.payment_status;
  v_refund_amount NUMERIC(10, 2) := 0;
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

  v_minutes_to_slot := EXTRACT(EPOCH FROM (v_booking.slot_start - NOW())) / 60;
  IF upper(p_initiated_by) = 'MERCHANT' THEN
    v_eligible := true;
  ELSE
    -- 30-Minute Cutoff: Full refund if cancelled > 30 minutes in advance
    v_eligible := (v_minutes_to_slot > 30);
  END IF;

  IF v_eligible THEN
    v_payment_status := 'REFUNDED'::public.payment_status;
    v_refund_amount := COALESCE(v_booking.deposit_amount, 100.00);
  ELSE
    v_payment_status := 'FORFEITED'::public.payment_status;
    v_refund_amount := 0;
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
          'minutes_before_slot', v_minutes_to_slot
        )
    WHERE booking_id = p_booking_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'CANCELLED',
    'payment_status', v_payment_status,
    'refund_eligible', v_eligible,
    'refund_amount', v_refund_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Updated protect_booking_payment_fields Trigger Function (30-Min Cutoff)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_booking_payment_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_minutes_to_slot numeric;
BEGIN
  -- Allow trusted internal functions to bypass
  IF current_setting('app.trusted_write', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.gateway_payment_id IS DISTINCT FROM OLD.gateway_payment_id
     OR NEW.deposit_amount IS DISTINCT FROM OLD.deposit_amount THEN
    RAISE EXCEPTION 'Payment identifiers and amounts can only be set by the trusted payment system';
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF (SELECT auth.uid()) IS DISTINCT FROM OLD.customer_id OR NEW.status != 'CANCELLED' THEN
      RAISE EXCEPTION 'payment_status can only be changed by the payment system';
    END IF;

    v_minutes_to_slot := EXTRACT(EPOCH FROM (OLD.slot_start - now())) / 60;

    IF v_minutes_to_slot > 30 AND NEW.payment_status != 'REFUNDED' THEN
      RAISE EXCEPTION 'Cancellations more than 30 minutes before the slot must be REFUNDED, not %', NEW.payment_status;
    ELSIF v_minutes_to_slot <= 30 AND NEW.payment_status != 'FORFEITED' THEN
      RAISE EXCEPTION 'Cancellations within 30 minutes of the slot must be FORFEITED, not %', NEW.payment_status;
    END IF;
  END IF;

  IF (SELECT auth.uid()) = OLD.customer_id AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status != 'CANCELLED' THEN
    RAISE EXCEPTION 'Customers may only cancel their own booking, not set status to %', NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_booking_payment_fields ON public.bookings;
CREATE TRIGGER trg_protect_booking_payment_fields
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.protect_booking_payment_fields();

-- -----------------------------------------------------------------------------
-- 4. Test Utility RPC: reset_test_customer_strikes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_test_customer_strikes(
  p_customer_id UUID,
  p_count INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);
  UPDATE public.profiles
  SET no_show_count = p_count,
      is_flagged = (p_count >= 3),
      updated_at = NOW()
  WHERE id = p_customer_id;

  RETURN jsonb_build_object('success', true, 'customer_id', p_customer_id, 'no_show_count', p_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_test_customer_strikes(uuid, int) TO anon, authenticated, service_role;
