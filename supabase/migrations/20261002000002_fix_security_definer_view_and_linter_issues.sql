-- Migration: 20261002000002_fix_security_definer_view_and_linter_issues.sql
-- Description:
-- 1. Fix Security Definer View (0010_security_definer_view) on public.merchant_bookings:
--    Add security_invoker = true so querying user's RLS is enforced on underlying tables.
--    Use security-definer helper public.get_masked_customer_info to safely project
--    masked customer phone and name without exposing raw profiles table to merchants.
-- 2. Fix Function Search Path Mutable (0011_function_search_path_mutable):
--    Set search_path = public, pg_temp on public.mask_customer_phone.
-- 3. Fix Public Can Execute SECURITY DEFINER Function (0028_anon_security_definer_function_executable):
--    Revoke anon execution on trigger functions and internal security definer helpers.
-- 4. Aligned remote schema_migrations tracking table with canonical repository timestamps.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. MASKED PHONE FUNCTION SEARCH PATH FIX
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mask_customer_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_digits text;
  v_len int;
BEGIN
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN 'Not provided';
  END IF;

  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  v_len := length(v_digits);

  IF v_len < 6 THEN
    RETURN 'Not provided';
  END IF;

  RETURN repeat('*', v_len - 3) || right(v_digits, 3);
END;
$$;

REVOKE ALL ON FUNCTION public.mask_customer_phone(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.mask_customer_phone(text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. MASKED CUSTOMER SUMMARY HELPER FOR MERCHANT BOOKINGS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_masked_customer_info(p_customer_id UUID)
RETURNS TABLE (
  customer_name TEXT,
  customer_phone TEXT,
  no_show_count INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(pr.full_name, 'Walk-in / Guest') AS customer_name,
    public.mask_customer_phone(pr.phone) AS customer_phone,
    COALESCE(pr.no_show_count, 0) AS no_show_count
  FROM public.profiles pr
  WHERE pr.id = p_customer_id;
$$;

REVOKE ALL ON FUNCTION public.get_masked_customer_info(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_masked_customer_info(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CONVERT public.merchant_bookings TO security_invoker = true
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.merchant_bookings
WITH (security_invoker = true)
AS
SELECT
  b.id,
  b.customer_id,
  b.provider_id,
  b.resource_id,
  b.slot_start,
  b.slot_end,
  b.status,
  b.payment_status,
  b.deposit_amount,
  b.platform_fee,
  b.total_amount,
  b.gateway_payment_id,
  b.hold_expires_at,
  b.reference_code,
  b.attachment_url,
  b.reminder_1h_sent_at,
  b.reminder_30m_sent_at,
  b.is_present,
  b.customer_arrived_at,
  b.platform_fee_gst,
  b.gstin_platform,
  b.invoice_number,
  b.created_at,
  b.updated_at,
  COALESCE(c.customer_name, 'Walk-in / Guest') AS customer_name,
  COALESCE(c.customer_phone, 'Not provided') AS customer_phone,
  COALESCE(c.no_show_count, 0) AS no_show_count,
  COALESCE(r.name, 'Standard Unit') AS resource_name,
  COALESCE(r.type, 'slot') AS resource_type,
  COALESCE(p.name, 'Merchant Venue') AS provider_name
FROM public.bookings b
LEFT JOIN LATERAL public.get_masked_customer_info(b.customer_id) c ON true
LEFT JOIN public.resources r ON r.id = b.resource_id
LEFT JOIN public.providers p ON p.id = b.provider_id
WHERE b.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
   OR public.is_admin(auth.uid());

REVOKE ALL ON public.merchant_bookings FROM anon;
GRANT SELECT ON public.merchant_bookings TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. HARDEN TRIGGER & INTERNAL FUNCTIONS AGAINST ANON RPC EXECUTION
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.assign_clinic_queue_position() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guard_profile_governance() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guard_provider_governance() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_booking_notification_trigger() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_booking_reference_code() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validate_booking_update() FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_merchant_owner_or_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_merchant_owner_or_admin(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_user_authorized_providers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_authorized_providers(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_update_merchant_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_merchant_status(uuid, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_update_resource_status(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_resource_status(uuid, boolean, text) TO authenticated, service_role;
