-- Rollback migration for 20261104000001_reconcile_merged_stored_procedures.sql
-- Restores function definitions from 20261103000003 and 20261103000004 if rollback is required.

REVOKE EXECUTE ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, TEXT, TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.choose_emergency_option(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM authenticated;
DROP FUNCTION IF EXISTS public.cancel_doctor_emergency(UUID, TIMESTAMPTZ, TEXT, BOOLEAN);
