-- Migration: Align notification_logs status check constraint and claim_queued_notifications RPC
-- Ensures claim_queued_notifications sets status = 'SENDING' as required by worker contracts.

ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS chk_notification_logs_status;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT chk_notification_logs_status
  CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'FAILED_DLQ', 'RETRY'));

CREATE OR REPLACE FUNCTION public.claim_queued_notifications(p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, booking_id uuid, recipient_phone text, recipient_name text, event_type text, channel text, status text, template_name text, template_params jsonb, attempts integer, last_error text, next_attempt_at timestamp with time zone, message_content text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Strict security check: service_role or superuser without JWT only
  IF NOT (
    (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Access denied: claim_queued_notifications is service_role only'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  RETURN QUERY
  WITH claimed AS (
    SELECT nl.id
    FROM public.notification_logs nl
    WHERE nl.status IN ('QUEUED', 'RETRY')
      AND (nl.next_attempt_at IS NULL OR nl.next_attempt_at <= NOW())
      AND nl.attempts < 3
    ORDER BY nl.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_logs target
  SET status = 'SENDING',
      attempts = target.attempts + 1,
      next_attempt_at = NOW() + (POWER(2, target.attempts) || ' minutes')::interval
  FROM claimed
  WHERE target.id = claimed.id
  RETURNING
    target.id,
    target.booking_id,
    target.recipient_phone,
    target.recipient_name,
    target.event_type,
    target.channel,
    target.status,
    target.template_name,
    target.template_params,
    target.attempts,
    target.last_error,
    target.next_attempt_at,
    target.message_content,
    target.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_queued_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_queued_notifications(integer) TO service_role;
