-- Migration: 20261115000003_resolve_overloads_and_standby_linter.sql
-- Description:
-- 1. Resolve ambiguous function overloads in public and private schemas:
--    - mark_present_manually: Drop legacy overloads, recreate unified function with p_reason text DEFAULT NULL
--    - merchant_add_resource_leave: Drop (uuid, uuid) and (uuid, text) overloads, recreate single polymorphic (anyelement) function
--    - merchant_register_shop_for_user: Drop 1A jsonb and 1B text overloads, recreate single unified signature
-- 2. Fix public.merchant_move_booking_to_standby: update customer_arrived_at instead of non-existent arrived_at to satisfy supabase db lint.

-- =============================================================================
-- 1. MARK PRESENT MANUALLY (Resolve overloads)
-- =============================================================================
DROP FUNCTION IF EXISTS public.mark_present_manually(uuid, text);
DROP FUNCTION IF EXISTS public.mark_present_manually(uuid);
DROP FUNCTION IF EXISTS private.mark_present_manually(uuid, text);
DROP FUNCTION IF EXISTS private.mark_present_manually(uuid);

CREATE OR REPLACE FUNCTION private.mark_present_manually(
  p_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff_id UUID := auth.uid();
  v_now TIMESTAMPTZ;
  v_booking public.bookings%ROWTYPE;
  v_patient_name TEXT;
  v_service_doctor TEXT;
  v_slot_time_str TEXT;
  v_is_late BOOLEAN;
  v_was_skipped BOOLEAN;
  v_is_hospital BOOLEAN;
  v_hosp_role TEXT;
  v_clean_reason TEXT;
BEGIN
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Authentication required');
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Booking not found');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);
  v_is_hospital := public.is_hospital_provider(v_booking.provider_id);

  IF v_is_hospital THEN
    v_hosp_role := public.hospital_role(v_booking.provider_id, v_staff_id);
    IF v_hosp_role = 'none' THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Not authorized for this hospital');
    END IF;

    IF NOT public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_staff_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Staff is not authorized for this doctor');
    END IF;
  ELSE
    IF NOT public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_staff_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Staff is not authorized for this shop');
    END IF;
  END IF;

  IF v_booking.status = 'CHECKED_IN' OR v_booking.is_present = TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'Booking is already checked in');
  END IF;

  IF v_booking.status != 'CONFIRMED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Only confirmed bookings can be marked present');
  END IF;

  v_was_skipped := (v_booking.skipped_at IS NOT NULL) OR EXISTS (
    SELECT 1
    FROM public.bookings b2
    WHERE b2.resource_id = v_booking.resource_id
      AND (b2.slot_start AT TIME ZONE 'Asia/Kolkata')::date = (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date
      AND b2.slot_start > v_booking.slot_start
      AND b2.status IN ('IN_CONSULTATION', 'COMPLETED')
  );

  -- Per SPEC.md: Arrival window is +/- 10 minutes. A patient is Late only if checked in > 10 min after slot_start.
  v_is_late := v_was_skipped OR (v_now > (v_booking.slot_start + interval '10 minutes'));
  v_clean_reason := NULLIF(trim(COALESCE(current_setting('app.manual_checkin_reason', true), '')), '');

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CHECKED_IN',
      is_present = TRUE,
      checked_in_at = v_now,
      checked_in_by = v_staff_id,
      checked_in_method = 'manual',
      customer_arrived_at = COALESCE(customer_arrived_at, v_now),
      manual_checkin_reason = COALESCE(v_clean_reason, manual_checkin_reason),
      skipped_at = CASE WHEN v_was_skipped THEN COALESCE(skipped_at, v_now) ELSE skipped_at END,
      updated_at = v_now
  WHERE id = v_booking.id
    AND status = 'CONFIRMED'
    AND is_present = FALSE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'Booking is already checked in');
  END IF;

  SELECT COALESCE(full_name, 'Patient') INTO v_patient_name
  FROM public.profiles WHERE id = v_booking.customer_id;

  SELECT name INTO v_service_doctor
  FROM public.resources WHERE id = v_booking.resource_id;

  v_slot_time_str := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'patient_name', v_patient_name,
    'service_doctor', v_service_doctor,
    'slot_time', v_slot_time_str,
    'is_late', v_is_late,
    'checked_in_at', v_now,
    'manual_checkin_reason', v_clean_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.mark_present_manually(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mark_present_manually(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_present_manually(
  p_booking_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_reason IS NOT NULL AND trim(p_reason) <> '' THEN
    PERFORM set_config('app.manual_checkin_reason', trim(p_reason), true);
  ELSE
    PERFORM set_config('app.manual_checkin_reason', '', true);
  END IF;
  RETURN private.mark_present_manually(p_booking_id);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_present_manually(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_present_manually(uuid, text) TO authenticated, service_role;


-- =============================================================================
-- 2. MERCHANT ADD RESOURCE LEAVE (Resolve overloads)
-- =============================================================================
DROP FUNCTION IF EXISTS public.merchant_add_resource_leave(uuid, uuid, text, date, text);
DROP FUNCTION IF EXISTS public.merchant_add_resource_leave(uuid, text, text, date, text);

CREATE OR REPLACE FUNCTION public.merchant_add_resource_leave(
  p_provider_id uuid,
  p_resource_id anyelement,
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
    v_leave_id, p_provider_id, p_resource_id::text, trim(p_doctor_name), p_leave_date, trim(p_reason), now()
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

REVOKE ALL ON FUNCTION public.merchant_add_resource_leave(uuid, anyelement, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_add_resource_leave(uuid, anyelement, text, date, text) TO authenticated, service_role;


-- =============================================================================
-- 3. MERCHANT REGISTER SHOP FOR USER (Resolve overloads)
-- =============================================================================
DROP FUNCTION IF EXISTS public.merchant_register_shop_for_user(uuid, text, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.merchant_register_shop_for_user(uuid, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.merchant_register_shop_for_user(
  p_user_id uuid,
  p_shop_name text,
  p_category_id text DEFAULT 'hospital',
  p_address text DEFAULT 'AIR Bypass Road, Tirupati',
  p_phone text DEFAULT '+919999999999',
  p_full_name text DEFAULT NULL,
  p_raw_meta jsonb DEFAULT '{}'::jsonb,
  p_photo_url text DEFAULT NULL,
  p_city text DEFAULT 'Tirupati'
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
  v_category text := lower(trim(COALESCE(p_category_id, 'hospital')));
  v_photos text[] := NULL;
  v_lat double precision := 13.6288;
  v_lng double precision := 79.4192;
  v_existing_provider_id uuid;
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

  SELECT id INTO v_existing_provider_id FROM public.providers WHERE owner_id = p_user_id LIMIT 1;
  IF v_existing_provider_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'provider_id', v_existing_provider_id,
      'is_existing', true,
      'message', 'User already owns a provider'
    );
  END IF;

  v_clean_phone := trim(COALESCE(p_phone, '+919999999999'));

  IF p_photo_url IS NOT NULL AND trim(p_photo_url) <> '' THEN
    v_photos := ARRAY[trim(p_photo_url)];
  ELSIF p_raw_meta IS NOT NULL AND p_raw_meta ? 'photos' AND jsonb_typeof(p_raw_meta->'photos') = 'array' THEN
    SELECT array_agg(value#>>'{}')
    INTO v_photos
    FROM jsonb_array_elements(p_raw_meta->'photos');
  END IF;

  IF p_raw_meta IS NOT NULL AND p_raw_meta ? 'latitude' AND p_raw_meta ? 'longitude' THEN
    BEGIN
      v_lat := (p_raw_meta->>'latitude')::double precision;
      v_lng := (p_raw_meta->>'longitude')::double precision;
    EXCEPTION WHEN OTHERS THEN
      v_lat := 13.6288;
      v_lng := 79.4192;
    END;
  END IF;

  INSERT INTO public.providers (
    id, name, category_id, address, phone, email, city, city_id,
    latitude, longitude, opening_time, closing_time, owner_id, status, photos, created_at, updated_at
  ) VALUES (
    v_provider_id, trim(p_shop_name), v_category, COALESCE(NULLIF(trim(p_address), ''), 'AIR Bypass Road, Tirupati'),
    v_clean_phone, v_clean_email, COALESCE(trim(p_city), 'Tirupati'), 'tirupati',
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
    'merchant_id', v_provider_id,
    'shop_id', v_provider_id,
    'shop_name', trim(p_shop_name),
    'category_id', v_category,
    'email', v_clean_email,
    'photos', v_photos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_register_shop_for_user(uuid, text, text, text, text, text, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_register_shop_for_user(uuid, text, text, text, text, text, jsonb, text, text) TO authenticated, service_role;


-- =============================================================================
-- 4. MERCHANT MOVE BOOKING TO STANDBY (Use correct bookings columns for linter)
-- =============================================================================
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
  SET is_present = false,
      skipped_at = COALESCE(skipped_at, now()),
      updated_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'message', 'Patient moved to Standby Queue');
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_move_booking_to_standby FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_move_booking_to_standby TO authenticated, service_role;
