import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Subtask 6: Concurrency Safety & Race Tests (50/50 runs)', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let tokens = {};
  let neuroDocId;
  let neuroDeptId;

  const appBaseUrl = 'http://localhost:3000';

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
    neuroDeptId = hospA.departments.find((d) => d.name === 'Neurology').id;

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
    tokens.neuroDoc = await login('neuro.doc@test-tirupati.local');
    tokens.neuroDesk = await login('neuro.desk@test-tirupati.local');
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');
    tokens.patient2 = await login('test.patient.02@test-tirupati.local');

    // Resolve doctor resource
    const allDocs = await (
      await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}`, {
        headers: serviceHeaders,
      })
    ).json();

    const neuroDoc = allDocs.find((d) => d.user_id === tokens.neuroDoc.user.id) || allDocs[0];
    neuroDocId = neuroDoc.id;

    // Ensure doctor front desk assignment for neuroDesk -> neuroDoc
    await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: neuroDocId,
        user_id: tokens.neuroDesk.user.id,
        is_active: true,
      }),
    });
  });

  let slotCounter = 0;
  const baseEpoch = Date.now() + (1000 + Math.floor(Math.random() * 10000)) * 86400 * 1000;

  async function createTestBooking(status = 'CONFIRMED', is_present = false, queue_pos = null) {
    slotCounter++;
    const tStart = new Date(baseEpoch + slotCounter * 3600 * 1000);
    const tEnd = new Date(tStart.getTime() + 15 * 60 * 1000);

    const res = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient1.user.id,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        department_id: neuroDeptId,
        slot_start: tStart.toISOString(),
        slot_end: tEnd.toISOString(),
        status,
        is_present,
        queue_position: queue_pos,
        reference_code: `TEST-RACE-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        deposit_amount: 100,
        total_amount: 500,
        payment_status: 'CAPTURED',
      }),
    });
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) {
      throw new Error(`createTestBooking failed (${res.status}): ${JSON.stringify(data)}`);
    }
    return data[0];
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1: Double Check-in Concurrency (50/50 runs)
  // ───────────────────────────────────────────────────────────────────────────
  it('Race 1: Double check-in - exactly 1 caller succeeds, zero double-processing (50/50 runs)', async () => {
    let successCount = 0;

    for (let i = 0; i < 50; i++) {
      const bkg = await createTestBooking('CONFIRMED', false);

      // Concurrent admit calls from neuroDesk & adminApex
      const [res1, res2] = await Promise.all([
        fetch(`${appBaseUrl}/api/bookings/admit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.neuroDesk.token}`,
          },
          body: JSON.stringify({ booking_id: bkg.id }),
        }),
        fetch(`${appBaseUrl}/api/bookings/admit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.adminApex.token}`,
          },
          body: JSON.stringify({ booking_id: bkg.id }),
        }),
      ]);

      const data1 = await res1.json();
      const data2 = await res2.json();

      const success1 = res1.status === 200 && data1.success && !data1.already_present;
      const success2 = res2.status === 200 && data2.success && !data2.already_present;

      // Exactly one should perform the checkin; the other gets already_present or 409
      const winnerCount = (success1 ? 1 : 0) + (success2 ? 1 : 0);
      assert.equal(winnerCount, 1, `Run ${i + 1}: Expected exactly 1 winner, got ${winnerCount}`);

      // Verify DB state is single valid CHECKED_IN
      const dbRes = await (
        await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bkg.id}`, { headers: serviceHeaders })
      ).json();
      assert.equal(dbRes[0].status, 'CHECKED_IN');
      assert.equal(dbRes[0].is_present, true);

      successCount++;
    }

    assert.equal(successCount, 50, 'All 50 double check-in race runs must pass');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: Single In Consultation Partial Unique Index (50/50 runs)
  // ───────────────────────────────────────────────────────────────────────────
  it('Race 2: Consultant cannot have two In Consultation bookings concurrently (50/50 runs)', async () => {
    let successCount = 0;

    for (let i = 0; i < 50; i++) {
      // Ensure no dangling IN_CONSULTATION for this doctor
      await fetch(
        `${supabaseUrl}/rest/v1/bookings?resource_id=eq.${neuroDocId}&status=eq.IN_CONSULTATION`,
        {
          method: 'PATCH',
          headers: serviceHeaders,
          body: JSON.stringify({ status: 'COMPLETED' }),
        }
      );

      const bkgA = await createTestBooking('CHECKED_IN', true);
      const bkgB = await createTestBooking('CHECKED_IN', true);

      // Concurrent start calls for bkgA and bkgB
      const [resA, resB] = await Promise.all([
        fetch(`${appBaseUrl}/api/bookings/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.neuroDesk.token}`,
          },
          body: JSON.stringify({ booking_id: bkgA.id }),
        }),
        fetch(`${appBaseUrl}/api/bookings/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.neuroDesk.token}`,
          },
          body: JSON.stringify({ booking_id: bkgB.id }),
        }),
      ]);

      const dataA = await resA.json();
      const dataB = await resB.json();

      const okA = resA.status === 200 && dataA.success;
      const okB = resB.status === 200 && dataB.success;

      // Exactly one must succeed, the other must get 409 conflict
      const successTotal = (okA ? 1 : 0) + (okB ? 1 : 0);
      assert.equal(successTotal, 1, `Run ${i + 1}: Expected exactly 1 IN_CONSULTATION, got ${successTotal}`);

      if (okA) {
        assert.equal(resB.status, 409, `Run ${i + 1}: bkgB should be rejected with 409`);
      } else {
        assert.equal(resA.status, 409, `Run ${i + 1}: bkgA should be rejected with 409`);
      }

      // Check DB: verify exactly 1 IN_CONSULTATION exists for neuroDocId
      const inConsultationRows = await (
        await fetch(
          `${supabaseUrl}/rest/v1/bookings?resource_id=eq.${neuroDocId}&status=eq.IN_CONSULTATION`,
          { headers: serviceHeaders }
        )
      ).json();
      assert.equal(
        inConsultationRows.length,
        1,
        `Run ${i + 1}: DB must contain exactly 1 IN_CONSULTATION, found ${inConsultationRows.length}`
      );

      // Clean up before next iteration
      await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${inConsultationRows[0].id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      successCount++;
    }

    assert.equal(successCount, 50, 'All 50 single in-consultation race runs must pass');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: Transactional Queue Reorder & Override (50/50 runs)
  // ───────────────────────────────────────────────────────────────────────────
  it('Race 3: Concurrent queue reorder & override produce unique gap-free positions (50/50 runs)', async () => {
    let successCount = 0;

    for (let i = 0; i < 50; i++) {
      // Clear any prior active queue for neuroDocId so bkg1, bkg2, bkg3 form the entire active queue
      await fetch(
        `${supabaseUrl}/rest/v1/bookings?resource_id=eq.${neuroDocId}&status=in.(CONFIRMED,CHECKED_IN)`,
        {
          method: 'PATCH',
          headers: serviceHeaders,
          body: JSON.stringify({ status: 'COMPLETED', queue_position: null }),
        }
      );

      const bkg1 = await createTestBooking('CHECKED_IN', true, 1);
      const bkg2 = await createTestBooking('CHECKED_IN', true, 2);
      const bkg3 = await createTestBooking('CHECKED_IN', true, 3);

      // Concurrently:
      // Request 1: Reorder batch to [bkg3, bkg1, bkg2]
      // Request 2: Override bkg2 to position 1
      await Promise.all([
        fetch(`${appBaseUrl}/api/bookings/reorder`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.neuroDesk.token}`,
          },
          body: JSON.stringify({
            booking_ids: [bkg3.id, bkg1.id, bkg2.id],
          }),
        }),
        fetch(`${appBaseUrl}/api/bookings/override`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.neuroDesk.token}`,
          },
          body: JSON.stringify({
            booking_id: bkg2.id,
            override_position: 1,
            reason: 'Emergency triage',
          }),
        }),
      ]);

      // Check DB positions for these 3 bookings
      const ids = [bkg1.id, bkg2.id, bkg3.id].join(',');
      const rows = await (
        await fetch(`${supabaseUrl}/rest/v1/bookings?id=in.(${ids})`, {
          headers: serviceHeaders,
        })
      ).json();

      const positions = rows.map((r) => r.queue_position).sort((a, b) => a - b);

      // Must be unique, gap-free positions [1, 2, 3]
      assert.deepEqual(
        positions,
        [1, 2, 3],
        `Run ${i + 1}: Queue positions must be gap-free [1, 2, 3], got ${JSON.stringify(positions)}`
      );

      // Clean up bookings so they don't affect subsequent runs
      await fetch(`${supabaseUrl}/rest/v1/bookings?id=in.(${ids})`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ status: 'COMPLETED', queue_position: null }),
      });

      successCount++;
    }

    assert.equal(successCount, 50, 'All 50 queue reorder/override race runs must pass');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: Optimistic Concurrency Control (Version Check) (50/50 runs)
  // ───────────────────────────────────────────────────────────────────────────
  it('Race 4: Concurrent edits with version check - second writer gets 409 (50/50 runs)', async () => {
    let successCount = 0;

    for (let i = 0; i < 50; i++) {
      // Ensure no active consultation
      await fetch(
        `${supabaseUrl}/rest/v1/bookings?resource_id=eq.${neuroDocId}&status=eq.IN_CONSULTATION`,
        {
          method: 'PATCH',
          headers: serviceHeaders,
          body: JSON.stringify({ status: 'COMPLETED' }),
        }
      );

      const bkg = await createTestBooking('CHECKED_IN', true);

      // Fetch initial version
      const initial = await (
        await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bkg.id}`, { headers: serviceHeaders })
      ).json();
      const currentVersion = initial[0].version;

      // Two concurrent updates both sending expected_version: currentVersion
      const [res1, res2] = await Promise.all([
        fetch(`${appBaseUrl}/api/bookings/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.neuroDesk.token}`,
          },
          body: JSON.stringify({
            booking_id: bkg.id,
            expected_version: currentVersion,
          }),
        }),
        fetch(`${appBaseUrl}/api/bookings/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.adminApex.token}`,
          },
          body: JSON.stringify({
            booking_id: bkg.id,
            expected_version: currentVersion,
          }),
        }),
      ]);

      const data1 = await res1.json();
      const data2 = await res2.json();

      const ok1 = res1.status === 200 && data1.success;
      const ok2 = res2.status === 200 && data2.success;

      // Exactly 1 must win, other must get 409
      const winnerCount = (ok1 ? 1 : 0) + (ok2 ? 1 : 0);
      assert.equal(winnerCount, 1, `Run ${i + 1}: Expected 1 successful update, got ${winnerCount}`);

      if (ok1) {
        assert.equal(res2.status, 409, `Run ${i + 1}: Second writer must get 409`);
        assert.match(data2.error, /Updated by someone else|Doctor already has an active consultation/i);
      } else {
        assert.equal(res1.status, 409, `Run ${i + 1}: Second writer must get 409`);
        assert.match(data1.error, /Updated by someone else|Doctor already has an active consultation/i);
      }

      // Cleanup
      await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bkg.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      successCount++;
    }

    assert.equal(successCount, 50, 'All 50 optimistic concurrency control runs must pass');
  });

  after(async () => {
    // Clean up any remaining IN_CONSULTATION bookings
    await fetch(
      `${supabaseUrl}/rest/v1/bookings?provider_id=eq.${hospA.id}&status=eq.IN_CONSULTATION`,
      {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ status: 'COMPLETED' }),
      }
    );
  });
});
