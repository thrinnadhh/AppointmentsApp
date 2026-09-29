-- Fix reschedule_booking_slot type mismatch and permissions
-- 1. Declare v_target_status as public.booking_status enum instead of text
--    to prevent 'column "status" is of type booking_status but expression is of type text'
-- 2. Grant EXECUTE to anon, authenticated, and service_role so API routes can execute RPC

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
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard:
  IF v_caller_role = 'service_role' OR SESSION_USER = 'postgres' OR CURRENT_USER = 'postgres' THEN
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

  IF v_booking.status IN ('CANCELLED', 'COMPLETED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
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

  -- Financial State Machine: Prevent unauthorized transition from HELD to CONFIRMED without captured payment
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

  BEGIN
    UPDATE public.bookings
    SET slot_start = p_new_slot_start,
        slot_end = p_new_slot_end,
        status = v_target_status,
        updated_at = NOW()
    WHERE id = p_booking_id;
  EXCEPTION
    WHEN exclusion_violation OR unique_violation THEN
      RETURN jsonb_build_object('success', false, 'error', 'The requested new slot is already booked or held');
  END;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'slot_start', p_new_slot_start,
    'slot_end', p_new_slot_end,
    'status', v_target_status::text
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated, service_role;
