-- Rollback Migration: 20261120000005_rollback_ignore_client_cashfree_settings.sql
-- Restores merchant_save_operational_settings from 20261115000002_persist_all_merchant_settings_and_checkin_reason.sql

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
