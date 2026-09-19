-- Migration: 20260915000003_merchant_self_register.sql
-- Description: Self-service merchant registration and isolated shop provisioning RPC.

CREATE OR REPLACE FUNCTION public.merchant_self_register(
  p_full_name text,
  p_email text,
  p_password text,
  p_phone text,
  p_shop_name text,
  p_category_id text,
  p_address text DEFAULT 'AIR Bypass Road, Tirupati'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_provider_id uuid := gen_random_uuid();
  v_encrypted_pw text;
  v_clean_email text := lower(trim(p_email));
  v_clean_phone text;
  v_category text := lower(trim(p_category_id));
BEGIN
  IF v_clean_email IS NULL OR position('@' in v_clean_email) = 0 THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;

  IF length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  IF length(trim(p_shop_name)) = 0 THEN
    RAISE EXCEPTION 'Shop name is required';
  END IF;

  v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));
  v_clean_phone := COALESCE(NULLIF(trim(p_phone), ''), '+91 98480 00000');

  -- Normalize category to valid ID
  IF v_category NOT IN ('salons', 'clinics', 'gaming', 'restaurants', 'pets') THEN
    v_category := 'salons';
  END IF;

  -- 1. Check or Create User in auth.users
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_clean_email;

  IF v_user_id IS NOT NULL THEN
    -- Update existing password so user can sign in immediately
    UPDATE auth.users 
    SET encrypted_password = v_encrypted_pw,
        raw_user_meta_data = jsonb_build_object('full_name', p_full_name, 'role', 'merchant'),
        updated_at = now()
    WHERE id = v_user_id;
  ELSE
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone_change_token, reauthentication_token, email_change_token_current, is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_clean_email, v_encrypted_pw, now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object('full_name', p_full_name, 'role', 'merchant'),
      now(), now(), '', '', '', '', '', '', '', false
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id,
      jsonb_build_object('sub', v_user_id, 'email', v_clean_email),
      'email', v_user_id::text, now(), now(), now()
    );
  END IF;

  -- 2. Upsert Profile
  INSERT INTO public.profiles (id, full_name, phone, role, email, updated_at)
  VALUES (v_user_id, p_full_name, v_clean_phone, 'merchant'::public.user_role, v_clean_email, now())
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = 'merchant'::public.user_role,
    email = EXCLUDED.email,
    updated_at = now();

  -- 3. Create Shop / Provider
  INSERT INTO public.providers (
    id, name, category_id, address, phone, email, city, city_id,
    latitude, longitude, opening_time, closing_time, owner_id, status, created_at, updated_at
  ) VALUES (
    v_provider_id, trim(p_shop_name), v_category, COALESCE(NULLIF(trim(p_address), ''), 'AIR Bypass Road, Tirupati'),
    v_clean_phone, v_clean_email, 'Tirupati', 'tirupati',
    13.6288, 79.4192, '09:00:00', '21:00:00', v_user_id, 'ACTIVE', now(), now()
  );

  -- 4. Create Merchant Membership
  INSERT INTO public.merchant_memberships (user_id, provider_id, role, created_at, updated_at)
  VALUES (v_user_id, v_provider_id, 'owner', now(), now())
  ON CONFLICT (user_id, provider_id) DO UPDATE SET role = 'owner', updated_at = now();

  -- 5. Set default provider on profile
  UPDATE public.profiles
  SET default_provider_id = v_provider_id
  WHERE id = v_user_id;

  -- Note: Newly registered merchants start with a clean shop with zero dummy resources.

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'provider_id', v_provider_id,
    'shop_name', trim(p_shop_name),
    'category_id', v_category,
    'email', v_clean_email
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merchant_self_register(text, text, text, text, text, text, text) TO anon, authenticated, service_role;
