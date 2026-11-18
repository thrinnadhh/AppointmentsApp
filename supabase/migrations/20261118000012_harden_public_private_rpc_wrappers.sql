-- =============================================================================
-- Migration: 20261118000012_harden_public_private_rpc_wrappers.sql
-- Description: Security Finding 2 Fix & Wrapper Hardening:
--              Harden all 29 public wrapper functions that call private.*
--              with SECURITY DEFINER and search_path TO '' so authenticated
--              and service_role callers never encounter 42501 (permission denied
--              for schema private) during legitimate customer/staff workflows.
--              Enforces explicit execution grants on authenticated & service_role
--              while revoking anonymous execution on sensitive procedures.
-- =============================================================================

BEGIN;

-- 1. Ensure authenticated and service_role have schema USAGE and EXECUTE on private schema functions
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, service_role;

-- 2. Redefine all public wrappers as SECURITY DEFINER with search_path = ''

-- 2.1 cancel_booking
CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id uuid,
  p_reason text DEFAULT 'Standard cancellation'::text,
  p_initiated_by text DEFAULT 'CUSTOMER'::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.cancel_booking(p_booking_id, p_reason, p_initiated_by);
$function$;

REVOKE ALL ON FUNCTION public.cancel_booking(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text) TO authenticated, service_role;

