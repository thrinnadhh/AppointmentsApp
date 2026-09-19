-- Migration: 20260917000001_merchant_register_shop_for_user.sql
-- Description: Provision a shop/provider for an already authenticated user (e.g. verified Google OAuth session).

CREATE OR REPLACE FUNCTION public.merchant_register_shop_for_user(
  p_user_id uuid,
  p_shop_name text,
  p_category_id text,
  p_phone text,
  p_address text DEFAULT 'AIR Bypass Road, Tirupati',
  p_full_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_provider_id uuid := gen_random_uuid();
  v_clean_phone text;
  v_clean_email text;
  v_category text := lower(trim(p_category_id));
BEGIN
  -- 1. Look up authenticated user's email
  SELECT lower(trim(email)) INTO v_clean_email FROM auth.users WHERE id = p_user_id;

  IF v_clean_email IS NULL THEN
    RAISE EXCEPTION 'User not found or unverified';
  END IF;

  IF length(trim(p_shop_name)) = 0 THEN
    RAISE EXCEPTION 'Shop name is required';
  END IF;

  v_clean_phone := COALESCE(NULLIF(trim(p_phone), ''), '+91 98480 00000');

  IF v_category NOT IN ('salons', 'clinics', 'gaming', 'restaurants', 'pets') THEN
    v_category := 'clinics';
  END IF;

  -- 2. Create the provider record linked to this user and their verified email
  INSERT INTO public.providers (
    id, name, category_id, address, phone, email, city, city_id,
    latitude, longitude, opening_time, closing_time, owner_id, status, created_at, updated_at
  ) VALUES (
    v_provider_id, trim(p_shop_name), v_category, COALESCE(NULLIF(trim(p_address), ''), 'AIR Bypass Road, Tirupati'),
    v_clean_phone, v_clean_email, 'Tirupati', 'tirupati',
    13.6288, 79.4192, '09:00:00', '21:00:00', p_user_id, 'ACTIVE', now(), now()
  );

  -- 3. Upsert Profile as merchant
  INSERT INTO public.profiles (id, full_name, phone, role, email, default_provider_id, updated_at)
  VALUES (
    p_user_id, 
    COALESCE(p_full_name, 'Merchant Owner'), 
    v_clean_phone, 
    'merchant'::public.user_role, 
    v_clean_email, 
    v_provider_id, 
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    role = 'merchant'::public.user_role,
    default_provider_id = v_provider_id,
    updated_at = now();

  -- 4. Create Merchant Membership with 'owner' role
  INSERT INTO public.merchant_memberships (user_id, provider_id, role, created_at, updated_at)
  VALUES (p_user_id, v_provider_id, 'owner', now(), now())
  ON CONFLICT (user_id, provider_id) DO UPDATE SET role = 'owner', updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'provider_id', v_provider_id,
    'shop_name', trim(p_shop_name),
    'category_id', v_category,
    'email', v_clean_email
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merchant_register_shop_for_user(uuid, text, text, text, text, text) TO authenticated, service_role, anon;
