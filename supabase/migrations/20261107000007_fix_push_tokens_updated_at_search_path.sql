-- =============================================================================
-- Migration: 20261107000007_fix_push_tokens_updated_at_search_path.sql
-- Description: Security Advisor Finding #0011 Remediation:
--              Set immutable search_path on public.trg_push_tokens_updated_at
--              and restrict execution privileges to service_role.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_push_tokens_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_push_tokens_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_push_tokens_updated_at() TO service_role;
