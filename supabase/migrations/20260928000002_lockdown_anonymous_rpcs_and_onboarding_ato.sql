-- Migration: 20260928000002_lockdown_anonymous_rpcs_and_onboarding_ato.sql
-- Description:
--   1. Lockdown reschedule_booking_slot: Enforce auth.uid() ownership checks and revoke anon access.
--   2. Lockdown get_provider_details: Enforce auth.uid() authorization checks and revoke anon access.
--   3. Harden merchant_self_register: Prevent Account Takeover (ATO) and duplicate business email registration.
--   4. Harden merchant_register_shop_for_user: Enforce caller authorization and prevent duplicate business email registration.

-- =============================================================================
-- 1. RESCHEDULE BOOKING SLOT (Lockdown to authorized customer/merchant/admin)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reschedule_booking_slot(
  p_booking_id UUID,
  p_new_slot_start TIMESTAMPTZ,
  p_new_slot_end TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_conflict_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard:
  -- Allowed: service_role, owning customer (customer_id = auth.uid()), platform superadmin, or authorized provider staff/owners
  IF v_caller_role = 'service_role' THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not authorized to reschedule this booking');
  END IF;

  IF v_booking.status IN ('CANCELLED', 'COMPLETED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = v_booking.resource_id
    AND slot_start = p_new_slot_start
    AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
    AND id != p_booking_id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'The requested new slot is already booked or held');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET slot_start = p_new_slot_start,
      slot_end = p_new_slot_end,
      status = 'CONFIRMED',
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'slot_start', p_new_slot_start,
    'slot_end', p_new_slot_end,
    'status', 'CONFIRMED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;


-- =============================================================================
-- 2. GET PROVIDER DETAILS (Lockdown to authorized merchant/admin/service_role)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_provider_details(
  p_provider_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res jsonb;
  v_caller_id uuid := auth.uid();
  v_caller_role text := auth.role();
  v_is_authorized boolean := false;
BEGIN
  IF v_caller_role = 'service_role' THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL THEN
    IF public.is_admin(v_caller_id) THEN
      v_is_authorized := true;
    ELSIF p_provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Caller does not have permission to view provider details' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(p.*) || jsonb_build_object(
    'resources', COALESCE(
      (SELECT jsonb_agg(to_jsonb(r.*)) FROM public.resources r WHERE r.provider_id = p.id),
      '[]'::jsonb
    )
  )
  INTO v_res
  FROM public.providers p
  WHERE p.id = p_provider_id;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.get_provider_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_provider_details(uuid) TO authenticated, service_role;


-- =============================================================================
-- 3. MERCHANT SELF REGISTER (ATO & Duplicate Business Email Prevention)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.merchant_self_register(
  p_full_name text,
  p_email text,
  p_password text,
  p_phone text,
  p_shop_name text,
  p_category_id text,
  p_address text DEFAULT 'AIR Bypass Road, Tirupati'::text,
  p_photo_url text DEFAULT NULL::text
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
  v_photos text[] := NULL;
BEGIN
  IF v_clean_email IS NULL OR position('@' in v_clean_email) = 0 THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;

  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters long';
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

  IF p_photo_url IS NOT NULL AND length(trim(p_photo_url)) > 0 THEN
    v_photos := ARRAY[trim(p_photo_url)];
  END IF;

  -- Allow internal profile updates
  PERFORM set_config('app.trusted_write', 'true', true);

  -- 1. Check existing identity in auth.users, auth.identities, profiles, or providers
  SELECT id INTO v_user_id FROM auth.users WHERE lower(trim(email)) = v_clean_email;

  IF v_user_id IS NULL THEN
    SELECT user_id INTO v_user_id 
    FROM auth.identities 
    WHERE lower(trim(identity_data->>'email')) = v_clean_email 
       OR lower(trim(provider_id)) = v_clean_email 
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    SELECT id INTO v_user_id 
    FROM public.profiles 
    WHERE lower(trim(email)) = v_clean_email 
    LIMIT 1;
  END IF;

  -- Prevent account takeover: Never overwrite an existing user's credentials
  IF v_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'An account with this email is already registered. Please sign in or reset your password.' USING ERRCODE = '23505';
  END IF;

  -- Prevent registering a business with an email that is already registered
  IF EXISTS (SELECT 1 FROM public.providers WHERE lower(trim(email)) = v_clean_email) THEN
    RAISE EXCEPTION 'A business with this email address is already registered. Please sign in.' USING ERRCODE = '23505';
  END IF;

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
    latitude, longitude, opening_time, closing_time, owner_id, status, photos, created_at, updated_at
  ) VALUES (
    v_provider_id, trim(p_shop_name), v_category, COALESCE(NULLIF(trim(p_address), ''), 'AIR Bypass Road, Tirupati'),
    v_clean_phone, v_clean_email, 'Tirupati', 'tirupati',
    13.6288, 79.4192, '09:00:00', '21:00:00', v_user_id, 'ACTIVE', v_photos, now(), now()
  );

  -- 4. Create Merchant Membership
  INSERT INTO public.merchant_memberships (user_id, provider_id, role, created_at, updated_at)
  VALUES (v_user_id, v_provider_id, 'owner', now(), now())
  ON CONFLICT (user_id, provider_id) DO UPDATE SET role = 'owner', updated_at = now();

  -- 5. Set default provider on profile
  UPDATE public.profiles
  SET default_provider_id = v_provider_id
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'provider_id', v_provider_id,
    'shop_name', trim(p_shop_name),
    'category_id', v_category,
    'email', v_clean_email,
    'photos', v_photos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_self_register(text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_self_register(text, text, text, text, text, text, text, text) TO service_role;


-- =============================================================================
-- 4. MERCHANT REGISTER SHOP FOR USER (Caller Auth & Business Email Guard)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.merchant_register_shop_for_user(
  p_user_id uuid,
  p_shop_name text,
  p_category_id text,
  p_phone text,
  p_address text DEFAULT 'AIR Bypass Road, Tirupati'::text,
  p_full_name text DEFAULT NULL::text,
  p_photo_url text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_provider_id uuid := gen_random_uuid();
  v_clean_phone text;
  v_clean_email text;
  v_category text := lower(trim(p_category_id));
  v_photos text[] := NULL;
BEGIN
  -- 1. Caller Authorization Guard
  IF NOT (
    auth.role() = 'service_role' 
    OR auth.uid() = p_user_id 
    OR public.is_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to register shop for this user' USING ERRCODE = '42501';
  END IF;

  -- 2. Look up authenticated user's email
  SELECT lower(trim(email)) INTO v_clean_email FROM auth.users WHERE id = p_user_id;

  IF v_clean_email IS NULL THEN
    RAISE EXCEPTION 'User not found or unverified';
  END IF;

  -- Prevent registering a business with an email that is already registered
  IF EXISTS (SELECT 1 FROM public.providers WHERE lower(trim(email)) = v_clean_email) THEN
    RAISE EXCEPTION 'A business with this email address is already registered. Please sign in.' USING ERRCODE = '23505';
  END IF;

  IF length(trim(p_shop_name)) = 0 THEN
    RAISE EXCEPTION 'Shop name is required';
  END IF;

  v_clean_phone := COALESCE(NULLIF(trim(p_phone), ''), '+91 98480 00000');

  IF v_category NOT IN ('salons', 'clinics', 'gaming', 'restaurants', 'pets') THEN
    v_category := 'clinics';
  END IF;

  IF p_photo_url IS NOT NULL AND length(trim(p_photo_url)) > 0 THEN
    v_photos := ARRAY[trim(p_photo_url)];
  END IF;

  -- Create the provider record linked to this user and their verified email
  INSERT INTO public.providers (
    id, name, category_id, address, phone, email, city, city_id,
    latitude, longitude, opening_time, closing_time, owner_id, status, photos, created_at, updated_at
  ) VALUES (
    v_provider_id, trim(p_shop_name), v_category, COALESCE(NULLIF(trim(p_address), ''), 'AIR Bypass Road, Tirupati'),
    v_clean_phone, v_clean_email, 'Tirupati', 'tirupati',
    13.6288, 79.4192, '09:00:00', '21:00:00', p_user_id, 'ACTIVE', v_photos, now(), now()
  );

  -- Upsert Profile as merchant
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

  -- Create Merchant Membership with 'owner' role
  INSERT INTO public.merchant_memberships (user_id, provider_id, role, created_at, updated_at)
  VALUES (p_user_id, v_provider_id, 'owner', now(), now())
  ON CONFLICT (user_id, provider_id) DO UPDATE SET role = 'owner', updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'provider_id', v_provider_id,
    'shop_name', trim(p_shop_name),
    'category_id', v_category,
    'email', v_clean_email,
    'photos', v_photos
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.merchant_register_shop_for_user(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_register_shop_for_user(uuid, text, text, text, text, text, text) TO authenticated, service_role;
