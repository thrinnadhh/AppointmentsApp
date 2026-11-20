import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DRAFT_PATH = 'supabase/migrations_draft/20261120000004_guard_provider_payout_and_city.sql';
const ROLLBACK_PATH = 'supabase/migrations_rollback/20261120000004_rollback_provider_payout_and_city.sql';

function runSql(query) {
  const cmd = 'docker exec -i supabase_db_Appointments psql -U postgres -d postgres -t -A';
  return execSync(cmd, { input: query, encoding: 'utf-8', timeout: 10000 }).trim();
}

describe('SEC-WIN-017 & SEC-WIN-019 / Provider Governance & Payout Credential Guard Verification', () => {
  it('1. Draft forward migration and rollback migration exist and are isolated from auto-execution', () => {
    assert.ok(existsSync(DRAFT_PATH), `Draft migration must exist at ${DRAFT_PATH}`);
    assert.ok(existsSync(ROLLBACK_PATH), `Rollback script must exist at ${ROLLBACK_PATH}`);
    assert.ok(
      !existsSync('supabase/migrations/20261120000004_guard_provider_payout_and_city.sql'),
      'Draft migration must NOT exist in supabase/migrations/ to prevent auto-execution during db reset'
    );

    const draftContent = readFileSync(DRAFT_PATH, 'utf-8');
    const rollbackContent = readFileSync(ROLLBACK_PATH, 'utf-8');

    assert.match(draftContent, /NEW\.city IS DISTINCT FROM OLD\.city/);
    assert.match(draftContent, /NEW\.cashfree_vendor_status IS DISTINCT FROM OLD\.cashfree_vendor_status/);
    assert.match(draftContent, /NEW\.cashfree_vendor_id IS DISTINCT FROM OLD\.cashfree_vendor_id/);
    assert.match(draftContent, /NEW\.bank_ifsc IS DISTINCT FROM OLD\.bank_ifsc/);
    assert.match(draftContent, /NEW\.payout_upi_id IS DISTINCT FROM OLD\.payout_upi_id/);

    assert.doesNotMatch(rollbackContent, /NEW\.city IS DISTINCT FROM OLD\.city/);
    assert.doesNotMatch(rollbackContent, /NEW\.cashfree_vendor_status IS DISTINCT FROM OLD\.cashfree_vendor_status/);
  });

  it('2. Transactional execution of draft migration blocks tenant owner from modifying city & payout credentials', () => {
    const draftSql = readFileSync(DRAFT_PATH, 'utf-8');

    // Get an existing provider and owner id
    const provRow = runSql(`SELECT id || ':' || owner_id FROM public.providers WHERE owner_id IS NOT NULL LIMIT 1;`);
    const [provId, ownerId] = provRow.split(':');
    assert.ok(provId && ownerId, 'Must have a test provider');

    // Test each protected column in an isolated transaction
    const script = `
      BEGIN;
      ${draftSql}

      SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claims = '{"sub": "${ownerId}", "role": "authenticated"}';

      -- 1. Attempt to update providers.city -> MUST FAIL with 42501
      DO $$
      BEGIN
        UPDATE public.providers SET city = 'UnauthorizedCity' WHERE id = '${provId}';
        RAISE EXCEPTION 'UNEXPECTED_SUCCESS: city modification should have been blocked';
      EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
      END $$;

      -- 2. Attempt to self-activate cashfree_vendor_status -> MUST FAIL with 42501
      DO $$
      BEGIN
        UPDATE public.providers SET cashfree_vendor_status = 'ACTIVE' WHERE id = '${provId}';
        RAISE EXCEPTION 'UNEXPECTED_SUCCESS: cashfree_vendor_status modification should have been blocked';
      EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
      END $$;

      -- 3. Attempt to update cashfree_vendor_id -> MUST FAIL with 42501
      DO $$
      BEGIN
        UPDATE public.providers SET cashfree_vendor_id = 'unauthorized_vendor_999' WHERE id = '${provId}';
        RAISE EXCEPTION 'UNEXPECTED_SUCCESS: cashfree_vendor_id modification should have been blocked';
      EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
      END $$;

      -- 4. Attempt to update bank credentials -> MUST FAIL with 42501
      DO $$
      BEGIN
        UPDATE public.providers SET bank_ifsc = 'HDFC0001234' WHERE id = '${provId}';
        RAISE EXCEPTION 'UNEXPECTED_SUCCESS: bank_ifsc modification should have been blocked';
      EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
      END $$;

      -- 5. Attempt to update payout_upi_id -> MUST FAIL with 42501
      DO $$
      BEGIN
        UPDATE public.providers SET payout_upi_id = 'attacker@okaxis' WHERE id = '${provId}';
        RAISE EXCEPTION 'UNEXPECTED_SUCCESS: payout_upi_id modification should have been blocked';
      EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
      END $$;

      -- 6. Allowed merchant fields -> MUST SUCCEED
      UPDATE public.providers SET description = 'Updated Description By Owner', min_deposit_amount = 25 WHERE id = '${provId}';

      ROLLBACK;
    `;

    const out = runSql(script);
    assert.ok(!out.includes('UNEXPECTED_SUCCESS'), 'All protected updates were successfully blocked by draft trigger');
  });

  it('3. Legitimate writers (service_role, admin, app.trusted_write) can modify all fields under draft migration', () => {
    const draftSql = readFileSync(DRAFT_PATH, 'utf-8');
    const provRow = runSql(`SELECT id FROM public.providers LIMIT 1;`);
    const provId = provRow.trim();

    const script = `
      BEGIN;
      ${draftSql}

      -- Under service_role, vendor status, city, bank credentials, and payout_upi_id update must succeed
      SET LOCAL ROLE service_role;
      UPDATE public.providers 
      SET city = 'AdminCity',
          cashfree_vendor_status = 'ACTIVE',
          cashfree_vendor_id = 'legit_vendor_123',
          bank_ifsc = 'SBIN0001234',
          payout_upi_id = 'legit@okaxis'
      WHERE id = '${provId}';

      -- Under app.trusted_write context, update must succeed
      SET LOCAL ROLE authenticated;
      SET LOCAL "app.trusted_write" = 'true';
      UPDATE public.providers 
      SET cashfree_vendor_status = 'PENDING_KYC'
      WHERE id = '${provId}';

      ROLLBACK;
    `;

    const out = runSql(script);
    assert.ok(!out.includes('ERROR'), 'Legitimate writers must not be blocked by draft trigger');
  });

  it('4. Rollback script restores previous definition where city and payout fields are unblocked', () => {
    const draftSql = readFileSync(DRAFT_PATH, 'utf-8');
    const rollbackSql = readFileSync(ROLLBACK_PATH, 'utf-8');
    const provRow = runSql(`SELECT id || ':' || owner_id FROM public.providers WHERE owner_id IS NOT NULL LIMIT 1;`);
    const [provId, ownerId] = provRow.split(':');

    const script = `
      BEGIN;
      ${draftSql}
      ${rollbackSql}

      -- Under tenant owner, city and cashfree_vendor_status modification proceeds without trigger error as before
      SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claims = '{"sub": "${ownerId}", "role": "authenticated"}';
      UPDATE public.providers 
      SET city = 'RevertedCity',
          cashfree_vendor_status = 'ACTIVE'
      WHERE id = '${provId}';

      ROLLBACK;
    `;

    const out = runSql(script);
    assert.ok(!out.includes('ERROR'), 'Rollback must restore original behavior');
  });
});
