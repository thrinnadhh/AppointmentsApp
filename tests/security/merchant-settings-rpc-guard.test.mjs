import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const RPC_PATH = 'supabase/migrations/20261120000005_ignore_client_cashfree_settings.sql';

function runSql(query) {
  const cmd = 'docker exec -i supabase_db_Appointments psql -U postgres -d postgres -t -A';
  return execSync(cmd, { input: query, encoding: 'utf-8', timeout: 10000 }).trim();
}

describe('SEC-WIN-019 / merchant_save_operational_settings & Provider Governance RPC Guard', () => {
  it('1. Migration file exists and defines ignored cashfree parameters', () => {
    assert.ok(existsSync(RPC_PATH), `RPC migration must exist at ${RPC_PATH}`);
    const rpcContent = readFileSync(RPC_PATH, 'utf-8');
    assert.match(rpcContent, /p_cashfree_app_id/);
    assert.match(rpcContent, /p_cashfree_vendor_id/);
    assert.doesNotMatch(rpcContent, /cashfree_app_id\s*=\s*COALESCE/);
    assert.doesNotMatch(rpcContent, /cashfree_vendor_id\s*=\s*COALESCE/);
  });

  it('2. Tenant owner calling merchant_save_operational_settings has cashfree_* ignored while payout_upi_id is updated', () => {
    const rpcSql = readFileSync(RPC_PATH, 'utf-8');

    const provRow = runSql(`SELECT id || ':' || owner_id FROM public.providers WHERE owner_id IS NOT NULL LIMIT 1;`);
    const [provId, ownerId] = provRow.split(':');
    assert.ok(provId && ownerId, 'Must have a test provider with owner_id');

    const script = `
      BEGIN;
      ${rpcSql}

      -- Set legitimate initial state for the provider as trusted writer
      SET LOCAL "app.trusted_write" = 'true';
      UPDATE public.providers
      SET cashfree_vendor_id = 'initial_vendor_111',
          cashfree_app_id = 'initial_app_111',
          payout_upi_id = 'initial@upi'
      WHERE id = '${provId}';
      SET LOCAL "app.trusted_write" = 'false';

      -- Act as authenticated tenant owner
      SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claims = '{"sub": "${ownerId}", "role": "authenticated"}';

      -- Call RPC attempting to overwrite cashfree gateway credentials while setting allowed payout_upi_id
      SELECT public.merchant_save_operational_settings(
        p_provider_id := '${provId}'::uuid,
        p_payout_upi_id := 'legit_updated@oksbi',
        p_cashfree_app_id := 'SPOOFED_APP_999',
        p_cashfree_vendor_id := 'SPOOFED_VENDOR_999'
      );

      -- Verify stored values in providers table
      SELECT cashfree_vendor_id || '|' || cashfree_app_id || '|' || payout_upi_id
      FROM public.providers WHERE id = '${provId}';

      ROLLBACK;
    `;

    const out = runSql(script);
    assert.ok(!out.includes('ERROR'), `Execution failed: ${out}`);

    // Stored cashfree_vendor_id and cashfree_app_id must remain initial, NOT spoofed.
    // payout_upi_id must be updated.
    assert.ok(out.includes('initial_vendor_111'), `cashfree_vendor_id should keep stored value: got ${out}`);
    assert.ok(out.includes('initial_app_111'), `cashfree_app_id should keep stored value: got ${out}`);
    assert.ok(out.includes('legit_updated@oksbi'), `payout_upi_id should be updated: got ${out}`);
    assert.ok(!out.includes('SPOOFED_VENDOR_999'), 'Spoofed vendor ID must NOT be stored');
    assert.ok(!out.includes('SPOOFED_APP_999'), 'Spoofed app ID must NOT be stored');
  });

  it('3. Direct UPDATE by tenant owner is blocked by guard_provider_governance trigger (42501)', () => {
    const provRow = runSql(`SELECT id || ':' || owner_id FROM public.providers WHERE owner_id IS NOT NULL LIMIT 1;`);
    const [provId, ownerId] = provRow.split(':');

    const script = `
      BEGIN;

      SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claims = '{"sub": "${ownerId}", "role": "authenticated"}';

      DO $$
      BEGIN
        UPDATE public.providers SET cashfree_vendor_id = 'direct_hack_vendor' WHERE id = '${provId}';
        RAISE EXCEPTION 'UNEXPECTED_SUCCESS: direct UPDATE should be rejected';
      EXCEPTION WHEN SQLSTATE '42501' THEN
        -- Expected: 42501 raised
        NULL;
      END $$;

      ROLLBACK;
    `;

    const out = runSql(script);
    assert.ok(!out.includes('UNEXPECTED_SUCCESS'), 'Direct UPDATE must be blocked with 42501');
  });
});
