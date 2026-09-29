-- Migration: 20260923000001_customer_phone_masking_and_audit.sql
-- Description:
-- 1. Server-side customer phone masking function failing closed.
-- 2. Revoke merchant/staff access to raw customer profiles and phone column via RLS.
-- 3. Contact reveal audit table (contact_reveal_audit).
-- 4. reveal_customer_contact(p_booking_id UUID) RPC enforcing confirmed status, merchant ownership, and writing audit log.
-- 5. Merchant-facing view (merchant_bookings) and RPC (get_merchant_bookings) returning server-side masked phone numbers.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. MASKING FUNCTION (FAIL-CLOSED)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mask_customer_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits text;
  v_len int;
BEGIN
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN 'Not provided';
  END IF;

  -- Strip all non-digits
  v_digits := regexp_replace(p_phone, '\D', '', 'g');
  v_len := length(v_digits);

  -- Fewer than 6 digits returns 'Not provided'
  IF v_len < 6 THEN
    RETURN 'Not provided';
  END IF;

  -- Otherwise asterisks except the last 3 digits
  RETURN repeat('*', v_len - 3) || right(v_digits, 3);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mask_customer_phone(text) TO authenticated, service_role, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CONTACT REVEAL AUDIT TABLE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_reveal_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  revealed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_reveal_audit_booking ON public.contact_reveal_audit(booking_id);
CREATE INDEX IF NOT EXISTS idx_contact_reveal_audit_user ON public.contact_reveal_audit(user_id);

