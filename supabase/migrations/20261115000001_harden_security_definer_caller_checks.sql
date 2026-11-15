-- =============================================================================
-- Migration: 20261115000001_harden_security_definer_caller_checks.sql
-- Description: Harden SECURITY DEFINER RPCs against authorization bypass / BOLA.
--
-- CRITICAL SECURITY FIX:
-- In PostgreSQL, inside a SECURITY DEFINER function owned by 'postgres',
-- 'current_user' ALWAYS evaluates to 'postgres' regardless of who invoked the RPC.
-- Using 'current_user IN ('postgres', 'supabase_admin')' created a total BOLA bypass
-- for all PostgREST callers.
--
-- This migration replaces 'current_user' with:
--   (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
-- ensuring that API callers presenting JWTs are always subject to strict
-- tenant and role authorization checks.
-- =============================================================================

-- 1A. MERCHANT REGISTER SHOP FOR USER (Canonical 7-arg signature)
CREATE OR REPLACE FUNCTION public.merchant_register_shop_for_user(
  p_user_id uuid,
  p_business_name text,
  p_city text,
  p_address text,
  p_phone text,
  p_category text DEFAULT 'hospital',
  p_raw_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_provider_id uuid := gen_random_uuid();
  v_clean_email text;
  v_existing_provider_id uuid;
  v_photos text[] := NULL;
  v_lat double precision := 13.6288;
  v_lng double precision := 79.4192;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  -- 1. Caller Authorization Guard: only service_role, DB superuser without JWT, or the user themselves / admin
  IF NOT (
    (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
    OR auth.role() = 'service_role' 
    OR (v_caller_id IS NOT NULL AND v_caller_id = p_user_id)
    OR public.is_admin(v_caller_id)
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
    RAISE EXCEPTION 'A provider with this email already exists';
  END IF;

  -- Prevent duplicate registration for the same owner
  SELECT id INTO v_existing_provider_id FROM public.providers WHERE owner_id = p_user_id LIMIT 1;
  IF v_existing_provider_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'provider_id', v_existing_provider_id,
      'is_existing', true,
      'message', 'User already owns a provider'
    );
  END IF;

  -- Extract photos array from raw_meta if provided
  IF p_raw_meta IS NOT NULL AND p_raw_meta ? 'photos' AND jsonb_typeof(p_raw_meta->'photos') = 'array' THEN
    SELECT array_agg(value#>>'{}')
    INTO v_photos
    FROM jsonb_array_elements(p_raw_meta->'photos');
  END IF;

  -- Extract coordinates if present
  IF p_raw_meta IS NOT NULL AND p_raw_meta ? 'latitude' AND p_raw_meta ? 'longitude' THEN
    BEGIN
      v_lat := (p_raw_meta->>'latitude')::double precision;
      v_lng := (p_raw_meta->>'longitude')::double precision;
    EXCEPTION WHEN OTHERS THEN
      v_lat := 13.6288;
      v_lng := 79.4192;
    END;
  END IF;

  -- 3. Insert into public.providers
  INSERT INTO public.providers (
    id,
    name,
    city,
    city_id,
    address,
    phone,
    email,
    category_id,
    owner_id,
    is_active,
    status,
    photos,
    latitude,
    longitude,
    opening_time,
    closing_time,
    created_at,
    updated_at
  ) VALUES (
    v_provider_id,
    trim(p_business_name),
    COALESCE(NULLIF(trim(p_city), ''), 'Tirupati'),
    'tirupati',
    COALESCE(NULLIF(trim(p_address), ''), 'AIR Bypass Road, Tirupati'),
    trim(p_phone),
    v_clean_email,
    COALESCE(NULLIF(lower(trim(p_category)), ''), 'hospital'),
    p_user_id,
    true,
    'ACTIVE'::public.provider_status,
    v_photos,
    v_lat,
    v_lng,
    '09:00:00'::time,
    '21:00:00'::time,
    now(),
    now()
  );

  -- 4. Update caller profile to merchant and set default_provider_id
  INSERT INTO public.profiles (id, full_name, phone, role, email, default_provider_id, updated_at)
  VALUES (
    p_user_id,
    'Merchant Owner',
    trim(p_phone),
    'merchant'::public.user_role,
    v_clean_email,
    v_provider_id,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
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
    'is_existing', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_register_shop_for_user(uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_register_shop_for_user(uuid, text, text, text, text, text, jsonb) TO authenticated, service_role;


-- 1B. MERCHANT REGISTER SHOP FOR USER (Legacy 7-arg overload signature)
CREATE OR REPLACE FUNCTION public.merchant_register_shop_for_user(
  p_user_id uuid,
  p_shop_name text,
  p_category_id text,
  p_phone text,
  p_address text DEFAULT 'AIR Bypass Road, Tirupati',
  p_full_name text DEFAULT NULL,
  p_photo_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_provider_id uuid := gen_random_uuid();
  v_clean_phone text;
  v_clean_email text;
  v_category text := lower(trim(p_category_id));
  v_photos text[] := NULL;
  v_lat double precision := 13.6288;
  v_lng double precision := 79.4192;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  -- 1. Caller Authorization Guard
  IF NOT (
    (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
    OR auth.role() = 'service_role' 
    OR (v_caller_id IS NOT NULL AND v_caller_id = p_user_id)
    OR public.is_admin(v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to register shop for this user' USING ERRCODE = '42501';
  END IF;

  -- 2. Look up authenticated user's email
  SELECT lower(trim(email)) INTO v_clean_email FROM auth.users WHERE id = p_user_id;

  IF v_clean_email IS NULL THEN
    RAISE EXCEPTION 'User not found or unverified';
  END IF;

  IF EXISTS (SELECT 1 FROM public.providers WHERE lower(trim(email)) = v_clean_email) THEN
    RAISE EXCEPTION 'A provider with this email already exists';
  END IF;

  v_clean_phone := trim(p_phone);

  IF p_photo_url IS NOT NULL AND trim(p_photo_url) <> '' THEN
    v_photos := ARRAY[trim(p_photo_url)];
  END IF;

  INSERT INTO public.providers (
    id, name, category_id, address, phone, email, city, city_id,
    latitude, longitude, opening_time, closing_time, owner_id, status, photos, created_at, updated_at
  ) VALUES (
    v_provider_id, trim(p_shop_name), v_category, COALESCE(NULLIF(trim(p_address), ''), 'AIR Bypass Road, Tirupati'),
    v_clean_phone, v_clean_email, 'Tirupati', 'tirupati',
    v_lat, v_lng, '09:00:00'::time, '21:00:00'::time, p_user_id, 'ACTIVE'::public.provider_status, v_photos, now(), now()
  );

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
$$;

REVOKE ALL ON FUNCTION public.merchant_register_shop_for_user(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_register_shop_for_user(uuid, text, text, text, text, text, text) TO authenticated, service_role;


-- 2. MERCHANT RESOURCE MANAGEMENT (UPSERT & DELETE)
CREATE OR REPLACE FUNCTION public.merchant_upsert_resource(
  p_provider_id uuid,
  p_name text,
  p_category text DEFAULT 'doctor',
  p_price numeric DEFAULT 0,
  p_deposit_amount numeric DEFAULT NULL,
  p_duration_minutes integer DEFAULT 15,
  p_capacity integer DEFAULT 1,
  p_resource_id uuid DEFAULT NULL,
  p_attributes jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
  v_res_id uuid := COALESCE(p_resource_id, gen_random_uuid());
  v_deposit numeric;
  v_result jsonb;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  IF (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = p_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to manage resources for provider %', p_provider_id
      USING ERRCODE = '42501';
  END IF;

  v_deposit := COALESCE(p_deposit_amount, p_price, 0);

  INSERT INTO public.resources (
    id, provider_id, name, type, duration_minutes, capacity, deposit_amount, attributes, is_active, created_at, updated_at
  ) VALUES (
    v_res_id, p_provider_id, trim(p_name), COALESCE(p_category, 'doctor'),
    COALESCE(p_duration_minutes, 15), COALESCE(p_capacity, 1),
    v_deposit, COALESCE(p_attributes, '{}'::jsonb), true, now(), now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    duration_minutes = EXCLUDED.duration_minutes,
    capacity = EXCLUDED.capacity,
    deposit_amount = EXCLUDED.deposit_amount,
    attributes = EXCLUDED.attributes,
    updated_at = now()
  RETURNING to_jsonb(resources.*) INTO v_result;

  RETURN jsonb_build_object('success', true, 'resource', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_upsert_resource FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_upsert_resource TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.merchant_delete_resource(p_resource_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_provider_id uuid;
  v_is_authorized boolean := false;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  SELECT provider_id INTO v_provider_id FROM public.resources WHERE id = p_resource_id;

  IF v_provider_id IS NULL THEN
    RETURN false;
  END IF;

  IF (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.providers WHERE id = v_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = v_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = v_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to delete resources for provider %', v_provider_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.resources WHERE id = p_resource_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_delete_resource FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_delete_resource TO authenticated, service_role;


-- 3. OPERATIONAL SETTINGS & SCHEDULES
CREATE OR REPLACE FUNCTION public.merchant_save_operational_settings(
  p_provider_id uuid,
  p_cooling_period_days int DEFAULT 14,
  p_auto_confirm_holds boolean DEFAULT true,
  p_whatsapp_confirmations boolean DEFAULT true,
  p_reminder_offset_hours int DEFAULT 2
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  IF (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = p_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized for provider %', p_provider_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.providers
  SET cooling_period_days = COALESCE(p_cooling_period_days, cooling_period_days),
      auto_confirm_holds = COALESCE(p_auto_confirm_holds, auto_confirm_holds),
      whatsapp_confirmations = COALESCE(p_whatsapp_confirmations, whatsapp_confirmations),
      reminder_offset_hours = COALESCE(p_reminder_offset_hours, reminder_offset_hours),
      updated_at = now()
  WHERE id = p_provider_id;

  RETURN jsonb_build_object('success', true, 'provider_id', p_provider_id);
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_save_operational_settings FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_save_operational_settings TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.merchant_save_weekly_schedule(
  p_provider_id uuid,
  p_schedule jsonb,
  p_slot_duration_minutes int DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  IF (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = p_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized for provider %', p_provider_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.providers
  SET weekly_hours = p_schedule,
      updated_at = now()
  WHERE id = p_provider_id;

  IF p_slot_duration_minutes IS NOT NULL AND p_slot_duration_minutes > 0 THEN
    UPDATE public.resources
    SET duration_minutes = p_slot_duration_minutes,
        updated_at = now()
    WHERE provider_id = p_provider_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'provider_id', p_provider_id);
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_save_weekly_schedule FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_save_weekly_schedule TO authenticated, service_role;


-- 3A. MERCHANT ADD RESOURCE LEAVE (Doctor ID uuid signature)
CREATE OR REPLACE FUNCTION public.merchant_add_resource_leave(
  p_provider_id uuid,
  p_doctor_id uuid,
  p_doctor_name text,
  p_leave_date date,
  p_reason text DEFAULT 'Planned Leave'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
  v_leave_id uuid := gen_random_uuid();
  v_leave_record jsonb;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  IF (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = p_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized for provider %', p_provider_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.resource_leaves (
    id, provider_id, resource_id, doctor_name, leave_date, reason, created_at
  ) VALUES (
    v_leave_id, p_provider_id, p_doctor_id::text, trim(p_doctor_name), p_leave_date, trim(p_reason), now()
  )
  RETURNING jsonb_build_object(
    'id', id,
    'doctorId', resource_id,
    'doctorName', doctor_name,
    'date', to_char(leave_date, 'YYYY-MM-DD'),
    'reason', reason,
    'createdAt', created_at
  ) INTO v_leave_record;

  RETURN jsonb_build_object('success', true, 'leave', v_leave_record);
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_add_resource_leave(uuid, uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_add_resource_leave(uuid, uuid, text, date, text) TO authenticated, service_role;


-- 3B. MERCHANT ADD RESOURCE LEAVE (Resource ID text overload signature)
CREATE OR REPLACE FUNCTION public.merchant_add_resource_leave(
  p_provider_id uuid,
  p_resource_id text,
  p_doctor_name text,
  p_leave_date date,
  p_reason text DEFAULT 'Planned Leave'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
  v_leave_id uuid := gen_random_uuid();
  v_doc_uuid uuid;
  v_leave_record jsonb;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  IF (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = p_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized for provider %', p_provider_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.resource_leaves (
    id, provider_id, resource_id, doctor_name, leave_date, reason, created_at
  ) VALUES (
    v_leave_id, p_provider_id, trim(p_resource_id), trim(p_doctor_name), p_leave_date, trim(p_reason), now()
  )
  RETURNING jsonb_build_object(
    'id', id,
    'doctorId', resource_id,
    'doctorName', doctor_name,
    'date', to_char(leave_date, 'YYYY-MM-DD'),
    'reason', reason,
    'createdAt', created_at
  ) INTO v_leave_record;

  RETURN jsonb_build_object('success', true, 'leave', v_leave_record);
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_add_resource_leave(uuid, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_add_resource_leave(uuid, text, text, date, text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.merchant_delete_resource_leave(p_leave_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_provider_id uuid;
  v_is_authorized boolean := false;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  SELECT provider_id INTO v_provider_id FROM public.resource_leaves WHERE id = p_leave_id;

  IF v_provider_id IS NULL THEN
    RETURN false;
  END IF;

  IF (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.providers WHERE id = v_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = v_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = v_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized for provider %', v_provider_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.resource_leaves WHERE id = p_leave_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_delete_resource_leave FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_delete_resource_leave TO authenticated, service_role;


-- 4. FRONTDESK QUEUE & CHECK-IN
CREATE OR REPLACE FUNCTION public.merchant_move_booking_to_standby(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_provider_id uuid;
  v_is_authorized boolean := false;
  v_booking record;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;

  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;

  v_provider_id := v_booking.provider_id;

  IF (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.providers WHERE id = v_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = v_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = v_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to update booking %', p_booking_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.bookings
  SET queue_status = 'STANDBY',
      is_present = true,
      arrived_at = COALESCE(arrived_at, now()),
      updated_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'queue_status', 'STANDBY');
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_move_booking_to_standby FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_move_booking_to_standby TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.atomic_assign_checkin_arrival(
  p_booking_id uuid,
  p_arrived_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
  v_booking public.bookings%ROWTYPE;
  v_slot_date_ist date;
  v_arrived timestamptz;
  v_was_skipped boolean;
  v_is_late boolean;
  v_new_pos integer;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.providers WHERE id = v_booking.provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = v_booking.provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = v_booking.provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND v_caller_id = v_booking.customer_id THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to check-in this booking' USING ERRCODE = '42501';
  END IF;

  IF v_booking.status IN ('CANCELLED', 'NO_SHOW') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot mark arrived for ' || v_booking.status::text || ' booking');
  END IF;

  v_slot_date_ist := (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date;

  -- Serialize queue_position assignment per consultant (resource_id) + IST date
  PERFORM pg_advisory_xact_lock(
    hashtext('checkin_pos:' || v_booking.resource_id::text || ':' || v_slot_date_ist::text)
  );

  v_arrived := COALESCE(v_booking.customer_arrived_at, p_arrived_at, public.get_test_clock(v_booking.provider_id));

  v_was_skipped := (v_booking.skipped_at IS NOT NULL) OR EXISTS (
    SELECT 1
    FROM public.bookings b2
    WHERE b2.resource_id = v_booking.resource_id
      AND (b2.slot_start AT TIME ZONE 'Asia/Kolkata')::date = v_slot_date_ist
      AND b2.slot_start > v_booking.slot_start
      AND b2.status IN ('IN_CONSULTATION', 'COMPLETED')
  );

  v_is_late := v_was_skipped OR (v_arrived > (v_booking.slot_start + INTERVAL '5 minutes'));

  IF v_booking.is_present = TRUE AND v_booking.customer_arrived_at IS NOT NULL AND v_booking.queue_position IS NOT NULL AND v_booking.queue_position > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'booking_id', v_booking.id,
      'already_checked_in', true,
      'is_present', true,
      'customer_arrived_at', v_booking.customer_arrived_at,
      'is_late_arrival', v_is_late,
      'was_skipped', v_was_skipped,
      'queue_position', v_booking.queue_position
    );
  END IF;

  IF v_booking.queue_position IS NOT NULL AND v_booking.queue_position > 0 THEN
    v_new_pos := v_booking.queue_position;
  ELSE
    SELECT COALESCE(MAX(b.queue_position), 0) + 1
    INTO v_new_pos
    FROM public.bookings b
    WHERE b.resource_id = v_booking.resource_id
      AND (b.slot_start AT TIME ZONE 'Asia/Kolkata')::date = v_slot_date_ist
      AND b.status NOT IN ('CANCELLED', 'NO_SHOW');
  END IF;

  UPDATE public.bookings
  SET status = CASE WHEN status = 'CONFIRMED' THEN 'CHECKED_IN'::public.booking_status ELSE status END,
      is_present = TRUE,
      customer_arrived_at = v_arrived,
      checked_in_at = COALESCE(checked_in_at, v_arrived),
      skipped_at = CASE WHEN v_was_skipped THEN COALESCE(skipped_at, v_arrived) ELSE skipped_at END,
      queue_position = v_new_pos,
      updated_at = v_arrived
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'already_checked_in', false,
    'is_present', true,
    'customer_arrived_at', v_arrived,
    'is_late_arrival', v_is_late,
    'was_skipped', v_was_skipped,
    'queue_position', v_new_pos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_assign_checkin_arrival FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atomic_assign_checkin_arrival TO authenticated, service_role;


-- 5. ADMIN PROFILE & CITY WAITLIST READS
CREATE OR REPLACE FUNCTION public.admin_get_caller_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_res jsonb;
BEGIN
  IF NOT (
    (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
    OR auth.role() = 'service_role'
    OR (v_caller_id IS NOT NULL AND public.is_admin(v_caller_id))
  ) THEN
    RAISE EXCEPTION 'Access Denied: Admins only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'email', p.email,
    'full_name', p.full_name,
    'phone', p.phone,
    'role', p.role
  ) INTO v_res
  FROM public.profiles p
  WHERE p.id = v_caller_id;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_caller_profile FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_caller_profile TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.admin_fetch_city_waitlist(p_city_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF NOT (
    (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
    OR auth.role() = 'service_role' 
    OR (v_caller_id IS NOT NULL AND public.is_admin(v_caller_id))
  ) THEN
    RAISE EXCEPTION 'Access Denied: Admins only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(to_jsonb(w)) INTO v_result
  FROM (
    SELECT id, city_name AS city_id, phone AS contact_info,
           vertical_interest AS role_interest, notes, created_at,
           jsonb_build_object('name', city_name) AS cities
    FROM public.city_waitlist
    WHERE p_city_id IS NULL OR p_city_id = 'all' OR city_name ILIKE '%' || p_city_id || '%'
    ORDER BY created_at DESC
  ) w;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_fetch_city_waitlist FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fetch_city_waitlist TO authenticated, service_role;
