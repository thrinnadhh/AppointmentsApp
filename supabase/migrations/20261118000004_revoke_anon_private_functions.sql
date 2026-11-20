-- =============================================================================
-- Migration: 20261118000004_revoke_anon_private_functions.sql
-- Description: Fix DB-05: Revoke direct EXECUTE on private functions from anon & PUBLIC.
-- =============================================================================

BEGIN;

-- 1. Explicitly revoke execution on sensitive private procedures from anon and PUBLIC
REVOKE ALL ON FUNCTION private.submit_city_waitlist(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.log_client_event(text, text, text, text, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.get_active_cities(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.get_nearby_providers(numeric, numeric, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.search_directory_public(text) FROM PUBLIC, anon;

-- Blanket revoke: anonymous and public roles must have NO direct execute privileges on the private schema
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM anon, PUBLIC;

-- 2. Restate public wrappers as SECURITY DEFINER so legitimate public API endpoints continue to function
CREATE OR REPLACE FUNCTION public.submit_city_waitlist(
  p_city_name text,
  p_phone text,
  p_vertical_interest text DEFAULT 'all'::text,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.submit_city_waitlist(p_city_name, p_phone, p_vertical_interest, p_notes);
$function$;

CREATE OR REPLACE FUNCTION public.get_active_cities(p_include_expanding boolean DEFAULT true)
RETURNS TABLE(id text, name text, state text, status text, latitude numeric, longitude numeric, radius_km numeric, active_providers_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT * FROM private.get_active_cities(p_include_expanding);
$function$;

CREATE OR REPLACE FUNCTION public.get_nearby_providers(
  p_lat numeric,
  p_lng numeric,
  p_category text DEFAULT NULL::text,
  p_radius_meters integer DEFAULT 25000
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.get_nearby_providers(p_lat, p_lng, p_category, p_radius_meters);
$function$;

CREATE OR REPLACE FUNCTION public.log_client_event(
  p_platform text,
  p_level text,
  p_message text,
  p_component text DEFAULT NULL::text,
  p_stack_trace text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT NULL::jsonb,
  p_device_info jsonb DEFAULT NULL::jsonb,
  p_session_id text DEFAULT NULL::text,
  p_severity text DEFAULT NULL::text,
  p_category text DEFAULT NULL::text,
  p_source text DEFAULT NULL::text,
  p_error_code text DEFAULT NULL::text,
  p_role text DEFAULT NULL::text,
  p_city_id text DEFAULT NULL::text,
  p_vertical text DEFAULT NULL::text,
  p_appointment_id text DEFAULT NULL::text,
  p_app_version text DEFAULT NULL::text,
  p_platform_os text DEFAULT NULL::text,
  p_device_model text DEFAULT NULL::text,
  p_environment text DEFAULT NULL::text,
  p_fingerprint text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.log_client_event(
    p_platform, p_level, p_message, p_component, p_stack_trace,
    p_metadata, p_device_info, p_session_id, p_severity, p_category,
    p_source, p_error_code, p_role, p_city_id, p_vertical,
    p_appointment_id, p_app_version, p_platform_os, p_device_model,
    p_environment, p_fingerprint
  );
$function$;

-- Public wrappers grants
GRANT EXECUTE ON FUNCTION public.submit_city_waitlist(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_cities(boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_nearby_providers(numeric, numeric, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_client_event(text, text, text, text, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text) TO anon, authenticated, service_role;

COMMIT;
