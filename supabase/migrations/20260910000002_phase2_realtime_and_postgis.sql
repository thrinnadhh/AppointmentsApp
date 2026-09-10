-- ==============================================================================
-- Migration: 20260910000002_phase2_realtime_and_postgis.sql
-- Description: Phase 2 Real-Time Experience & Geolocation
--   1. Enable PostGIS extension in extensions schema
--   2. Spatial GIST index on public.providers coordinates
--   3. Spatial RPC get_nearby_providers for hyper-local distance sorting
--   4. Ensure public.bookings and public.payments in supabase_realtime publication
-- ==============================================================================

-- 1. Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- 2. Spatial GIST Index
CREATE INDEX IF NOT EXISTS idx_providers_geo 
ON public.providers USING gist (
  (extensions.ST_MakePoint(longitude, latitude)::extensions.geography)
);

-- 3. Spatial RPC get_nearby_providers
CREATE OR REPLACE FUNCTION public.get_nearby_providers(
  p_lat numeric,
  p_lng numeric,
  p_category text DEFAULT NULL,
  p_radius_meters integer DEFAULT 25000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_results jsonb;
  v_client_point extensions.geography;
BEGIN
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
        p_radius_meters
      )
    ORDER BY distance_meters ASC
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
      ORDER BY pd.distance_meters ASC
    ),
    '[]'::jsonb
  ) INTO v_results
  FROM provider_distances pd;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_nearby_providers(numeric, numeric, text, integer) TO anon, authenticated, service_role;

-- 4. Ensure publication contains bookings and payments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bookings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;
END $$;
