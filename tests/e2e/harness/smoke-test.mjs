/**
 * tests/e2e/harness/smoke-test.mjs
 * 
 * Phase 0 Completion Gate:
 * Proves that two tenants can be created simultaneously, move their clocks independently
 * in Asia/Kolkata, maintain strict data isolation, and clean up completely without touching each other.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, cleanupTenant } from './tenant-factory.mjs';
import { getFrontDeskClient } from './client-helpers.mjs';
import fs from 'fs';

describe('Phase 0 Completion Gate: Multi-Tenant Factory & Test Clock Isolation Smoke Test', () => {
  it('creates two tenants concurrently, moves clocks independently, verifies isolation, and cleans up cleanly', async () => {
    console.log('[Smoke Test] Step 1: Concurrently creating Tenant SMOKE_A and SMOKE_B...');
    const [tenantA, tenantB] = await Promise.all([
      createTenant('SMOKE_A'),
      createTenant('SMOKE_B')
    ]);

    assert.ok(tenantA?.hospital?.id, 'Tenant A hospital created');
    assert.ok(tenantB?.hospital?.id, 'Tenant B hospital created');
    assert.notEqual(tenantA.hospital.id, tenantB.hospital.id, 'Tenants must have distinct provider IDs');

    assert.equal(tenantA.consultants.length, 5, 'Tenant A has 5 consultants');
    assert.equal(tenantB.consultants.length, 5, 'Tenant B has 5 consultants');
    assert.equal(tenantA.frontDesks.length, 3, 'Tenant A has 3 front desk members');
    assert.equal(tenantB.frontDesks.length, 3, 'Tenant B has 3 front desk members');

    console.log('[Smoke Test] Step 2: Testing independent virtual clock movement...');
    // Both initial clocks were set to 2026-10-20T09:00:00+05:30 (03:30:00Z)
    const timeAInitial = await tenantA.clock.get();
    const timeBInitial = await tenantB.clock.get();
    assert.equal(timeAInitial.toISOString(), '2026-10-20T03:30:00.000Z');
    assert.equal(timeBInitial.toISOString(), '2026-10-20T03:30:00.000Z');

    // Advance Tenant A clock by 120 minutes (to 11:00 AM IST / 05:30:00Z)
    await tenantA.clock.advance(120);

    const timeAAfter = await tenantA.clock.get();
    const timeBAfter = await tenantB.clock.get();

    assert.equal(timeAAfter.toISOString(), '2026-10-20T05:30:00.000Z', 'Tenant A clock moved forward by 2 hours');
    assert.equal(timeBAfter.toISOString(), '2026-10-20T03:30:00.000Z', 'Tenant B clock must remain completely unaffected');

    console.log('[Smoke Test] Step 3: Verifying cross-tenant data isolation...');
    // Create a booking in Tenant A (Dr. Sharma) and in Tenant B (Dr. Sharma)
    const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
    const url = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/)[1];
    const serviceKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/)[1];
    const serviceHeaders = {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    const slotStartA = '2026-10-20T05:30:00.000Z'; // 11:00 AM IST
    const slotEndA = '2026-10-20T05:40:00.000Z';

    const bResA = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: tenantA.hospital.id,
        resource_id: tenantA.consultants[0].id,
        customer_id: tenantA.patients[0].id,
        slot_start: slotStartA,
        slot_end: slotEndA,
        status: 'CONFIRMED',
        deposit_amount: 100,
        total_amount: 500,
        reference_code: 'SMOKE-BOOK-A',
        version: 1
      })
    });
    const bookingA = (await bResA.json())[0];
    assert.ok(bookingA?.id, 'Booking A inserted');

    const slotStartB = '2026-10-20T03:30:00.000Z'; // 09:00 AM IST
    const slotEndB = '2026-10-20T03:40:00.000Z';

    const bResB = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: tenantB.hospital.id,
        resource_id: tenantB.consultants[0].id,
        customer_id: tenantB.patients[0].id,
        slot_start: slotStartB,
        slot_end: slotEndB,
        status: 'CONFIRMED',
        deposit_amount: 100,
        total_amount: 500,
        reference_code: 'SMOKE-BOOK-B',
        version: 1
      })
    });
    const bookingB = (await bResB.json())[0];
    assert.ok(bookingB?.id, 'Booking B inserted');

    // Tenant A Front Desk queries bookings
    const fdA = getFrontDeskClient(tenantA, 0);
    const bookingsForFdA = await fdA.fetchBookings();
    assert.ok(Array.isArray(bookingsForFdA));
    assert.ok(bookingsForFdA.some(b => b.id === bookingA.id), 'FD A can see Tenant A booking');
    assert.ok(!bookingsForFdA.some(b => b.id === bookingB.id), 'FD A CANNOT see Tenant B booking');

    // Tenant B Front Desk queries bookings
    const fdB = getFrontDeskClient(tenantB, 0);
    const bookingsForFdB = await fdB.fetchBookings();
    assert.ok(Array.isArray(bookingsForFdB));
    assert.ok(bookingsForFdB.some(b => b.id === bookingB.id), 'FD B can see Tenant B booking');
    assert.ok(!bookingsForFdB.some(b => b.id === bookingA.id), 'FD B CANNOT see Tenant A booking');

    console.log('[Smoke Test] Step 4: Cleaning up both tenants completely...');
    await Promise.all([
      cleanupTenant('SMOKE_A'),
      cleanupTenant('SMOKE_B')
    ]);

    // Verify cleanup
    const checkProvRes = await fetch(`${url}/rest/v1/providers?name=like.[SMOKE_*`, { headers: serviceHeaders });
    const remainingProvs = await checkProvRes.json();
    assert.equal(remainingProvs.length, 0, 'Zero residual smoke providers');

    const checkBookRes = await fetch(`${url}/rest/v1/bookings?reference_code=like.SMOKE-BOOK-*`, { headers: serviceHeaders });
    const remainingBooks = await checkBookRes.json();
    assert.equal(remainingBooks.length, 0, 'Zero residual smoke bookings');

    console.log('[Smoke Test] Phase 0 Smoke Test Passed 100% cleanly!');
  });
});
