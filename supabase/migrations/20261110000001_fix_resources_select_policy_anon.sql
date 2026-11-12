-- Migration: Fix resources select policy for anon role
-- Description: In 20261107000010_perf_multiple_permissive_policies.sql, resources_select_policy was defined
-- TO public with a subquery on public.providers(owner_id). Since anon does not have SELECT on providers(owner_id),
-- this caused anon queries joining resources to fail with 'permission denied for table providers'.
-- We split the select policy so anon evaluates only (is_active = true) while authenticated users evaluate owner/admin checks.

DROP POLICY IF EXISTS "resources_select_policy" ON public.resources;
DROP POLICY IF EXISTS "resources_anon_select" ON public.resources;
DROP POLICY IF EXISTS "resources_authenticated_select" ON public.resources;

CREATE POLICY "resources_anon_select"
  ON public.resources
  FOR SELECT
  TO anon
  USING (
    is_active = true
  );

CREATE POLICY "resources_authenticated_select"
  ON public.resources
  FOR SELECT
  TO authenticated, service_role
  USING (
    (is_active = true)
    OR (provider_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    ))
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))
  );

