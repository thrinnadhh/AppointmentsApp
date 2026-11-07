-- =============================================================================
-- Migration: 20261107000005_supabase_security_advisor_remediation.sql
-- Description: Comprehensive Remediation of Supabase Security Advisor Findings
--              1. Move extensions (btree_gist, citext, pg_trgm) to extensions schema
--              2. Revoke default EXECUTE on functions in schema public
--              3. Restrict Category A (Trigger/Internal) functions to service_role only
--              4. Move Category B (RLS Helper) functions to unexposed private schema
--                 + Provide private.is_admin and secure service-only public aliases
--              5. Harden Category C (Public by Design) functions (SECURITY INVOKER / sanitization)
--              6. Restrict Category D (Authenticated / Admin) RPCs to authorized roles
--              7. Restrict Category E (Server/Cron) functions to service_role only
--              8. Restrict Category F (Test fixtures) to service_role only
--              9. Add explicit deny RLS policies on internal & test tables
-- Rollback Note: Reverse schema moves and grant mappings are documented in each section.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. EXTENSIONS: Move btree_gist, citext, pg_trgm to extensions schema
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

ALTER EXTENSION btree_gist SET SCHEMA extensions;
ALTER EXTENSION citext SET SCHEMA extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;


-- -----------------------------------------------------------------------------
-- 2. DEFAULT PRIVILEGES: Fail closed on future functions in schema public
-- -----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. CATEGORY A: Trigger / Internal Procedures (Never callable via PostgREST API)
-- -----------------------------------------------------------------------------
-- Revoke execution from PUBLIC, anon, authenticated; grant only to service_role
DO $$
DECLARE
  v_proc text;
  v_procs text[] := ARRAY[
    'check_department_member_limit()',
    'handle_booking_checkin_code_trigger()',
    'increment_booking_version()',
    'sync_resource_user_id()',
    'trg_audit_booking_status_change()',
    'trg_audit_doctor_assignments()',
    'trg_audit_resource_services()',
    'assign_clinic_queue_position()',
    'guard_profile_governance()',
    'guard_provider_governance()',
    'handle_booking_notification_trigger()',
    'handle_new_auth_user()',
    'set_booking_reference_code()',
    'validate_booking_update()',
    '_record_checkin_failure(uuid, timestamp with time zone)',
    'generate_appointment_checkin_code_for_booking(uuid)',
    'dispatch_booking_notification(uuid, text)'
  ];
BEGIN
  FOREACH v_proc IN ARRAY v_procs LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated;', v_proc);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role;', v_proc);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 4. CATEGORY B: RLS Helper Functions (Move to unexposed private schema)
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

DO $$
BEGIN
  -- Move RLS helpers to private schema (Postgres RLS references them by OID, continuing to work)
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.is_admin(uuid) SET SCHEMA private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_hospital_owner' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.is_hospital_owner(uuid, uuid) SET SCHEMA private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hospital_role' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.hospital_role(uuid, uuid) SET SCHEMA private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hospital_accessible_resource_ids' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.hospital_accessible_resource_ids(uuid, uuid) SET SCHEMA private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_user_department_id' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.get_user_department_id(uuid, uuid) SET SCHEMA private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_user_authorized_providers' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.get_user_authorized_providers(uuid) SET SCHEMA private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_hospital_provider' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.is_hospital_provider(uuid) SET SCHEMA private;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_merchant_owner_or_admin' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.is_merchant_owner_or_admin(uuid, uuid) SET SCHEMA private;
  END IF;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, service_role;

-- Provide internal-only public aliases for backward compatibility with existing migration SQL & triggers,
-- with execution strictly REVOKED from PUBLIC, anon, and authenticated so PostgREST never exposes them.
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, pg_temp AS $$
  SELECT private.is_admin(p_user_id);
$$;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.hospital_role(p_provider_id UUID, p_user_id UUID)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, pg_temp AS $$
  SELECT private.hospital_role(p_provider_id, p_user_id);
