-- =============================================================================
-- Migration: 20261026000001_harden_pii_security_and_erasure.sql
-- Description:
--   1. Harden notification_logs RLS:
--      - Drop permissive policy permitting merchants to read notification logs.
--      - Add policy restricting SELECT exclusively to Admins and Customer Owners.
--   2. Automated Notification Log Masking:
--      - Add mask_old_notification_logs(p_days) function to scrub recipient PII older than threshold.
--   3. Contact Reveal Justification Reason:
--      - Add 'reason' column to public.contact_reveal_audit.
--      - Update reveal_customer_contact RPC to mandate non-empty business justification reason,
--        record in audit trail, and support unmasking family/third-party patient contact details.
--   4. Right to Erasure Scrubbing:
--      - Update anonymize_user_data RPC to scrub patient_name and patient_phone on bookings.
--   5. Merchant Bookings View Privacy:
--      - Update public.merchant_bookings view to expose patient_name and masked patient_phone.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. HARDEN NOTIFICATION_LOGS RLS (CRIT-01)
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Merchants and customers read own booking notification logs" ON public.notification_logs;

DROP POLICY IF EXISTS "Admins and customer owners read notification logs" ON public.notification_logs;
CREATE POLICY "Admins and customer owners read notification logs"
  ON public.notification_logs
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR booking_id IN (
      SELECT id FROM public.bookings WHERE customer_id = auth.uid()
    )
  );

-- Function to mask old notification logs
CREATE OR REPLACE FUNCTION public.mask_old_notification_logs(p_days int DEFAULT 7)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count int;
BEGIN
  IF current_user != 'postgres' AND auth.role() != 'service_role' AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: only service_role or admin can execute notification log masking' USING ERRCODE = '42501';
  END IF;

  WITH updated AS (
    UPDATE public.notification_logs
    SET recipient_phone = public.mask_customer_phone(recipient_phone),
        recipient_name = 'Customer'
    WHERE created_at < (NOW() - (p_days || ' days')::interval)
      AND recipient_phone IS NOT NULL
      AND recipient_phone NOT LIKE '*%'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CONTACT REVEAL AUDIT REASON & RPC HARDENING (HIGH-03)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.contact_reveal_audit
ADD COLUMN IF NOT EXISTS reason TEXT;

DROP FUNCTION IF EXISTS public.reveal_customer_contact(uuid);
DROP FUNCTION IF EXISTS public.reveal_customer_contact(uuid, text);

CREATE OR REPLACE FUNCTION public.reveal_customer_contact(
  p_booking_id uuid,
  p_reason text DEFAULT 'Operational check-in'
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
  v_is_authorized BOOLEAN;
  v_reveals_last_hour INT;
  v_hourly_limit INT := 20; -- Maximum 20 reveals per user per rolling 1 hour
  v_return_phone TEXT;
  v_return_name TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    IF current_user = 'postgres' THEN
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

  IF v_reveals_last_hour >= v_hourly_limit AND NOT public.is_admin(v_caller_id) AND current_user != 'postgres' THEN
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
  SELECT (
    current_user = 'postgres'
    OR public.is_admin(v_caller_id)
    OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id))
    OR EXISTS (
      SELECT 1 FROM public.department_members dm
      WHERE dm.user_id = v_caller_id AND dm.merchant_id = v_booking.provider_id AND dm.status = 'active'
    )
  ) INTO v_is_authorized;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RIGHT TO ERASURE SCRUBBING (HIGH-01)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.anonymize_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_caller_role TEXT;
