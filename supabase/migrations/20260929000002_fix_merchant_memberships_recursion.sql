-- Migration: 20260929000002_fix_merchant_memberships_recursion.sql
-- Fix: Prevent 42P17 infinite recursion on public.merchant_memberships RLS policy
-- Root cause: store_owners_manage_memberships policy previously executed a subquery directly against
-- public.merchant_memberships while public.profiles evaluated a subquery against merchant_memberships,
-- triggering circular policy evaluation whenever any authenticated user read their own profile.

-- 1. Create a SECURITY DEFINER helper function to evaluate store ownership or administrative privileges
CREATE OR REPLACE FUNCTION public.is_merchant_owner_or_admin(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT is_admin(p_user_id) OR EXISTS (
    SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = p_user_id
    UNION
    SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = p_user_id AND role = 'owner'
  );
$$;

-- 2. Drop and recreate store_owners_manage_memberships with the SECURITY DEFINER check
DROP POLICY IF EXISTS "store_owners_manage_memberships" ON public.merchant_memberships;

CREATE POLICY "store_owners_manage_memberships" ON public.merchant_memberships
FOR ALL
TO authenticated
USING (public.is_merchant_owner_or_admin(provider_id, auth.uid()))
WITH CHECK (public.is_merchant_owner_or_admin(provider_id, auth.uid()));
