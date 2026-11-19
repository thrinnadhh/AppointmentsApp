-- ==============================================================================
-- Migration: 20261120000003_harden_resource_leaves_rls.sql
-- Vulnerability ID: SEC-WIN-015
-- Description: Restrict public.resource_leaves SELECT policy to authorized
--              merchants, staff, and admins. Revoke anon table SELECT grant.
-- ==============================================================================

-- 1. Revoke public/anon SELECT grant on public.resource_leaves
REVOKE SELECT ON public.resource_leaves FROM anon;

-- 2. Drop overly permissive qual: true SELECT policy
DROP POLICY IF EXISTS "resource_leaves_select_policy" ON public.resource_leaves;

-- 3. Create hardened tenant-scoped SELECT policy for authenticated users
CREATE POLICY "resource_leaves_select_policy" ON public.resource_leaves
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.providers
      WHERE providers.id = resource_leaves.provider_id
        AND providers.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.merchant_memberships
      WHERE merchant_memberships.provider_id = resource_leaves.provider_id
        AND merchant_memberships.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.department_members
      WHERE department_members.merchant_id = resource_leaves.provider_id
        AND department_members.user_id = auth.uid()
        AND department_members.status = 'active'
    )
  );

COMMENT ON POLICY "resource_leaves_select_policy" ON public.resource_leaves IS
  'SEC-WIN-015: Restricts doctor leave visibility strictly to authorized merchant staff, owner, and platform admins. Anon cannot read leave reasons.';
