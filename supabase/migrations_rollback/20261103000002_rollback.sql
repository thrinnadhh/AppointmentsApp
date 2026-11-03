-- =============================================================================
-- Rollback for: 20261103000002_production_readiness_security_and_rbac.sql
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('release-expired-holds-sql');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM cron.unschedule('expire-stale-standby-sql');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM cron.unschedule('dpdp-account-deletions-sql');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'build_template_params'
      AND pg_get_function_identity_arguments(p.oid) = 'p_event_type text, p_booking_id uuid'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.build_template_params(text, uuid) TO authenticated, service_role';
  END IF;
END $$;

REVOKE SELECT ON TABLE public.providers FROM anon, authenticated;

GRANT SELECT (
  address, category_id, city, closing_time, cooling_period_days, created_at,
  description, email, id, is_active, latitude, longitude, name, opening_time,
  owner_id, phone, photos, status, sub_category_id, updated_at, weekly_hours
) ON TABLE public.providers TO anon;

GRANT SELECT (
  address, category_id, city, closing_time, cooling_period_days, created_at,
  description, email, id, latitude, longitude, name, opening_time, phone,
  photos, status, sub_category_id, updated_at, weekly_hours
) ON TABLE public.providers TO authenticated;

DROP FUNCTION IF EXISTS public.is_caller_authorized_for_resource(UUID, UUID, UUID);

COMMIT;

