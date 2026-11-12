-- =============================================================================
-- Rollback for 20261103000004_phase3_queue_grace_and_payment_enum.sql
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.atomic_assign_checkin_arrival(UUID, TIMESTAMPTZ);

ALTER TABLE public.bookings
  DROP COLUMN IF EXISTS skipped_at;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS no_overlapping_active_bookings;

ALTER TABLE public.bookings
  ADD CONSTRAINT no_overlapping_active_bookings
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(slot_start, slot_end) WITH &&
  ) WHERE (status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION'));

COMMIT;

