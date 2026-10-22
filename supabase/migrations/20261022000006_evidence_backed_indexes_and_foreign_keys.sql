-- =============================================================================
-- Migration: 20261022000006_evidence_backed_indexes_and_foreign_keys.sql
-- Description: Fix 7 - Create proven performance indexes and 7 missing foreign key indexes.
--               Max 3 indexes added to bookings table:
--               1. idx_bookings_customer_slot (customer_id, slot_start DESC) [proven on 200k rows]
--               2. idx_bookings_checked_in_by (checked_in_by) [FK index]
--               3. idx_bookings_followup_orig (followup_original_booking_id) [FK index]
--               Plus 5 remaining foreign key indexes on non-bookings tables.
-- =============================================================================

-- 1. Bookings indexes (Strictly 3 new indexes on public.bookings)
CREATE INDEX IF NOT EXISTS idx_bookings_customer_slot
  ON public.bookings (customer_id, slot_start DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_checked_in_by
  ON public.bookings (checked_in_by)
  WHERE checked_in_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_followup_orig
  ON public.bookings (followup_original_booking_id)
  WHERE followup_original_booking_id IS NOT NULL;

-- 2. Foreign Key Indexes on other tables (5 tables)
CREATE INDEX IF NOT EXISTS idx_profiles_default_provider_id
  ON public.profiles (default_provider_id)
  WHERE default_provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_user_id
  ON public.account_deletion_requests (user_id);

CREATE INDEX IF NOT EXISTS idx_city_settlements_approved_by
  ON public.city_settlements (approved_by)
  WHERE approved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_department_members_invited_by
  ON public.department_members (invited_by)
  WHERE invited_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_test_provider_clock_links_tenant_prefix
  ON public.test_provider_clock_links (tenant_prefix);
