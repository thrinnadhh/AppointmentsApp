-- Migration: Customer Arrival Reached & In-Person Presence Tracking
-- Allows customers to signal when they have arrived at a hospital, clinic, salon, or venue.
-- Adds is_present boolean and customer_arrived_at timestamp to public.bookings.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_present BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_arrived_at TIMESTAMPTZ NULL;

-- Index to quickly query active present customers in a venue
CREATE INDEX IF NOT EXISTS idx_bookings_is_present 
  ON public.bookings(provider_id, is_present) 
  WHERE is_present = true;

-- RPC for secure customer arrival declaration
CREATE OR REPLACE FUNCTION public.mark_customer_reached(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Booking not found'
    );
  END IF;

  IF v_booking.status = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot mark arrived: Booking is already cancelled'
    );
  END IF;

  IF v_booking.status = 'NO_SHOW' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot mark arrived: Booking was marked as no-show'
    );
  END IF;

  UPDATE public.bookings
  SET 
    is_present = true,
    customer_arrived_at = COALESCE(customer_arrived_at, now()),
    updated_at = now()
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'is_present', v_booking.is_present,
    'customer_arrived_at', v_booking.customer_arrived_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_customer_reached(UUID) TO anon, authenticated, service_role;