-- 2.2 cancel_doctor_emergency
CREATE OR REPLACE FUNCTION public.cancel_doctor_emergency(
  p_doctor_resource_id uuid,
  p_effective_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_reason text DEFAULT 'Doctor emergency unavailable'::text,
  p_doctor_arrived boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  -- Validates doctor resource membership via department_members in private.cancel_doctor_emergency
  SELECT private.cancel_doctor_emergency(p_doctor_resource_id, p_effective_from, p_reason, p_doctor_arrived);
$function$;

REVOKE ALL ON FUNCTION public.cancel_doctor_emergency(uuid, timestamp with time zone, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_doctor_emergency(uuid, timestamp with time zone, text, boolean) TO authenticated, service_role;

-- 2.3 check_cooling_period_eligibility
CREATE OR REPLACE FUNCTION public.check_cooling_period_eligibility(
  p_customer_id uuid,
  p_provider_id uuid,
  p_target_slot timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.check_cooling_period_eligibility(p_customer_id, p_provider_id, p_target_slot);
$function$;

REVOKE ALL ON FUNCTION public.check_cooling_period_eligibility(uuid, uuid, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_cooling_period_eligibility(uuid, uuid, timestamp with time zone) TO authenticated, service_role;

-- 2.4 complete_booking
CREATE OR REPLACE FUNCTION public.complete_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.complete_booking(p_booking_id);
$function$;

REVOKE ALL ON FUNCTION public.complete_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_booking(uuid) TO authenticated, service_role;

-- 2.5 confirm_booking_by_merchant
CREATE OR REPLACE FUNCTION public.confirm_booking_by_merchant(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.confirm_booking_by_merchant(p_booking_id);
$function$;

REVOKE ALL ON FUNCTION public.confirm_booking_by_merchant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_booking_by_merchant(uuid) TO authenticated, service_role;

-- 2.6 create_booking_hold
CREATE OR REPLACE FUNCTION public.create_booking_hold(
  p_resource_id uuid,
  p_slot_start timestamp with time zone,
  p_slot_end timestamp with time zone,
  p_customer_id uuid,
  p_booking_for_someone_else boolean DEFAULT false,
  p_patient_name text DEFAULT NULL::text,
  p_patient_phone text DEFAULT NULL::text,
  p_patient_relationship text DEFAULT NULL::text,
  p_booked_for text DEFAULT 'self'::text,
  p_patient_age smallint DEFAULT NULL::smallint,
  p_booking_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.create_booking_hold(
    p_resource_id, p_slot_start, p_slot_end, p_customer_id,
    p_booking_for_someone_else, p_patient_name, p_patient_phone,
    p_patient_relationship, p_booked_for, p_patient_age, p_booking_note
  );
$function$;

REVOKE ALL ON FUNCTION public.create_booking_hold(uuid, timestamp with time zone, timestamp with time zone, uuid, boolean, text, text, text, text, smallint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(uuid, timestamp with time zone, timestamp with time zone, uuid, boolean, text, text, text, text, smallint, text) TO authenticated, service_role;

-- 2.7 get_masked_customer_info
CREATE OR REPLACE FUNCTION public.get_masked_customer_info(p_customer_id uuid)
RETURNS TABLE(customer_name text, customer_phone text, no_show_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT * FROM private.get_masked_customer_info(p_customer_id);
$function$;

REVOKE ALL ON FUNCTION public.get_masked_customer_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_masked_customer_info(uuid) TO authenticated, service_role;

-- 2.8 get_merchant_bookings
CREATE OR REPLACE FUNCTION public.get_merchant_bookings(p_provider_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(
  id uuid,
  customer_id uuid,
  provider_id uuid,
  resource_id uuid,
  slot_start timestamp with time zone,
  slot_end timestamp with time zone,
  status booking_status,
  payment_status payment_status,
  deposit_amount numeric,
  platform_fee numeric,
  total_amount numeric,
  gateway_payment_id text,
  hold_expires_at timestamp with time zone,
  reference_code text,
  attachment_url text,
  reminder_1h_sent_at timestamp with time zone,
  reminder_30m_sent_at timestamp with time zone,
  is_present boolean,
  customer_arrived_at timestamp with time zone,
  platform_fee_gst numeric,
  gstin_platform text,
  invoice_number text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  customer_name text,
  customer_phone text,
  no_show_count integer,
  resource_name text,
  resource_type text,
  provider_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT * FROM private.get_merchant_bookings(p_provider_id);
$function$;

REVOKE ALL ON FUNCTION public.get_merchant_bookings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_merchant_bookings(uuid) TO authenticated, service_role;

-- 2.9 get_provider_details
CREATE OR REPLACE FUNCTION public.get_provider_details(p_provider_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.get_provider_details(p_provider_id);
$function$;

REVOKE ALL ON FUNCTION public.get_provider_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_provider_details(uuid) TO authenticated, service_role;

-- 2.10 get_user_authorized_providers
CREATE OR REPLACE FUNCTION public.get_user_authorized_providers(p_user_id uuid DEFAULT auth.uid())
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT * FROM private.get_user_authorized_providers(p_user_id);
$function$;

REVOKE ALL ON FUNCTION public.get_user_authorized_providers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_authorized_providers(uuid) TO authenticated, service_role;

-- 2.11 hospital_accessible_resource_ids
CREATE OR REPLACE FUNCTION public.hospital_accessible_resource_ids(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT * FROM private.hospital_accessible_resource_ids(p_provider_id, p_user_id);
$function$;

REVOKE ALL ON FUNCTION public.hospital_accessible_resource_ids(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_accessible_resource_ids(uuid, uuid) TO authenticated, service_role;

-- 2.12 hospital_role
CREATE OR REPLACE FUNCTION public.hospital_role(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.hospital_role(p_provider_id, p_user_id);
$function$;

REVOKE ALL ON FUNCTION public.hospital_role(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_role(uuid, uuid) TO authenticated, service_role;

-- 2.13 is_admin
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.is_admin(p_user_id);
$function$;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

-- 2.14 is_city_director_for_city
CREATE OR REPLACE FUNCTION public.is_city_director_for_city(p_city_id text, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.is_city_director_for_city(p_city_id, p_user_id);
$function$;

REVOKE ALL ON FUNCTION public.is_city_director_for_city(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_city_director_for_city(text, uuid) TO authenticated, service_role;

-- 2.15 is_hospital_provider
CREATE OR REPLACE FUNCTION public.is_hospital_provider(p_provider_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.is_hospital_provider(p_provider_id);
$function$;

REVOKE ALL ON FUNCTION public.is_hospital_provider(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_hospital_provider(uuid) TO authenticated, service_role;

-- 2.16 is_merchant_owner_or_admin
CREATE OR REPLACE FUNCTION public.is_merchant_owner_or_admin(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.is_merchant_owner_or_admin(p_provider_id, p_user_id);
$function$;

REVOKE ALL ON FUNCTION public.is_merchant_owner_or_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_merchant_owner_or_admin(uuid, uuid) TO authenticated, service_role;

-- 2.17 mark_customer_reached
CREATE OR REPLACE FUNCTION public.mark_customer_reached(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.mark_customer_reached(p_booking_id);
$function$;

REVOKE ALL ON FUNCTION public.mark_customer_reached(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_customer_reached(uuid) TO authenticated, service_role;

-- 2.18 merchant_update_cooling_period
CREATE OR REPLACE FUNCTION public.merchant_update_cooling_period(p_provider_id uuid, p_cooling_period_days integer)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.merchant_update_cooling_period(p_provider_id, p_cooling_period_days);
$function$;

REVOKE ALL ON FUNCTION public.merchant_update_cooling_period(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_update_cooling_period(uuid, integer) TO authenticated, service_role;

-- 2.19 override_hospital_queue_position
CREATE OR REPLACE FUNCTION public.override_hospital_queue_position(
  p_booking_id uuid,
  p_override_position integer,
  p_caller_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.override_hospital_queue_position(p_booking_id, p_override_position, p_caller_id);
$function$;

REVOKE ALL ON FUNCTION public.override_hospital_queue_position(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.override_hospital_queue_position(uuid, integer, uuid) TO authenticated, service_role;

-- 2.20 reassign_booking_resource
CREATE OR REPLACE FUNCTION public.reassign_booking_resource(
  p_booking_id uuid,
  p_new_resource_id uuid,
  p_reason text DEFAULT 'Emergency re-allocation'::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.reassign_booking_resource(p_booking_id, p_new_resource_id, p_reason);
$function$;

REVOKE ALL ON FUNCTION public.reassign_booking_resource(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_booking_resource(uuid, uuid, text) TO authenticated, service_role;

-- 2.21 record_no_show
CREATE OR REPLACE FUNCTION public.record_no_show(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.record_no_show(p_booking_id);
$function$;

REVOKE ALL ON FUNCTION public.record_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_no_show(uuid) TO authenticated, service_role;

-- 2.22 reorder_hospital_queue
CREATE OR REPLACE FUNCTION public.reorder_hospital_queue(
  p_provider_id uuid,
  p_doctor_id uuid,
  p_booking_ids uuid[],
  p_caller_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.reorder_hospital_queue(p_provider_id, p_doctor_id, p_booking_ids, p_caller_id);
$function$;

REVOKE ALL ON FUNCTION public.reorder_hospital_queue(uuid, uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_hospital_queue(uuid, uuid, uuid[], uuid) TO authenticated, service_role;

-- 2.23 request_account_deletion
CREATE OR REPLACE FUNCTION public.request_account_deletion(p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.request_account_deletion(p_reason);
$function$;

REVOKE ALL ON FUNCTION public.request_account_deletion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(text) TO authenticated, service_role;

-- 2.24 reschedule_booking_slot
CREATE OR REPLACE FUNCTION public.reschedule_booking_slot(
  p_booking_id uuid,
  p_new_slot_start timestamp with time zone,
  p_new_slot_end timestamp with time zone
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.reschedule_booking_slot(p_booking_id, p_new_slot_start, p_new_slot_end);
$function$;

REVOKE ALL ON FUNCTION public.reschedule_booking_slot(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_slot(uuid, timestamp with time zone, timestamp with time zone) TO authenticated, service_role;

-- 2.25 reveal_customer_contact
CREATE OR REPLACE FUNCTION public.reveal_customer_contact(
  p_booking_id uuid,
  p_reason text DEFAULT 'Operational check-in'::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.reveal_customer_contact(p_booking_id, p_reason);
$function$;

REVOKE ALL ON FUNCTION public.reveal_customer_contact(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_customer_contact(uuid, text) TO authenticated, service_role;

-- 2.26 search_directory
CREATE OR REPLACE FUNCTION public.search_directory(p_query text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.search_directory(p_query);
$function$;

REVOKE ALL ON FUNCTION public.search_directory(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_directory(text) TO authenticated, service_role;

-- 2.27 search_directory_public
CREATE OR REPLACE FUNCTION public.search_directory_public(p_query text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.search_directory_public(p_query);
$function$;

REVOKE ALL ON FUNCTION public.search_directory_public(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_directory_public(text) TO authenticated, service_role;

-- 2.28 sync_customer_profile
CREATE OR REPLACE FUNCTION public.sync_customer_profile(
  p_full_name text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.sync_customer_profile(p_full_name, p_phone, p_email);
$function$;

REVOKE ALL ON FUNCTION public.sync_customer_profile(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_customer_profile(text, text, text) TO authenticated, service_role;

-- 2.29 verify_checkin_code
CREATE OR REPLACE FUNCTION public.verify_checkin_code(p_shop_id uuid, p_code text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.verify_checkin_code(p_shop_id, p_code);
$function$;

REVOKE ALL ON FUNCTION public.verify_checkin_code(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_checkin_code(uuid, text) TO authenticated, service_role;

-- 2.30 Harden private.reschedule_booking_slot to return success:false on unauthorized caller
CREATE OR REPLACE FUNCTION private.reschedule_booking_slot(
  p_booking_id uuid,
  p_new_slot_start timestamp with time zone,
  p_new_slot_end timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_conflict_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_target_status public.booking_status;
  v_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_caller_id) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access Denied: Not authorized to reschedule this booking');
  END IF;

  IF v_booking.status::text IN ('CHECKED_IN', 'WAITING', 'UP_NEXT', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW', 'CANCELLED')
     OR v_booking.is_present = TRUE
     OR v_booking.status::text NOT IN ('CONFIRMED', 'HELD') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);

  IF p_new_slot_start < v_now THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule to a slot in the past');
  END IF;

  IF v_caller_role <> 'service_role'
     AND v_caller_id IS NOT NULL
     AND v_caller_id = v_booking.customer_id
     AND v_booking.slot_start < v_now + INTERVAL '60 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Late reschedule: appointments within 60 minutes of their slot cannot be rescheduled.');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);
  UPDATE public.bookings
  SET status = 'CANCELLED', payment_status = 'FORFEITED', updated_at = v_now
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND status = 'HELD'
    AND hold_expires_at < v_now;

  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND (
      status IN ('CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING', 'UP_NEXT', 'PENDING_PAYMENT')
      OR (status = 'HELD' AND (hold_expires_at IS NULL OR hold_expires_at >= v_now))
    )
    AND id != p_booking_id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'The requested new slot is already booked or held');
  END IF;

  IF v_booking.status = 'HELD' THEN
    IF COALESCE(v_booking.deposit_amount, 0) > 0 AND (v_booking.payment_status != 'CAPTURED' OR v_booking.gateway_payment_id IS NULL) THEN
      v_target_status := 'HELD'::public.booking_status;
    ELSE
      v_target_status := 'CONFIRMED'::public.booking_status;
    END IF;
  ELSIF v_booking.status = 'CONFIRMED' THEN
    v_target_status := 'CONFIRMED'::public.booking_status;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET slot_start = p_new_slot_start,
      slot_end = p_new_slot_end,
      status = v_target_status,
      updated_at = v_now
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'slot_start', p_new_slot_start,
    'slot_end', p_new_slot_end,
    'status', v_target_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.reschedule_booking_slot(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.reschedule_booking_slot(uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- 2.31 dispatch_booking_notification consultant resource authorization
CREATE OR REPLACE FUNCTION public.dispatch_booking_notification(p_booking_id uuid, p_event_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking RECORD;
  v_normalized_phone TEXT;
  v_template_name TEXT;
  v_template_params JSONB;
  v_msg_content TEXT;
  v_whatsapp_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_has_consent BOOLEAN := FALSE;
  v_booking_json JSONB;
  v_display_name TEXT;
BEGIN
  -- Strict allowlist of event types
  IF p_event_type NOT IN (
    'BOOKING_CONFIRMED',
    'BOOKING_REMINDER_1H',
    'BOOKING_CANCELLED',
    'REFUND_PROCESSED'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid event_type for WhatsApp notifications');
  END IF;

  -- Fetch booking details with provider and resource info
  SELECT 
    b.id,
    b.reference_code,
    b.slot_start,
    b.slot_end,
    b.status,
    b.payment_status,
    b.deposit_amount,
    b.total_amount,
    b.customer_id,
    b.provider_id,
    b.resource_id,
    b.booked_for,
    b.patient_name,
    p.name AS provider_name,
    p.address AS provider_address,
    p.phone AS provider_phone,
    r.name AS resource_name,
    prof.phone AS customer_phone,
    prof.full_name AS customer_name
  INTO v_booking
  FROM public.bookings b
  JOIN public.providers p ON b.provider_id = p.id
  JOIN public.resources r ON b.resource_id = r.id
  LEFT JOIN public.profiles prof ON b.customer_id = prof.id
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := TRUE;
    ELSIF public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_caller_id) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to dispatch notifications for this booking' USING ERRCODE = '42501';
  END IF;

  -- Phone normalization (always sends to booker's account phone)
  v_normalized_phone := public.normalize_phone_number(v_booking.customer_phone);
  IF v_normalized_phone IS NULL THEN
    PERFORM set_config('app.trusted_write', 'true', true);
    INSERT INTO public.notification_logs (
      booking_id,
      recipient_phone,
      recipient_name,
      event_type,
      channel,
      status,
      last_error,
      message_content
    ) VALUES (
      p_booking_id,
      COALESCE(v_booking.customer_phone, 'unknown'),
      COALESCE(v_booking.customer_name, 'there'),
      p_event_type,
      'whatsapp',
      'FAILED',
      'Invalid or missing recipient phone number',
      'Phone normalization failed'
    )
    ON CONFLICT (booking_id, event_type, channel) DO NOTHING;

    RETURN jsonb_build_object('success', false, 'error', 'Invalid recipient phone number');
  END IF;

  -- If booked for family, name the patient in the message copy
  IF v_booking.booked_for = 'family' AND v_booking.patient_name IS NOT NULL AND trim(v_booking.patient_name) <> '' THEN
    v_display_name := trim(v_booking.patient_name);
  ELSE
    v_display_name := v_booking.customer_name;
  END IF;

  -- Prepare booking JSON for build_template_params
  v_booking_json := jsonb_build_object(
    'id', v_booking.id,
    'reference_code', v_booking.reference_code,
    'provider_name', v_booking.provider_name,
    'customer_name', v_display_name,
    'slot_start', v_booking.slot_start,
    'amount', COALESCE(v_booking.deposit_amount, 0)::text
  );

  v_template_name := public.get_template_name(p_event_type);
  v_template_params := public.build_template_params(p_event_type, v_booking_json);

  -- Standard message description for audit
  v_msg_content := format(
    'WhatsApp notification [%s] for %s at %s (Ref: %s)',
    v_template_name,
    COALESCE(v_display_name, 'there'),
    v_booking.provider_name,
    COALESCE(v_booking.reference_code, p_booking_id::text)
  );

  -- Opt-in check: Verify customer has granted whatsapp_notifications consent
  IF v_booking.customer_id IS NOT NULL THEN
    SELECT granted INTO v_has_consent
    FROM public.user_consents
    WHERE user_id = v_booking.customer_id
      AND purpose = 'whatsapp_notifications'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- If no consent recorded, log as SKIPPED
  IF NOT COALESCE(v_has_consent, false) THEN
    PERFORM set_config('app.trusted_write', 'true', true);
    INSERT INTO public.notification_logs (
      booking_id,
      recipient_phone,
      recipient_name,
      event_type,
      channel,
      status,
      last_error,
      message_content
    ) VALUES (
      p_booking_id,
      v_normalized_phone,
      COALESCE(v_display_name, 'there'),
      p_event_type,
      'whatsapp',
      'SKIPPED',
      'User has not consented to WhatsApp notifications',
      v_msg_content
    )
    ON CONFLICT (booking_id, event_type, channel) DO NOTHING;

    RETURN jsonb_build_object(
      'success', true,
      'channel', 'whatsapp',
      'status', 'SKIPPED',
      'queued', false,
      'skipped', true,
      'reason', 'Consent not granted'
    );
  END IF;

  -- Enqueue notification directly into public.notification_logs (idempotent ON CONFLICT DO NOTHING)
  PERFORM set_config('app.trusted_write', 'true', true);

  INSERT INTO public.notification_logs (
    booking_id,
    recipient_phone,
    recipient_name,
    event_type,
    channel,
    status,
    template_name,
    template_params,
    attempts,
    next_attempt_at,
    message_content,
    provider_response
  ) VALUES (
    p_booking_id,
    v_normalized_phone,
    COALESCE(v_display_name, 'there'),
    p_event_type,
    'whatsapp',
    'QUEUED',
    v_template_name,
    v_template_params,
    0,
    NOW(),
    v_msg_content,
    '{}'::jsonb
  )
  ON CONFLICT (booking_id, event_type, channel) DO NOTHING
  RETURNING id INTO v_whatsapp_id;

  -- If duplicate was ignored, fetch the existing row id
  IF v_whatsapp_id IS NULL THEN
    SELECT id INTO v_whatsapp_id
    FROM public.notification_logs
    WHERE booking_id = p_booking_id
      AND event_type = p_event_type
      AND channel = 'whatsapp';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'whatsapp_id', v_whatsapp_id,
    'whatsapp_log_id', v_whatsapp_id,
    'queued', true,
    'skipped', false,
    'channel', 'whatsapp',
    'status', 'QUEUED',
    'template_name', v_template_name,
    'recipient_phone', v_normalized_phone
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_booking_notification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(uuid, text) TO authenticated, service_role;

-- 2.32 enqueue_refund_request with payment_status preserved on double enqueue
CREATE OR REPLACE FUNCTION public.enqueue_refund_request(
  p_booking_id uuid,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_reason text DEFAULT 'Refund requested'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking record;
  v_refund_amount numeric(10, 2);
  v_caller_id uuid := COALESCE(p_actor_id, auth.uid());
  v_caller_role text := auth.role();
  v_is_authorized boolean := false;
  v_enqueued_msg_id bigint;
  v_payload jsonb;
BEGIN
  -- Row lock booking
  SELECT 
    id, provider_id, customer_id, gateway_payment_id,
    deposit_amount, total_amount,
    status, payment_status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := true;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := true;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized to request refund for this booking' USING ERRCODE = '42501';
  END IF;

  -- Validate refund eligibility (reject if already refunded, in progress, or already queued as pending)
  IF v_booking.payment_status IN ('REFUNDED', 'REFUND_IN_PROGRESS', 'REFUND_PENDING') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Booking refund is already processed or pending in queue',
      'payment_status', v_booking.payment_status
    );
  END IF;

  -- Calculate refund amount: deposit if available, else total
  v_refund_amount := COALESCE(v_booking.deposit_amount, v_booking.total_amount, 0);

  IF v_refund_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No refundable amount found on booking'
    );
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  -- Atomic claim on payments table
  UPDATE public.payments
  SET status = 'REFUND_PENDING',
      updated_at = NOW()
  WHERE booking_id = p_booking_id
    AND status IN ('CAPTURED', 'REFUND_FAILED');

  -- Mark booking payment_status as REFUND_PENDING
  UPDATE public.bookings
  SET payment_status = 'REFUND_PENDING',
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- Build privacy-safe payload (IDs and numbers only, NO PII)
  v_payload := jsonb_build_object(
    'appointment_id', v_booking.id,
    'tenant_id', v_booking.provider_id,
    'user_id', v_booking.customer_id,
    'type', 'REFUND_REQUESTED',
    'amount', v_refund_amount,
    'reason', p_reason,
    'gateway_payment_id', v_booking.gateway_payment_id
  );

  -- Enqueue into pgmq refunds queue
  SELECT pgmq.send('refunds', v_payload) INTO v_enqueued_msg_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'payment_status', 'REFUND_PENDING',
    'refund_amount', v_refund_amount,
    'queue_msg_id', v_enqueued_msg_id
  );
EXCEPTION
  WHEN sqlstate '42501' THEN
    RAISE;
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) TO authenticated, service_role;

COMMIT;
