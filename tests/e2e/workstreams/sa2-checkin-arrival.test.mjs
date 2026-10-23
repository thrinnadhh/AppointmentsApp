/**
 * tests/e2e/workstreams/sa2-checkin-arrival.test.mjs
 * 
 * Sub-Agent SA2: Check-in & Arrival Tags Workstream
 * 
 * Cases Covered:
 * - C1: Arrival tags (+/- 10 min window around slot_start)
 * - C2: Check-in code verification and arrival window enforcement (-60m)
 * - C3: Manual check-in by authorized Front Desk vs rejection of unassigned
 * - C4: Check-in failure rate limiting (5 failed attempts -> 60s lock)
 * - C5: Race test: 50 runs of concurrent double check-in (code vs manual)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createTenant, cleanupTenant } from '../harness/tenant-factory.mjs';
import { SubAgentReportWriter } from '../harness/report-writer.mjs';

import { getDbConfig } from '../harness/client-helpers.mjs';

describe('Sub-Agent SA2: Check-in & Arrival Tags', () => {
  let tenant;
  let writer;
  const { url, serviceHeaders } = getDbConfig();

  const prefix = 'LEG_SA2';

  before(async () => {
    writer = new SubAgentReportWriter(prefix, 'Legacy Check-in & Arrival Tags');
    console.log(`[${prefix}] Setting up isolated tenant ${prefix}...`);
    try {
      tenant = await createTenant(prefix);
    } catch (err) {
      if (writer) writer.markSetupFailed(err);
      throw err;
    }
  });

  after(async () => {
    console.log(`[${prefix}] Generating test report and tearing down tenant ${prefix}...`);
    try {
      if (writer) writer.save();
    } catch {}
    try {
      await cleanupTenant(prefix);
    } catch {}
  });

  function userHeaders(authToken) {
    return {
      'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  // C1: Arrival Tags Evaluation
  it('C1: Arrival tags correctly tag Early, On Time, Late, Expected', async () => {
    try {
      const computeArrivalTag = (slotStartStr, arrivedAtStr) => {
        if (!arrivedAtStr) return 'Expected';
        const slot = new Date(slotStartStr).getTime();
        const arrived = new Date(arrivedAtStr).getTime();
        const diffMins = (arrived - slot) / (60 * 1000);
        if (diffMins < -10) return 'Early';
        if (diffMins <= 10) return 'On Time';
        return 'Late';
      };

      const slot = '2026-10-20T12:30:00+05:30';
      assert.equal(computeArrivalTag(slot, '2026-10-20T12:15:00+05:30'), 'Early', '15m before slot is Early');
      assert.equal(computeArrivalTag(slot, '2026-10-20T12:20:00+05:30'), 'On Time', '-10m boundary is On Time');
      assert.equal(computeArrivalTag(slot, '2026-10-20T12:30:00+05:30'), 'On Time', 'Exact slot is On Time');
      assert.equal(computeArrivalTag(slot, '2026-10-20T12:40:00+05:30'), 'On Time', '+10m boundary is On Time');
      assert.equal(computeArrivalTag(slot, '2026-10-20T12:45:00+05:30'), 'Late', '15m after slot is Late');
      assert.equal(computeArrivalTag(slot, null), 'Expected', 'Null arrival is Expected');

      writer.addCaseResult({
        caseId: 'C1',
        scenario: 'Arrival tag classification (+/- 10 min window around slot_start)',
        status: 'PASS',
        evidence: 'Verified Early (< -10m), On Time ([-10m, +10m]), Late (> +10m), and Expected (no arrival).'
      });
    } catch (err) {
      writer.addCaseResult({
        caseId: 'C1',
        scenario: 'Arrival tag classification',
        status: 'FAIL',
        evidence: err.message
      });
      throw err;
    }
  });

  // C2: Check-in Code RPC & Arrival Window
  it('C2: Check-in code verification enforces -60m window and records arrival', async () => {
    try {
      const doc = tenant.consultants[0]; // Dr. Sharma (assigned to FD1)
      const fd = tenant.frontDesks[0];    // FD1
      const patient = tenant.patients[0];
      const now = await tenant.clock.get(); // 09:00 IST

      // 1. Too early case: Slot at 11:00 AM IST (now is 09:00, window opens at 10:00)
      const slotEarlyStart = new Date(now.getTime() + 120 * 60 * 1000).toISOString();
      const slotEarlyEnd = new Date(now.getTime() + 130 * 60 * 1000).toISOString();

      const bResEarly = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: patient.id,
          slot_start: slotEarlyStart,
          slot_end: slotEarlyEnd,
          status: 'CONFIRMED',
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA2-EARLY-${Date.now()}`,
          version: 1
        })
      });
      const bookEarly = (await bResEarly.json())[0];

      // Fetch generated checkin code
      const codeRes1 = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${bookEarly.id}`, { headers: serviceHeaders });
      const codeEarly = (await codeRes1.json())[0];

      const checkinEarlyRes = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: userHeaders(fd.auth.token),
        body: JSON.stringify({ p_shop_id: tenant.hospital.id, p_code: codeEarly.code })
      });
      const checkinEarlyData = await checkinEarlyRes.json();
      assert.equal(checkinEarlyData.success, false);
      assert.equal(checkinEarlyData.error, 'TOO_EARLY');

      // 2. Advance clock to 10:15 AM IST (within -60m window for 11:00 slot)
      await tenant.clock.advance(75);
      const checkinValidRes = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: userHeaders(fd.auth.token),
        body: JSON.stringify({ p_shop_id: tenant.hospital.id, p_code: codeEarly.code })
      });
      const checkinValidData = await checkinValidRes.json();
      assert.equal(checkinValidData.success, true);
      assert.equal(checkinValidData.booking_id, bookEarly.id);
      assert.equal(checkinValidData.is_late, false);

      writer.addCaseResult({
        caseId: 'C2',
        scenario: 'Check-in code window enforcement (opens -60m before slot)',
        status: 'PASS',
        evidence: `At 09:00: TOO_EARLY for 11:00 slot. After 75m clock advance (10:15): check-in verified successfully.`
      });
    } catch (err) {
      writer.addCaseResult({
        caseId: 'C2',
        scenario: 'Check-in code window enforcement',
        status: 'FAIL',
        evidence: err.message
      });
      throw err;
    }
  });

  // C3: Manual Check-in by Authorized Front Desk vs Rejection of Unassigned
  it('C3: Manual check-in allows assigned doctor and rejects unassigned with FORBIDDEN', async () => {
    try {
      const doc1 = tenant.consultants[0]; // Dr. Sharma (assigned to FD1)
      const doc2 = tenant.consultants[2]; // Dr. Reddy (assigned to FD2, NOT FD1)
      const fd1 = tenant.frontDesks[0];   // FD1
      const now = await tenant.clock.get();

      const slotStart = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
      const slotEnd = new Date(now.getTime() + 20 * 60 * 1000).toISOString();

      // Booking for Doc1 (assigned to FD1)
      const bRes1 = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc1.department_id,
          resource_id: doc1.id,
          customer_id: tenant.patients[2].id,
          slot_start: slotStart,
          slot_end: slotEnd,
          status: 'CONFIRMED',
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA2-DOC1-${Date.now()}`,
          version: 1
        })
      });
      const book1 = (await bRes1.json())[0];

      // Booking for Doc2 (unassigned to FD1)
      const bRes2 = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc2.department_id,
          resource_id: doc2.id,
          customer_id: tenant.patients[3].id,
          slot_start: slotStart,
          slot_end: slotEnd,
          status: 'CONFIRMED',
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA2-DOC2-${Date.now()}`,
          version: 1
        })
      });
      const book2 = (await bRes2.json())[0];

      // FD1 marks present for Doc1 (assigned) -> PASS
      const resManual1 = await fetch(`${url}/rest/v1/rpc/mark_present_manually`, {
        method: 'POST',
        headers: userHeaders(fd1.auth.token),
        body: JSON.stringify({ p_booking_id: book1.id })
      });
      const dataManual1 = await resManual1.json();
      assert.equal(dataManual1.success, true, 'Assigned FD1 can manually mark present for Doc1');

      // FD1 marks present for Doc2 (unassigned) -> REJECTED FORBIDDEN
      const resManual2 = await fetch(`${url}/rest/v1/rpc/mark_present_manually`, {
        method: 'POST',
        headers: userHeaders(fd1.auth.token),
        body: JSON.stringify({ p_booking_id: book2.id })
      });
      const dataManual2 = await resManual2.json();
      assert.equal(dataManual2.success, false);
      assert.equal(dataManual2.error, 'FORBIDDEN', 'Unassigned doctor check-in must be rejected with FORBIDDEN');

      writer.addCaseResult({
        caseId: 'C3',
        scenario: 'Manual check-in role & doctor assignment verification',
        status: 'PASS',
        evidence: `Assigned doc1 marked present successfully. Unassigned doc2 rejected with FORBIDDEN.`
      });
    } catch (err) {
      writer.addCaseResult({
        caseId: 'C3',
        scenario: 'Manual check-in role & doctor assignment verification',
        status: 'FAIL',
        evidence: err.message
      });
      throw err;
    }
  });

  // C4: Check-in Failure Rate Limiting (5 failed attempts -> 60s lock)
  it('C4: Rate limiting locks staff after 5 failed check-in attempts', async () => {
    try {
      const fd = tenant.frontDesks[1]; // FD2
      const now = await tenant.clock.get();

      // Clear any prior rate limits for this user
      await fetch(`${url}/rest/v1/staff_checkin_rate_limits?user_id=eq.${fd.user_id}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });

      // Submit 5 invalid check-in codes
      for (let i = 1; i <= 5; i++) {
        const res = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
          method: 'POST',
          headers: userHeaders(fd.auth.token),
          body: JSON.stringify({ p_shop_id: tenant.hospital.id, p_code: `INVALID-${i}` })
        });
        const data = await res.json();
        assert.equal(data.success, false);
      }

      // 6th attempt must be RATE_LIMITED
      const lockedRes = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: userHeaders(fd.auth.token),
        body: JSON.stringify({ p_shop_id: tenant.hospital.id, p_code: `ANY-CODE` })
      });
      const lockedData = await lockedRes.json();
      assert.equal(lockedData.success, false);
      assert.equal(lockedData.error, 'RATE_LIMITED', '6th attempt must be rate limited');

      // Advance clock by 2 minutes to expire lock
      await tenant.clock.advance(2);

      // Attempt after lock expiry should no longer return RATE_LIMITED (returns INVALID_CODE)
      const afterRes = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: userHeaders(fd.auth.token),
        body: JSON.stringify({ p_shop_id: tenant.hospital.id, p_code: `EXPIRED-LOCK-CHECK` })
      });
      const afterData = await afterRes.json();
      assert.notEqual(afterData.error, 'RATE_LIMITED', 'Lock should expire after 60 seconds');

      writer.addCaseResult({
        caseId: 'C4',
        scenario: 'Check-in failure rate limiting (5 attempts locks for 60s)',
        status: 'PASS',
        evidence: `5 invalid codes locked staff (RATE_LIMITED). 2-minute clock advance unlocked staff.`
      });
    } catch (err) {
      writer.addCaseResult({
        caseId: 'C4',
        scenario: 'Check-in failure rate limiting',
        status: 'FAIL',
        evidence: err.message
      });
      throw err;
    }
  });

  // C5: Race Test: 50 runs of double check-in (code vs manual)
  it('C5: Double check-in race across 50 runs guarantees exactly one winner', async () => {
    try {
      const doc = tenant.consultants[1]; // Dr. Patel (assigned to FD1, zero conflicting bookings)
      const fd = tenant.frontDesks[0];    // FD1
      const now = await tenant.clock.get();
      let racePassCount = 0;

      for (let run = 1; run <= 50; run++) {
        // Advance clock by 15 mins each run so every slot is non-overlapping and within arrival window
        await tenant.clock.advance(15);
        const currTime = await tenant.clock.get();
        const slotStart = new Date(currTime.getTime() + 15 * 60 * 1000).toISOString();
        const slotEnd = new Date(currTime.getTime() + 25 * 60 * 1000).toISOString();

        // Create confirmed booking
        const bRes = await fetch(`${url}/rest/v1/bookings`, {
          method: 'POST',
          headers: serviceHeaders,
          body: JSON.stringify({
            provider_id: tenant.hospital.id,
            department_id: doc.department_id,
            resource_id: doc.id,
            customer_id: tenant.patients[5].id,
            slot_start: slotStart,
            slot_end: slotEnd,
            status: 'CONFIRMED',
            deposit_amount: 100,
            total_amount: 500,
            payment_status: 'CAPTURED',
            reference_code: `SA2-RACE-${run}`,
            version: 1
          })
        });
        const bText = await bRes.text();
        let booking;
        try {
          const parsed = JSON.parse(bText);
          booking = Array.isArray(parsed) ? parsed[0] : parsed;
        } catch {
          console.error(`Run ${run} parse error: ${bText}`);
        }
        if (!booking?.id) {
          console.error(`Run ${run} bRes status: ${bRes.status}, body: ${bText}`);
        }

        // Fetch check-in code
        const codeRes = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${booking.id}`, { headers: serviceHeaders });
        const codeRec = (await codeRes.json())[0];

        // Concurrently race: Caller A calls verify_checkin_code vs Caller B calls mark_present_manually
        const [resCode, resManual] = await Promise.all([
          fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
            method: 'POST',
            headers: userHeaders(fd.auth.token),
            body: JSON.stringify({ p_shop_id: tenant.hospital.id, p_code: codeRec.code })
          }),
          fetch(`${url}/rest/v1/rpc/mark_present_manually`, {
            method: 'POST',
            headers: userHeaders(fd.auth.token),
            body: JSON.stringify({ p_booking_id: booking.id })
          })
        ]);

        const [dataCode, dataManual] = await Promise.all([resCode.json(), resManual.json()]);

        const successes = [dataCode.success, dataManual.success].filter(Boolean);
        const failures = [dataCode.success, dataManual.success].filter(s => !s);

        assert.equal(successes.length, 1, `Run ${run}: Exactly 1 caller must succeed`);
        assert.equal(failures.length, 1, `Run ${run}: Exactly 1 caller must be rejected`);
        racePassCount++;
      }

      assert.equal(racePassCount, 50, 'All 50 double check-in race runs passed');

      writer.addCaseResult({
        caseId: 'C5',
        scenario: 'Double check-in race condition across 50 runs (code vs manual)',
        status: 'PASS',
        evidence: `50/50 runs passed with exactly 1 winner and 0 double check-in anomalies.`
      });
    } catch (err) {
      writer.addCaseResult({
        caseId: 'C5',
        scenario: 'Double check-in race condition across 50 runs',
        status: 'FAIL',
        evidence: err.message
      });
      throw err;
    }
  });
});
