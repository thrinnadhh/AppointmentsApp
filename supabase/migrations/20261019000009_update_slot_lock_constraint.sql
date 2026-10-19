-- =============================================================================
-- Migration: 20261019000009_update_slot_lock_constraint.sql
-- Description:
--   Update range exclusion constraint to reserve slots during IN_CONSULTATION.
-- =============================================================================

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS no_overlapping_active_bookings;

ALTER TABLE public.bookings 
  ADD CONSTRAINT no_overlapping_active_bookings 
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(slot_start, slot_end) WITH &&
  ) WHERE (status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION'));
