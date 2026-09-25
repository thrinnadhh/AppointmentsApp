-- =============================================================================
-- Migration: 20260924000001_scheduled_account_deletion_anonymization.sql
-- Description:
--   Task 2: Scheduled Data Minimisation & Anonymization Engine
--   1. Batch procedure public.process_expired_account_deletions() to process
--      all account deletion requests that have completed their 30-day grace period.
--   2. Calls public.anonymize_user_data(user_id) for each matured request.
--   3. Registers pg_cron schedule 'process-expired-account-deletions' daily at 03:00 UTC.
--   4. Grants execute exclusively to service_role.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BATCH ANONYMIZATION FUNCTION
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_expired_account_deletions()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_processed_count INT := 0;
BEGIN
    -- Select all matured deletion requests where grace period has elapsed
    FOR r IN
        SELECT user_id
        FROM public.account_deletion_requests
        WHERE scheduled_for <= NOW()
          AND completed_at IS NULL
          AND cancelled_at IS NULL
        ORDER BY scheduled_for ASC
    LOOP
        BEGIN
            -- Anonymize user records and scrub booking notes
            PERFORM public.anonymize_user_data(r.user_id);
            v_processed_count := v_processed_count + 1;
        EXCEPTION WHEN OTHERS THEN
            -- Log failure and continue processing remaining records
            RAISE WARNING 'Failed to anonymize user %: %', r.user_id, SQLERRM;
        END;
    END LOOP;

    RETURN v_processed_count;
END;
$$;

-- Restrict execution to service_role and admin
REVOKE ALL ON FUNCTION public.process_expired_account_deletions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_expired_account_deletions() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PG_CRON SCHEDULE: Run daily at 03:00 UTC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'process-expired-account-deletions'
  ) THEN
    PERFORM cron.schedule(
      'process-expired-account-deletions',
      '0 3 * * *',
      'SELECT public.process_expired_account_deletions();'
    );
  END IF;
END $$;
