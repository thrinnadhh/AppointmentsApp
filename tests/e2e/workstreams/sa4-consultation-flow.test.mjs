/**
 * tests/e2e/workstreams/sa4-consultation-flow.test.mjs
 * 
 * Sub-Agent SA4: Consultation Flow & Status Transitions Workstream
 * 
 * Cases Covered:
 * - E1: Start consultation (CHECKED_IN -> IN_CONSULTATION)
 * - E2: Single active consultation constraint across 50 runs (idx_single_in_consultation_per_doctor)
 * - E3: End consultation (IN_CONSULTATION -> COMPLETED)
 * - E4: Admit patient to consultation queue
 * - E5: Illegal status transitions rejected by state machine
 * - E6: Concurrency version check (optimistic locking: stale version receives 409)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createTenant, cleanupTenant } from '../harness/tenant-factory.mjs';
import { SubAgentReportWriter } from '../harness/report-writer.mjs';

import { getDbConfig } from '../harness/client-helpers.mjs';

describe('Sub-Agent SA4: Consultation Flow & Status Transitions', () => {
  let tenant;
  let writer;
  const { url, appUrl, serviceHeaders } = getDbConfig();

  const prefix = 'LEG_SA4';

  before(async () => {
    writer = new SubAgentReportWriter(prefix, 'Legacy Consultation Flow & Status Transitions');
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
      'Prefer': 'return=representation',
      'x-test-local-db': 'true'
    };
  }

  // E1: Start Consultation
  it('E1: Consultant starts consultation moving booking to IN_CONSULTATION', async () => {
    try {
      const doc = tenant.consultants[0]; // Dr. Sharma
      const patient = tenant.patients[0];
      const now = await tenant.clock.get();

      // Create CHECKED_IN booking
      const bRes = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: patient.id,
          slot_start: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
          slot_end: new Date(now.getTime() + 20 * 60 * 1000).toISOString(),
          status: 'CHECKED_IN',
          is_present: true,
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA4-START-${Date.now()}`,
          version: 1
        })
      });
      const booking = (await bRes.json())[0];
      assert.ok(booking?.id, 'Booking inserted for E1');

      // Consultant calls POST /api/bookings/start
      const startRes = await fetch(`${appUrl}/api/bookings/start`, {
        method: 'POST',
        headers: userHeaders(doc.auth.token),
        body: JSON.stringify({ booking_id: booking.id, expected_version: 1 })
      });
      const startData = await startRes.json();
      assert.equal(startRes.status, 200, `Expected 200 but got ${startRes.status}: ${JSON.stringify(startData)}`);
      assert.equal(startData.status, 'IN_CONSULTATION');

      writer.addCaseResult({
        caseId: 'E1',
        scenario: 'Consultant starts consultation transition',
        status: 'PASS',
        evidence: `Booking ${booking.id} transitioned from CHECKED_IN to IN_CONSULTATION.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'E1', scenario: 'Start consultation transition', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // E2: Single Active Consultation Invariant (50 runs)
  it('E2: Single active consultation constraint rejects second concurrent consultation across 50 runs', async () => {
    try {
      const doc = tenant.consultants[1]; // Dr. Patel
      const now = await tenant.clock.get();
      let passCount = 0;

      for (let run = 1; run <= 50; run++) {
        const slotStartA = new Date(now.getTime() + (run * 20) * 60 * 1000).toISOString();
        const slotEndA = new Date(now.getTime() + (run * 20 + 8) * 60 * 1000).toISOString();
        const slotStartB = new Date(now.getTime() + (run * 20 + 10) * 60 * 1000).toISOString();
        const slotEndB = new Date(now.getTime() + (run * 20 + 18) * 60 * 1000).toISOString();

        // 1. Create first active consultation
        const bResA = await fetch(`${url}/rest/v1/bookings`, {
          method: 'POST',
          headers: serviceHeaders,
          body: JSON.stringify({
            provider_id: tenant.hospital.id,
            department_id: doc.department_id,
            resource_id: doc.id,
            customer_id: tenant.patients[run % 10].id,
            slot_start: slotStartA,
            slot_end: slotEndA,
            status: 'IN_CONSULTATION',
            is_present: true,
            deposit_amount: 100,
            total_amount: 500,
            payment_status: 'CAPTURED',
            reference_code: `SA4-ACTIVE-${run}-A`,
            version: 1
          })
        });
        const bookingA = (await bResA.json())[0];
        assert.ok(bookingA?.id, `Run ${run}: Booking A in consultation`);

        // 2. Attempt to create second simultaneous active consultation for same doctor -> MUST BE REJECTED
        const bResB = await fetch(`${url}/rest/v1/bookings`, {
          method: 'POST',
          headers: serviceHeaders,
          body: JSON.stringify({
            provider_id: tenant.hospital.id,
            department_id: doc.department_id,
            resource_id: doc.id,
            customer_id: tenant.patients[(run + 1) % 10].id,
            slot_start: slotStartB,
            slot_end: slotEndB,
            status: 'IN_CONSULTATION',
            is_present: true,
            deposit_amount: 100,
            total_amount: 500,
            payment_status: 'CAPTURED',
            reference_code: `SA4-ACTIVE-${run}-B`,
            version: 1
          })
        });
        const errB = await bResB.json();
        assert.ok(bResB.status === 409 || bResB.status === 400, 'Rejection status must be 409 or 400');
        assert.ok(errB.message?.includes('idx_single_in_consultation_per_doctor') || errB.code === '23505', 'Rejected by partial unique index');

        // Free doctor for next iteration
        await fetch(`${url}/rest/v1/bookings?id=eq.${bookingA.id}`, {
          method: 'PATCH',
          headers: serviceHeaders,
          body: JSON.stringify({ status: 'COMPLETED' })
        });

        passCount++;
      }

      assert.equal(passCount, 50, 'All 50 single-active consultation runs passed');

      writer.addCaseResult({
        caseId: 'E2',
        scenario: 'Single active consultation constraint enforced by DB index (50 runs)',
        status: 'PASS',
        evidence: `50/50 runs passed. Doctor strictly prohibited from having >1 concurrent IN_CONSULTATION.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'E2', scenario: 'Single active consultation constraint', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // E3: End Consultation
  it('E3: Consultant ends consultation moving booking to COMPLETED', async () => {
    try {
      const doc = tenant.consultants[2]; // Dr. Reddy
      const patient = tenant.patients[2];
      const now = await tenant.clock.get();

      // Create IN_CONSULTATION booking
      const bRes = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: patient.id,
          slot_start: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
          slot_end: new Date(now.getTime() + 20 * 60 * 1000).toISOString(),
          status: 'IN_CONSULTATION',
          is_present: true,
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA4-END-${Date.now()}`,
          version: 1
        })
      });
      const booking = (await bRes.json())[0];
      assert.ok(booking?.id, 'Booking inserted for E3');

      // Consultant calls POST /api/bookings/end
      const endRes = await fetch(`${appUrl}/api/bookings/end`, {
        method: 'POST',
        headers: userHeaders(doc.auth.token),
        body: JSON.stringify({ booking_id: booking.id, expected_version: 1 })
      });
      const endData = await endRes.json();
      assert.equal(endRes.status, 200, `Expected 200 but got ${endRes.status}: ${JSON.stringify(endData)}`);
      assert.equal(endData.status, 'COMPLETED');

      writer.addCaseResult({
        caseId: 'E3',
        scenario: 'End consultation transitions booking to COMPLETED',
        status: 'PASS',
        evidence: `Booking ${booking.id} transitioned to COMPLETED status.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'E3', scenario: 'End consultation', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // E4: Admit Patient / Follow-up Creation
  it('E4: Front Desk admits patient to consultation queue', async () => {
    try {
      const doc = tenant.consultants[0]; // Dr. Sharma
      const fd = tenant.frontDesks[0];    // Assigned FD
      const patient = tenant.patients[3];
      const now = await tenant.clock.get();

      // Slot at +50m so it doesn't overlap with E1
      const bRes = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: patient.id,
          slot_start: new Date(now.getTime() + 50 * 60 * 1000).toISOString(),
          slot_end: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
          status: 'CONFIRMED',
          is_present: false,
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA4-ADMIT-${Date.now()}`,
          version: 1
        })
      });
      const booking = (await bRes.json())[0];
      assert.ok(booking?.id, 'Booking inserted for E4');

      const admitRes = await fetch(`${appUrl}/api/bookings/admit`, {
        method: 'POST',
        headers: userHeaders(fd.auth.token),
        body: JSON.stringify({ booking_id: booking.id, expected_version: 1 })
      });
      const admitData = await admitRes.json();
      assert.equal(admitRes.status, 200, `Expected 200 but got ${admitRes.status}: ${JSON.stringify(admitData)}`);
      assert.equal(admitData.success, true);
      assert.equal(admitData.status, 'CHECKED_IN');

      writer.addCaseResult({
        caseId: 'E4',
        scenario: 'Front Desk admits patient to queue',
        status: 'PASS',
        evidence: `Booking ${booking.id} admitted successfully by assigned Front Desk.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'E4', scenario: 'Admit patient', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // E5: Illegal Status Transitions Rejected
  it('E5: Illegal status transitions rejected by state machine', async () => {
    try {
      const doc = tenant.consultants[3]; // Dr. Rao
      const patient = tenant.patients[4];
      const now = await tenant.clock.get();

      // Create COMPLETED booking
      const bRes = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: patient.id,
          slot_start: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
          slot_end: new Date(now.getTime() + 20 * 60 * 1000).toISOString(),
          status: 'COMPLETED',
          is_present: true,
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA4-ILLEGAL-${Date.now()}`,
          version: 1
        })
      });
      const booking = (await bRes.json())[0];
      assert.ok(booking?.id, 'Booking inserted for E5');

      // Attempt to restart COMPLETED consultation -> MUST FAIL with 409
      const restartRes = await fetch(`${appUrl}/api/bookings/start`, {
        method: 'POST',
        headers: userHeaders(doc.auth.token),
        body: JSON.stringify({ booking_id: booking.id, expected_version: 1 })
      });
      assert.ok(restartRes.status === 409 || restartRes.status === 400, 'COMPLETED booking cannot transition back to IN_CONSULTATION');

      writer.addCaseResult({
        caseId: 'E5',
        scenario: 'Illegal status transition rejection (COMPLETED -> IN_CONSULTATION)',
        status: 'PASS',
        evidence: 'Server rejected illegal restart of COMPLETED booking.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'E5', scenario: 'Illegal status transitions', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // E6: Optimistic Locking / Version Check Concurrency
  it('E6: Concurrent edits with version check guarantees second writer gets 409 Conflict', async () => {
    try {
      const doc = tenant.consultants[4]; // Dr. Varma
      const patient = tenant.patients[5];
      const now = await tenant.clock.get();

      const bRes = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: patient.id,
          slot_start: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
          slot_end: new Date(now.getTime() + 20 * 60 * 1000).toISOString(),
          status: 'CHECKED_IN',
          is_present: true,
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA4-VERSION-${Date.now()}`,
          version: 1
        })
      });
      const booking = (await bRes.json())[0];
      assert.ok(booking?.id, 'Booking inserted for E6');

      // Two concurrent writers attempt to start consultation with expected_version: 1
      const [res1, res2] = await Promise.all([
        fetch(`${appUrl}/api/bookings/start`, {
          method: 'POST',
          headers: userHeaders(doc.auth.token),
          body: JSON.stringify({ booking_id: booking.id, expected_version: 1 })
        }),
        fetch(`${appUrl}/api/bookings/start`, {
          method: 'POST',
          headers: userHeaders(doc.auth.token),
          body: JSON.stringify({ booking_id: booking.id, expected_version: 1 })
        })
      ]);

      const statuses = [res1.status, res2.status];
      assert.ok(statuses.includes(200), 'One writer must succeed (200)');
      assert.ok(statuses.includes(409) || statuses.includes(400), 'Second writer must receive version conflict 409/400');

      writer.addCaseResult({
        caseId: 'E6',
        scenario: 'Optimistic locking with expected_version check',
        status: 'PASS',
        evidence: `Concurrent start requests resolved with statuses [${statuses.join(', ')}]. Stale writer rejected.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'E6', scenario: 'Optimistic locking concurrency', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });
});
