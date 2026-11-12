-- =============================================================================
-- pgTAP Test Suite 05: Cron Functions, Table RLS Lockdown & Rate Limiting
-- Verifies:
--   1. Cron & server maintenance functions denied for authenticated role (42501)
--   2. Cron & server maintenance functions callable by service_role
--   3. Explicit RLS deny-all policies on internal rate-limit table
--   4. Staff checkin lockout triggers after 5 failed attempts
--   5. verify_checkin_code rejects calls with RATE_LIMITED error when locked
-- =============================================================================

BEGIN;
SELECT plan(12);

-- -----------------------------------------------------------------------------
-- 1. Cron Functions Denied for Authenticated Role
-- -----------------------------------------------------------------------------
SELECT throws_ok(
  $$
  SET LOCAL ROLE authenticated;
  SELECT public.purge_expired_waitlist_entries();
  $$,
  '42501',
  NULL,
  'purge_expired_waitlist_entries denied for authenticated role (42501)'
);

SELECT throws_ok(
  $$
  SET LOCAL ROLE authenticated;
  SELECT public.purge_old_app_logs(30);
  $$,
  '42501',
  NULL,
  'purge_old_app_logs denied for authenticated role (42501)'
);

SELECT throws_ok(
  $$
  SET LOCAL ROLE authenticated;
  SELECT public.expire_stale_standby_queue(15, NULL);
  $$,
  '42501',
  NULL,
  'expire_stale_standby_queue denied for authenticated role (42501)'
);

SELECT throws_ok(
  $$
  SET LOCAL ROLE authenticated;
  SELECT public.release_expired_holds();
  $$,
  '42501',
  NULL,
  'release_expired_holds denied for authenticated role (42501)'
);

-- -----------------------------------------------------------------------------
-- 2. Cron Functions Callable by service_role
-- -----------------------------------------------------------------------------
SELECT lives_ok(
  $$
  SET LOCAL ROLE service_role;
  SELECT public.purge_expired_waitlist_entries();
  $$,
  'purge_expired_waitlist_entries callable by service_role'
);

SELECT lives_ok(
  $$
  SET LOCAL ROLE service_role;
  SELECT public.purge_old_app_logs(30);
  $$,
  'purge_old_app_logs callable by service_role'
);

SELECT lives_ok(
  $$
  SET LOCAL ROLE service_role;
  SELECT public.expire_stale_standby_queue(15, NULL);
  $$,
  'expire_stale_standby_queue callable by service_role'
);

SELECT lives_ok(
  $$
  SET LOCAL ROLE service_role;
  SELECT public.release_expired_holds();
  $$,
  'release_expired_holds callable by service_role'
);

-- -----------------------------------------------------------------------------
-- 3. RLS Lockdown on staff_checkin_rate_limits
-- -----------------------------------------------------------------------------
SELECT throws_ok(
  $$
  SET LOCAL ROLE authenticated;
  INSERT INTO public.staff_checkin_rate_limits (user_id, failed_attempts)
  VALUES ('00000000-0000-0000-0000-000000000000', 1);
  $$,
  '42501',
  NULL,
  'Direct insert into staff_checkin_rate_limits denied for authenticated role (42501)'
);

SELECT throws_ok(
  $$
  SET LOCAL ROLE anon;
  INSERT INTO public.staff_checkin_rate_limits (user_id, failed_attempts)
  VALUES ('00000000-0000-0000-0000-000000000000', 1);
  $$,
  '42501',
  NULL,
  'Direct insert into staff_checkin_rate_limits denied for anon role (42501)'
);

-- -----------------------------------------------------------------------------
-- 4. Rate Limiting: Lockout triggers after 5 failed attempts
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE test_rate_limit_result (
  user_id uuid,
  locked_until timestamptz,
  checkin_res jsonb
);

DO $$
DECLARE
  v_test_uid uuid;
  v_now timestamptz := now();
  v_locked_until timestamptz;
  v_res jsonb;
BEGIN
  SELECT id INTO v_test_uid FROM public.profiles LIMIT 1;
  DELETE FROM public.staff_checkin_rate_limits WHERE user_id = v_test_uid;

  -- Record 5 consecutive check-in failures
  FOR i IN 1..5 LOOP
    PERFORM public._record_checkin_failure(v_test_uid, v_now);
  END LOOP;

  SELECT locked_until INTO v_locked_until
  FROM public.staff_checkin_rate_limits
  WHERE user_id = v_test_uid;

  -- Call verify_checkin_code as this staff user
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_test_uid, 'role', 'authenticated')::text, true);
  v_res := public.verify_checkin_code((SELECT id FROM public.providers LIMIT 1), '1234');

  PERFORM set_config('role', 'postgres', true);
  INSERT INTO test_rate_limit_result VALUES (v_test_uid, v_locked_until, v_res);
END $$;

SELECT ok(
  locked_until IS NOT NULL AND locked_until > now(),
  '_record_checkin_failure locks user for 60 seconds after 5 failed attempts'
) FROM test_rate_limit_result;

SELECT is(
  checkin_res->>'error',
  'RATE_LIMITED',
  'verify_checkin_code rejects checkin with RATE_LIMITED error when locked'
) FROM test_rate_limit_result;

SELECT * FROM finish();
ROLLBACK;
