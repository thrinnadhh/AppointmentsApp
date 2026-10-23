-- =============================================================================
-- Migration: 20261023000001_restore_hospital_access_helper_wrappers.sql
-- Description:
--   Restore 1-argument RPC wrappers for hospital_role(p_provider_id UUID)
--   and hospital_accessible_resource_ids(p_provider_id UUID)
--   so client-side and PostgREST RPC callers specifying only p_provider_id
--   can resolve against auth.uid() without PGRST202 schema errors.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hospital_role(p_provider_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
  SELECT public.hospital_role(p_provider_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.hospital_role(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_role(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hospital_accessible_resource_ids(p_provider_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
  SELECT public.hospital_accessible_resource_ids(p_provider_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.hospital_accessible_resource_ids(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_accessible_resource_ids(UUID) TO authenticated, service_role;
