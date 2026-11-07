-- =============================================================================
-- pgTAP Test Suite 02: Extensions Isolation & Core Functional Capabilities
-- Verifies:
--   1. btree_gist, citext, and pg_trgm are installed in `extensions` schema
--   2. citext uniqueness is case-insensitive
--   3. pg_trgm fuzzy matching & operators operate across search_path
--   4. btree_gist exclusion constraint on bookings rejects overlapping intervals
-- =============================================================================

BEGIN;
SELECT plan(8);

-- -----------------------------------------------------------------------------
-- 1. Extension Schema Placement (Moved from public to extensions)
-- -----------------------------------------------------------------------------
SELECT is(
  extnamespace::regnamespace::text,
  'extensions',
  'Extension btree_gist is located in schema extensions (not public)'
) FROM pg_extension WHERE extname = 'btree_gist';

SELECT is(
  extnamespace::regnamespace::text,
  'extensions',
  'Extension citext is located in schema extensions (not public)'
) FROM pg_extension WHERE extname = 'citext';

SELECT is(
  extnamespace::regnamespace::text,
  'extensions',
  'Extension pg_trgm is located in schema extensions (not public)'
) FROM pg_extension WHERE extname = 'pg_trgm';

-- -----------------------------------------------------------------------------
-- 2. citext Case-Insensitive Uniqueness Test
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE test_citext_uniqueness (
  id serial PRIMARY KEY,
  email extensions.citext UNIQUE
);

INSERT INTO test_citext_uniqueness (email) VALUES ('Doctor.Jones@Example.com');

SELECT throws_ok(
  $$INSERT INTO test_citext_uniqueness (email) VALUES ('doctor.jones@example.com')$$,
  '23505',
  NULL,
  'citext uniqueness constraint rejects lowercase duplicate of mixed-case value'
);

-- -----------------------------------------------------------------------------
-- 3. pg_trgm Similarity & Operators Test
-- -----------------------------------------------------------------------------
SELECT ok(
  extensions.similarity('appointment', 'appointmnt') > 0.6,
  'pg_trgm similarity() calculates score > 0.6 for minor typo'
);

SELECT ok(
  extensions.word_similarity('hospital', 'City Life General Hospital Center') > 0.8,
  'pg_trgm word_similarity() matches term within multi-word string'
);

SELECT ok(
  'appointment' % 'appointmnt',
  'pg_trgm % operator evaluates successfully with extensions in search_path'
);

-- -----------------------------------------------------------------------------
-- 4. btree_gist Exclusion Constraint on bookings
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_provider_id uuid;
  v_resource_id uuid;
  v_customer_id uuid;
  v_start timestamptz := '2026-12-01 10:00:00+00';
  v_end timestamptz   := '2026-12-01 10:30:00+00';
BEGIN
  SELECT id INTO v_provider_id FROM public.providers WHERE status = 'ACTIVE' LIMIT 1;
  SELECT id INTO v_resource_id FROM public.resources WHERE provider_id = v_provider_id LIMIT 1;
  SELECT id INTO v_customer_id FROM public.profiles LIMIT 1;

  INSERT INTO public.bookings (
    provider_id,
    resource_id,
    customer_id,
    slot_start,
    slot_end,
    status,
    deposit_amount
  ) VALUES (
    v_provider_id,
    v_resource_id,
    v_customer_id,
    v_start,
    v_end,
    'CONFIRMED',
    100
  );
END $$;

SELECT throws_ok(
  $$
  INSERT INTO public.bookings (
    provider_id,
    resource_id,
    customer_id,
    slot_start,
    slot_end,
    status,
    deposit_amount
  ) VALUES (
    (SELECT provider_id FROM public.bookings WHERE slot_start = '2026-12-01 10:00:00+00' LIMIT 1),
    (SELECT resource_id FROM public.bookings WHERE slot_start = '2026-12-01 10:00:00+00' LIMIT 1),
    (SELECT id FROM public.profiles LIMIT 1),
    '2026-12-01 10:15:00+00',
    '2026-12-01 10:45:00+00',
    'CONFIRMED',
    100
  );
  $$,
  '23P01',
  NULL,
  'btree_gist exclusion constraint on bookings rejects overlapping active time slot'
);

SELECT * FROM finish();
ROLLBACK;
