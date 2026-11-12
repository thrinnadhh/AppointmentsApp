-- =============================================================================
-- Migration: 20261107000002_harden_security_definer_and_default_privileges.sql
-- Description:
--   1. Revoke default EXECUTE privileges in public schema to ensure new functions
--      are secure-by-default (fail closed).
--   2. Harden reveal_customer_contact RPC to eliminate the current_user = 'postgres'
--      bypass vulnerability inside SECURITY DEFINER context.
--   3. Set security_invoker = true on contact_reveal_anomalies view.
-- =============================================================================

-- 1. Default Privileges: Revoke EXECUTE on future functions from PUBLIC, anon, authenticated
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- 2. Harden contact_reveal_anomalies view
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'contact_reveal_anomalies') THEN
    EXECUTE 'ALTER VIEW public.contact_reveal_anomalies SET (security_invoker = true)';
    EXECUTE 'REVOKE ALL ON public.contact_reveal_anomalies FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT SELECT ON public.contact_reveal_anomalies TO service_role';
  END IF;
END $$;

-- 3. Fix reveal_customer_contact RPC authorization
CREATE OR REPLACE FUNCTION public.reveal_customer_contact(
  p_booking_id uuid,
  p_reason text DEFAULT 'Operational check-in'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID;
  v_booking RECORD;
  v_customer RECORD;
  v_is_authorized BOOLEAN := FALSE;
  v_reveals_last_hour INT;
  v_hourly_limit INT := 20; -- Maximum 20 reveals per user per rolling 1 hour
  v_return_phone TEXT;
  v_return_name TEXT;
BEGIN
  v_caller_id := auth.uid();
  
  -- Handle system / service_role invocation safely
  IF v_caller_id IS NULL THEN
    IF auth.role() = 'service_role' THEN
      SELECT id INTO v_caller_id FROM auth.users WHERE email LIKE '%admin%' LIMIT 1;
    ELSE
      RAISE EXCEPTION 'Authentication required to reveal customer contact' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. Validate mandatory business justification reason
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A valid business justification reason is required to reveal customer contact' USING ERRCODE = '22023';
  END IF;

  -- 2. Verify caller rate limit (rolling 1-hour window)
  SELECT count(*) INTO v_reveals_last_hour
  FROM public.contact_reveal_audit
  WHERE user_id = v_caller_id
    AND revealed_at > (NOW() - INTERVAL '1 hour');

  IF v_reveals_last_hour >= v_hourly_limit 
     AND NOT public.is_admin(v_caller_id) 
     AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Rate limit exceeded: You have reached the maximum of % contact reveals per hour. Please try again later.', v_hourly_limit
      USING ERRCODE = 'P0003';
  END IF;

  -- 3. Fetch booking record
  SELECT id, customer_id, provider_id, status, booking_for_someone_else, patient_name, patient_phone
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Verify merchant authorization or admin
  -- NOTE: Do NOT check current_user = 'postgres' or SESSION_USER as that is bypassed in test/pg connections
  IF auth.role() = 'service_role' THEN
    v_is_authorized := TRUE;
  ELSIF public.is_admin(v_caller_id) THEN
    v_is_authorized := TRUE;
  ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
    v_is_authorized := TRUE;
  ELSIF EXISTS (
    SELECT 1 FROM public.department_members dm
    WHERE dm.user_id = v_caller_id AND dm.merchant_id = v_booking.provider_id AND dm.status = 'active'
  ) THEN
    v_is_authorized := TRUE;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to view contacts for this venue' USING ERRCODE = '42501';
  END IF;

  -- 5. Verify booking is confirmed
  IF v_booking.status != 'CONFIRMED' THEN
    RAISE EXCEPTION 'Customer contact can only be revealed for confirmed bookings (current status: %)', v_booking.status
      USING ERRCODE = '22023';
  END IF;

  -- 6. Fetch customer profile contact
  SELECT phone, full_name
  INTO v_customer
  FROM public.profiles
  WHERE id = v_booking.customer_id;

  IF v_booking.booking_for_someone_else IS TRUE AND v_booking.patient_phone IS NOT NULL AND trim(v_booking.patient_phone) != '' THEN
    v_return_phone := v_booking.patient_phone;
    v_return_name := COALESCE(v_booking.patient_name, v_customer.full_name, 'Patient');
  ELSE
    v_return_phone := v_customer.phone;
    v_return_name := COALESCE(v_customer.full_name, 'Valued Customer');
  END IF;

  -- 7. Insert audit log with reason
  INSERT INTO public.contact_reveal_audit (
    user_id,
    booking_id,
    revealed_at,
    reason
  ) VALUES (
    v_caller_id,
    p_booking_id,
    NOW(),
    trim(p_reason)
  );

  -- 8. Return unmasked contact
  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'phone', COALESCE(v_return_phone, 'Not provided'),
    'full_name', v_return_name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reveal_customer_contact(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_customer_contact(uuid, text) TO authenticated;
