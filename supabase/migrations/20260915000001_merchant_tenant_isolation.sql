-- Migration: 20260915000001_merchant_tenant_isolation.sql
-- Description: Multi-tenant isolation for merchants, role memberships, and verticalized access controls.

-- 1. ADD default_provider_id TO PROFILES
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS default_provider_id UUID REFERENCES public.providers(id) ON DELETE SET NULL;

-- 2. CREATE MERCHANT MEMBERSHIPS TABLE
CREATE TABLE IF NOT EXISTS public.merchant_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_memberships_user_id ON public.merchant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_merchant_memberships_provider_id ON public.merchant_memberships(provider_id);

-- 3. HELPER FUNCTIONS FOR RBAC & AUTHORIZED PROVIDERS
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = p_user_id AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_authorized_providers(p_user_id UUID DEFAULT auth.uid())
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
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
    SELECT id FROM public.providers WHERE owner_id = p_user_id;
END;
$$;

-- 4. SEED MEMBERSHIPS & DEFAULT PROVIDERS FOR DEMO USERS
UPDATE public.providers 
SET owner_id = '6be12bfd-f10b-4b60-bf52-31c09b952398',
    name = 'SVIMS Dental & Specialty Clinic'
WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE public.providers 
SET owner_id = 'a6fea022-2a8c-45a2-a97c-756111935d43',
    name = 'Naturals Luxury Salon & Spa'
WHERE id = '44444444-4444-4444-4444-444444444444';

UPDATE public.profiles 
SET default_provider_id = '11111111-1111-1111-1111-111111111111'
WHERE id = '6be12bfd-f10b-4b60-bf52-31c09b952398';

UPDATE public.profiles 
SET default_provider_id = '44444444-4444-4444-4444-444444444444'
WHERE id = 'a6fea022-2a8c-45a2-a97c-756111935d43';

INSERT INTO public.merchant_memberships (user_id, provider_id, role)
VALUES 
  ('6be12bfd-f10b-4b60-bf52-31c09b952398', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('a6fea022-2a8c-45a2-a97c-756111935d43', '44444444-4444-4444-4444-444444444444', 'manager')
ON CONFLICT (user_id, provider_id) DO UPDATE SET role = EXCLUDED.role;

-- 5. SEED SAMPLE SALON BOOKINGS
INSERT INTO public.bookings (
    id, customer_id, provider_id, resource_id, slot_start, slot_end, status, payment_status, deposit_amount, reference_code
) VALUES
  (
    'b5555555-5555-5555-5555-555555555551',
    '99999999-9999-9999-9999-999999999991',
    '44444444-4444-4444-4444-444444444444',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    NOW() + INTERVAL '1 hour',
    NOW() + INTERVAL '1 hour 45 minutes',
    'CONFIRMED',
    'CAPTURED',
    75.00,
    'NAT-SALON-101'
  ),
  (
    'b5555555-5555-5555-5555-555555555552',
    '99999999-9999-9999-9999-999999999992',
    '44444444-4444-4444-4444-444444444444',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    NOW() + INTERVAL '2 hours 30 minutes',
    NOW() + INTERVAL '3 hours 15 minutes',
    'CONFIRMED',
    'CAPTURED',
    75.00,
    'NAT-SALON-102'
  ),
  (
    'b5555555-5555-5555-5555-555555555553',
    '99999999-9999-9999-9999-999999999991',
    '44444444-4444-4444-4444-444444444444',
    'ddddddde-dddd-dddd-dddd-dddddddddddd',
    NOW() + INTERVAL '3 hours 30 minutes',
    NOW() + INTERVAL '4 hours 15 minutes',
    'HELD',
    'PENDING',
    75.00,
    'NAT-SALON-103'
  )
ON CONFLICT (id) DO NOTHING;

-- 6. RLS POLICIES
ALTER TABLE public.merchant_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS members_view_own_memberships ON public.merchant_memberships;
CREATE POLICY members_view_own_memberships ON public.merchant_memberships
FOR SELECT USING (
  user_id = auth.uid() OR public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS admins_manage_memberships ON public.merchant_memberships;
CREATE POLICY admins_manage_memberships ON public.merchant_memberships
FOR ALL USING (
  public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS merchants_update_own_provider ON public.providers;
CREATE POLICY merchants_update_own_provider ON public.providers
FOR UPDATE USING (
  id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  OR public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS merchants_insert_resources ON public.resources;
CREATE POLICY merchants_insert_resources ON public.resources
FOR INSERT WITH CHECK (
  provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  OR public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS merchants_update_resources ON public.resources;
CREATE POLICY merchants_update_resources ON public.resources
FOR UPDATE USING (
  provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  OR public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS merchants_delete_resources ON public.resources;
CREATE POLICY merchants_delete_resources ON public.resources
FOR DELETE USING (
  provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  OR public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS allow_reading_bookings ON public.bookings;
CREATE POLICY allow_reading_bookings ON public.bookings
FOR SELECT USING (
  auth.uid() = customer_id
  OR provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  OR public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS allow_updating_bookings ON public.bookings;
CREATE POLICY allow_updating_bookings ON public.bookings
FOR UPDATE USING (
  auth.uid() = customer_id
  OR provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  OR public.is_admin(auth.uid())
);
