-- =============================================================================
-- Migration: 20261103000002_production_readiness_security_and_rbac.sql
-- Description:
--   1. Introduce public.is_caller_authorized_for_resource(provider_id, resource_id, user_id)
--      to enforce per-consultant hospital RBAC in SQL RPCs and prevent horizontal
--      privilege escalation by front_desk / consultant users across doctors.
--   2. Reconcile column-level SELECT grants on public.providers for anon and
--      authenticated (revoking table-level SELECT and PII columns from anon while
--      granting is_active to authenticated so mobile/web queries succeed).
--   3. Lock down public.build_template_params(text, uuid) to service_role only.
--   4. Scrub sensitive staff id_card_number from public.resources.attributes JSONB.
--   5. Schedule SQL maintenance jobs (release_expired_holds, expire_stale_standby_queue,
--      process_expired_account_deletions) directly in pg_cron when available.
-- =============================================================================

BEGIN;

-- 1. Resource-level authorization helper for hospital & non-hospital providers
CREATE OR REPLACE FUNCTION public.is_caller_authorized_for_resource(
  p_provider_id UUID,
  p_resource_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := COALESCE(p_user_id, auth.uid());
  v_hosp_role TEXT;
BEGIN
  IF auth.role() = 'service_role' OR current_setting('app.trusted_write', true) = 'true' THEN
    RETURN TRUE;
  END IF;

  IF v_caller_id IS NULL OR p_provider_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.is_admin(v_caller_id) THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.providers
    WHERE id = p_provider_id AND owner_id = v_caller_id
  ) THEN
    RETURN TRUE;
  END IF;

  IF public.is_hospital_provider(p_provider_id) THEN
    v_hosp_role := public.hospital_role(p_provider_id, v_caller_id);
    IF v_hosp_role = 'admin' THEN
      RETURN TRUE;
    ELSIF v_hosp_role IN ('front_desk', 'consultant') THEN
      IF p_resource_id IS NULL THEN
        RETURN TRUE;
      END IF;
      RETURN EXISTS (
        SELECT 1
        FROM public.hospital_accessible_resource_ids(p_provider_id, v_caller_id) AS rid
        WHERE rid = p_resource_id
      );
    ELSE
      RETURN FALSE;
    END IF;
  END IF;

  RETURN p_provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id));
END;
$$;

REVOKE ALL ON FUNCTION public.is_caller_authorized_for_resource(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_caller_authorized_for_resource(UUID, UUID, UUID) TO authenticated, service_role;

-- 2. Reconcile column-level SELECT privileges on public.providers
--    Revoke table-level SELECT and restrict anon to non-PII public catalog columns,
--    while ensuring authenticated has is_active and non-financial columns.
REVOKE SELECT ON TABLE public.providers FROM anon, authenticated;

GRANT SELECT (
  address,
  auto_accept_bookings,
  category_id,
  city,
  city_id,
  closing_time,
  cooling_period_days,
  created_at,
  daily_booking_limit,
  description,
  id,
  is_active,
  is_booking_frozen,
  latitude,
  longitude,
  name,
  opening_time,
  photos,
  status,
  sub_category_id,
  updated_at,
  weekly_hours
) ON TABLE public.providers TO anon;

GRANT SELECT (
  address,
  auto_accept_bookings,
  category_id,
  city,
  city_id,
  closing_time,
  cooling_period_days,
  created_at,
  daily_booking_limit,
  description,
  email,
  id,
  is_active,
  is_booking_frozen,
  latitude,
  longitude,
  name,
  opening_time,
  owner_id,
  phone,
  photos,
  status,
  sub_category_id,
  updated_at,
  weekly_hours
) ON TABLE public.providers TO authenticated;

-- 3. Lock down build_template_params(text, uuid) to service_role only (prevent IDOR PII leak)
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
    EXECUTE 'REVOKE ALL ON FUNCTION public.build_template_params(text, uuid) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.build_template_params(text, uuid) TO service_role';
  END IF;
END $$;

-- 4. Scrub staff id_card_number from public.resources.attributes->'front_desk_members'
UPDATE public.resources r
SET attributes = jsonb_set(
  r.attributes,
  '{front_desk_members}',
  COALESCE(
    (
      SELECT jsonb_agg(elem - 'id_card_number')
      FROM jsonb_array_elements(r.attributes->'front_desk_members') AS elem
    ),
    '[]'::jsonb
  )
)
WHERE r.attributes IS NOT NULL
  AND jsonb_typeof(r.attributes->'front_desk_members') = 'array';

-- 5. Schedule pure SQL maintenance jobs in pg_cron (replacing broken http://kong:8000 URL)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove broken local-docker HTTP job if present
    BEGIN
      PERFORM cron.unschedule('release-expired-holds-job');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- 5a. Release expired 10-minute booking holds every minute
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'release_expired_holds'
    ) THEN
      PERFORM cron.schedule(
        'release-expired-holds-sql',
        '* * * * *',
        'SELECT public.release_expired_holds();'
      );
    END IF;

    -- 5b. Expire unverified remote standby claims every 5 minutes
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'expire_stale_standby_queue'
    ) THEN
      PERFORM cron.schedule(
        'expire-stale-standby-sql',
        '*/5 * * * *',
        'SELECT public.expire_stale_standby_queue();'
      );
    END IF;

    -- 5c. Process expired 30-day DPDP account deletion requests daily at 02:00 UTC
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'process_expired_account_deletions'
    ) THEN
      PERFORM cron.schedule(
        'dpdp-account-deletions-sql',
        '0 2 * * *',
        'SELECT public.process_expired_account_deletions();'
      );
    END IF;
  END IF;
END $$;

COMMIT;

