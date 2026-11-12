-- ============================================================================
-- Migration: 20261107000001_production_readiness_audit_hardening.sql
-- Description: Production readiness hardening for Supabase Power Features
--              1. Vault secret allowlist validation in get_vault_secret_by_name
--              2. Idempotent refund enqueuing with double-enqueue guard
--              3. DLQ handling with atomic REFUND_FAILED status sync
--              4. Secure DLQ replay helper procedure (service_role only)
--              5. Guard trigger and cron consumer dispatches against REPLACE_ME
--              6. DLQ count alerting in daily cleanup cron
--              7. Strict lockdown of all procedures to service_role only
-- ============================================================================

-- 1. Vault Secret Accessor with Strict Name Allowlist
CREATE OR REPLACE FUNCTION public.get_vault_secret_by_name(p_secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'pg_temp'
AS $$
DECLARE
  v_secret text;
BEGIN
  -- Security Guard: Caller must be service_role or superuser/postgres
  IF auth.role() <> 'service_role' AND CURRENT_USER <> 'postgres' AND SESSION_USER <> 'postgres' THEN
    RAISE EXCEPTION 'Access denied: only service_role can read vault secrets';
  END IF;

  -- Security Guard: Strict allowlist of secret names to prevent arbitrary secret dumping
  IF p_secret_name NOT IN (
    'razorpay_key_secret',
    'razorpay_webhook_secret',
    'internal_webhook_secret',
    'expo_push_access_token',
    'edge_functions_base_url'
  ) THEN
    RAISE EXCEPTION 'Access denied: secret name "%" is not in the allowed vault access list', p_secret_name;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = p_secret_name
  LIMIT 1;

  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vault_secret_by_name(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vault_secret_by_name(text) TO service_role;


-- 2. Idempotent Refund Enqueueing with Double-Enqueue Guard
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

  -- Validate refund eligibility (reject if already refunded, in progress, or already queued as pending)
  IF v_booking.payment_status IN ('REFUNDED', 'REFUND_IN_PROGRESS', 'REFUND_PENDING') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Booking refund is already processed or pending in queue',
      'payment_status', v_booking.payment_status
    );
  END IF;

  v_refund_amount := COALESCE(v_booking.deposit_amount, v_booking.total_amount, 0.00);

  PERFORM set_config('app.trusted_write', 'true', true);

  -- Atomic claim on payments table
  UPDATE public.payments
  SET status = 'REFUND_PENDING',
      updated_at = NOW()
  WHERE booking_id = p_booking_id
    AND status IN ('CAPTURED', 'REFUND_FAILED');

  -- Update booking payment_status
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
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) TO service_role;


