-- =============================================================================
-- Migration: 20260928000001_lockdown_security_definer_search_path.sql
-- Description:
--   1. Harden SECURITY DEFINER functions by fixing mutable search_path vulnerability
--      (explicit SET search_path = public, pg_temp).
--   2. Lockdown public.mark_customer_reached:
--      - Revoke execution from PUBLIC and anon.
--      - Add in-function caller authorization (customer owner, venue staff, or admin).
--      - Explicitly set search_path = public, pg_temp.
--   3. Lockdown public.is_admin and public.get_user_authorized_providers with
--      immutable search_path.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. public.is_admin: immutable search_path
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = p_user_id AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. public.get_user_authorized_providers: immutable search_path
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_authorized_providers(p_user_id UUID DEFAULT auth.uid())
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
STABLE
AS $$
BEGIN
  IF public.is_admin(p_user_id) THEN
    RETURN QUERY SELECT id FROM public.providers;
    RETURN;
  END IF;

  RETURN QUERY 
    SELECT provider_id FROM public.merchant_memberships WHERE user_id = p_user_id
    UNION
    SELECT id FROM public.providers WHERE owner_id = p_user_id
    UNION
    SELECT p.id FROM public.providers p
    JOIN auth.users u ON lower(trim(u.email)) = lower(trim(p.email))
    WHERE u.id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_authorized_providers(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_authorized_providers(UUID) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. public.mark_customer_reached: authorization + immutable search_path
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_customer_reached(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
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

  -- Verify caller authorization:
  -- Allowed: service_role, booking customer, venue staff/owners, or platform admin
  IF v_caller_role = 'service_role' THEN
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
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: You do not have permission to mark arrival for this booking'
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

-- Revoke anon access and grant strictly to authenticated and service_role
REVOKE ALL ON FUNCTION public.mark_customer_reached(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_customer_reached(UUID) TO authenticated, service_role;
