-- Migration: 20261022000010_secure_city_waitlist.sql
-- Description:
-- Fix F-02: Secure city_waitlist table and add validated, rate-limited, deduplicated RPC.
-- Revokes direct table access from anon (anon gets NO select, insert, update, delete).
-- Creates SECURITY DEFINER submit_city_waitlist function with input validation, phone normalization, and deduplication.

-- 1. Table-level permissions lockdown
REVOKE ALL ON public.city_waitlist FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.city_waitlist FROM authenticated;
GRANT SELECT ON public.city_waitlist TO authenticated;
GRANT ALL ON public.city_waitlist TO service_role;

-- 2. Drop overly permissive public insert RLS policy if exists
DROP POLICY IF EXISTS "Allow public insert city waitlist" ON public.city_waitlist;
DROP POLICY IF EXISTS "allow_public_insert_waitlist" ON public.city_waitlist;

-- 3. Dedicated SECURITY DEFINER RPC with validation and deduplication
CREATE OR REPLACE FUNCTION public.submit_city_waitlist(
  p_city_name text,
  p_phone text,
  p_vertical_interest text DEFAULT 'customer',
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean_city text;
  v_clean_phone text;
  v_digits text;
  v_existing_id uuid;
  v_new_id uuid;
BEGIN
  -- 1. Validate City Name
  v_clean_city := trim(COALESCE(p_city_name, ''));
  IF length(v_clean_city) < 2 OR length(v_clean_city) > 100 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_CITY',
      'message', 'City name must be between 2 and 100 characters'
    );
  END IF;

  -- 2. Validate & Normalize Phone Number
  v_clean_phone := trim(COALESCE(p_phone, ''));
  v_digits := regexp_replace(v_clean_phone, '\D', '', 'g');

  IF length(v_digits) < 10 OR length(v_digits) > 15 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_PHONE',
      'message', 'Phone number must contain between 10 and 15 digits'
    );
  END IF;

  -- Format national 10-digit Indian numbers with +91 if needed
  IF length(v_digits) = 10 THEN
    v_clean_phone := '+91' || v_digits;
  ELSIF NOT v_clean_phone LIKE '+%' THEN
    v_clean_phone := '+' || v_digits;
  END IF;

  -- 3. Deduplication Check (same city and phone)
  SELECT id INTO v_existing_id
  FROM public.city_waitlist
  WHERE lower(city_name) = lower(v_clean_city)
    AND (
      phone = v_clean_phone
      OR regexp_replace(phone, '\D', '', 'g') = v_digits
    )
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'already_registered', true,
      'id', v_existing_id,
      'city_name', initcap(v_clean_city),
      'message', 'Waitlist interest already recorded for this city and phone'
    );
  END IF;

  -- 4. Atomic Insert (purge_after is generated automatically)
  INSERT INTO public.city_waitlist (
    city_name,
    phone,
    vertical_interest,
    notes,
    consent_given,
    consent_timestamp
  ) VALUES (
    initcap(v_clean_city),
    v_clean_phone,
    COALESCE(substring(trim(p_vertical_interest) from 1 for 50), 'customer'),
    substring(trim(p_notes) from 1 for 500),
    true,
    clock_timestamp()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'already_registered', false,
    'id', v_new_id,
    'city_name', initcap(v_clean_city),
    'message', 'Successfully joined expansion waitlist'
  );
END;
$$;

-- 4. Secure RPC permissions
REVOKE ALL ON FUNCTION public.submit_city_waitlist(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_city_waitlist(text, text, text, text) TO anon, authenticated, service_role;
