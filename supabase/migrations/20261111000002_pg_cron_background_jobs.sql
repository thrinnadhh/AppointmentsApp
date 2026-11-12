-- Migration: 20261111000002_pg_cron_background_jobs.sql
-- Description: Configures native PostgreSQL (pg_cron) background maintenance jobs,
--              moving hold release, DPDP anonymization, and log cleanup into PostgreSQL ($0 compute).

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  -- Verify pg_cron is loaded and cron.job table is available
  IF EXISTS (
    SELECT 1 FROM pg_proc JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid 
    WHERE pg_namespace.nspname = 'cron' AND pg_proc.proname = 'schedule'
  ) THEN
    -- 1. Unschedule duplicate or existing jobs to ensure clean idempotent state
    PERFORM cron.unschedule(jobname) 
    FROM cron.job 
    WHERE jobname IN (
      'release-expired-booking-holds',
      'dpdp-daily-account-anonymization',
      'process-expired-account-deletions',
      'cleanup-old-app-logs'
    );

    -- 2. Release expired booking holds every minute ($0 compute)
    PERFORM cron.schedule(
      'release-expired-booking-holds',
      '* * * * *',
      'SELECT public.release_expired_holds();'
    );

    -- 3. Run daily DPDP account anonymization at 03:00 UTC
    PERFORM cron.schedule(
      'dpdp-daily-account-anonymization',
      '0 3 * * *',
      'SELECT public.process_expired_account_deletions();'
    );

    -- 4. Clean up public.app_logs older than 7 days daily at 03:30 UTC
    PERFORM cron.schedule(
      'cleanup-old-app-logs',
      '30 3 * * *',
      'SELECT public.purge_old_app_logs(7);'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron background scheduling skipped: %', SQLERRM;
END $$;
