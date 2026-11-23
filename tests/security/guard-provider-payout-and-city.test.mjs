import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const MIGRATION_PATH = 'supabase/migrations/20261120000004_guard_provider_payout_and_city.sql';

function runSql(query) {
  const cmd = 'docker exec -i supabase_db_Appointments psql -U postgres -d postgres -t -A';
  return execSync(cmd, { input: query, encoding: 'utf-8', timeout: 10000 }).trim();
}

describe('SEC-WIN-017 & SEC-WIN-019 / Provider Governance & Payout Credential Guard Verification', () => {
  it('1. Migration file exists and defines protected column list', () => {
    assert.ok(existsSync(MIGRATION_PATH), `Migration must exist at ${MIGRATION_PATH}`);

    const migrationContent = readFileSync(MIGRATION_PATH, 'utf-8');

    assert.match(migrationContent, /NEW\.city IS DISTINCT FROM OLD\.city/);
    assert.match(migrationContent, /NEW\.cashfree_vendor_status IS DISTINCT FROM OLD\.cashfree_vendor_status/);
    assert.match(migrationContent, /NEW\.cashfree_vendor_id IS DISTINCT FROM OLD\.cashfree_vendor_id/);
    assert.match(migrationContent, /NEW\.bank_ifsc IS DISTINCT FROM OLD\.bank_ifsc/);
    assert.match(migrationContent, /NEW\.payout_upi_id IS DISTINCT FROM OLD\.payout_upi_id/);
  });

  it('2. Applying migration blocks tenant owner from modifying city & payout credentials', () => {
    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8');

    // Get an existing provider and owner id
    const provRow = runSql(`SELECT id || ':' || owner_id FROM public.providers WHERE owner_id IS NOT NULL LIMIT 1;`);
    const [provId, ownerId] = provRow.split(':');
    assert.ok(provId && ownerId, 'Must have a test provider');

    // Test each protected column in an isolated transaction
    const script = `
      BEGIN;
      ${migrationSql}

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
    assert.ok(!out.includes('UNEXPECTED_SUCCESS'), 'All protected updates were successfully blocked by trigger');
  });

  it('3. Legitimate writers (service_role, admin, app.trusted_write) can modify all fields', () => {
    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8');
    const provRow = runSql(`SELECT id FROM public.providers LIMIT 1;`);
    const provId = provRow.trim();

    const script = `
      BEGIN;
      ${migrationSql}

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
    assert.ok(!out.includes('ERROR'), 'Legitimate writers must not be blocked by trigger');
  });
});
