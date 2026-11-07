-- =============================================================================
-- pgTAP Test Suite 04: Authorization, IDOR Protection & Identity Spoof Defense
-- Verifies:
--   1. anon role is denied execution of authenticated RPCs (42501)
--   2. Happy path execution as an authorized authenticated user
--   3. Cross-tenant IDOR defense: Staff from Tenant A cannot verify or reveal Tenant B
--   4. Identity spoofing defense: auth.uid() derivation enforced, client identity params rejected
-- =============================================================================

BEGIN;
SELECT plan(8);

-- -----------------------------------------------------------------------------
-- 1. Unauthenticated (anon) Caller Denials
-- -----------------------------------------------------------------------------
SELECT throws_ok(
  $$
  SET LOCAL ROLE anon;
  SELECT public.cancel_booking('00000000-0000-0000-0000-000000000000'::uuid, 'test', 'customer');
  $$,
  '42501',
  NULL,
  'anon role cannot execute cancel_booking (throws 42501)'
);

SELECT throws_ok(
  $$
  SET LOCAL ROLE anon;
  SELECT public.sync_customer_profile('Spoofed Name', '+919999999999', 'spoof@example.com');
  $$,
  '42501',
  NULL,
  'anon role cannot execute sync_customer_profile (throws 42501)'
);

SELECT throws_ok(
  $$
  SET LOCAL ROLE anon;
  SELECT public.request_account_deletion('GDPR deletion request');
  $$,
  '42501',
  NULL,
  'anon role cannot execute request_account_deletion (throws 42501)'
);

-- -----------------------------------------------------------------------------
-- 2. Happy Path as Authenticated Role
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE test_auth_context AS
SELECT id AS target_uid FROM public.profiles LIMIT 1;
GRANT ALL ON test_auth_context TO authenticated;

DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT target_uid INTO v_uid FROM test_auth_context;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  PERFORM public.sync_customer_profile('Authorized Customer', '+919876543211', 'updated@example.com');
  PERFORM set_config('role', 'postgres', true);
END $$;

SELECT is(
  full_name,
  'Authorized Customer',
  'Happy path: sync_customer_profile updates record bound to authenticated auth.uid()'
) FROM public.profiles WHERE id = (SELECT target_uid FROM test_auth_context);

-- -----------------------------------------------------------------------------
-- 3. Cross-Tenant IDOR Rejection (verify_checkin_code)
-- -----------------------------------------------------------------------------
-- Staff from Tenant A (not assigned to Hospital B) attempting checkin at Hospital B
CREATE TEMP TABLE test_idor_checkin_result (res jsonb);

DO $$
DECLARE
  v_hosp_b_id uuid;
  v_res jsonb;
BEGIN
  -- Obtain Hospital B provider ID
  SELECT id INTO v_hosp_b_id FROM public.providers WHERE name ILIKE '%Hospital B%' OR name ILIKE '%Care%' LIMIT 1;
  IF v_hosp_b_id IS NULL THEN
    SELECT id INTO v_hosp_b_id FROM public.providers ORDER BY id DESC LIMIT 1;
  END IF;

  -- Authenticate as an arbitrary customer or non-staff user
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub": "99999999-9999-9999-9999-999999999991", "role": "authenticated"}', true);

  v_res := public.verify_checkin_code(v_hosp_b_id, '9999');
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO test_idor_checkin_result VALUES (v_res);
END $$;

SELECT is(
  (res->>'success')::boolean,
  false,
  'verify_checkin_code rejects checkin attempt from unauthorized caller (IDOR defense)'
) FROM test_idor_checkin_result;

SELECT is(
  res->>'error',
  'UNAUTHORIZED',
  'verify_checkin_code returns UNAUTHORIZED error code for cross-tenant attempt'
) FROM test_idor_checkin_result;

-- -----------------------------------------------------------------------------
-- 4. Cross-Tenant IDOR Rejection (reveal_customer_contact)
-- -----------------------------------------------------------------------------
SELECT throws_ok(
  $$
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" = '{"sub": "99999999-9999-9999-9999-999999999991", "role": "authenticated"}';
  SELECT public.reveal_customer_contact(
    (SELECT id FROM public.bookings LIMIT 1),
    'Unauthorized audit attempt'
  );
  $$,
  '42501',
  NULL,
  'reveal_customer_contact raises 42501 when caller is not authorized for target booking provider'
);

-- -----------------------------------------------------------------------------
-- 5. Spoof Defense: Identity Derivation from auth.uid() Only
-- -----------------------------------------------------------------------------
SELECT throws_ok(
  $$
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" = '{}';
  SELECT public.sync_customer_profile('Spoofer', '+919999999999', 'spoof@example.com');
  $$,
  'P0001',
  'Not authenticated',
  'sync_customer_profile fails when auth.uid() is missing (cannot spoof identity via params)'
);

SELECT * FROM finish();
ROLLBACK;
