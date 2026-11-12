-- ==============================================================================
-- Migration: 20261105000001_deduplicate_cron_jobs.sql
-- Description: Group 5 Cron Deduplication & Standardization
--   1. Pair A: Keep canonical 'release-expired-booking-holds' (* * * * *) and
--      idempotently unschedule redundant duplicate 'release-expired-holds-sql'.
--   2. Pair B: Keep canonical 'dpdp-account-deletions-sql' (0 2 * * *) and
--      idempotently unschedule redundant duplicate 'process-expired-account-deletions'.
--   3. Both kept jobs execute direct SQL stored procedures with FOR UPDATE SKIP LOCKED
--      concurrency controls.
-- ==============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- ──────────────────────────────────────────────────────────────────────────
    -- 1. PAIR A: Booking Holds Auto-Release
    -- ──────────────────────────────────────────────────────────────────────────
    -- Unschedule duplicate 'release-expired-holds-sql' introduced in 20261103000002
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-expired-holds-sql') THEN
      PERFORM cron.unschedule('release-expired-holds-sql');
    END IF;

    -- Ensure canonical 'release-expired-booking-holds' (from 20260910000001) is active
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'release_expired_holds'
    ) THEN
      IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-expired-booking-holds') THEN
        PERFORM cron.schedule(
          'release-expired-booking-holds',
          '* * * * *',
          'SELECT public.release_expired_holds();'
        );
      END IF;
    END IF;

    -- ──────────────────────────────────────────────────────────────────────────
    -- 2. PAIR B: DPDP Statutory Account Deletions & Anonymization
    -- ──────────────────────────────────────────────────────────────────────────
    -- Unschedule duplicate 'process-expired-account-deletions' (from 20260924000001)
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-expired-account-deletions') THEN
      PERFORM cron.unschedule('process-expired-account-deletions');
    END IF;

    -- Ensure canonical 'dpdp-account-deletions-sql' (02:00 UTC / 07:30 IST) is active
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'process_expired_account_deletions'
    ) THEN
      IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dpdp-account-deletions-sql') THEN
        PERFORM cron.schedule(
          'dpdp-account-deletions-sql',
          '0 2 * * *',
          'SELECT public.process_expired_account_deletions();'
        );
      END IF;
    END IF;

  END IF;
END $$;
