-- Migration: 20261029000001_whatsapp_queue_foundation.sql
-- Description: Step 2 Queue Foundation: Ensure notification_logs schema, status constraint with SKIPPED,
-- deduplicate existing rows safely, unique constraint on (booking_id, event_type, channel),
-- and claim RPC using FOR UPDATE SKIP LOCKED restricted to service_role only.

-- 1. Ensure columns exist with correct types and defaults
ALTER TABLE public.notification_logs
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS template_name TEXT,
  ADD COLUMN IF NOT EXISTS template_params JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Clean and deduplicate existing rows safely before enforcing unique index
DELETE FROM public.notification_logs a
USING public.notification_logs b
WHERE a.booking_id = b.booking_id
  AND a.event_type = b.event_type
  AND a.channel = b.channel
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));

-- 3. Replace old non-unique indexes with unique index
DROP INDEX IF EXISTS public.idx_notification_logs_booking;
CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_notification_logs_booking_event_channel
  ON public.notification_logs(booking_id, event_type, channel);

-- 4. Status constraint: QUEUED, SENDING, SENT, DELIVERED, READ, FAILED, SKIPPED
-- Normalize existing statuses to uppercase and default any invalid values
UPDATE public.notification_logs
SET status = UPPER(status)
WHERE status != UPPER(status);

UPDATE public.notification_logs
SET status = 'QUEUED'
WHERE status NOT IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- Set default status to 'QUEUED'
ALTER TABLE public.notification_logs
  ALTER COLUMN status SET DEFAULT 'QUEUED';

-- Update check constraint
ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS chk_notification_logs_status;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT chk_notification_logs_status
  CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'));

-- 5. Index for queue worker polling
CREATE INDEX IF NOT EXISTS idx_notification_logs_claim_queue
  ON public.notification_logs(next_attempt_at ASC, created_at ASC)
  WHERE status = 'QUEUED';

-- 6. Claim RPC: claim_queued_notifications using FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_queued_notifications(
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  booking_id UUID,
  recipient_phone TEXT,
  recipient_name TEXT,
  event_type TEXT,
  channel TEXT,
  status TEXT,
  template_name TEXT,
  template_params JSONB,
  attempts INT,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ,
  message_content TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Strict security check: service_role or postgres only
  IF auth.role() != 'service_role' AND SESSION_USER != 'postgres' AND CURRENT_USER != 'postgres' THEN
    RAISE EXCEPTION 'Access denied: claim_queued_notifications is service_role only'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  RETURN QUERY
  WITH claimed AS (
    SELECT nl.id
    FROM public.notification_logs nl
    WHERE nl.status = 'QUEUED'
      AND nl.channel = 'whatsapp'
      AND nl.next_attempt_at <= NOW()
    ORDER BY nl.next_attempt_at ASC, nl.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_logs nl
  SET status = 'SENDING',
      attempts = nl.attempts + 1
  FROM claimed
  WHERE nl.id = claimed.id
  RETURNING
    nl.id,
    nl.booking_id,
    nl.recipient_phone,
    nl.recipient_name,
    nl.event_type,
    nl.channel,
    nl.status,
    nl.template_name,
    nl.template_params,
    nl.attempts,
    nl.last_error,
    nl.next_attempt_at,
    nl.message_content,
    nl.created_at;
END;
$$;

-- Revoke from public, anon, authenticated; grant only to service_role
REVOKE ALL ON FUNCTION public.claim_queued_notifications(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_queued_notifications(INT) TO service_role;