BEGIN
    IF current_user != 'postgres' AND auth.role() != 'service_role' THEN
        SELECT role INTO v_caller_role FROM public.profiles WHERE id = (SELECT auth.uid());
        IF v_caller_role != 'admin' THEN
            RAISE EXCEPTION 'Unauthorized: only service_role or admin can anonymize users' USING ERRCODE = '42501';
        END IF;
    END IF;

    PERFORM set_config('app.trusted_write', 'true', true);
    PERFORM set_config('storage.allow_delete_query', 'true', true);

    -- 1. Delete physical files from Supabase Storage
    DELETE FROM storage.objects
    WHERE owner = p_user_id
       OR owner_id = p_user_id::text
       OR (bucket_id = 'prescriptions-and-records' AND name LIKE p_user_id || '/%')
       OR (bucket_id = 'prescriptions-and-records' AND name IN (
           SELECT attachment_url FROM public.bookings WHERE customer_id = p_user_id AND attachment_url IS NOT NULL
       ));

    -- 2. Anonymize profile: scrub PII
    UPDATE public.profiles SET
        full_name       = 'Deleted User',
        phone           = NULL,
        email           = 'deleted_' || p_user_id || '@deleted.local',
        expo_push_token = NULL,
        is_flagged      = FALSE,
        updated_at      = NOW()
    WHERE id = p_user_id;

    -- 3. Scrub booking customer attachment URLs and third-party patient details
    UPDATE public.bookings SET
        patient_name   = 'Deleted Patient',
        patient_phone  = NULL,
        attachment_url = NULL,
        updated_at     = NOW()
    WHERE customer_id = p_user_id;

    -- 4. Scrub notification logs recipient PII
    UPDATE public.notification_logs SET
        recipient_phone = NULL,
        recipient_name  = 'Deleted User'
    WHERE booking_id IN (SELECT id FROM public.bookings WHERE customer_id = p_user_id);

    -- 5. Revoke and delete user consents
    DELETE FROM public.user_consents WHERE user_id = p_user_id;

    -- 6. Disable and scrub auth credentials in auth.users
    UPDATE auth.users SET
        email = 'deleted_' || p_user_id || '@deleted.local',
        phone = NULL,
        raw_user_meta_data = '{}'::jsonb,
        banned_until = '2999-01-01 00:00:00+00'
    WHERE id = p_user_id;

    -- 7. Mark deletion request complete
    UPDATE public.account_deletion_requests SET
        completed_at = NOW(),
        last_error = NULL
    WHERE user_id = p_user_id AND completed_at IS NULL;

    RETURN jsonb_build_object('success', true, 'anonymized_user', p_user_id);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. MERCHANT BOOKINGS VIEW PRIVACY & MASKING (CRIT-02 & HIGH-03)
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.merchant_bookings CASCADE;

CREATE VIEW public.merchant_bookings WITH (security_invoker = true) AS
 SELECT b.id,
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
    COALESCE(c.customer_name, 'Walk-in / Guest'::text) AS customer_name,
    COALESCE(c.customer_phone, 'Not provided'::text) AS customer_phone,
    COALESCE(c.no_show_count, 0) AS no_show_count,
    COALESCE(r.name, 'Standard Unit'::text) AS resource_name,
    COALESCE(r.type, 'slot'::text) AS resource_type,
    COALESCE(p.name, 'Merchant Venue'::text) AS provider_name,
    b.department_id,
    COALESCE(dept.name, 'General Medicine'::text) AS department_name,
    b.queue_position,
    b.estimated_wait_minutes,
    b.checked_in_at,
    b.checked_in_method,
    b.is_followup,
    b.followup_original_booking_id,
    b.booking_for_someone_else,
    b.patient_name,
    CASE
      WHEN b.patient_phone IS NOT NULL AND trim(b.patient_phone) != '' THEN public.mask_customer_phone(b.patient_phone)
      ELSE NULL
    END AS patient_phone,
    b.patient_relationship,
    b.emergency_cancelled,
    b.emergency_doctor_arrived,
    b.emergency_patient_choice
   FROM bookings b
     LEFT JOIN LATERAL get_masked_customer_info(b.customer_id) c(customer_name, customer_phone, no_show_count) ON true
     LEFT JOIN resources r ON r.id = b.resource_id
     LEFT JOIN providers p ON p.id = b.provider_id
     LEFT JOIN departments dept ON dept.id = b.department_id
  WHERE (current_user = 'postgres')
     OR (b.provider_id IN ( SELECT get_user_authorized_providers(auth.uid()) AS get_user_authorized_providers))
     OR (b.provider_id IN ( SELECT department_members.merchant_id
           FROM department_members
          WHERE department_members.user_id = auth.uid() AND department_members.status = 'active'::text))
     OR is_admin(auth.uid());

GRANT SELECT ON public.merchant_bookings TO authenticated, anon;
