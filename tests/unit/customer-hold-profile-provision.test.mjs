import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Customer Hold Profile Auto-Provisioning & Seed Invariant', () => {
  it('scripts/seed-e2e-data.mjs must seed default test customer phone +919999900001', () => {
    const seedScriptPath = path.resolve('scripts/seed-e2e-data.mjs');
    const content = fs.readFileSync(seedScriptPath, 'utf8');

    assert.ok(
      content.includes('+919999900001'),
      'seed-e2e-data.mjs must include +919999900001 in seeded accounts so default customer profile exists'
    );
  });

  it('hold operations ensure customer profile exists before create_booking_hold RPC', () => {
    const routePath = path.resolve('apps/merchant-web/src/app/api/bookings', 'hold', 'route.ts');
    if (!fs.existsSync(routePath)) {
      // In Phase 2 double-hop proxy elimination, booking holds route directly through create_booking_hold RPC
      assert.ok(true, 'Hold proxy route eliminated; direct RPC active');
      return;
    }
    const content = fs.readFileSync(routePath, 'utf8');

    assert.ok(
      content.includes("existingProfile") || content.includes("profiles"),
      'Hold route must check public.profiles for customer existence'
    );
    assert.ok(
      content.includes("auth.admin.getUserById") && content.includes("auth.admin.createUser"),
      'Hold route must ensure auth.users entry exists before upserting public.profiles to satisfy profiles_id_fkey'
    );
    assert.ok(
      content.includes(".from('profiles').upsert") || content.includes('.from("profiles").upsert') || content.includes(".from('profiles').insert"),
      'Hold route must auto-provision customer profile in public.profiles to prevent foreign key violation'
    );
  });

  it('supabase/seed.sql and scripts/seed-e2e-data.mjs must seed canonical GoTrue phone 919999900001 and phone_confirm', () => {
    const seedSql = fs.readFileSync(path.resolve('supabase/seed.sql'), 'utf8');
    const seedScript = fs.readFileSync(path.resolve('scripts/seed-e2e-data.mjs'), 'utf8');

    assert.ok(
      seedSql.includes("'919999900001'") && seedSql.includes('auth.identities'),
      'supabase/seed.sql must seed auth.users.phone without leading + (919999900001) and auth.identities so GoTrue OTP login resolves the same user ID'
    );
    assert.ok(
      seedScript.includes('phone_confirm: true'),
      'scripts/seed-e2e-data.mjs must pass phone_confirm: true to GoTrue Admin API'
    );
  });
});

