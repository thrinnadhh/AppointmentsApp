-- Migration: 20260908000004_admin_portal_rpc.sql
-- Adds RPC stored procedures for Super Admin & Merchants to add users, venues, and doctor/resources

-- 1. Create User RPC
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text DEFAULT 'merchant',
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_encrypted_pw text;
  v_phone text;
BEGIN
  IF p_email IS NULL OR position('@' in p_email) = 0 THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;
  IF length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'User with this email already exists';
  END IF;

  v_encrypted_pw := crypt(p_password, gen_salt('bf'));
  v_phone := COALESCE(p_phone, '+91' || lpad((floor(random() * 9000000000) + 1000000000)::text, 10, '0'));

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    phone_change_token,
    reauthentication_token,
    email_change_token_current,
    is_super_admin
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    lower(trim(p_email)),
    v_encrypted_pw,
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'role', p_role),
    now(),
    now(),
    '', '', '', '', '', '', '',
    (p_role = 'admin')
  );

  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_user_id,
    jsonb_build_object('sub', v_user_id, 'email', lower(trim(p_email))),
    'email',
    v_user_id::text,
    now(),
    now(),
    now()
  );

  INSERT INTO public.profiles (
    id,
    full_name,
    phone,
    role,
    email
  ) VALUES (
    v_user_id,
    p_full_name,
    v_phone,
    p_role::public.user_role,
    lower(trim(p_email))
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    email = EXCLUDED.email;

  RETURN jsonb_build_object(
    'id', v_user_id,
    'email', lower(trim(p_email)),
    'full_name', p_full_name,
    'role', p_role,
    'phone', v_phone
  );
END;
$$;

-- 2. Create Venue RPC
CREATE OR REPLACE FUNCTION public.admin_create_venue(
  p_name text,
  p_category_id text,
  p_address text,
  p_phone text,
  p_opening_time time DEFAULT '09:00:00',
  p_closing_time time DEFAULT '21:00:00',
  p_description text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_latitude numeric DEFAULT 13.6288,
  p_longitude numeric DEFAULT 79.4192
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_provider_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.providers (
    id,
    name,
    category_id,
    address,
    city,
    phone,
    email,
    opening_time,
    closing_time,
    description,
    owner_id,
    latitude,
    longitude,
    status
  ) VALUES (
    v_provider_id,
    p_name,
    p_category_id,
    p_address,
    'Tirupati',
    p_phone,
    p_email,
    p_opening_time,
    p_closing_time,
    p_description,
    p_owner_id,
    p_latitude,
    p_longitude,
    'ACTIVE'
  );

  RETURN jsonb_build_object(
    'id', v_provider_id,
    'name', p_name,
    'category_id', p_category_id,
    'address', p_address,
    'phone', p_phone,
    'opening_time', p_opening_time,
    'closing_time', p_closing_time
  );
END;
$$;

-- 3. Create Doctor / Resource RPC
CREATE OR REPLACE FUNCTION public.admin_create_resource(
  p_provider_id uuid,
  p_name text,
  p_type text,
  p_department text DEFAULT 'General',
  p_price numeric DEFAULT 500.00,
  p_deposit_amount numeric DEFAULT 50.00,
  p_duration_minutes integer DEFAULT 30,
  p_capacity integer DEFAULT 1,
  p_attributes jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_resource_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.resources (
    id,
    provider_id,
    name,
    type,
    department,
    price,
    deposit_amount,
    duration_minutes,
    capacity,
    attributes,
    is_active
  ) VALUES (
    v_resource_id,
    p_provider_id,
    p_name,
    p_type,
    p_department,
    p_price,
    p_deposit_amount,
    p_duration_minutes,
    p_capacity,
    p_attributes,
    true
  );

  RETURN jsonb_build_object(
    'id', v_resource_id,
    'provider_id', p_provider_id,
    'name', p_name,
    'type', p_type,
    'department', p_department,
    'price', p_price,
    'deposit_amount', p_deposit_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_venue TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_resource TO authenticated, anon, service_role;
