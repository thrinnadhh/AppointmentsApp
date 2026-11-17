-- Migration: 20261115000002_persist_all_merchant_settings_and_checkin_reason.sql
-- Description: Persist all 4 merchant settings tabs (Profile, Payments, Notifications, Policies)
--              and staff manual check-in compliance reason on bookings.

-- 1. Extend public.providers with operational settings columns
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS gstin text,
  ADD COLUMN IF NOT EXISTS support_phone text,
  ADD COLUMN IF NOT EXISTS support_email text,
  ADD COLUMN IF NOT EXISTS jurisdiction text,
  ADD COLUMN IF NOT EXISTS payout_upi_id text,
  ADD COLUMN IF NOT EXISTS min_deposit_amount numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_window_hours integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cashfree_app_id text,
  ADD COLUMN IF NOT EXISTS cashfree_vendor_id text;

-- 2. Extend public.bookings with manual_checkin_reason
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS manual_checkin_reason text;

-- 3. Grants for new columns
GRANT SELECT (gstin, support_phone, support_email, jurisdiction, payout_upi_id, min_deposit_amount, cancellation_window_hours, cashfree_app_id, cashfree_vendor_id)
  ON public.providers TO authenticated, service_role;

GRANT SELECT (manual_checkin_reason)
  ON public.bookings TO authenticated, service_role;

-- 4. Drop legacy 5-argument overload before recreating with expanded arguments
DROP FUNCTION IF EXISTS public.merchant_save_operational_settings(uuid, int, boolean, boolean, int);

-- 5. Expanded merchant_save_operational_settings RPC
CREATE OR REPLACE FUNCTION public.merchant_save_operational_settings(
  p_provider_id uuid,
  p_cooling_period_days int DEFAULT 0,
  p_auto_confirm_holds boolean DEFAULT true,
  p_whatsapp_confirmations boolean DEFAULT true,
  p_reminder_offset_hours int DEFAULT 2,
  p_business_name text DEFAULT NULL,
  p_gstin text DEFAULT NULL,
  p_support_phone text DEFAULT NULL,
  p_support_email text DEFAULT NULL,
  p_jurisdiction text DEFAULT NULL,
  p_payout_upi_id text DEFAULT NULL,
  p_min_deposit_amount numeric DEFAULT 0,
  p_cancellation_window_hours int DEFAULT 1,
  p_cashfree_app_id text DEFAULT NULL,
  p_cashfree_vendor_id text DEFAULT NULL
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
  SET name = COALESCE(NULLIF(trim(p_business_name), ''), name),
      gstin = COALESCE(NULLIF(trim(p_gstin), ''), gstin),
      support_phone = COALESCE(NULLIF(trim(p_support_phone), ''), support_phone),
      support_email = COALESCE(NULLIF(trim(p_support_email), ''), support_email),
      jurisdiction = COALESCE(NULLIF(trim(p_jurisdiction), ''), jurisdiction),
      payout_upi_id = COALESCE(NULLIF(trim(p_payout_upi_id), ''), payout_upi_id),
      min_deposit_amount = COALESCE(p_min_deposit_amount, min_deposit_amount),
      cancellation_window_hours = COALESCE(p_cancellation_window_hours, cancellation_window_hours),
      cashfree_app_id = COALESCE(NULLIF(trim(p_cashfree_app_id), ''), cashfree_app_id),
      cashfree_vendor_id = COALESCE(NULLIF(trim(p_cashfree_vendor_id), ''), cashfree_vendor_id),
      cooling_period_days = COALESCE(p_cooling_period_days, cooling_period_days),
      auto_confirm_holds = COALESCE(p_auto_confirm_holds, auto_confirm_holds),
      whatsapp_confirmations = COALESCE(p_whatsapp_confirmations, whatsapp_confirmations),
      reminder_offset_hours = COALESCE(p_reminder_offset_hours, reminder_offset_hours),
      updated_at = now()
  WHERE id = p_provider_id;

  RETURN jsonb_build_object(
    'success', true,
    'provider_id', p_provider_id,
    'cooling_period_days', p_cooling_period_days,
    'auto_confirm_holds', p_auto_confirm_holds,
    'whatsapp_confirmations', p_whatsapp_confirmations,
    'reminder_offset_hours', p_reminder_offset_hours,
    'cancellation_window_hours', p_cancellation_window_hours,
    'min_deposit_amount', p_min_deposit_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_save_operational_settings(uuid, int, boolean, boolean, int, text, text, text, text, text, text, numeric, int, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_save_operational_settings(uuid, int, boolean, boolean, int, text, text, text, text, text, text, numeric, int, text, text) TO authenticated, service_role;

-- 6. Updated private.mark_present_manually with p_reason logging
CREATE OR REPLACE FUNCTION private.mark_present_manually(
  p_booking_id uuid,
  p_reason text DEFAULT NULL
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
  v_clean_reason := NULLIF(trim(p_reason), '');

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

-- 7. Public wrappers for mark_present_manually (1-arg and 2-arg overloads)
CREATE OR REPLACE FUNCTION public.mark_present_manually(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.mark_present_manually(p_booking_id, NULL);
$$;

CREATE OR REPLACE FUNCTION public.mark_present_manually(p_booking_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.mark_present_manually(p_booking_id, p_reason);
$$;

REVOKE ALL ON FUNCTION private.mark_present_manually(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mark_present_manually(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_present_manually(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_present_manually(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_present_manually(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_present_manually(uuid, text) TO authenticated, service_role;
