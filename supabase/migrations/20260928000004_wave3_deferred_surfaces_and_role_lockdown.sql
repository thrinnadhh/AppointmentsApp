-- Migration: 20260928000004_wave3_deferred_surfaces_and_role_lockdown.sql
-- Description:
-- 1. Gate reveal-contact RPCs against anonymous scraping and enforce role authorization for customer & merchant contacts.
-- 2. Restrict staff role creation, modification, and deletion in merchant_memberships strictly to store owners and superadmins.
-- 3. Audit logging for contact reveals.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. GATE REVEAL CONTACT RPC (Customer & Merchant Protection)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reveal_contact(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_booking RECORD;
  v_customer RECORD;
  v_provider RECORD;
  v_is_merchant BOOLEAN := FALSE;
  v_is_customer BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_reveals_last_hour INT;
  v_hourly_limit INT := 20;
BEGIN
  v_caller_id := auth.uid();
  v_caller_role := auth.role();

  -- 1. Strict Authentication Check: Block anonymous scraping
  IF v_caller_role = 'service_role' THEN
    v_is_admin := TRUE;
  ELSIF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to reveal contact' USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch booking record
  SELECT id, customer_id, provider_id, status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Check caller identity against booking participants
  IF NOT v_is_admin THEN
    v_is_admin := public.is_admin(v_caller_id);
    v_is_customer := (v_booking.customer_id = v_caller_id);
    v_is_merchant := (v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)));
  END IF;

  IF NOT (v_is_admin OR v_is_customer OR v_is_merchant) THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to view contacts for this booking' USING ERRCODE = '42501';
  END IF;

  -- 4. Status Check: Only confirmed bookings can reveal contact details
  IF v_booking.status != 'CONFIRMED' THEN
    RAISE EXCEPTION 'Contact details can only be revealed for confirmed bookings (current status: %)', v_booking.status
      USING ERRCODE = '22023';
  END IF;

  -- 5. Rate limiting for non-admins (rolling 1-hour window)
  IF NOT v_is_admin THEN
    SELECT count(*) INTO v_reveals_last_hour
    FROM public.contact_reveal_audit
    WHERE user_id = v_caller_id
      AND revealed_at > (NOW() - INTERVAL '1 hour');

    IF v_reveals_last_hour >= v_hourly_limit THEN
      RAISE EXCEPTION 'Rate limit exceeded: You have reached the maximum of % contact reveals per hour', v_hourly_limit
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- 6. Insert audit trail record
  IF v_caller_id IS NOT NULL THEN
    INSERT INTO public.contact_reveal_audit (
      user_id,
      booking_id,
      revealed_at
    ) VALUES (
      v_caller_id,
      p_booking_id,
      NOW()
    );
  END IF;

  -- 7. Fetch participant records
  SELECT phone, full_name INTO v_customer
  FROM public.profiles
  WHERE id = v_booking.customer_id;

  SELECT phone, name, address INTO v_provider
  FROM public.providers
  WHERE id = v_booking.provider_id;

  -- 8. Return tailored contacts based on caller's role
  IF v_is_merchant OR v_is_admin THEN
    -- Merchant/Admin viewing customer phone
    RETURN jsonb_build_object(
      'success', true,
      'booking_id', p_booking_id,
      'role', 'customer',
      'contact_phone', COALESCE(v_customer.phone, 'Not provided'),
      'contact_name', COALESCE(v_customer.full_name, 'Valued Customer')
    );
  ELSE
    -- Customer viewing merchant/venue phone
    RETURN jsonb_build_object(
      'success', true,
      'booking_id', p_booking_id,
      'role', 'merchant',
      'contact_phone', COALESCE(v_provider.phone, 'Not provided'),
      'contact_name', COALESCE(v_provider.name, 'Service Provider'),
      'address', COALESCE(v_provider.address, 'Tirupati')
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_contact(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_contact(UUID) TO authenticated, service_role;

-- Ensure reveal_customer_contact is also strictly revoked from anon/public
REVOKE ALL ON FUNCTION public.reveal_customer_contact(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_customer_contact(UUID) TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RESTRICT STAFF ROLE MODIFICATIONS STRICTLY TO STORE OWNERS
-- ─────────────────────────────────────────────────────────────────────────────
-- Drop existing write policies on merchant_memberships
DROP POLICY IF EXISTS admins_manage_memberships ON public.merchant_memberships;
DROP POLICY IF EXISTS store_owners_manage_memberships ON public.merchant_memberships;

-- Only platform superadmins OR verified store owners of the specific provider can insert/update/delete memberships
CREATE POLICY store_owners_manage_memberships ON public.merchant_memberships
FOR ALL TO authenticated
USING (
  public.is_admin(auth.uid())
  OR provider_id IN (
    -- Provider owner directly in providers table
    SELECT id FROM public.providers WHERE owner_id = auth.uid()
    UNION
    -- Provider owner in merchant_memberships table
    SELECT mm.provider_id FROM public.merchant_memberships mm WHERE mm.user_id = auth.uid() AND mm.role = 'owner'
  )
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR provider_id IN (
    SELECT id FROM public.providers WHERE owner_id = auth.uid()
    UNION
    SELECT mm.provider_id FROM public.merchant_memberships mm WHERE mm.user_id = auth.uid() AND mm.role = 'owner'
  )
);

-- Ensure anon has zero write permissions
REVOKE INSERT, UPDATE, DELETE ON public.merchant_memberships FROM PUBLIC, anon;
