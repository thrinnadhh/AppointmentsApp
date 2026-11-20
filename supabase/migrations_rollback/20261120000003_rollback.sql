-- ==============================================================================
-- Rollback Migration: 20261120000003_rollback.sql
-- Vulnerability ID: SEC-WIN-015
-- Rollback Target: 20261120000003_harden_resource_leaves_rls.sql
-- Description: Re-grants anon SELECT on public.resource_leaves and restores
--              the permissive public SELECT policy.
-- ==============================================================================

-- 1. Restore anon SELECT grant on public.resource_leaves
GRANT SELECT ON public.resource_leaves TO anon;

-- 2. Drop hardened policy
DROP POLICY IF EXISTS "resource_leaves_select_policy" ON public.resource_leaves;

-- 3. Restore permissive SELECT policy for authenticated and anon
CREATE POLICY "resource_leaves_select_policy" ON public.resource_leaves
  FOR SELECT TO authenticated, anon
  USING (true);
