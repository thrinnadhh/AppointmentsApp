-- Migration: 20261111000002_pg_cron_background_jobs.sql
-- Description: Configures native PostgreSQL (pg_cron) background maintenance jobs,
--              moving hold release, DPDP anonymization, and log cleanup into PostgreSQL ($0 compute).

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1. Enhance daily cleanup function to purge public.app_logs older than 7 days
CREATE OR REPLACE FUNCTION public.cron_daily_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cron_deleted integer := 0;
  v_logs_deleted integer := 0;
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

  -- 3. Purge public.app_logs older than 7 days ($0 compute background cleanup)
  BEGIN
    v_logs_deleted := public.purge_old_app_logs(7);
  EXCEPTION WHEN OTHERS THEN
    v_logs_deleted := 0;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'cron_runs_purged', v_cron_deleted,
    'app_logs_purged', v_logs_deleted,
    'executed_at', NOW()
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 2. Idempotent background jobs registration & deduplication
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid 
    WHERE pg_namespace.nspname = 'cron' AND pg_proc.proname = 'schedule'
  ) THEN
    -- Unschedule temporary or redundant duplicates
    PERFORM cron.unschedule(jobname) 
    FROM cron.job 
    WHERE jobname IN (
      'dpdp-daily-account-anonymization',
      'process-expired-account-deletions',
      'release-expired-holds-sql',
      'cleanup-old-app-logs'
    );

    -- Ensure canonical 'release-expired-booking-holds' is active (every minute, $0 compute)
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-expired-booking-holds') THEN
      PERFORM cron.schedule(
        'release-expired-booking-holds',
        '* * * * *',
        'SELECT public.release_expired_holds();'
      );
    END IF;

    -- Ensure canonical 'dpdp-account-deletions-sql' is active (daily, $0 compute)
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dpdp-account-deletions-sql') THEN
      PERFORM cron.schedule(
        'dpdp-account-deletions-sql',
        '0 3 * * *',
        'SELECT public.process_expired_account_deletions();'
      );
    END IF;

    -- Ensure canonical 'daily-cleanup' is active (daily, purges app_logs, pgmq archives, cron runs)
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-cleanup') THEN
      PERFORM cron.schedule(
        'daily-cleanup',
        '30 3 * * *',
        'SELECT public.cron_daily_cleanup();'
      );
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron background scheduling skipped: %', SQLERRM;
END $$;