-- 3. Read Queue with Automatic DLQ Routing & Atomic State Sync
CREATE OR REPLACE FUNCTION public.read_queue_with_dlq(
  p_queue text,
  p_dlq text,
  p_vt integer DEFAULT 30,
  p_qty integer DEFAULT 10,
  p_max_reads integer DEFAULT 5
)
RETURNS TABLE (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamp with time zone,
  vt timestamp with time zone,
  message jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rec record;
BEGIN
  -- Loop through messages read from queue with visibility timeout
  FOR v_rec IN
    SELECT r.msg_id, r.read_ct, r.enqueued_at, r.vt, r.message
    FROM pgmq.read(p_queue, p_vt, p_qty) r
  LOOP
    -- Check if message has exceeded max read attempts
    IF v_rec.read_ct >= p_max_reads THEN
      -- Route to dead-letter queue with diagnostic failure context
      PERFORM pgmq.send(
        p_dlq,
        v_rec.message || jsonb_build_object(
          '_dlq_reason', 'max_read_count_exceeded',
          '_original_msg_id', v_rec.msg_id,
          '_read_ct', v_rec.read_ct,
          '_moved_at', NOW()
        )
      );

      PERFORM pgmq.delete(p_queue, v_rec.msg_id);

      -- If this is the refunds queue reaching DLQ, update database records to REFUND_FAILED
      IF p_dlq = 'refunds_dlq' AND (v_rec.message->>'appointment_id') IS NOT NULL THEN
        PERFORM set_config('app.trusted_write', 'true', true);

        UPDATE public.bookings
        SET payment_status = 'REFUND_FAILED',
            updated_at = NOW()
        WHERE id = (v_rec.message->>'appointment_id')::uuid
          AND payment_status = 'REFUND_PENDING';

        UPDATE public.payments
        SET status = 'REFUND_FAILED',
            updated_at = NOW()
        WHERE booking_id = (v_rec.message->>'appointment_id')::uuid
          AND status = 'REFUND_PENDING';
      END IF;

      -- Log DLQ movement to app_logs
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_logs') THEN
        INSERT INTO public.app_logs (
          platform,
          level,
          severity,
          category,
          message,
          metadata
        ) VALUES (
          'backend',
          'warn',
          'WARN',
          CASE WHEN p_queue = 'refunds' THEN 'PAYMENT' ELSE 'NOTIFICATION' END,
          format('Message %s from %s moved to DLQ %s after %s attempts', v_rec.msg_id, p_queue, p_dlq, v_rec.read_ct),
          jsonb_build_object(
            'source_queue', p_queue,
            'dlq', p_dlq,
            'original_msg_id', v_rec.msg_id,
            'read_ct', v_rec.read_ct,
            'payload_sample', jsonb_build_object(
              'type', v_rec.message->>'type',
              'appointment_id', v_rec.message->>'appointment_id'
            )
          )
        );
      END IF;
    ELSE
      -- Yield valid message to consumer
      msg_id := v_rec.msg_id;
      read_ct := v_rec.read_ct;
      enqueued_at := v_rec.enqueued_at;
      vt := v_rec.vt;
      message := v_rec.message;
      RETURN NEXT;
    END IF;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.read_queue_with_dlq(text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_queue_with_dlq(text, text, integer, integer, integer) TO service_role;


-- 4. Helper Function to Replay DLQ Messages
CREATE OR REPLACE FUNCTION public.replay_dlq_message(
  p_dlq text,
  p_target_queue text,
  p_dlq_msg_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pgmq', 'pg_temp'
AS $$
DECLARE
  v_rec record;
  v_clean_payload jsonb;
  v_new_msg_id bigint;
BEGIN
  IF auth.role() <> 'service_role' AND CURRENT_USER <> 'postgres' AND SESSION_USER <> 'postgres' THEN
    RAISE EXCEPTION 'Access denied: only service_role can replay DLQ messages';
  END IF;

  IF p_dlq NOT IN ('notifications_dlq', 'refunds_dlq') OR p_target_queue NOT IN ('notifications', 'refunds') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source DLQ or target queue name');
  END IF;

  -- Lock and fetch DLQ record
  EXECUTE format('SELECT msg_id, message FROM pgmq.q_%I WHERE msg_id = $1 FOR UPDATE', p_dlq)
  INTO v_rec
  USING p_dlq_msg_id;

  IF v_rec IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'DLQ message not found');
  END IF;

  -- Strip diagnostic DLQ metadata
  v_clean_payload := v_rec.message - '_dlq_reason' - '_original_msg_id' - '_read_ct' - '_moved_at';

  -- Re-enqueue to active queue
  SELECT pgmq.send(p_target_queue, v_clean_payload) INTO v_new_msg_id;

  -- Delete from DLQ
  EXECUTE format('DELETE FROM pgmq.q_%I WHERE msg_id = $1', p_dlq)
  USING p_dlq_msg_id;

  -- If replaying refund, restore booking and payment status to REFUND_PENDING
  IF p_target_queue = 'refunds' AND (v_clean_payload->>'appointment_id') IS NOT NULL THEN
    PERFORM set_config('app.trusted_write', 'true', true);

    UPDATE public.bookings
    SET payment_status = 'REFUND_PENDING',
        updated_at = NOW()
    WHERE id = (v_clean_payload->>'appointment_id')::uuid
      AND payment_status = 'REFUND_FAILED';

    UPDATE public.payments
    SET status = 'REFUND_PENDING',
        updated_at = NOW()
    WHERE booking_id = (v_clean_payload->>'appointment_id')::uuid
      AND status = 'REFUND_FAILED';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'replayed_dlq_msg_id', p_dlq_msg_id,
    'new_msg_id', v_new_msg_id,
    'target_queue', p_target_queue
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replay_dlq_message(text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replay_dlq_message(text, text, bigint) TO service_role;


-- 5. Booking Event Webhook Trigger Guarding against REPLACE_ME Placeholders
CREATE OR REPLACE FUNCTION public.handle_booking_event_webhook_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_is_meaningful boolean := false;
  v_event_type text;
  v_payload jsonb;
  v_edge_url text;
  v_webhook_secret text;
  v_headers jsonb;
BEGIN
  -- Determine meaningful transition
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'CONFIRMED' THEN
      v_event_type := 'BOOKING_CONFIRMED';
      v_is_meaningful := true;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Status transitions
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      IF NEW.status = 'CONFIRMED' THEN
        v_event_type := 'BOOKING_CONFIRMED';
        v_is_meaningful := true;
      ELSIF NEW.status = 'CANCELLED' THEN
        v_event_type := 'BOOKING_CANCELLED';
        v_is_meaningful := true;
      ELSIF NEW.status = 'UP_NEXT' THEN
        v_event_type := 'PATIENT_UP_NEXT';
        v_is_meaningful := true;
      ELSIF NEW.status = 'IN_CONSULTATION' THEN
        v_event_type := 'IN_CONSULTATION';
        v_is_meaningful := true;
      ELSIF NEW.status = 'WAITING' THEN
        v_event_type := 'QUEUE_CALLED';
        v_is_meaningful := true;
      ELSIF NEW.status = 'COMPLETED' THEN
        v_event_type := 'BOOKING_COMPLETED';
        v_is_meaningful := true;
      END IF;
    END IF;

    -- Payment status transition to REFUNDED
    IF (OLD.payment_status IS DISTINCT FROM NEW.payment_status) AND NEW.payment_status = 'REFUNDED' THEN
      v_event_type := 'REFUND_PROCESSED';
      v_is_meaningful := true;
    END IF;
  END IF;

  -- Only fire for meaningful events
  IF NOT v_is_meaningful OR v_event_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- Build privacy-safe payload (strictly IDs and metadata, NO PII)
  v_payload := jsonb_build_object(
    'appointment_id', NEW.id,
    'tenant_id', NEW.provider_id,
    'user_id', NEW.customer_id,
    'type', v_event_type,
    'status', NEW.status,
    'payment_status', NEW.payment_status,
    'occurred_at', NOW()
  );

  -- Keep trigger fast and non-failing: wrap queue enqueue and HTTP call in exception block
  BEGIN
    -- 1. Enqueue to pgmq notifications
    IF EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'notifications') THEN
      PERFORM pgmq.send('notifications', v_payload);
    END IF;

    -- 2. Check Vault for Edge Function base URL and internal webhook secret
    SELECT decrypted_secret INTO v_edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_functions_base_url'
    LIMIT 1;

    SELECT decrypted_secret INTO v_webhook_secret
    FROM vault.decrypted_secrets
    WHERE name = 'internal_webhook_secret'
    LIMIT 1;

    -- Guard: Only trigger async net.http_post if both URL and secret are configured and not placeholders
    IF v_edge_url IS NOT NULL 
       AND v_edge_url <> '' 
       AND v_edge_url <> 'REPLACE_ME'
       AND v_edge_url NOT LIKE '%REPLACE_ME%'
       AND v_webhook_secret IS NOT NULL
       AND v_webhook_secret <> ''
       AND v_webhook_secret <> 'REPLACE_ME'
       AND v_webhook_secret NOT LIKE '%REPLACE_ME%' THEN

      v_headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', v_webhook_secret
      );

      PERFORM extensions.net.http_post(
        url := rtrim(v_edge_url, '/') || '/process-notification-queue',
        body := v_payload,
        params := '{}'::jsonb,
        headers := v_headers,
        timeout_milliseconds := 5000
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Never allow notification failure to block booking operations
    NULL;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_booking_event_webhook_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_booking_event_webhook_trigger() TO service_role;


-- 6. Cron Queue Consumer Trigger Guarding against REPLACE_ME Placeholders
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

  -- Guard: Only dispatch if both edge URL and internal webhook secret are configured and not placeholders
  IF v_edge_url IS NOT NULL 
     AND v_edge_url <> '' 
     AND v_edge_url <> 'REPLACE_ME' 
     AND v_edge_url NOT LIKE '%REPLACE_ME%'
     AND v_secret IS NOT NULL
     AND v_secret <> ''
     AND v_secret <> 'REPLACE_ME' THEN

    v_headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', v_secret
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

  RETURN jsonb_build_object(
    'success', true, 
    'dispatched', false, 
    'reason', 'Edge functions base URL or internal secret not configured'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.cron_trigger_queue_consumers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_trigger_queue_consumers() TO service_role;


-- 7. Daily Cleanup with Dead-Letter Queue Depth Monitoring & Alerting
CREATE OR REPLACE FUNCTION public.cron_daily_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron', 'pgmq', 'pg_temp'
AS $$
DECLARE
  v_purged_cron_runs integer := 0;
  v_purged_archives integer := 0;
  v_notif_dlq_cnt integer := 0;
  v_refund_dlq_cnt integer := 0;
BEGIN
  -- 1. Purge cron.job_run_details older than 7 days
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'cron' AND table_name = 'job_run_details') THEN
    DELETE FROM cron.job_run_details
    WHERE start_time < NOW() - INTERVAL '7 days';
    GET DIAGNOSTICS v_purged_cron_runs = ROW_COUNT;
  END IF;

  -- 2. Purge pgmq archive rows older than 7 days
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgmq') THEN
    BEGIN
      EXECUTE 'DELETE FROM pgmq.a_notifications WHERE archived_at < NOW() - INTERVAL ''7 days'';';
      EXECUTE 'DELETE FROM pgmq.a_notifications_dlq WHERE archived_at < NOW() - INTERVAL ''7 days'';';
      EXECUTE 'DELETE FROM pgmq.a_refunds WHERE archived_at < NOW() - INTERVAL ''7 days'';';
      EXECUTE 'DELETE FROM pgmq.a_refunds_dlq WHERE archived_at < NOW() - INTERVAL ''7 days'';';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- 3. Check Dead Letter Queues (DLQ) and generate alert in app_logs if messages have failed
    BEGIN
      EXECUTE 'SELECT count(*)::int FROM pgmq.q_notifications_dlq;' INTO v_notif_dlq_cnt;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      EXECUTE 'SELECT count(*)::int FROM pgmq.q_refunds_dlq;' INTO v_refund_dlq_cnt;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    IF (v_notif_dlq_cnt > 0 OR v_refund_dlq_cnt > 0) AND EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_logs'
    ) THEN
      INSERT INTO public.app_logs (
        platform,
        level,
        severity,
        category,
        message,
        metadata
      ) VALUES (
        'backend',
        'error',
        'ERROR',
        'NOTIFICATION',
        format('DLQ Alert: %s notification(s) and %s refund(s) pending in Dead Letter Queues', v_notif_dlq_cnt, v_refund_dlq_cnt),
        jsonb_build_object(
          'notifications_dlq_count', v_notif_dlq_cnt,
          'refunds_dlq_count', v_refund_dlq_cnt,
          'alert_time', NOW()
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'purged_cron_runs', v_purged_cron_runs,
    'notifications_dlq_count', v_notif_dlq_cnt,
    'refunds_dlq_count', v_refund_dlq_cnt
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.cron_daily_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_daily_cleanup() TO service_role;
