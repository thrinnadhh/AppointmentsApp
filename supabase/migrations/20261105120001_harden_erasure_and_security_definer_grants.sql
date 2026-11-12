-- Migration: 20261105120001_harden_erasure_and_security_definer_grants.sql
-- Description: 
--  1. Hardens public.anonymize_user_data to completely scrub permanent_checkin_pin and
--     notification_logs.message_content to eliminate residual customer PII post-erasure.
--  2. Revokes execution privileges on all newly introduced cron, queue, and trigger
--     SECURITY DEFINER functions from PUBLIC, anon, and authenticated.
--  3. Fixes enqueue_refund_request column reference (removes non-existent refund_amount).
--  4. Fixes cron_trigger_queue_consumers net.http_post schema reference.

-- ============================================================================
-- 1. Hardened Data Erasure Procedure
-- ============================================================================
CREATE OR REPLACE FUNCTION public.anonymize_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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

    -- 2. Anonymize profile: scrub all PII including checkin PIN
    UPDATE public.profiles SET
        full_name             = 'Deleted User',
        phone                 = NULL,
        email                 = 'deleted_' || p_user_id || '@deleted.local',
        expo_push_token       = NULL,
        is_flagged            = FALSE,
        permanent_checkin_pin = NULL,
        updated_at            = NOW()
    WHERE id = p_user_id;

    -- 3. Scrub booking customer attachment URLs and third-party patient details
    UPDATE public.bookings SET
        patient_name   = 'Deleted Patient',
        patient_phone  = NULL,
        attachment_url = NULL,
        status         = CASE WHEN status IN ('PENDING_PAYMENT', 'HELD', 'CONFIRMED') THEN 'CANCELLED'::public.booking_status ELSE status END,
        updated_at     = NOW()
    WHERE customer_id = p_user_id;

    -- 4. Scrub notification logs recipient PII and message text containing names
    UPDATE public.notification_logs SET
        recipient_phone = NULL,
        recipient_name  = 'Deleted User',
        message_content = 'Notification content scrubbed pursuant to statutory erasure request'
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
$$;

REVOKE ALL ON FUNCTION public.anonymize_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_user_data(uuid) TO service_role;

-- ============================================================================
-- 2. Fix enqueue_refund_request (remove non-existent refund_amount column)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_refund_request(
  p_booking_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'Refund requested'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND (SESSION_USER = 'postgres' OR CURRENT_USER = 'postgres')) THEN
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
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized to request refund for this booking');
  END IF;

  -- Validate refund eligibility
  IF v_booking.payment_status IN ('REFUNDED', 'REFUND_IN_PROGRESS') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking is already refunded or in progress');
  END IF;

  v_refund_amount := COALESCE(v_booking.deposit_amount, v_booking.total_amount, 0.00);

  PERFORM set_config('app.trusted_write', 'true', true);

  -- Atomic claim on payments table
  UPDATE public.payments
  SET status = 'REFUND_IN_PROGRESS',
      updated_at = NOW()
  WHERE booking_id = p_booking_id
    AND status IN ('CAPTURED', 'PENDING');

  -- Update booking payment_status
  UPDATE public.bookings
  SET payment_status = 'REFUND_IN_PROGRESS',
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- Construct refund payload conforming to Razorpay refund worker contract
  v_payload := jsonb_build_object(
    'booking_id', p_booking_id,
    'payment_id', v_booking.gateway_payment_id,
    'amount_paise', (v_refund_amount * 100)::integer,
    'reason', p_reason,
    'actor_id', v_caller_id,
    'enqueued_at', NOW()
  );

  -- Enqueue into pgmq refunds queue
  SELECT pgmq.send('refunds', v_payload) INTO v_enqueued_msg_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'msg_id', v_enqueued_msg_id,
    'refund_amount', v_refund_amount,
    'status', 'REFUND_IN_PROGRESS'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================================
-- 3. Fix cron_trigger_queue_consumers (net.http_post schema reference)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cron_trigger_queue_consumers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_edge_url text;
  v_secret text;
  v_headers jsonb;
BEGIN
  SELECT decrypted_secret INTO v_edge_url FROM vault.decrypted_secrets WHERE name = 'edge_functions_base_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'internal_webhook_secret' LIMIT 1;

  IF v_edge_url IS NOT NULL AND v_edge_url <> '' AND v_edge_url <> 'REPLACE_ME' AND v_edge_url NOT LIKE '%REPLACE_ME%' THEN
    v_headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', COALESCE(v_secret, '')
    );

    -- Trigger notification consumer
    PERFORM net.http_post(
      url := rtrim(v_edge_url, '/') || '/process-notification-queue',
      body := jsonb_build_object('triggered_by', 'pg_cron'),
      params := '{}'::jsonb,
      headers := v_headers,
      timeout_milliseconds := 5000
    );

    -- Trigger refund consumer
    PERFORM net.http_post(
      url := rtrim(v_edge_url, '/') || '/process-refund-queue',
      body := jsonb_build_object('triggered_by', 'pg_cron'),
      params := '{}'::jsonb,
      headers := v_headers,
      timeout_milliseconds := 5000
    );

    RETURN jsonb_build_object('success', true, 'dispatched', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'dispatched', false, 'reason', 'Edge functions base URL not configured');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================================
-- 4. Lockdown execution grants on all Power & Cron SECURITY DEFINER procedures
-- ============================================================================
REVOKE ALL ON FUNCTION public.cancel_unpaid_pending_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_pending_bookings() TO service_role;

REVOKE ALL ON FUNCTION public.cron_daily_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_daily_cleanup() TO service_role;

REVOKE ALL ON FUNCTION public.cron_expire_no_shows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_expire_no_shows() TO service_role;

REVOKE ALL ON FUNCTION public.cron_trigger_queue_consumers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_trigger_queue_consumers() TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_booking_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_booking_reminders() TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.handle_booking_event_webhook_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_booking_event_webhook_trigger() TO service_role;
