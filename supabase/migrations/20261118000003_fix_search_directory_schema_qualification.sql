-- =============================================================================
-- Migration: 20261118000003_fix_search_directory_schema_qualification.sql
-- Description: Fix DB-03: schema-qualify word_similarity with extensions. schema
--              in private.search_directory and private.search_directory_public.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION private.search_directory(p_query text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_results jsonb;
  v_caller_id UUID := auth.uid();
  v_is_admin BOOLEAN := FALSE;
BEGIN
  IF v_caller_id IS NOT NULL THEN
    v_is_admin := public.is_admin(v_caller_id);
  END IF;

  IF p_query IS NULL OR trim(p_query) = '' THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'category_id', p.category_id,
          'address', p.address,
          'city', p.city,
          'phone', CASE
            WHEN v_is_admin OR (v_caller_id IS NOT NULL AND p.id IN (SELECT public.get_user_authorized_providers(v_caller_id)))
            THEN p.phone
            ELSE NULL
          END,
          'email', CASE
            WHEN v_is_admin OR (v_caller_id IS NOT NULL AND p.id IN (SELECT public.get_user_authorized_providers(v_caller_id)))
            THEN p.email
            ELSE NULL
          END,
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
      p.phone,
      p.email,
      p.opening_time,
      p.closing_time,
      p.description,
      p.photos,
      p.latitude,
      p.longitude,
      p.status,
      GREATEST(
        extensions.word_similarity(p_query, p.name),
        extensions.word_similarity(p_query, COALESCE(p.description, '')),
        COALESCE(MAX(extensions.word_similarity(p_query, r.name)), 0),
        COALESCE(MAX(extensions.word_similarity(p_query, COALESCE(r.department, ''))), 0)
      ) AS relevance
    FROM public.providers p
    LEFT JOIN public.resources r ON r.provider_id = p.id
    WHERE p.status = 'ACTIVE'
      AND (
        p.name ILIKE '%' || p_query || '%'
        OR COALESCE(p.description, '') ILIKE '%' || p_query || '%'
        OR r.name ILIKE '%' || p_query || '%'
        OR COALESCE(r.department, '') ILIKE '%' || p_query || '%'
        OR extensions.word_similarity(p_query, p.name) > 0.3
        OR extensions.word_similarity(p_query, COALESCE(r.name, '')) > 0.3
        OR extensions.word_similarity(p_query, COALESCE(r.department, '')) > 0.3
      )
    GROUP BY p.id, p.name, p.category_id, p.address, p.city, p.phone, p.email,
             p.opening_time, p.closing_time, p.description, p.photos,
             p.latitude, p.longitude, p.status
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', mp.id,
        'name', mp.name,
        'category_id', mp.category_id,
        'address', mp.address,
        'city', mp.city,
        'phone', CASE
          WHEN v_is_admin OR (v_caller_id IS NOT NULL AND mp.id IN (SELECT public.get_user_authorized_providers(v_caller_id)))
          THEN mp.phone
          ELSE NULL
        END,
        'email', CASE
          WHEN v_is_admin OR (v_caller_id IS NOT NULL AND mp.id IN (SELECT public.get_user_authorized_providers(v_caller_id)))
          THEN mp.email
          ELSE NULL
        END,
        'opening_time', mp.opening_time,
        'closing_time', mp.closing_time,
        'description', mp.description,
        'photos', mp.photos,
        'latitude', mp.latitude,
        'longitude', mp.longitude,
        'status', mp.status,
        'relevance', mp.relevance,
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
      ORDER BY mp.relevance DESC
    ),
    '[]'::jsonb
  )
  INTO v_results
  FROM matched_providers mp;

  RETURN v_results;
END;
$function$

;

CREATE OR REPLACE FUNCTION private.search_directory_public(p_query text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;

-- Re-declare public SQL wrappers
CREATE OR REPLACE FUNCTION public.search_directory(p_query text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT private.search_directory(p_query);
$function$;

CREATE OR REPLACE FUNCTION public.search_directory_public(p_query text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT private.search_directory_public(p_query);
$function$;

REVOKE ALL ON FUNCTION private.search_directory(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.search_directory(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_directory(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_directory(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.search_directory_public(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.search_directory_public(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_directory_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_directory_public(text) TO anon, authenticated, service_role;

COMMIT;
