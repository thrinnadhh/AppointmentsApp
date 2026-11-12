-- ==============================================================================
-- Rollback Migration for 20261105000001_deduplicate_cron_jobs.sql
-- Restores duplicate cron jobs if rollback is required.
-- ==============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Restore Pair A duplicate if missing
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-expired-holds-sql') THEN
      PERFORM cron.schedule(
        'release-expired-holds-sql',
        '* * * * *',
        'SELECT public.release_expired_holds();'
      );
    END IF;

    -- Restore Pair B duplicate if missing
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-expired-account-deletions') THEN
      PERFORM cron.schedule(
        'process-expired-account-deletions',
        '0 3 * * *',
        'SELECT public.process_expired_account_deletions();'
      );
    END IF;
  END IF;
END $$;
