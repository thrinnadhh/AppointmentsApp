-- Migration: 20261122000001_restore_mask_notification_admin_grant.sql
-- Description: Grant execute on public.mask_old_notification_logs to authenticated
-- so that in-function public.is_admin(auth.uid()) authorization guard can execute for platform admins.

GRANT EXECUTE ON FUNCTION public.mask_old_notification_logs(integer) TO authenticated;
