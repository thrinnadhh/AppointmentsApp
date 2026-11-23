-- Migration: 20261120000006_lockdown_maintenance_and_queue_rpcs.sql
-- Description: Revoke EXECUTE from PUBLIC, anon, and authenticated on internal maintenance
--              and queue procedures (SEC-WIN-020). Restrict to service_role only.
--              Explicitly preserves EXECUTE on dispatch_booking_notification for authenticated users.

-- 1. Purge old app logs: service_role only
REVOKE EXECUTE ON FUNCTION public.purge_old_app_logs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_app_logs(integer) TO service_role;

-- 2. Expire stale standby queue: service_role only (exact database signature: integer, uuid)
REVOKE EXECUTE ON FUNCTION public.expire_stale_standby_queue(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_standby_queue(integer, uuid) TO service_role;

-- 3. Mask old notification logs: service_role only
REVOKE EXECUTE ON FUNCTION public.mask_old_notification_logs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mask_old_notification_logs(integer) TO service_role;

-- 4. Enqueue refund request: service_role only (exact database signature: uuid, uuid, text)
REVOKE EXECUTE ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) TO service_role;
