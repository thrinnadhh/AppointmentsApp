-- Migration: 20261105100004_pg_net_booking_triggers.sql
-- Description: pg_net triggers on bookings table.
--              Enqueues privacy-safe ID-only messages to pgmq notifications
--              and dispatches asynchronous HTTP call to Edge Function via net.http_post,
--              reading edge_functions_base_url and internal_webhook_secret from Supabase Vault.
--              Trigger is non-failing (all network/queue exceptions caught).

CREATE OR REPLACE FUNCTION public.handle_booking_event_webhook_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_event_type text := NULL;
  v_is_meaningful boolean := false;
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

    -- If Edge Functions URL is configured and not default placeholder, trigger async net.http_post
    IF v_edge_url IS NOT NULL 
       AND v_edge_url <> '' 
       AND v_edge_url <> 'REPLACE_ME'
       AND v_edge_url NOT LIKE '%REPLACE_ME%' THEN

      v_headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', COALESCE(v_webhook_secret, '')
      );

      PERFORM extensions.net.http_post(
        url := rtrim(v_edge_url, '/') || '/process-notification-queue',
        body := jsonb_build_object(
          'triggered_by', 'pg_net_trigger',
          'event_type', v_event_type,
          'payload', v_payload
        ),
        params := '{}'::jsonb,
        headers := v_headers,
        timeout_milliseconds := 5000
      );
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- Non-blocking: warning only. A notification error must never block or roll back a booking!
    RAISE WARNING 'handle_booking_event_webhook_trigger non-fatal error: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Drop and recreate trigger idempotently
DROP TRIGGER IF EXISTS trg_booking_pgnet_webhook ON public.bookings;
CREATE TRIGGER trg_booking_pgnet_webhook
  AFTER INSERT OR UPDATE OF status, payment_status
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_booking_event_webhook_trigger();
