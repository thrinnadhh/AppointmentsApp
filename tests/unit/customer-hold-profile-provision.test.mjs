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

  it('apps/merchant-web/src/app/api/bookings/hold/route.ts must ensure customer profile exists before create_booking_hold RPC', () => {
    const routePath = path.resolve('apps/merchant-web/src/app/api/bookings/hold/route.ts');
    const content = fs.readFileSync(routePath, 'utf8');

    assert.ok(
      content.includes("existingProfile") || content.includes("profiles"),
      'Hold route must check public.profiles for customer existence'
    );
    assert.ok(
      content.includes(".from('profiles').upsert") || content.includes('.from("profiles").upsert') || content.includes(".from('profiles').insert"),
      'Hold route must auto-provision customer profile in public.profiles to prevent foreign key violation'
    );
  });
});

