-- Migration: 20261114000004_fix_human_journey_rpc_grants_and_triggers.sql
-- Description: Surgical SQL & RPC remediations to enable 24/24 Pass across human user journeys:
--   1. Fix merchant_register_shop_for_user to set app.trusted_write = 'true' and default Tirupati coordinates.
--   2. Add merchant_upsert_resource and merchant_delete_resource SECURITY DEFINER RPCs for authenticated staff.
--   3. Add operational settings columns & persistence RPCs (merchant_save_operational_settings, merchant_save_weekly_schedule, resource_leaves table & RPCs).
--   4. Authorize atomic_assign_checkin_arrival for merchant staff and add merchant_move_booking_to_standby RPC.
--   5. Fix city_waitlist RLS & add admin_fetch_city_waitlist and admin_get_caller_profile RPCs.
--   6. Update venue-assets storage policy to allow authenticated registration uploads.

BEGIN;

-- =============================================================================
-- 1. FIX merchant_register_shop_for_user (app.trusted_write & Tirupati PostGIS)
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
  v_lat double precision := 13.6288;
  v_lng double precision := 79.4192;
BEGIN
  -- Enable trusted write so profile governance trigger does not abort this authorized registration
  PERFORM set_config('app.trusted_write', 'true', true);

  -- 1. Caller Authorization Guard
  IF NOT (
    current_user IN ('postgres', 'supabase_admin')
    OR auth.role() = 'service_role' 
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
    v_lat, v_lng, '09:00:00', '21:00:00', p_user_id, 'ACTIVE', v_photos, now(), now()
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


-- =============================================================================
-- 2. RESOURCE MANAGEMENT RPCS (merchant_upsert_resource, merchant_delete_resource)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.merchant_upsert_resource(
  p_provider_id uuid,
  p_name text,
  p_category text,
  p_price numeric,
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

  IF current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = p_provider_id AND user_id = v_caller_id AND status = 'active') THEN
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
    COALESCE(p_duration_minutes, 15), COALESCE(p_capacity, 1), v_deposit,
    COALESCE(p_attributes, '{}'::jsonb), true, now(), now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    duration_minutes = EXCLUDED.duration_minutes,
    capacity = EXCLUDED.capacity,
    deposit_amount = EXCLUDED.deposit_amount,
    attributes = COALESCE(EXCLUDED.attributes, public.resources.attributes),
    updated_at = now();

  SELECT to_jsonb(r) INTO v_result FROM public.resources r WHERE r.id = v_res_id;
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

  IF current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.providers WHERE id = v_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = v_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = v_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to delete resource %', p_resource_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.resources WHERE id = p_resource_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_delete_resource FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_delete_resource TO authenticated, service_role;


-- =============================================================================
-- 3. OPERATIONAL SETTINGS & SCHEDULE PERSISTENCE
-- =============================================================================

ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS auto_confirm_holds boolean DEFAULT true;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS whatsapp_confirmations boolean DEFAULT true;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS reminder_offset_hours integer DEFAULT 2;

GRANT SELECT (auto_confirm_holds, whatsapp_confirmations, reminder_offset_hours) ON public.providers TO anon, authenticated;
GRANT SELECT ON public.providers TO authenticated;

CREATE OR REPLACE FUNCTION public.merchant_save_operational_settings(
  p_provider_id uuid,
  p_cooling_period_days int,
  p_auto_confirm_holds boolean,
  p_whatsapp_confirmations boolean,
  p_reminder_offset_hours int
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

  IF current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = p_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized for provider %', p_provider_id USING ERRCODE = '42501';
  END IF;

  UPDATE public.providers
  SET
    cooling_period_days = COALESCE(p_cooling_period_days, cooling_period_days),
    auto_confirm_holds = COALESCE(p_auto_confirm_holds, auto_confirm_holds),
    whatsapp_confirmations = COALESCE(p_whatsapp_confirmations, whatsapp_confirmations),
    reminder_offset_hours = COALESCE(p_reminder_offset_hours, reminder_offset_hours),
    updated_at = now()
  WHERE id = p_provider_id;

  RETURN jsonb_build_object('success', true);
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

  IF current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = p_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized for provider %', p_provider_id USING ERRCODE = '42501';
  END IF;

  UPDATE public.providers
  SET
    weekly_hours = p_schedule,
    updated_at = now()
  WHERE id = p_provider_id;

  IF p_slot_duration_minutes IS NOT NULL AND p_slot_duration_minutes > 0 THEN
    UPDATE public.resources
    SET duration_minutes = p_slot_duration_minutes, updated_at = now()
    WHERE provider_id = p_provider_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_save_weekly_schedule FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_save_weekly_schedule TO authenticated, service_role;

-- Resource leaves table for doctor/staff absence management
CREATE TABLE IF NOT EXISTS public.resource_leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  resource_id text NOT NULL,
  doctor_name text NOT NULL,
  leave_date date NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.resource_leaves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "resource_leaves_select_policy" ON public.resource_leaves;
CREATE POLICY "resource_leaves_select_policy" ON public.resource_leaves
  FOR SELECT TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "resource_leaves_manage_policy" ON public.resource_leaves;
CREATE POLICY "resource_leaves_manage_policy" ON public.resource_leaves
  FOR ALL TO authenticated
  USING (
    is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.providers WHERE id = resource_leaves.provider_id AND owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = resource_leaves.provider_id AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = resource_leaves.provider_id AND user_id = auth.uid() AND status = 'active')
  );

GRANT ALL ON public.resource_leaves TO service_role;
GRANT SELECT ON public.resource_leaves TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resource_leaves TO authenticated;

CREATE OR REPLACE FUNCTION public.merchant_add_resource_leave(
  p_provider_id uuid,
  p_resource_id text,
  p_doctor_name text,
  p_leave_date date,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean := false;
  v_row record;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  IF current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = p_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized for provider %', p_provider_id USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.resource_leaves (
    provider_id, resource_id, doctor_name, leave_date, reason
  ) VALUES (
    p_provider_id, p_resource_id, p_doctor_name, p_leave_date, trim(p_reason)
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('success', true, 'leave', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_add_resource_leave FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_add_resource_leave TO authenticated, service_role;

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

  IF current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.providers WHERE id = v_provider_id AND owner_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = v_provider_id AND user_id = v_caller_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = v_provider_id AND user_id = v_caller_id AND status = 'active') THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized for leave %', p_leave_id USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.resource_leaves WHERE id = p_leave_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_delete_resource_leave FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_delete_resource_leave TO authenticated, service_role;


-- =============================================================================
-- 4. LATE QUEUE & STANDBY QUEUE RPCS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.atomic_assign_checkin_arrival(
  p_booking_id UUID,
  p_arrived_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_booking RECORD;
  v_slot_date_ist DATE;
  v_arrived TIMESTAMPTZ;
  v_was_skipped BOOLEAN;
  v_is_late BOOLEAN;
  v_new_pos INT;
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Booking ID is required' USING ERRCODE = '22023';
  END IF;

  SELECT b.*, r.provider_id AS res_provider_id
  INTO v_booking
  FROM public.bookings b
  JOIN public.resources r ON r.id = b.resource_id
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;

  -- Authorize caller
  IF current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL AND (
    v_booking.customer_id = v_caller_id
    OR v_booking.provider_id = v_caller_id
    OR EXISTS (SELECT 1 FROM public.providers WHERE id = v_booking.provider_id AND owner_id = v_caller_id)
    OR EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = v_booking.provider_id AND user_id = v_caller_id)
    OR EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = v_booking.provider_id AND user_id = v_caller_id AND status = 'active')
  ) THEN
    v_is_authorized := TRUE;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to check-in this booking' USING ERRCODE = '42501';
  END IF;

  IF v_booking.status IN ('CANCELLED', 'NO_SHOW') THEN
    RAISE EXCEPTION 'Cannot check-in a % booking', v_booking.status USING ERRCODE = '22000';
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

REVOKE ALL ON FUNCTION public.atomic_assign_checkin_arrival(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atomic_assign_checkin_arrival(UUID, TIMESTAMPTZ) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.merchant_move_booking_to_standby(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_booking record;
  v_is_authorized boolean := false;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  IF current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role' OR public.is_admin(v_caller_id) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL AND (
    v_booking.provider_id = v_caller_id
    OR EXISTS (SELECT 1 FROM public.providers WHERE id = v_booking.provider_id AND owner_id = v_caller_id)
    OR EXISTS (SELECT 1 FROM public.merchant_memberships WHERE provider_id = v_booking.provider_id AND user_id = v_caller_id)
    OR EXISTS (SELECT 1 FROM public.department_members WHERE merchant_id = v_booking.provider_id AND user_id = v_caller_id AND status = 'active')
  ) THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to update booking %', p_booking_id USING ERRCODE = '42501';
  END IF;

  UPDATE public.bookings
  SET is_present = false,
      skipped_at = now(),
      updated_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'message', 'Patient moved to Standby Queue');
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_move_booking_to_standby FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_move_booking_to_standby TO authenticated, service_role;


-- =============================================================================
-- 5. ADMIN PROFILE & CITY WAITLIST READS (Bypassing column grants safely)
-- =============================================================================

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
  IF v_caller_id IS NULL THEN
    RETURN NULL;
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

DROP POLICY IF EXISTS "city_waitlist_select_policy" ON public.city_waitlist;
CREATE POLICY "city_waitlist_select_policy" ON public.city_waitlist
FOR SELECT TO authenticated
USING (public.is_admin((SELECT auth.uid())));

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
  IF NOT (current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role' OR public.is_admin(v_caller_id)) THEN
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


-- =============================================================================
-- 6. STORAGE POLICY UPDATE (venue-assets upload for new merchants)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow upload to venue assets'
  ) THEN
    ALTER POLICY "Allow upload to venue assets"
      ON storage.objects
      WITH CHECK (
        bucket_id = 'venue-assets'::text
        AND (
          ((SELECT auth.role()) = 'service_role'::text)
          OR is_admin((SELECT auth.uid()))
          OR (
            (SELECT auth.uid()) IS NOT NULL
            AND (
              (storage.foldername(name))[1] = (SELECT auth.uid())::text
              OR (storage.foldername(name))[2] = (SELECT auth.uid())::text
              OR (storage.foldername(name))[1] = 'common'
              OR (storage.foldername(name))[1] = 'new-merchant'
            )
          )
          OR (
            storage.foldername(name) IS NOT NULL
            AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text
            AND ((storage.foldername(name))[1])::uuid IN (
              SELECT get_user_authorized_providers((SELECT auth.uid()))
            )
          )
        )
      );
  END IF;
END $$;

COMMIT;
