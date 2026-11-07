-- =============================================================================
-- pgTAP Test Suite 03: Triggers, Search Paths & Booking Versioning
-- Verifies:
--   1. Finding #0011: trg_push_tokens_updated_at has immutable search_path
--   2. Booking insert trigger auto-populates reference_code
--   3. Initial booking version is 1
--   4. Booking insert/status trigger generates check-in code in appointment_checkin_codes
--   5. Booking update trigger increments version from 1 to 2
--   6. Booking reference code remains stable after update
-- =============================================================================

BEGIN;
SELECT plan(6);

-- -----------------------------------------------------------------------------
-- 1. Finding #0011: trg_push_tokens_updated_at must have immutable search_path
-- -----------------------------------------------------------------------------
SELECT ok(
  proconfig IS NOT NULL AND array_to_string(proconfig, ',') LIKE '%search_path=%',
  'trg_push_tokens_updated_at function has explicit immutable search_path set'
) FROM pg_proc WHERE proname = 'trg_push_tokens_updated_at';

-- -----------------------------------------------------------------------------
-- 2. Setup test booking
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE test_booking_run (
  id uuid,
  reference_code text,
  version integer
);

WITH ins AS (
  INSERT INTO public.bookings (
    provider_id,
    resource_id,
    customer_id,
    slot_start,
    slot_end,
    status,
    deposit_amount
  ) VALUES (
    (SELECT id FROM public.providers WHERE status = 'ACTIVE' LIMIT 1),
    (SELECT id FROM public.resources WHERE provider_id = (SELECT id FROM public.providers WHERE status = 'ACTIVE' LIMIT 1) LIMIT 1),
    (SELECT id FROM public.profiles LIMIT 1),
    '2026-12-15 14:00:00+00',
    '2026-12-15 14:30:00+00',
    'CONFIRMED',
    100
  ) RETURNING id, reference_code, version
)
INSERT INTO test_booking_run SELECT id, reference_code, version FROM ins;

-- -----------------------------------------------------------------------------
-- 3. Assertions on inserted booking
-- -----------------------------------------------------------------------------
SELECT ok(
  reference_code IS NOT NULL AND length(reference_code) > 0,
  'trg_set_booking_reference_code populates non-empty reference_code on insert'
) FROM test_booking_run;

SELECT is(
  version,
  1,
  'Initial booking version starts at 1'
) FROM test_booking_run;

SELECT ok(
  c.code IS NOT NULL AND length(c.code) >= 4,
  'trg_generate_appointment_checkin_code generates valid check-in code'
)
FROM test_booking_run t
JOIN public.appointment_checkin_codes c ON c.booking_id = t.id;

-- -----------------------------------------------------------------------------
-- 4. Update booking and verify version increment
-- -----------------------------------------------------------------------------
SELECT set_config('app.trusted_write', 'true', true);

UPDATE public.bookings
SET booking_note = 'Updated by pgTAP test'
WHERE id = (SELECT id FROM test_booking_run);

SELECT is(
  b.version,
  2,
  'trg_increment_booking_version increments version from 1 to 2 upon update'
)
FROM public.bookings b
JOIN test_booking_run t ON t.id = b.id;

SELECT is(
  b.reference_code,
  t.reference_code,
  'Reference code remains unchanged after update'
)
FROM public.bookings b
JOIN test_booking_run t ON t.id = b.id;

SELECT * FROM finish();
ROLLBACK;
