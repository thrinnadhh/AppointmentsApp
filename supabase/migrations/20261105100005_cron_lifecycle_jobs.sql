-- Migration: 20261105100005_cron_lifecycle_jobs.sql
-- Description: Schedules pg_cron jobs for appointment lifecycle, reminders, cancellations, and cleanup.
--              All job functions are SECURITY DEFINER with fixed search_path, tenant-safe,
--              and safe to execute repeatedly. pg_cron runs in UTC.

-- 1. Function: expire-no-shows (runs every minute)
-- Marks confirmed appointments where patient never arrived/checked in 15m after slot_end as NO_SHOW
CREATE OR REPLACE FUNCTION public.cron_expire_no_shows()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rec record;
  v_count integer := 0;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  FOR v_rec IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.status = 'CONFIRMED'
      AND b.is_present = false
      AND b.checked_in_at IS NULL
      AND (b.slot_end + INTERVAL '15 minutes') < NOW()
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    PERFORM public.record_no_show(v_rec.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'no_shows_expired', v_count,
    'executed_at', NOW()
  );
END;
$$;

-- 2. Function: cancel-unpaid-pending (runs every 5 minutes)
-- Cancels bookings stuck in PENDING_PAYMENT past hold expiration or 15m timeout
CREATE OR REPLACE FUNCTION public.cancel_unpaid_pending_bookings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  WITH expired_pending AS (
    SELECT id
    FROM public.bookings
    WHERE status = 'PENDING_PAYMENT'
      AND payment_status = 'PENDING'
      AND (
        (hold_expires_at IS NOT NULL AND hold_expires_at < NOW())
        OR (hold_expires_at IS NULL AND created_at < NOW() - INTERVAL '15 minutes')
      )
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.bookings b
    SET status = 'CANCELLED',
        payment_status = 'FORFEITED',
        updated_at = NOW()
    FROM expired_pending ep
    WHERE b.id = ep.id
    RETURNING b.id
  )
  SELECT count(*) INTO v_count FROM updated;

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_count', v_count,
    'executed_at', NOW()
  );
END;
$$;

-- 3. Function: enqueue-reminders (runs every 5 minutes)
-- Enqueues 30-minute advance reminders to pgmq notifications
CREATE OR REPLACE FUNCTION public.enqueue_booking_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rec record;
  v_count integer := 0;
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  FOR v_rec IN
    SELECT b.id, b.provider_id, b.customer_id
    FROM public.bookings b
    WHERE b.status = 'CONFIRMED'
      AND b.reminder_30m_sent_at IS NULL
      AND b.slot_start >= NOW() + INTERVAL '25 minutes'
      AND b.slot_start <= NOW() + INTERVAL '35 minutes'
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    IF EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'notifications') THEN
      PERFORM pgmq.send('notifications', jsonb_build_object(
        'appointment_id', v_rec.id,
        'tenant_id', v_rec.provider_id,
        'user_id', v_rec.customer_id,
        'type', 'BOOKING_REMINDER_30M',
        'enqueued_at', NOW()
      ));
    END IF;

    UPDATE public.bookings
    SET reminder_30m_sent_at = NOW(),
        updated_at = NOW()
    WHERE id = v_rec.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reminders_enqueued', v_count,
    'executed_at', NOW()
  );
END;
$$;

-- 4. Function: cleanup (runs daily at 21:30 UTC = 03:00 IST)
-- Purges old cron.job_run_details and pgmq archive tables older than 7 days
CREATE OR REPLACE FUNCTION public.cron_daily_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cron_deleted integer := 0;
BEGIN
  -- 1. Purge cron job run details older than 7 days
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'cron' AND table_name = 'job_run_details') THEN
    DELETE FROM cron.job_run_details WHERE end_time < NOW() - INTERVAL '7 days';
    GET DIAGNOSTICS v_cron_deleted = ROW_COUNT;
  END IF;

  -- 2. Purge pgmq archive tables older than 7 days if pgmq exists
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgmq') THEN
    BEGIN
      EXECUTE 'DELETE FROM pgmq.a_notifications WHERE archived_at < NOW() - INTERVAL ''7 days'';';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      EXECUTE 'DELETE FROM pgmq.a_notifications_dlq WHERE archived_at < NOW() - INTERVAL ''7 days'';';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      EXECUTE 'DELETE FROM pgmq.a_refunds WHERE archived_at < NOW() - INTERVAL ''7 days'';';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      EXECUTE 'DELETE FROM pgmq.a_refunds_dlq WHERE archived_at < NOW() - INTERVAL ''7 days'';';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'cron_runs_purged', v_cron_deleted,
    'executed_at', NOW()
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 5. Helper to trigger queue consumers from cron via net.http_post
CREATE OR REPLACE FUNCTION public.cron_trigger_queue_consumers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
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
    PERFORM extensions.net.http_post(
      url := rtrim(v_edge_url, '/') || '/process-notification-queue',
      body := jsonb_build_object('triggered_by', 'pg_cron'),
      params := '{}'::jsonb,
      headers := v_headers,
      timeout_milliseconds := 5000
    );

    -- Trigger refund consumer
    PERFORM extensions.net.http_post(
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

-- Schedule jobs idempotently
DO $$
BEGIN
  -- 1. expire-no-shows: every minute (* * * * *)
  PERFORM cron.schedule(
    'expire-no-shows',
    '* * * * *',
    'SELECT public.cron_expire_no_shows();'
  );

  -- 2. release-held-slots:
  -- Canonical 'release-expired-booking-holds' already exists and invokes public.release_expired_holds().
  -- If absent, schedule it.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('release-expired-booking-holds', 'release-held-slots')) THEN
    PERFORM cron.schedule(
      'release-expired-booking-holds',
      '* * * * *',
      'SELECT public.release_expired_holds();'
    );
  END IF;

  -- 3. cancel-unpaid-pending: every 5 minutes (*/5 * * * *)
  PERFORM cron.schedule(
    'cancel-unpaid-pending',
    '*/5 * * * *',
    'SELECT public.cancel_unpaid_pending_bookings();'
  );

  -- 4. enqueue-reminders: every 5 minutes (*/5 * * * *)
  PERFORM cron.schedule(
    'enqueue-reminders',
    '*/5 * * * *',
    'SELECT public.enqueue_booking_reminders();'
  );

  -- 5. cleanup: daily at 21:30 UTC = 03:00 IST (UTC+5:30)
  PERFORM cron.schedule(
    'daily-cleanup',
    '30 21 * * *',
    'SELECT public.cron_daily_cleanup();'
  );

  -- 6. process-queues-cron: every minute to trigger edge function queue consumers
  PERFORM cron.schedule(
    'process-queues-cron',
    '* * * * *',
    'SELECT public.cron_trigger_queue_consumers();'
  );
END $$;
