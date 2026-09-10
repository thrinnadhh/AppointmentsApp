-- ==============================================================================
-- Migration: 20260910000001_phase1_power_features.sql
-- Description: Phase 1 Native Supabase Power Features
--   1. pg_cron native 1-minute auto-release of expired 5-minute booking holds
--   2. pg_trgm fuzzy & typo-tolerant directory search RPC with GIN indexes
--   3. Short human-readable reference codes (#TPT-XXXXXX) for triage & bookings
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. pg_cron native scheduler
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'release-expired-booking-holds'
  ) THEN
    PERFORM cron.schedule(
      'release-expired-booking-holds',
      '* * * * *',
      'SELECT public.release_expired_holds();'
    );
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. pg_trgm typo-tolerant fuzzy search & GIN indexes
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_providers_name_trgm 
  ON public.providers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_providers_desc_trgm 
  ON public.providers USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_resources_name_trgm 
  ON public.resources USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_resources_dept_trgm 
  ON public.resources USING gin (department gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_directory(p_query text DEFAULT '')
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
        to_jsonb(p.*) || jsonb_build_object(
          'resources', COALESCE(
            (SELECT jsonb_agg(to_jsonb(r.*)) FROM public.resources r WHERE r.provider_id = p.id AND r.is_active = true),
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
        'phone', mp.phone,
        'email', mp.email,
        'opening_time', mp.opening_time,
        'closing_time', mp.closing_time,
        'description', mp.description,
        'photos', mp.photos,
        'latitude', mp.latitude,
        'longitude', mp.longitude,
        'status', mp.status,
        'relevance', mp.relevance,
        'resources', COALESCE(
          (SELECT jsonb_agg(to_jsonb(r.*)) FROM public.resources r WHERE r.provider_id = mp.id AND r.is_active = true),
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

GRANT EXECUTE ON FUNCTION public.search_directory(text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. Human-readable Reference Codes for Bookings
-- ------------------------------------------------------------------------------
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS reference_code text UNIQUE;
CREATE INDEX IF NOT EXISTS idx_bookings_reference_code ON public.bookings(reference_code);

CREATE OR REPLACE FUNCTION public.set_booking_reference_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.reference_code IS NULL OR trim(NEW.reference_code) = '' THEN
    NEW.reference_code := 'TPT-' || UPPER(SUBSTRING(MD5(NEW.id::text || NOW()::text || gen_random_uuid()::text) FROM 1 FOR 6));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_booking_reference_code ON public.bookings;
CREATE TRIGGER trg_set_booking_reference_code
BEFORE INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.set_booking_reference_code();

-- Backfill existing bookings
UPDATE public.bookings
SET reference_code = 'TPT-' || UPPER(SUBSTRING(MD5(id::text) FROM 1 FOR 6))
WHERE reference_code IS NULL;

-- Update create_booking_hold to return reference_code
CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id UUID,
    p_slot_start TIMESTAMPTZ,
    p_slot_end TIMESTAMPTZ,
    p_customer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_provider_id UUID;
    v_deposit_amount NUMERIC(10, 2);
    v_is_active BOOLEAN;
    v_existing_booking_id UUID;
    v_new_booking_id UUID;
    v_reference_code TEXT;
    v_hold_expiry TIMESTAMPTZ;
BEGIN
    UPDATE public.bookings
    SET status = 'CANCELLED', updated_at = NOW()
    WHERE status = 'HELD' AND hold_expires_at < NOW();

    SELECT provider_id, deposit_amount, is_active 
    INTO v_provider_id, v_deposit_amount, v_is_active
    FROM public.resources
    WHERE id = p_resource_id;

    IF NOT FOUND OR NOT v_is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Resource not found or inactive');
    END IF;

    SELECT id INTO v_existing_booking_id
    FROM public.bookings
    WHERE resource_id = p_resource_id
      AND slot_start = p_slot_start
      AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
    FOR UPDATE;

    IF v_existing_booking_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked by another customer');
    END IF;

    v_hold_expiry := NOW() + INTERVAL '5 minutes';

    INSERT INTO public.bookings (
        customer_id,
        provider_id,
        resource_id,
        slot_start,
        slot_end,
        status,
        payment_status,
        deposit_amount,
        hold_expires_at
    ) VALUES (
        p_customer_id,
        v_provider_id,
        p_resource_id,
        p_slot_start,
        p_slot_end,
        'HELD',
        'PENDING',
        v_deposit_amount,
        v_hold_expiry
    )
    RETURNING id, reference_code INTO v_new_booking_id, v_reference_code;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_new_booking_id,
        'reference_code', v_reference_code,
        'deposit_amount', v_deposit_amount,
        'hold_expires_at', v_hold_expiry
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO anon, authenticated, service_role;
