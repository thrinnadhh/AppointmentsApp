import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Hospital Tiered No-Show Policy & 7-Day Account Block', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let tokens = {};
  let neuroDocId;
  let testCustomerId;

  before(async () => {
    const envFile = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
    supabaseUrl = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=\"?([^\"\n]+)/)[1];
    serviceKey = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=\"?([^\"\n]+)/)[1];

    serviceHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
    hospA = manifest.hospitalA;

    async function login(email, password = 'HospitalTest2026!') {
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      return { token: data.access_token, user: data.user };
    }

    tokens.adminApex = await login('admin.apex@test-tirupati.local');
    tokens.patient = await login('test.patient.01@test-tirupati.local');
    testCustomerId = tokens.patient.user.id;

    // Fetch doctor resource
    const allDocs = await (
      await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}`, {
        headers: serviceHeaders,
      })
    ).json();
    neuroDocId = allDocs[0].id;

    // Reset test customer profile to clean state before test run
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${testCustomerId}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({
        no_show_count: 0,
        blocked_until: null,
        is_flagged: false,
      }),
    });
  });

  // Helper to create a test booking in CONFIRMED state with ₹100 deposit
  async function createTestBooking(offsetHours) {
    const start = new Date(Date.now() + offsetHours * 3600000);
    const end = new Date(start.getTime() + 15 * 60000);
    const refCode = `NS-TEST-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const res = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: hospA.id,
        resource_id: neuroDocId,
        customer_id: testCustomerId,
        slot_start: start.toISOString(),
        slot_end: end.toISOString(),
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100.00,
        total_amount: 500.00,
        reference_code: refCode,
      }),
    });
    const data = await res.json();
    return Array.isArray(data) ? data[0] : data;
  }

  it('1. Strike 1: First No-Show receives courtesy 100% refund without monetary penalty', async () => {
    const booking = await createTestBooking(1);
    assert.ok(booking?.id, 'Booking created');

    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/record_no_show`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${tokens.adminApex.token}`,
      },
      body: JSON.stringify({ p_booking_id: booking.id }),
    });

    const result = await rpcRes.json();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.no_show_count, 1, 'Strike count must be 1');
    assert.strictEqual(result.penalty_applied, false, 'No penalty on first strike');
    assert.strictEqual(Number(result.refund_amount), 100, 'Full ₹100 courtesy refund');
    assert.strictEqual(result.payment_status, 'REFUND_PENDING');

    // Verify profile state
    const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${testCustomerId}&select=no_show_count,blocked_until`, {
      headers: serviceHeaders,
    });
    const profData = await profRes.json();
    const prof = Array.isArray(profData) ? profData[0] : profData;
    assert.strictEqual(prof.no_show_count, 1);
    assert.strictEqual(prof.blocked_until, null);
  });

  it('2. Strike 2: Second No-Show receives courtesy 100% refund and increments strike count to 2', async () => {
    const booking = await createTestBooking(2);
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/record_no_show`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${tokens.adminApex.token}`,
      },
      body: JSON.stringify({ p_booking_id: booking.id }),
    });

    const result = await rpcRes.json();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.no_show_count, 2, 'Strike count must be 2');
    assert.strictEqual(result.penalty_applied, false, 'No penalty on second strike');
    assert.strictEqual(Number(result.refund_amount), 100, 'Full ₹100 courtesy refund');

    const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${testCustomerId}&select=no_show_count,blocked_until`, {
      headers: serviceHeaders,
    });
    const profData = await profRes.json();
    const prof = Array.isArray(profData) ? profData[0] : profData;
    assert.strictEqual(prof.no_show_count, 2, 'Customer now has 2 strikes triggering UI warning on next booking');
    assert.strictEqual(prof.blocked_until, null);
  });

  it('3. Strike 3: Third No-Show deducts ₹60 (₹50 to doctor, ₹10 platform fee) and refunds ₹40 remainder', async () => {
    // Read current provider penalty_balance
    const provBeforeRes = await fetch(`${supabaseUrl}/rest/v1/providers?id=eq.${hospA.id}&select=penalty_balance`, {
      headers: serviceHeaders,
    });
    const [provBefore] = await provBeforeRes.json();
    const balanceBefore = Number(provBefore?.penalty_balance || 0);

    const booking = await createTestBooking(3);
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/record_no_show`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${tokens.adminApex.token}`,
      },
      body: JSON.stringify({ p_booking_id: booking.id }),
    });

    const result = await rpcRes.json();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.no_show_count, 3, 'Strike count must be 3');
    assert.strictEqual(result.penalty_applied, true, 'Penalty MUST apply on strike 3');
    assert.strictEqual(Number(result.refund_amount), 40, 'Remainder refund must be deposit (₹100) - ₹60 = ₹40');
    assert.strictEqual(result.payment_status, 'REFUND_PENDING');

    // Verify merchant got ₹50
    const provAfterRes = await fetch(`${supabaseUrl}/rest/v1/providers?id=eq.${hospA.id}&select=penalty_balance`, {
      headers: serviceHeaders,
    });
    const [provAfter] = await provAfterRes.json();
    assert.strictEqual(Number(provAfter.penalty_balance), balanceBefore + 50, 'Doctor/Provider received ₹50 penalty credit');
  });

  it('4. Strikes 4 & 5: Continues tiered penalty without blocking account', async () => {
    for (let count = 4; count <= 5; count++) {
      const booking = await createTestBooking(count);
      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/record_no_show`, {
        method: 'POST',
        headers: {
          ...serviceHeaders,
          Authorization: `Bearer ${tokens.adminApex.token}`,
        },
        body: JSON.stringify({ p_booking_id: booking.id }),
      });
      const result = await rpcRes.json();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.no_show_count, count);
      assert.strictEqual(result.penalty_applied, true);
      assert.strictEqual(Number(result.refund_amount), 40);
    }

    const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${testCustomerId}&select=no_show_count,blocked_until`, {
      headers: serviceHeaders,
    });
    const profData = await profRes.json();
    const prof = Array.isArray(profData) ? profData[0] : profData;
    assert.strictEqual(prof.no_show_count, 5, 'Strike count is now 5');
    assert.strictEqual(prof.blocked_until, null, 'Account is not yet blocked at 5 strikes');
  });

  it('5. Strike 6 (> 5 strikes): Blocks account for 7 days, sets blocked_until, and resets strike counter to 0', async () => {
    const booking = await createTestBooking(6);
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/record_no_show`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${tokens.adminApex.token}`,
      },
      body: JSON.stringify({ p_booking_id: booking.id }),
    });

    const result = await rpcRes.json();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.is_blocked, true, 'User must be marked blocked on 6th no-show');
    assert.ok(result.blocked_until, 'Must return blocked_until timestamp');

    const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${testCustomerId}&select=no_show_count,blocked_until`, {
      headers: serviceHeaders,
    });
    const profData = await profRes.json();
    const prof = Array.isArray(profData) ? profData[0] : profData;
    assert.strictEqual(prof.no_show_count, 0, 'No-show strike counter must be RESET to 0 per spec');
    assert.ok(prof.blocked_until, 'Profile must have blocked_until set');

    const blockDate = new Date(prof.blocked_until).getTime();
    const now = Date.now();
    const diffDays = (blockDate - now) / (1000 * 3600 * 24);
    assert.ok(diffDays >= 6.9 && diffDays <= 7.1, `Blocked duration must be ~7 days (got ${diffDays.toFixed(2)} days)`);
  });

  it('6. Block Enforcement: Booking hold is rejected while account is blocked for 7 days', async () => {
    const start = new Date(Date.now() + 24 * 3600000);
    const end = new Date(start.getTime() + 15 * 60000);

    const holdRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${tokens.patient.token}`,
      },
      body: JSON.stringify({
        p_resource_id: neuroDocId,
        p_customer_id: testCustomerId,
        p_slot_start: start.toISOString(),
        p_slot_end: end.toISOString(),
      }),
    });

    const holdData = await holdRes.json();
    // Must fail or return error containing blocked
    const errorMsg = holdData.error || holdData.message || JSON.stringify(holdData);
    assert.ok(
      errorMsg.toLowerCase().includes('blocked for 7 days') ||
      errorMsg.toLowerCase().includes('account is blocked'),
      `Hold attempt must be rejected with account blocked message, got: ${errorMsg}`
    );
  });
});
