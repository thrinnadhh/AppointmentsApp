-- Migration: 20261029000004_allow_null_booking_id_for_auth_notifications.sql
-- Description: Allow booking_id to be NULL in public.notification_logs to support
-- authentication events (such as AUTH_CODE) before a booking exists.

ALTER TABLE public.notification_logs
  ALTER COLUMN booking_id DROP NOT NULL;
