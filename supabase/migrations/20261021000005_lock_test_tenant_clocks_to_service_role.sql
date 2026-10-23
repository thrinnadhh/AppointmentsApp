-- =============================================================================
-- Migration: 20261021000005_lock_test_tenant_clocks_to_service_role.sql
-- Description:
--   Security Hardening for Test Tenant Clocks.
--   Enforces that NO role other than service_role (and postgres) can create or
--   change a clock row or invoke test clock modification RPCs.
--   Revokes EXECUTE on set_test_clock and advance_test_clock from anon and authenticated.
--   Enables RLS on test_tenant_clocks and test_provider_clock_links.
-- =============================================================================

-- 1. Enable RLS on test clock tables
ALTER TABLE public.test_tenant_clocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_provider_clock_links ENABLE ROW LEVEL SECURITY;

-- 2. Revoke all table write privileges from PUBLIC, anon, and authenticated
REVOKE ALL ON public.test_tenant_clocks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.test_provider_clock_links FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.test_tenant_clocks TO service_role;
GRANT ALL ON public.test_provider_clock_links TO service_role;

-- 3. Hardened set_test_clock with caller role validation
CREATE OR REPLACE FUNCTION public.set_test_clock(
    p_prefix TEXT,
    p_time TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
BEGIN
  -- Restrict to service_role and postgres superuser
  IF auth.role() <> 'service_role' AND (CURRENT_USER <> 'postgres' AND SESSION_USER <> 'postgres') THEN
    RAISE EXCEPTION 'Forbidden: Only service_role or postgres may modify test clocks';
  END IF;

  INSERT INTO public.test_tenant_clocks (tenant_prefix, simulated_time, updated_at)
  VALUES (p_prefix, p_time, clock_timestamp())
  ON CONFLICT (tenant_prefix)
  DO UPDATE SET simulated_time = EXCLUDED.simulated_time, updated_at = clock_timestamp();

  RETURN p_time;
END;
$$;

-- 4. Hardened advance_test_clock with caller role validation
CREATE OR REPLACE FUNCTION public.advance_test_clock(
    p_prefix TEXT,
    p_minutes INT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_current TIMESTAMPTZ;
  v_new TIMESTAMPTZ;
BEGIN
  -- Restrict to service_role and postgres superuser
  IF auth.role() <> 'service_role' AND (CURRENT_USER <> 'postgres' AND SESSION_USER <> 'postgres') THEN
    RAISE EXCEPTION 'Forbidden: Only service_role or postgres may modify test clocks';
  END IF;

  SELECT simulated_time INTO v_current
  FROM public.test_tenant_clocks
  WHERE tenant_prefix = p_prefix;

  IF NOT FOUND THEN
    v_current := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata');
  END IF;

  v_new := v_current + (p_minutes || ' minutes')::interval;

  INSERT INTO public.test_tenant_clocks (tenant_prefix, simulated_time, updated_at)
  VALUES (p_prefix, v_new, clock_timestamp())
  ON CONFLICT (tenant_prefix)
  DO UPDATE SET simulated_time = EXCLUDED.simulated_time, updated_at = clock_timestamp();

  RETURN v_new;
END;
$$;

-- 5. Revoke execution from PUBLIC, anon, and authenticated
REVOKE EXECUTE ON FUNCTION public.set_test_clock(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_test_clock(TEXT, TIMESTAMPTZ) TO service_role;

REVOKE EXECUTE ON FUNCTION public.advance_test_clock(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_test_clock(TEXT, INT) TO service_role;

-- Read-only test clock inspection functions remain callable for verification
GRANT EXECUTE ON FUNCTION public.get_test_clock(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_test_clock_for_prefix(TEXT) TO anon, authenticated, service_role;