ALTER TABLE public.contact_reveal_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and authorized merchants can view reveal audits" ON public.contact_reveal_audit;
CREATE POLICY "Admins and authorized merchants can view reveal audits"
ON public.contact_reveal_audit
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = contact_reveal_audit.booking_id
      AND b.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REVEAL CUSTOMER CONTACT RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reveal_customer_contact(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_booking RECORD;
  v_customer RECORD;
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- 1. Find the booking
  SELECT id, provider_id, customer_id, status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Verify merchant ownership / authorization
  SELECT (
    public.is_admin(v_caller_id)
    OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id))
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to view contacts for this venue' USING ERRCODE = '42501';
  END IF;

  -- 3. Verify booking is confirmed
  IF v_booking.status != 'CONFIRMED' THEN
    RAISE EXCEPTION 'Customer contact can only be revealed for confirmed bookings (current status: %)', v_booking.status
      USING ERRCODE = '22023';
  END IF;

  -- 4. Fetch customer profile contact
  SELECT phone, full_name
  INTO v_customer
  FROM public.profiles
  WHERE id = v_booking.customer_id;

  IF NOT FOUND OR v_customer.phone IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'booking_id', p_booking_id,
      'phone', 'Not provided',
      'full_name', COALESCE(v_customer.full_name, 'Valued Customer')
    );
  END IF;

  -- 5. Insert audit log
  INSERT INTO public.contact_reveal_audit (
    user_id,
    booking_id,
    revealed_at
  ) VALUES (
    v_caller_id,
    p_booking_id,
    NOW()
  );

  -- 6. Return unmasked contact
  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'phone', v_customer.phone,
    'full_name', v_customer.full_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reveal_customer_contact(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REVOKE MERCHANT / STAFF ACCESS TO RAW PROFILES VIA RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Drop any previous permissive profile policies that allowed merchants to read customer profiles
DROP POLICY IF EXISTS users_read_own_profile ON public.profiles;
DROP POLICY IF EXISTS "Allow reading profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;

-- Merchants/staff can ONLY read their own profile, or fellow merchant staff in their team, or admin
CREATE POLICY users_read_own_profile ON public.profiles
FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.merchant_memberships mm
    WHERE mm.user_id = profiles.id
      AND mm.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. MERCHANT-FACING VIEW & RPC WITH SERVER-SIDE MASKED PHONE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.merchant_bookings AS
SELECT
  b.id,
  b.customer_id,
  b.provider_id,
  b.resource_id,
  b.slot_start,
  b.slot_end,
  b.status,
  b.payment_status,
  b.deposit_amount,
  b.platform_fee,
  b.total_amount,
  b.gateway_payment_id,
  b.hold_expires_at,
  b.reference_code,
  b.attachment_url,
  b.reminder_1h_sent_at,
  b.reminder_30m_sent_at,
  b.is_present,
  b.customer_arrived_at,
  b.platform_fee_gst,
  b.gstin_platform,
  b.invoice_number,
  b.created_at,
  b.updated_at,
  COALESCE(pr.full_name, 'Walk-in / Guest') AS customer_name,
  public.mask_customer_phone(pr.phone) AS customer_phone,
  COALESCE(pr.no_show_count, 0) AS no_show_count,
  COALESCE(r.name, 'Standard Unit') AS resource_name,
  COALESCE(r.type, 'slot') AS resource_type,
  COALESCE(p.name, 'Merchant Venue') AS provider_name
FROM public.bookings b
LEFT JOIN public.profiles pr ON pr.id = b.customer_id
LEFT JOIN public.resources r ON r.id = b.resource_id
LEFT JOIN public.providers p ON p.id = b.provider_id
WHERE b.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
   OR public.is_admin(auth.uid());

GRANT SELECT ON public.merchant_bookings TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_merchant_bookings(p_provider_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  customer_id UUID,
  provider_id UUID,
  resource_id UUID,
  slot_start TIMESTAMPTZ,
  slot_end TIMESTAMPTZ,
  status booking_status,
  payment_status payment_status,
  deposit_amount NUMERIC(10, 2),
  platform_fee NUMERIC(10, 2),
  total_amount NUMERIC(10, 2),
  gateway_payment_id TEXT,
  hold_expires_at TIMESTAMPTZ,
  reference_code TEXT,
  attachment_url TEXT,
  reminder_1h_sent_at TIMESTAMPTZ,
  reminder_30m_sent_at TIMESTAMPTZ,
  is_present BOOLEAN,
  customer_arrived_at TIMESTAMPTZ,
  platform_fee_gst NUMERIC(10, 2),
  gstin_platform TEXT,
  invoice_number TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  customer_name TEXT,
  customer_phone TEXT,
  no_show_count INT,
  resource_name TEXT,
  resource_type TEXT,
  provider_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.customer_id,
    b.provider_id,
    b.resource_id,
    b.slot_start,
    b.slot_end,
    b.status,
    b.payment_status,
    b.deposit_amount,
    b.platform_fee,
    b.total_amount,
    b.gateway_payment_id,
    b.hold_expires_at,
    b.reference_code,
    b.attachment_url,
    b.reminder_1h_sent_at,
    b.reminder_30m_sent_at,
    b.is_present,
    b.customer_arrived_at,
    b.platform_fee_gst,
    b.gstin_platform,
    b.invoice_number,
    b.created_at,
    b.updated_at,
    COALESCE(pr.full_name, 'Walk-in / Guest') AS customer_name,
    public.mask_customer_phone(pr.phone) AS customer_phone,
    COALESCE(pr.no_show_count, 0) AS no_show_count,
    COALESCE(r.name, 'Standard Unit') AS resource_name,
    COALESCE(r.type, 'slot') AS resource_type,
    COALESCE(p.name, 'Merchant Venue') AS provider_name
  FROM public.bookings b
  LEFT JOIN public.profiles pr ON pr.id = b.customer_id
  LEFT JOIN public.resources r ON r.id = b.resource_id
  LEFT JOIN public.providers p ON p.id = b.provider_id
  WHERE (p_provider_id IS NULL OR b.provider_id = p_provider_id)
    AND (
      b.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
      OR public.is_admin(auth.uid())
    )
  ORDER BY b.slot_start ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_merchant_bookings(UUID) TO authenticated, service_role;
