-- =============================================================================
-- pgTAP Test Suite 06: Security Advisor Zero Warnings Regression Guard
-- Verifies:
--   1. 0 SECURITY DEFINER functions in exposed schema public executable by anon
--   2. 0 SECURITY DEFINER functions in exposed schema public executable by authenticated
--   3. 0 functions in public schema with mutable search_path
--   4. 0 extensions installed in public schema
--   5. 0 tables with RLS enabled and no policies
--   6. Schema private exists and is isolated from unauthorized public access
--   7. All 26 application functions in public are SECURITY INVOKER
--   8. All 26 backend functions in private are SECURITY DEFINER
-- =============================================================================

BEGIN;
SELECT plan(10);

-- -----------------------------------------------------------------------------
-- 1. Advisor Rule 0007: Zero anon-executable SECURITY DEFINER functions in public
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
  $$,
  'Security Advisor: Zero SECURITY DEFINER functions in public schema executable by anon (lint 0007)'
);

-- -----------------------------------------------------------------------------
-- 2. Advisor Rule 0008: Zero authenticated-executable SECURITY DEFINER functions in public
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  $$,
  'Security Advisor: Zero SECURITY DEFINER functions in public schema executable by authenticated (lint 0008)'
);

-- -----------------------------------------------------------------------------
-- 3. Advisor Rule 0011: Zero functions with mutable search_path in public
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.proconfig IS NULL OR NOT array_to_string(p.proconfig, ',') LIKE '%search_path%')
  $$,
  'Security Advisor: Zero functions in public schema have mutable role search_path (lint 0011)'
);

-- -----------------------------------------------------------------------------
-- 4. Advisor Rule 0014: Zero extensions in public schema
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT e.extname
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE n.nspname = 'public'
  $$,
  'Security Advisor: Zero extensions installed in public schema (lint 0014)'
);

-- -----------------------------------------------------------------------------
-- 5. Advisor Rule 0001: Zero tables with RLS enabled without explicit policies
-- -----------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = true
    AND NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = c.oid)
  $$,
  'Security Advisor: Zero tables with RLS enabled without explicit policies (lint 0001)'
);

-- -----------------------------------------------------------------------------
-- 6. Schema private isolation
-- -----------------------------------------------------------------------------
SELECT has_schema('private', 'Schema private exists for Pattern B architecture');

SELECT ok(
  NOT has_schema_privilege('public', 'private', 'create'),
  'Public role cannot create objects in private schema'
);

-- -----------------------------------------------------------------------------
-- 7. Direct execution protection on private authenticated functions
-- -----------------------------------------------------------------------------
SELECT throws_ok(
  $$
  SET LOCAL ROLE anon;
  SELECT * FROM private.get_masked_customer_info('00000000-0000-0000-0000-000000000000'::uuid);
  $$,
  '42501',
  NULL,
  'anon role cannot directly execute private authenticated functions (throws 42501)'
);

-- -----------------------------------------------------------------------------
-- 8. Core Application Functions: 26 in public are SECURITY INVOKER
-- -----------------------------------------------------------------------------
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'get_active_cities', 'get_nearby_providers', 'log_client_event', 'submit_city_waitlist',
        'cancel_booking', 'cancel_doctor_emergency', 'check_cooling_period_eligibility',
        'complete_booking', 'create_booking_hold', 'get_masked_customer_info',
        'get_user_authorized_providers', 'hospital_accessible_resource_ids', 'hospital_role',
        'is_admin', 'is_hospital_provider', 'is_merchant_owner_or_admin', 'mark_customer_reached',
        'mark_present_manually', 'override_hospital_queue_position', 'reassign_booking_resource',
        'request_account_deletion', 'reschedule_booking_slot', 'reveal_customer_contact',
        'search_directory', 'sync_customer_profile', 'verify_checkin_code'
      )
      AND p.prosecdef = false
  ),
  26,
  'All 26 audited public application functions are SECURITY INVOKER (prosecdef = false)'
);

-- -----------------------------------------------------------------------------
-- 9. Underlying Implementations: 26 in private are SECURITY DEFINER
-- -----------------------------------------------------------------------------
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN (
        'get_active_cities', 'get_nearby_providers', 'log_client_event', 'submit_city_waitlist',
        'cancel_booking', 'cancel_doctor_emergency', 'check_cooling_period_eligibility',
        'complete_booking', 'create_booking_hold', 'get_masked_customer_info',
        'get_user_authorized_providers', 'hospital_accessible_resource_ids', 'hospital_role',
        'is_admin', 'is_hospital_provider', 'is_merchant_owner_or_admin', 'mark_customer_reached',
        'mark_present_manually', 'override_hospital_queue_position', 'reassign_booking_resource',
        'request_account_deletion', 'reschedule_booking_slot', 'reveal_customer_contact',
        'search_directory', 'sync_customer_profile', 'verify_checkin_code'
      )
      AND p.prosecdef = true
  ),
  26,
  'All 26 underlying implementations in private schema are SECURITY DEFINER (prosecdef = true)'
);

SELECT * FROM finish();
ROLLBACK;

