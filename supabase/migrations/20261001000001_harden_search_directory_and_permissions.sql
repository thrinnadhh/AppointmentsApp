-- ==============================================================================
-- Migration: 20261001000001_harden_search_directory_and_permissions.sql
-- Description: Revoke anon execute on search_directory to prevent contact scraping
--              and deploy search_directory_public without sensitive PII (phone/email).
-- ==============================================================================

-- 1. Revoke anon execute on sensitive search_directory
REVOKE EXECUTE ON FUNCTION public.search_directory(text) FROM anon;

-- 2. Create public sanitized search RPC omitting PII (phone, email, tax/bank data)
CREATE OR REPLACE FUNCTION public.search_directory_public(p_query text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_results jsonb;
BEGIN
  IF p_query IS NULL OR trim(p_query) = '' THEN
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
                'name', r.name,
                'department', r.department,
                'category_id', r.category_id,
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
        word_similarity(p_query, p.name),
        word_similarity(p_query, COALESCE(p.description, '')),
        COALESCE(MAX(word_similarity(p_query, r.name)), 0),
        COALESCE(MAX(word_similarity(p_query, COALESCE(r.department, ''))), 0)
      ) AS relevance
    FROM public.providers p
    LEFT JOIN public.resources r ON r.provider_id = p.id
    WHERE p.status = 'ACTIVE'
      AND (
        p.name ILIKE '%' || p_query || '%'
        OR COALESCE(p.description, '') ILIKE '%' || p_query || '%'
        OR r.name ILIKE '%' || p_query || '%'
        OR COALESCE(r.department, '') ILIKE '%' || p_query || '%'
        OR word_similarity(p_query, p.name) > 0.3
        OR word_similarity(p_query, COALESCE(r.name, '')) > 0.3
        OR word_similarity(p_query, COALESCE(r.department, '')) > 0.3
      )
    GROUP BY p.id, p.name, p.category_id, p.address, p.city,
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
              'name', r.name,
              'department', r.department,
              'category_id', r.category_id,
              'is_active', r.is_active
            )
          ) FROM public.resources r WHERE r.provider_id = mp.id AND r.is_active = true),
          '[]'::jsonb
        )
      )
      ORDER BY mp.relevance DESC
    ),
    '[]'::jsonb
  ) INTO v_results
  FROM matched_providers mp;

  RETURN v_results;
END;
$$;

-- 3. Grant execute permissions on public RPC
GRANT EXECUTE ON FUNCTION public.search_directory_public(text) TO anon, authenticated, service_role;
