-- Migration: 20261107000011_perf_indexes.sql
-- Description: Fix Supabase Performance Advisor lint 0001 (unindexed_foreign_keys)
-- and lint 0009 (duplicate_index).
--
-- 1. Unindexed Foreign Key:
--    Add covering index on public.bookings(consultation_collected_by), which references
--    auth.users(id) via bookings_consultation_collected_by_fkey.
--    NOTE FOR PRODUCTION: On a live production database with heavy traffic, execute as
--    `CREATE INDEX CONCURRENTLY idx_bookings_consultation_collected_by ON public.bookings(consultation_collected_by);`
--
-- 2. Duplicate Indexes / Constraints:
--    - Drop redundant constraint `appointment_checkin_codes_booking_id_key` on public.appointment_checkin_codes,
--      preserving `unique_booking_checkin_code UNIQUE (booking_id)`.
--    - Drop redundant non-unique index `idx_checkin_codes_booking_id` on public.appointment_checkin_codes(booking_id).
--    - Drop redundant non-unique index `idx_bookings_reference_code` on public.bookings(reference_code),
--      preserving unique constraint `bookings_reference_code_key UNIQUE (reference_code)`.
--
-- Rollback SQL is documented at the bottom of this file.

BEGIN;

-- =============================================================================
-- 1. Unindexed Foreign Key (bookings.consultation_collected_by)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_bookings_consultation_collected_by
  ON public.bookings (consultation_collected_by);

-- =============================================================================
-- 2. Duplicate Indexes & Constraints
-- =============================================================================

-- Drop redundant unique constraint on appointment_checkin_codes
ALTER TABLE public.appointment_checkin_codes
  DROP CONSTRAINT IF EXISTS appointment_checkin_codes_booking_id_key;

-- Drop redundant non-unique btree index on appointment_checkin_codes(booking_id)
DROP INDEX IF EXISTS public.idx_checkin_codes_booking_id;

-- Drop redundant non-unique btree index on bookings(reference_code)
DROP INDEX IF EXISTS public.idx_bookings_reference_code;

COMMIT;

-- =============================================================================
-- ROLLBACK INSTRUCTIONS
-- =============================================================================
-- To roll back these index changes:
--
-- DROP INDEX IF EXISTS public.idx_bookings_consultation_collected_by;
-- ALTER TABLE public.appointment_checkin_codes ADD CONSTRAINT appointment_checkin_codes_booking_id_key UNIQUE (booking_id);
-- CREATE INDEX IF NOT EXISTS idx_checkin_codes_booking_id ON public.appointment_checkin_codes (booking_id);
-- CREATE INDEX IF NOT EXISTS idx_bookings_reference_code ON public.bookings (reference_code);
