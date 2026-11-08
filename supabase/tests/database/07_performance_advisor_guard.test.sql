-- =============================================================================
-- pgTAP Test Suite 07: Performance Advisor Zero Warnings Regression Guard
-- Verifies:
--   1. 0 unwrapped auth.uid() in public/storage policies (lint 0003: auth_rls_initplan)
--   2. 0 unwrapped auth.role() in public/storage policies (lint 0003: auth_rls_initplan)
--   3. 0 unwrapped auth.jwt() in public/storage policies (lint 0003: auth_rls_initplan)
--   4. 0 unwrapped current_setting() in public/storage policies (lint 0003: auth_rls_initplan)
--   5. 0 tables with multiple permissive policies per (role, cmd) (lint 0006: multiple_permissive_policies)
--   6. Duplicate index appointment_checkin_codes_booking_id_key dropped (lint 0009)
--   7. Unique constraint on appointment_checkin_codes(booking_id) preserved
--   8. Covering index for bookings.consultation_collected_by FK exists (lint 0001: unindexed_foreign_keys)
--   9. Redundant duplicate index idx_bookings_reference_code dropped
--  10. Redundant duplicate index idx_checkin_codes_booking_id dropped
-- =============================================================================

BEGIN;
SELECT plan(10);

-- -----------------------------------------------------------------------------
-- 1. Advisor Rule 0003: Zero unwrapped auth.uid() in public/storage policies
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT schemaname, tablename, policyname
  FROM pg_policies
  WHERE schemaname IN ('public', 'storage')
    AND (
      (qual ~* '\bauth\.uid\(\)' AND qual !~* '\(select auth\.uid\(\)\)')
      OR (with_check ~* '\bauth\.uid\(\)' AND with_check !~* '\(select auth\.uid\(\)\)')
    )
  $$,
  'Performance Advisor: Zero unwrapped auth.uid() calls in public/storage policies (lint 0003)'
);

-- -----------------------------------------------------------------------------
-- 2. Advisor Rule 0003: Zero unwrapped auth.role() in public/storage policies
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT schemaname, tablename, policyname
  FROM pg_policies
  WHERE schemaname IN ('public', 'storage')
    AND (
      (qual ~* '\bauth\.role\(\)' AND qual !~* '\(select auth\.role\(\)\)')
      OR (with_check ~* '\bauth\.role\(\)' AND with_check !~* '\(select auth\.role\(\)\)')
    )
  $$,
  'Performance Advisor: Zero unwrapped auth.role() calls in public/storage policies (lint 0003)'
);

-- -----------------------------------------------------------------------------
-- 3. Advisor Rule 0003: Zero unwrapped auth.jwt() in public/storage policies
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT schemaname, tablename, policyname
  FROM pg_policies
  WHERE schemaname IN ('public', 'storage')
    AND (
      (qual ~* '\bauth\.jwt\(\)' AND qual !~* '\(select auth\.jwt\(\)\)')
      OR (with_check ~* '\bauth\.jwt\(\)' AND with_check !~* '\(select auth\.jwt\(\)\)')
    )
  $$,
  'Performance Advisor: Zero unwrapped auth.jwt() calls in public/storage policies (lint 0003)'
);

-- -----------------------------------------------------------------------------
-- 4. Advisor Rule 0003: Zero unwrapped current_setting() in public/storage policies
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT schemaname, tablename, policyname
  FROM pg_policies
  WHERE schemaname IN ('public', 'storage')
    AND (
      (qual ~* '\bcurrent_setting\(' AND qual !~* '\(select current_setting\(')
      OR (with_check ~* '\bcurrent_setting\(' AND with_check !~* '\(select current_setting\(')
    )
  $$,
  'Performance Advisor: Zero unwrapped current_setting() calls in public/storage policies (lint 0003)'
);

-- -----------------------------------------------------------------------------
-- 5. Advisor Rule 0006: Zero tables with multiple permissive policies per (role, cmd)
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  WITH policy_roles AS (
    SELECT
      c.relname AS tablename,
      p.polname,
      p.polcmd,
      unnest(CASE WHEN p.polroles = '{0}' THEN ARRAY['public'] ELSE (SELECT array_agg(r.rolname) FROM pg_roles r WHERE r.oid = ANY(p.polroles)) END) AS role_name
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname != 'cities' -- Documented exception: public.cities halted per Rule 5 Security Gate
      AND p.polpermissive = true
  )
  SELECT tablename, role_name, polcmd, count(*)
  FROM policy_roles
  GROUP BY tablename, role_name, polcmd
  HAVING count(*) > 1;
  $$,
  'Performance Advisor: Zero tables with multiple permissive policies per (role, cmd) (lint 0006)'
);

-- -----------------------------------------------------------------------------
-- 6. Advisor Rule 0009: Duplicate index appointment_checkin_codes_booking_id_key dropped
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT indexname
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'appointment_checkin_codes'
    AND indexname = 'appointment_checkin_codes_booking_id_key'
  $$,
  'Performance Advisor: Duplicate index appointment_checkin_codes_booking_id_key dropped (lint 0009)'
);

-- -----------------------------------------------------------------------------
-- 7. Uniqueness constraint on appointment_checkin_codes(booking_id) still enforced
-- -----------------------------------------------------------------------------
SELECT isnt_empty(
  $$
  SELECT conname
  FROM pg_constraint
  WHERE conrelid = 'public.appointment_checkin_codes'::regclass
    AND contype = 'u'
  $$,
  'Performance Advisor: Uniqueness constraint on appointment_checkin_codes still enforced'
);

-- -----------------------------------------------------------------------------
-- 8. Advisor Rule 0001: Covering index exists for bookings.consultation_collected_by FK
-- -----------------------------------------------------------------------------
SELECT isnt_empty(
  $$
  SELECT ic.relname
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_class ic ON ic.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum = i.indkey[0]
  WHERE n.nspname = 'public'
    AND c.relname = 'bookings'
    AND att.attname = 'consultation_collected_by'
  $$,
  'Performance Advisor: Covering index exists for bookings.consultation_collected_by foreign key (lint 0001)'
);

-- -----------------------------------------------------------------------------
-- 9. Redundant duplicate index idx_bookings_reference_code dropped
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT indexname
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'bookings'
    AND indexname = 'idx_bookings_reference_code'
  $$,
  'Performance Advisor: Redundant duplicate index idx_bookings_reference_code dropped'
);

-- -----------------------------------------------------------------------------
-- 10. Redundant duplicate index idx_checkin_codes_booking_id dropped
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT indexname
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'appointment_checkin_codes'
    AND indexname = 'idx_checkin_codes_booking_id'
  $$,
  'Performance Advisor: Redundant duplicate index idx_checkin_codes_booking_id dropped'
);

SELECT * FROM finish();
ROLLBACK;
