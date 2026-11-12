/**
 * tests/e2e/workstreams/sa6-consultant-isolation.test.mjs
 * 
 * Sub-Agent SA6: Per-Consultant Isolation & RBAC Workstream
 * 
 * Cases Covered:
 * - G1: Hospital Admin cross-department visibility (Admin reads all hospital bookings)
 * - G2: Front Desk assigned doctor isolation (FD reads only assigned doctors; unassigned doctor yields 0 rows)
 * - G3: Consultant own-appointment isolation (Consultant reads only own appointments; peer consultant yields 0 rows)
 * - G4: Customer data isolation (Patient reads only own bookings; other patient data returns 0 rows)
 * - G5: Audit logging on doctor-front desk assignment changes (Triggers record assignment lifecycle)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createTenant, cleanupTenant } from '../harness/tenant-factory.mjs';
import { SubAgentReportWriter } from '../harness/report-writer.mjs';

import { getDbConfig } from '../harness/client-helpers.mjs';

describe('Sub-Agent SA6: Per-Consultant Isolation & RBAC', () => {
  let tenant;
  let writer;
  const { url, serviceHeaders } = getDbConfig();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

  function userHeaders(authToken) {
    return {
      'apikey': anonKey,
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    };
  }

  async function loginUser(email, password = 'HospitalTest2026!') {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    return data.access_token;
  }

  const prefix = 'LEG_SA6';

  before(async () => {
    writer = new SubAgentReportWriter(prefix, 'Legacy Per-Consultant Isolation & RBAC');
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
    } catch (e) {
      console.error(`[${prefix}] Error saving report:`, e);
    }
    try {
      await cleanupTenant(prefix);
    } catch (e) {
      console.error(`[${prefix}] Error cleaning up tenant:`, e);
    }
  });

  // Seed baseline bookings for Dr 0, Dr 1, Dr 2
  let bookingDoc0, bookingDoc1, bookingDoc2;

  before(async () => {
    const now = await tenant.clock.get();

    // Booking for Dr. 0 (Sharma, assigned to FD 0)
    const b0Res = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: tenant.hospital.id,
        department_id: tenant.consultants[0].department_id,
        resource_id: tenant.consultants[0].id,
        customer_id: tenant.patients[0].id,
        slot_start: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        slot_end: new Date(now.getTime() + 20 * 60 * 1000).toISOString(),
        status: 'CONFIRMED',
        deposit_amount: 100,
        total_amount: 500,
        payment_status: 'CAPTURED',
        reference_code: `SA6-B0-${Date.now()}`
      })
    });
    bookingDoc0 = (await b0Res.json())[0];

    // Booking for Dr. 1 (Patel, assigned to FD 0)
    const b1Res = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: tenant.hospital.id,
        department_id: tenant.consultants[1].department_id,
        resource_id: tenant.consultants[1].id,
        customer_id: tenant.patients[1].id,
        slot_start: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
        slot_end: new Date(now.getTime() + 40 * 60 * 1000).toISOString(),
        status: 'CONFIRMED',
        deposit_amount: 100,
        total_amount: 500,
        payment_status: 'CAPTURED',
        reference_code: `SA6-B1-${Date.now()}`
      })
    });
    bookingDoc1 = (await b1Res.json())[0];

    // Booking for Dr. 2 (Reddy, assigned ONLY to FD 1, NOT FD 0)
    const b2Res = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: tenant.hospital.id,
        department_id: tenant.consultants[2].department_id,
        resource_id: tenant.consultants[2].id,
        customer_id: tenant.patients[2].id,
        slot_start: new Date(now.getTime() + 50 * 60 * 1000).toISOString(),
        slot_end: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        status: 'CONFIRMED',
        deposit_amount: 100,
        total_amount: 500,
        payment_status: 'CAPTURED',
        reference_code: `SA6-B2-${Date.now()}`
      })
    });
    bookingDoc2 = (await b2Res.json())[0];
  });

  // G1: Hospital Admin Cross-Department Visibility
  it('G1: Hospital Admin has full read access across all departments and consultants', async () => {
    try {
      const res = await fetch(`${url}/rest/v1/bookings?provider_id=eq.${tenant.hospital.id}`, {
        headers: userHeaders(tenant.adminAuth.token)
      });
      const bookings = await res.json();
      assert.ok(Array.isArray(bookings), 'Bookings returned as array');

      const foundB0 = bookings.some(b => b.id === bookingDoc0.id);
      const foundB1 = bookings.some(b => b.id === bookingDoc1.id);
      const foundB2 = bookings.some(b => b.id === bookingDoc2.id);

      assert.ok(foundB0 && foundB1 && foundB2, 'Admin can see bookings for all 3 consultants across departments');

      writer.addCaseResult({
        caseId: 'G1',
        scenario: 'Hospital Admin cross-department visibility',
        status: 'PASS',
        evidence: `Admin retrieved all tenant bookings (found doc0, doc1, doc2). Total accessible: ${bookings.length}.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'G1', scenario: 'Admin visibility', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // G2: Front Desk Assigned Doctor Isolation
  it('G2: Front Desk reads only assigned doctors; unassigned doctor yields 0 rows', async () => {
    try {
      const fd0 = tenant.frontDesks[0]; // Assigned to Dr 0 and Dr 1, NOT Dr 2

      // Query bookings for Dr 0 (assigned) -> MUST SUCCEED
      const resDoc0 = await fetch(`${url}/rest/v1/bookings?resource_id=eq.${tenant.consultants[0].id}`, {
        headers: userHeaders(fd0.auth.token)
      });
      const bookingsDoc0 = await resDoc0.json();
      assert.ok(bookingsDoc0.some(b => b.id === bookingDoc0.id), 'FD0 can see assigned Dr 0 bookings');

      // Query bookings for Dr 1 (assigned) -> MUST SUCCEED
      const resDoc1 = await fetch(`${url}/rest/v1/bookings?resource_id=eq.${tenant.consultants[1].id}`, {
        headers: userHeaders(fd0.auth.token)
      });
      const bookingsDoc1 = await resDoc1.json();
      assert.ok(bookingsDoc1.some(b => b.id === bookingDoc1.id), 'FD0 can see assigned Dr 1 bookings');

      // Query bookings for Dr 2 (unassigned) -> MUST RETURN 0 ROWS
      const resDoc2 = await fetch(`${url}/rest/v1/bookings?resource_id=eq.${tenant.consultants[2].id}`, {
        headers: userHeaders(fd0.auth.token)
      });
      const bookingsDoc2 = await resDoc2.json();
      assert.equal(bookingsDoc2.length, 0, 'FD0 cannot see unassigned Dr 2 bookings (RLS returns 0 rows)');

      writer.addCaseResult({
        caseId: 'G2',
        scenario: 'Front Desk assigned doctor isolation',
        status: 'PASS',
        evidence: `FD0 sees assigned Dr 0 (${bookingsDoc0.length}) and Dr 1 (${bookingsDoc1.length}). Unassigned Dr 2 returned strictly 0 rows.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'G2', scenario: 'Front Desk isolation', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // G3: Consultant Own-Appointment Isolation
  it('G3: Consultant reads only own appointments; peer appointments return 0 rows', async () => {
    try {
      const doc0 = tenant.consultants[0]; // Dr. Sharma

      // Query own bookings
      const resOwn = await fetch(`${url}/rest/v1/bookings?resource_id=eq.${doc0.id}`, {
        headers: userHeaders(doc0.auth.token)
      });
      const ownBookings = await resOwn.json();
      assert.ok(ownBookings.some(b => b.id === bookingDoc0.id), 'Dr 0 can see own bookings');

      // Query peer consultant Dr 1's bookings -> MUST RETURN 0 ROWS
      const resPeer = await fetch(`${url}/rest/v1/bookings?resource_id=eq.${tenant.consultants[1].id}`, {
        headers: userHeaders(doc0.auth.token)
      });
      const peerBookings = await resPeer.json();
      assert.equal(peerBookings.length, 0, 'Dr 0 cannot see Dr 1 bookings (RLS returns 0 rows)');

      writer.addCaseResult({
        caseId: 'G3',
        scenario: 'Consultant own-appointment isolation',
        status: 'PASS',
        evidence: `Dr 0 can see own bookings (${ownBookings.length}). Querying peer Dr 1 returned strictly 0 rows.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'G3', scenario: 'Consultant isolation', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // G4: Customer Data Isolation
  it('G4: Patient reads only own bookings; query for peer patient returns 0 rows', async () => {
    try {
      const patient0 = tenant.patients[0];
      const patient1 = tenant.patients[1];

      const token0 = await loginUser(patient0.email);

      // Query own bookings
      const resOwn = await fetch(`${url}/rest/v1/bookings?customer_id=eq.${patient0.id}`, {
        headers: userHeaders(token0)
      });
      const ownBookings = await resOwn.json();
      assert.ok(ownBookings.some(b => b.id === bookingDoc0.id), 'Patient 0 can see own booking');

      // Query peer patient 1's bookings -> MUST RETURN 0 ROWS
      const resPeer = await fetch(`${url}/rest/v1/bookings?customer_id=eq.${patient1.id}`, {
        headers: userHeaders(token0)
      });
      const peerBookings = await resPeer.json();
      assert.equal(peerBookings.length, 0, 'Patient 0 cannot see Patient 1 bookings (RLS returns 0 rows)');

      writer.addCaseResult({
        caseId: 'G4',
        scenario: 'Customer data isolation',
        status: 'PASS',
        evidence: `Patient 0 sees own bookings. Query for Patient 1 returned strictly 0 rows.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'G4', scenario: 'Customer data isolation', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // G5: Audit Logging on Doctor Assignment
  it('G5: Doctor-Front Desk assignment changes trigger automatic audit log recording', async () => {
    try {
      const fd = tenant.frontDesks[1]; // FD 1
      const doc = tenant.consultants[4]; // Dr. Varma

      // Hospital Admin assigns FD 1 to Dr. Varma
      const asRes = await fetch(`${url}/rest/v1/doctor_front_desk_assignments`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          doctor_id: doc.id,
          user_id: fd.user_id,
          id_card_number: `ID-AUDIT-TEST`
        })
      });
      assert.equal(asRes.status, 201, 'Assignment created');
      const assignment = (await asRes.json())[0];

      // Verify audit log exists for this assignment
      const auditRes = await fetch(`${url}/rest/v1/audit_logs?merchant_id=eq.${tenant.hospital.id}&target=eq.doctor_front_desk_assignments`, {
        headers: serviceHeaders
      });
      const auditLogs = await auditRes.json();
      assert.ok(auditLogs.length >= 1, 'Audit log recorded for doctor assignment change');

      // Cleanup test assignment
      await fetch(`${url}/rest/v1/doctor_front_desk_assignments?id=eq.${assignment.id}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });

      writer.addCaseResult({
        caseId: 'G5',
        scenario: 'Audit logging for doctor-front desk assignments',
        status: 'PASS',
        evidence: `Assignment created. Audit log trigger generated entry on target 'doctor_front_desk_assignments'.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'G5', scenario: 'Audit logging on assignments', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });
});