$$;
REVOKE ALL ON FUNCTION public.hospital_role(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hospital_role(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.hospital_role(p_provider_id UUID)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, pg_temp AS $$
  SELECT private.hospital_role(p_provider_id, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.hospital_role(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hospital_role(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.hospital_accessible_resource_ids(p_provider_id UUID, p_user_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, pg_temp AS $$
  SELECT private.hospital_accessible_resource_ids(p_provider_id, p_user_id);
$$;
REVOKE ALL ON FUNCTION public.hospital_accessible_resource_ids(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hospital_accessible_resource_ids(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.hospital_accessible_resource_ids(p_provider_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, pg_temp AS $$
  SELECT private.hospital_accessible_resource_ids(p_provider_id, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.hospital_accessible_resource_ids(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hospital_accessible_resource_ids(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.is_hospital_owner(p_user_id UUID, p_merchant_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, pg_temp AS $$
  SELECT private.is_hospital_owner(p_user_id, p_merchant_id);
$$;
REVOKE ALL ON FUNCTION public.is_hospital_owner(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_hospital_owner(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_user_department_id(p_user_id UUID, p_merchant_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, pg_temp AS $$
  SELECT private.get_user_department_id(p_user_id, p_merchant_id);
$$;
REVOKE ALL ON FUNCTION public.get_user_department_id(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_department_id(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_user_authorized_providers(p_user_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, pg_temp AS $$
  SELECT private.get_user_authorized_providers(p_user_id);
$$;
REVOKE ALL ON FUNCTION public.get_user_authorized_providers(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_authorized_providers(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.is_hospital_provider(p_provider_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, pg_temp AS $$
  SELECT private.is_hospital_provider(p_provider_id);
$$;
REVOKE ALL ON FUNCTION public.is_hospital_provider(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_hospital_provider(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.is_merchant_owner_or_admin(p_provider_id UUID, p_user_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, pg_temp AS $$
  SELECT private.is_merchant_owner_or_admin(p_provider_id, p_user_id);
$$;
REVOKE ALL ON FUNCTION public.is_merchant_owner_or_admin(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_merchant_owner_or_admin(UUID, UUID) TO service_role;

-- Public safe role accessor: Returns only the caller's own roles via auth.uid()
CREATE OR REPLACE FUNCTION public.my_roles()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'is_admin', COALESCE((SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid()), false),
    'role', (SELECT role FROM public.profiles WHERE id = auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.my_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_roles() TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5. CATEGORY C: Public by Design Functions (Sanitized and hardened)
-- -----------------------------------------------------------------------------
-- Ensure public.cities table is readable by public discovery
GRANT SELECT ON TABLE public.cities TO anon, authenticated, service_role;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_read_active_cities ON public.cities;
CREATE POLICY allow_read_active_cities ON public.cities
  FOR SELECT TO anon, authenticated
  USING (status IN ('ACTIVE', 'EXPANDING'));

-- 5a. get_active_cities: Switch to SECURITY INVOKER with authentic city columns
DROP FUNCTION IF EXISTS public.get_active_cities(boolean);
CREATE OR REPLACE FUNCTION public.get_active_cities(p_include_expanding BOOLEAN DEFAULT TRUE)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  state TEXT,
  status TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  radius_km NUMERIC,
  active_providers_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.state,
    c.status,
    c.latitude,
    c.longitude,
    c.radius_km,
    COUNT(p.id) FILTER (WHERE p.status = 'ACTIVE')::BIGINT AS active_providers_count
  FROM public.cities c
  LEFT JOIN public.providers p ON p.city_id = c.id
  WHERE (c.status = 'ACTIVE') OR (p_include_expanding AND c.status = 'EXPANDING')
  GROUP BY c.id, c.name, c.state, c.status, c.latitude, c.longitude, c.radius_km
  ORDER BY (CASE WHEN c.status = 'ACTIVE' THEN 1 ELSE 2 END), c.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_cities(boolean) TO anon, authenticated, service_role;

-- 5b. search_directory_public: Switch to SECURITY INVOKER with authentic provider columns
DROP FUNCTION IF EXISTS public.search_directory_public(text);
CREATE OR REPLACE FUNCTION public.search_directory_public(p_query text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_results jsonb;
  v_sanitized_query text;
BEGIN
  v_sanitized_query := substr(trim(COALESCE(p_query, '')), 1, 100);

  IF v_sanitized_query = '' THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'category_id', p.category_id,
          'address', p.address,
          'city', p.city,
          'opening_time', p.opening_time,
          'closing_time', p.closing_time,
          'description', p.description,
          'photos', p.photos,
          'latitude', p.latitude,
          'longitude', p.longitude,
          'status', p.status,
          'resources', COALESCE(
            (SELECT jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'provider_id', r.provider_id,
                'name', r.name,
                'type', r.type,
                'department', r.department,
                'department_id', r.department_id,
                'deposit_amount', r.deposit_amount,
                'duration_minutes', r.duration_minutes,
                'capacity', r.capacity,
                'is_active', r.is_active
              )
            ) FROM public.resources r WHERE r.provider_id = p.id AND r.is_active = true),
            '[]'::jsonb
          )
        )
      ),
      '[]'::jsonb
    )
    INTO v_results
    FROM public.providers p
    WHERE p.status = 'ACTIVE';
    RETURN v_results;
  END IF;

  WITH matched_providers AS (
    SELECT
      p.id,
      p.name,
      p.category_id,
      p.address,
      p.city,
      p.opening_time,
      p.closing_time,
      p.description,
      p.photos,
      p.latitude,
      p.longitude,
      p.status,
      GREATEST(
        extensions.word_similarity(v_sanitized_query, p.name),
        extensions.word_similarity(v_sanitized_query, COALESCE(p.description, '')),
        COALESCE(MAX(extensions.word_similarity(v_sanitized_query, r.name)), 0),
        COALESCE(MAX(extensions.word_similarity(v_sanitized_query, COALESCE(r.department, ''))), 0)
      ) AS relevance
    FROM public.providers p
    LEFT JOIN public.resources r ON r.provider_id = p.id
    WHERE p.status = 'ACTIVE'
      AND (
        p.name ILIKE '%' || v_sanitized_query || '%'
        OR COALESCE(p.description, '') ILIKE '%' || v_sanitized_query || '%'
        OR r.name ILIKE '%' || v_sanitized_query || '%'
        OR COALESCE(r.department, '') ILIKE '%' || v_sanitized_query || '%'
        OR extensions.word_similarity(v_sanitized_query, p.name) > 0.3
        OR extensions.word_similarity(v_sanitized_query, COALESCE(r.name, '')) > 0.3
        OR extensions.word_similarity(v_sanitized_query, COALESCE(r.department, '')) > 0.3
      )
    GROUP BY p.id, p.name, p.category_id, p.address, p.city, p.opening_time, p.closing_time, p.description, p.photos, p.latitude, p.longitude, p.status
    ORDER BY relevance DESC
    LIMIT 50
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', mp.id,
        'name', mp.name,
        'category_id', mp.category_id,
        'address', mp.address,
        'city', mp.city,
        'opening_time', mp.opening_time,
        'closing_time', mp.closing_time,
        'description', mp.description,
        'photos', mp.photos,
        'latitude', mp.latitude,
        'longitude', mp.longitude,
        'status', mp.status,
        'resources', COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              'id', r.id,
              'provider_id', r.provider_id,
              'name', r.name,
              'type', r.type,
              'department', r.department,
              'department_id', r.department_id,
              'deposit_amount', r.deposit_amount,
              'duration_minutes', r.duration_minutes,
              'capacity', r.capacity,
              'is_active', r.is_active
            )
          ) FROM public.resources r WHERE r.provider_id = mp.id AND r.is_active = true),
          '[]'::jsonb
        )
      )
    ),
    '[]'::jsonb
  )
  INTO v_results
  FROM matched_providers mp;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_directory_public(text) TO anon, authenticated, service_role;

-- 5c. get_nearby_providers: Clamped radius and public venue columns
DROP FUNCTION IF EXISTS public.get_nearby_providers(numeric, numeric, text, integer);
CREATE OR REPLACE FUNCTION public.get_nearby_providers(
  p_lat numeric,
  p_lng numeric,
  p_category text DEFAULT NULL,
  p_radius_meters integer DEFAULT 25000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_results jsonb;
  v_client_point extensions.geography;
  v_clamped_radius integer;
BEGIN
  v_clamped_radius := LEAST(GREATEST(COALESCE(p_radius_meters, 25000), 100), 50000);
  v_client_point := extensions.ST_MakePoint(p_lng, p_lat)::extensions.geography;

  WITH provider_distances AS (
    SELECT
      p.id,
      p.owner_id,
      p.category_id,
      p.sub_category_id,
      p.name,
      p.description,
      p.address,
      p.city,
      p.latitude,
      p.longitude,
      p.phone,
      p.email,
      p.opening_time,
      p.closing_time,
      p.photos,
      p.status,
      p.created_at,
      p.updated_at,
      extensions.ST_Distance(
        extensions.ST_MakePoint(p.longitude, p.latitude)::extensions.geography,
        v_client_point
      ) AS distance_meters,
      ROUND(
        (extensions.ST_Distance(
          extensions.ST_MakePoint(p.longitude, p.latitude)::extensions.geography,
          v_client_point
        ) / 1000.0)::numeric, 1
      ) AS distance_km
    FROM public.providers p
    WHERE p.status = 'ACTIVE'
      AND (
        p_category IS NULL 
        OR p_category = 'all' 
        OR p.category_id = p_category
        OR regexp_replace(lower(p.category_id), 's$', '') = regexp_replace(lower(p_category), 's$', '')
      )
      AND extensions.ST_DWithin(
        extensions.ST_MakePoint(p.longitude, p.latitude)::extensions.geography,
        v_client_point,
        v_clamped_radius
      )
    ORDER BY distance_meters ASC
    LIMIT 50
  )
  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(pd.*) || jsonb_build_object(
        'resources', COALESCE(
          (
            SELECT jsonb_agg(to_jsonb(r.*))
            FROM public.resources r
            WHERE r.provider_id = pd.id AND r.is_active = true
          ),
          '[]'::jsonb
        )
      )
    ),
    '[]'::jsonb
  )
  INTO v_results
  FROM provider_distances pd;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_nearby_providers(numeric, numeric, text, integer) TO anon, authenticated, service_role;

-- 5d. submit_city_waitlist: Strict length capping and input sanitization
DROP FUNCTION IF EXISTS public.submit_city_waitlist(text, text, text, text);
CREATE OR REPLACE FUNCTION public.submit_city_waitlist(
  p_city_name text,
  p_phone text,
  p_vertical_interest text DEFAULT 'all'::text,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_sanitized_city text;
  v_sanitized_phone text;
  v_sanitized_vertical text;
  v_sanitized_notes text;
  v_existing_id uuid;
BEGIN
  -- 1. Validate mandatory inputs
  IF p_city_name IS NULL OR length(trim(p_city_name)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'City name is required');
  END IF;

  IF p_phone IS NULL OR length(trim(p_phone)) < 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'A valid phone number is required');
  END IF;

  -- 2. Sanitize and length-cap to prevent payload abuse
  v_sanitized_city := substr(trim(p_city_name), 1, 100);
  v_sanitized_phone := substr(regexp_replace(trim(p_phone), '[^0-9+]', '', 'g'), 1, 15);
  v_sanitized_vertical := substr(COALESCE(trim(p_vertical_interest), 'all'), 1, 50);
  v_sanitized_notes := CASE WHEN p_notes IS NOT NULL THEN substr(trim(p_notes), 1, 500) ELSE NULL END;

  -- 3. Check for existing waitlist submission to prevent spam
  SELECT id INTO v_existing_id
  FROM public.city_waitlist
  WHERE phone = v_sanitized_phone
    AND city_name ILIKE v_sanitized_city
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'You are already registered on the waitlist for this city!',
      'id', v_existing_id
    );
  END IF;

  -- 4. Insert sanitized waitlist record
  INSERT INTO public.city_waitlist (
    city_name,
    phone,
    vertical_interest,
    notes,
    user_id
  ) VALUES (
    v_sanitized_city,
    v_sanitized_phone,
    v_sanitized_vertical,
    v_sanitized_notes,
    auth.uid()
  )
  RETURNING id INTO v_existing_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Successfully added to city waitlist',
    'id', v_existing_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_city_waitlist(text, text, text, text) TO anon, authenticated, service_role;

-- 5e. log_client_event: Sanitize, truncate stack trace and metadata <= 8KB, ignore client role
DROP FUNCTION IF EXISTS public.log_client_event(text, text, text, text, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text);
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_actual_role text;
  v_capped_stack text;
  v_capped_meta jsonb;
  v_new_id uuid;
BEGIN
  -- 1. Derive true authenticated role from context, never trust client-supplied role
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_actual_role FROM public.profiles WHERE id = auth.uid();
  ELSE
    v_actual_role := 'anon';
  END IF;

  -- 2. Cap stack trace to 8KB
  IF p_stack_trace IS NOT NULL THEN
    v_capped_stack := substr(p_stack_trace, 1, 8192);
  END IF;

  -- 3. Cap metadata JSON to 8KB
  IF p_metadata IS NOT NULL THEN
    IF length(p_metadata::text) > 8192 THEN
      v_capped_meta := jsonb_build_object(
        '_truncated', true,
        'summary', substr(p_metadata::text, 1, 8000)
      );
    ELSE
      v_capped_meta := p_metadata;
    END IF;
  ELSE
    v_capped_meta := '{}'::jsonb;
  END IF;

  -- 4. Insert into app_logs
  INSERT INTO public.app_logs (
    platform,
    level,
    message,
    component,
    stack_trace,
    metadata,
    device_info,
    session_id,
    severity,
    category,
    source,
    error_code,
    role,
    city_id,
    vertical,
    appointment_id,
    app_version,
    platform_os,
    device_model,
    environment,
    fingerprint,
    user_id
  ) VALUES (
    COALESCE(p_platform, 'unknown'),
    COALESCE(p_level, 'info'),
    substr(COALESCE(p_message, 'No message provided'), 1, 2000),
    substr(p_component, 1, 200),
    v_capped_stack,
    v_capped_meta,
    p_device_info,
    substr(p_session_id, 1, 100),
    COALESCE(p_severity, 'INFO'),
    COALESCE(p_category, 'OTHER'),
    substr(p_source, 1, 100),
    substr(p_error_code, 1, 100),
    v_actual_role,
    substr(p_city_id, 1, 50),
    substr(p_vertical, 1, 50),
    substr(p_appointment_id, 1, 100),
    substr(p_app_version, 1, 50),
    substr(p_platform_os, 1, 50),
    substr(p_device_model, 1, 100),
    substr(p_environment, 1, 50),
    substr(p_fingerprint, 1, 100),
    auth.uid()
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
EXCEPTION WHEN OTHERS THEN
  -- Logging should never fail client operations
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_client_event(
  text, text, text, text, text, jsonb, jsonb, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text
) TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 6. CATEGORY D: Authenticated & Admin RPCs (Revoke anon / Public access)
-- -----------------------------------------------------------------------------
-- 6a. Admin procedures called from Next.js server route handlers:
--     Restrict to service_role so they cannot be called directly via PostgREST as anon or authenticated
DO $$
DECLARE
  v_admin_proc text;
  v_admin_procs text[] := ARRAY[
    'admin_create_resource(uuid, text, text, text, numeric, numeric, integer, integer, jsonb)',
    'admin_create_user(text, text, text, text, text)',
    'admin_create_venue(text, text, text, text, time without time zone, time without time zone, text, text, uuid, numeric, numeric)',
    'admin_delete_resource(uuid)',
    'admin_fetch_merchants(text)',
    'admin_update_merchant_status(uuid, text, text)',
    'admin_update_provider_operational_settings(uuid, boolean, boolean, integer, text, jsonb)',
    'admin_update_resource_status(uuid, boolean, text)',
    'auto_link_merchant_by_email(uuid, text)',
    'get_admin_audit_logs(integer, text)',
    'get_admin_city_stats()',
    'get_admin_velocity_analytics(text, text)',
    'get_city_director_stats(date, date)',
    'merchant_self_register(text, text, text, text, text, text, text, text)',
    'reveal_contact(uuid)',
    'update_city_status(text, text, integer, text)'
  ];
BEGIN
  FOREACH v_admin_proc IN ARRAY v_admin_procs LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated;', v_admin_proc);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role;', v_admin_proc);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;

-- 6b. Authenticated caller-scoped RPCs: Revoke anon and PUBLIC execution
DO $$
DECLARE
  v_auth_proc text;
  v_auth_procs text[] := ARRAY[
    'cancel_booking(uuid, text, text)',
    'cancel_doctor_emergency(uuid, timestamp with time zone, text, boolean)',
    'check_cooling_period_eligibility(uuid, uuid, timestamp with time zone)',
    'complete_booking(uuid)',
    'confirm_booking_by_merchant(uuid)',
    'create_booking_hold(uuid, timestamp with time zone, timestamp with time zone, uuid, boolean, text, text, text)',
    'get_masked_customer_info(uuid)',
    'get_merchant_bookings(uuid)',
    'get_provider_details(uuid)',
    'mark_customer_reached(uuid)',
    'mark_present_manually(uuid)',
    'merchant_register_shop_for_user(uuid, text, text, text, text, text, text)',
    'merchant_update_cooling_period(uuid, integer)',
    'override_hospital_queue_position(uuid, integer, uuid)',
    'reassign_booking_resource(uuid, uuid, text)',
    'record_no_show(uuid)',
    'reorder_hospital_queue(uuid, uuid, uuid[], uuid)',
    'request_account_deletion(text)',
    'reschedule_booking_slot(uuid, timestamp with time zone, timestamp with time zone)',
    'reveal_customer_contact(uuid, text)',
    'search_directory(text)',
    'sync_customer_profile(text, text, text)',
    'verify_checkin_code(uuid, text)'
  ];
BEGIN
  FOREACH v_auth_proc IN ARRAY v_auth_procs LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon;', v_auth_proc);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role;', v_auth_proc);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 7. CATEGORY E: Server & Cron Only Functions
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cron_proc text;
  v_cron_procs text[] := ARRAY[
    'purge_expired_waitlist_entries()',
    'purge_old_app_logs(integer)',
    'expire_stale_standby_queue(integer, uuid)',
    'release_expired_holds()'
  ];
BEGIN
  FOREACH v_cron_proc IN ARRAY v_cron_procs LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated;', v_cron_proc);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role;', v_cron_proc);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 8. CATEGORY F: Test Clock & Harness Fixtures
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_test_proc text;
  v_test_procs text[] := ARRAY[
    'get_test_clock(uuid)',
    'get_test_clock_for_prefix(text)',
    'set_test_clock(text, timestamp with time zone)',
    'advance_test_clock(text, integer)',
    'reset_test_bookings(uuid, uuid)',
    'reset_test_customer_strikes(uuid, integer)',
    'reset_test_provider_strikes(uuid, integer)'
  ];
BEGIN
  FOREACH v_test_proc IN ARRAY v_test_procs LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated;', v_test_proc);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role;', v_test_proc);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 9. RLS POLICIES ON INTERNAL & TEST TABLES
-- -----------------------------------------------------------------------------
-- 9a. staff_checkin_rate_limits: Server-only table, deny public/anon/authenticated
REVOKE ALL ON TABLE public.staff_checkin_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.staff_checkin_rate_limits TO service_role;

DROP POLICY IF EXISTS staff_checkin_rate_limits_deny_all ON public.staff_checkin_rate_limits;
CREATE POLICY staff_checkin_rate_limits_deny_all ON public.staff_checkin_rate_limits
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- 9b. test_provider_clock_links: Deny anon/authenticated direct access
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'test_provider_clock_links') THEN
    REVOKE ALL ON TABLE public.test_provider_clock_links FROM PUBLIC, anon, authenticated;
    GRANT ALL ON TABLE public.test_provider_clock_links TO service_role;

    DROP POLICY IF EXISTS test_provider_clock_links_deny_all ON public.test_provider_clock_links;
    EXECUTE 'CREATE POLICY test_provider_clock_links_deny_all ON public.test_provider_clock_links FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);';
  END IF;
END $$;

-- 9c. test_tenant_clocks: Deny anon/authenticated direct access
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'test_tenant_clocks') THEN
    REVOKE ALL ON TABLE public.test_tenant_clocks FROM PUBLIC, anon, authenticated;
    GRANT ALL ON TABLE public.test_tenant_clocks TO service_role;

    DROP POLICY IF EXISTS test_tenant_clocks_deny_all ON public.test_tenant_clocks;
    EXECUTE 'CREATE POLICY test_tenant_clocks_deny_all ON public.test_tenant_clocks FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);';
  END IF;
END $$;
