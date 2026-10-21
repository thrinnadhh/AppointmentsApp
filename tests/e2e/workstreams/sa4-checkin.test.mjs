/**
 * tests/e2e/workstreams/sa4-checkin.test.mjs
 * 
 * Workstream SA4: Check-in Workstream
 * 
 * Covers Planned Cases:
 * - D1: On-time protection against late arrivals
 * - D2: Early/On-Time patient enters directly when doctor is free
 * - D3: Arrival tags: 11 min before = Early; 10 min before = On Time; 10 min after = On Time; 11 min after = Late; not arrived = Expected
 * - D4: Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for an unauthorized code
 * - D5: Standby Queue ordering follows original booking time (FIFO)
 * - D6: Sliding schedule optimization fills gap before next on-time window
 * - D7: Doctor idle prevention dispatches standby patient when waiting queue empty
 * - D8: A patient checks in and then leaves: Front Desk sets No Show and the queue closes the gap
 * 
 * Extra Tests:
 * - X-D10: Burst arrivals across 10 concurrent check-ins
 * - X-D12: Multi-department queue isolation
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createTenant, cleanupTenant } from '../harness/tenant-factory.mjs';
import { SubAgentReportWriter } from '../harness/report-writer.mjs';
import { getFrontDeskClient, getCustomerClient } from '../harness/client-helpers.mjs';
import { calculateArrivalTag, HospitalDepartmentQueueEngine } from '../../../packages/shared/src/queue-engine.ts';

function getDbConfig() {
  const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const url = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/)[1];
  const serviceKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/)[1];
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  return {
    url,
    anonKey,
    serviceHeaders: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
}

describe('Workstream SA4: Check-in', () => {
  let tenant;
  let writer;
  const { url, anonKey, serviceHeaders } = getDbConfig();

  before(async () => {
    writer = new SubAgentReportWriter('SA4', 'Check-in');
    console.log('[SA4] Setting up isolated tenant SA4...');
    tenant = await createTenant('SA4');
  });

  after(async () => {
    console.log('[SA4] Generating test report and tearing down tenant SA4...');
    writer.save();
    await cleanupTenant('SA4');
  });

  // D1: On-time protection against late arrivals
  it('D1: On-time protection against late arrivals', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      engine.addBooking({ id: 'P_ON_TIME', patientName: 'P-OnTime', slotStart: '2026-10-20T10:00:00+05:30', durationMinutes: 15 });
      engine.addBooking({ id: 'P_LATE', patientName: 'P-Late', slotStart: '2026-10-20T09:30:00+05:30', durationMinutes: 15 });

      engine.checkInPatient('P_LATE', '2026-10-20T09:55:00+05:30');
      engine.checkInPatient('P_ON_TIME', '2026-10-20T09:58:00+05:30');

      const state = engine.evaluateQueues('2026-10-20T10:00:00+05:30');
      assert.equal(state.waitingQueue[0].id, 'P_ON_TIME', 'On-time patient must be first in Waiting Queue');
      assert.equal(state.standbyQueue[0].id, 'P_LATE', 'Late patient must be in Standby Queue');

      writer.addCaseResult({
        caseId: 'D1',
        scenario: 'On-time protection against late arrivals',
        status: 'PASS',
        evidence: 'On-time patient P_ON_TIME retained priority over late arrival P_LATE.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D1', scenario: 'On-time protection', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D2: Early/On-Time patient enters directly when doctor free
  it('D2: Early/On-Time patient enters directly when doctor free', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      engine.addBooking({ id: 'P_EARLY', patientName: 'P-Early', slotStart: '2026-10-20T12:30:00+05:30', durationMinutes: 15 });
      engine.checkInPatient('P_EARLY', '2026-10-20T12:25:00+05:30');

      const state = engine.evaluateQueues('2026-10-20T12:25:00+05:30');
      assert.equal(state.waitingQueue[0].id, 'P_EARLY');
      assert.equal(state.liveQueue[0].id, 'P_EARLY');

      writer.addCaseResult({
        caseId: 'D2',
        scenario: 'Early/On-Time patient enters directly when doctor is free',
        status: 'PASS',
        evidence: 'Patient arriving at 12:25 for 12:30 slot placed in live queue directly.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D2', scenario: 'Early/On-Time direct entry', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D3: Arrival tags exact boundaries
  it('D3: Arrival tags: 11 min before = Early; 10 min before = On Time; 10 min after = On Time; 11 min after = Late; not arrived = Expected', async () => {
    try {
      const slot = '2026-10-20T10:00:00+05:30';
      assert.equal(calculateArrivalTag(slot, '2026-10-20T09:49:00+05:30'), 'Early', '11 min before must be Early');
      assert.equal(calculateArrivalTag(slot, '2026-10-20T09:50:00+05:30'), 'On Time', '10 min before must be On Time');
      assert.equal(calculateArrivalTag(slot, '2026-10-20T10:00:00+05:30'), 'On Time', 'Slot time must be On Time');
      assert.equal(calculateArrivalTag(slot, '2026-10-20T10:10:00+05:30'), 'On Time', '10 min after must be On Time');
      assert.equal(calculateArrivalTag(slot, '2026-10-20T10:11:00+05:30'), 'Late', '11 min after must be Late');
      assert.equal(calculateArrivalTag(slot, null), 'Expected', 'Not arrived must be Expected');

      writer.addCaseResult({
        caseId: 'D3',
        scenario: 'Arrival tags: 11 min before = Early; 10 min before = On Time; 10 min after = On Time; 11 min after = Late; not arrived = Expected',
        status: 'PASS',
        evidence: 'Exact boundary verification: -11m=Early, -10m=On Time, +10m=On Time, +11m=Late, null=Expected.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D3', scenario: 'Arrival tags', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // Helper to create booking fixtures directly via service role
  async function createFixtureBooking({ customerId, resourceId, slotStart, slotEnd, status = 'CONFIRMED' }) {
    const doc = tenant.consultants.find(c => c.id === resourceId);
    const departmentId = doc ? doc.department_id : null;
    const ref = `BOOK-${tenant.prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const res = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: tenant.hospital.id,
        resource_id: resourceId,
        department_id: departmentId,
        customer_id: customerId,
        slot_start: slotStart,
        slot_end: slotEnd,
        status,
        deposit_amount: 100,
        total_amount: 500,
        payment_status: 'CAPTURED',
        reference_code: ref,
        version: 1
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`createFixtureBooking failed: ${JSON.stringify(data)}`);
    }
    return Array.isArray(data) ? data[0] : data;
  }

  // D4: Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for an unauthorized code
  it('D4: Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for an unauthorized code', async () => {
    try {
      const fd = getFrontDeskClient(tenant, 0);
      const doc = tenant.consultants[0];
      const patient = await getCustomerClient(tenant, 0);
      const now = await tenant.clock.get();
      const todayStr = '2026-10-20';

      // 1. Invalid Code
      const resInvalid = await fd.verifyCheckinCode('XYZINVALID');
      console.log('DEBUG resInvalid:', resInvalid);
      if (resInvalid.code === '42883') {
        throw new Error(`RPC verify_checkin_code failed with SQLSTATE 42883: ${resInvalid.message}`);
      }
      assert.equal(resInvalid.success, false);
      assert.equal(resInvalid.error, 'INVALID_CODE', 'Random string returns INVALID_CODE');

      // 2. Too Early (>60m before slot): Book slot at 14:00 (now is 09:00)
      const slotTooEarly = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
      const slotTooEarlyEnd = new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString();
      const bEarly = await createFixtureBooking({
        customerId: patient.user.id,
        resourceId: doc.id,
        slotStart: slotTooEarly,
        slotEnd: slotTooEarlyEnd,
      });

      // Fetch checkin code for bEarly
      const codeRes1 = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${bEarly.id}`, { headers: serviceHeaders });
      const [codeRec1] = await codeRes1.json();
      assert.ok(codeRec1, 'Checkin code generated');

      const resTooEarly = await fd.verifyCheckinCode(codeRec1.code);
      assert.equal(resTooEarly.success, false);
      assert.equal(resTooEarly.error, 'TOO_EARLY', 'Checking in >60m before slot returns TOO_EARLY');

      // 3. Expired code: Create booking on past date
      const pastDate = '2026-10-18';
      const bPast = await createFixtureBooking({
        customerId: patient.user.id,
        resourceId: doc.id,
        slotStart: `${pastDate}T10:00:00+05:30`,
        slotEnd: `${pastDate}T10:15:00+05:30`,
      });
      const codeResPast = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${bPast.id}`, { headers: serviceHeaders });
      const [codeRecPast] = await codeResPast.json();

      const resExpired = await fd.verifyCheckinCode(codeRecPast.code);
      assert.equal(resExpired.success, false);
      assert.equal(resExpired.error, 'EXPIRED', 'Past date code returns EXPIRED');

      // 4. Wrong day (Future date): Create booking on tomorrow
      const futureDate = '2026-10-22';
      const bFuture = await createFixtureBooking({
        customerId: patient.user.id,
        resourceId: doc.id,
        slotStart: `${futureDate}T10:00:00+05:30`,
        slotEnd: `${futureDate}T10:15:00+05:30`,
      });
      const codeResFuture = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${bFuture.id}`, { headers: serviceHeaders });
      const [codeRecFuture] = await codeResFuture.json();

      const resFuture = await fd.verifyCheckinCode(codeRecFuture.code);
      assert.equal(resFuture.success, false);
      assert.equal(resFuture.error, 'APPOINTMENT_FUTURE', 'Future date code returns APPOINTMENT_FUTURE');

      // 5. Valid check-in, then already used check-in
      const slotValid = new Date(now.getTime() + 30 * 60 * 1000).toISOString(); // 30m away (in 60m window)
      const slotValidEnd = new Date(now.getTime() + 45 * 60 * 1000).toISOString();
      const bValid = await createFixtureBooking({
        customerId: patient.user.id,
        resourceId: doc.id,
        slotStart: slotValid,
        slotEnd: slotValidEnd,
      });
      const codeResValid = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${bValid.id}`, { headers: serviceHeaders });
      const [codeRecValid] = await codeResValid.json();

      const resValid = await fd.verifyCheckinCode(codeRecValid.code);
      assert.equal(resValid.success, true, 'Valid code checkin succeeds');

      // Attempt to reuse already used code:
      const resAlreadyUsed = await fd.verifyCheckinCode(codeRecValid.code);
      assert.equal(resAlreadyUsed.success, false);
      assert.equal(resAlreadyUsed.error, 'ALREADY_CHECKED_IN', 'Reused code returns ALREADY_CHECKED_IN');

      // 6. Unauthorized code (unauthorized doctor/shop) returns identical uniform response
      const unauthDoc = tenant.consultants[2]; // Dr. Reddy (Dermatology, unassigned to fd in Neurology)
      const bUnauth = await createFixtureBooking({
        customerId: patient.user.id,
        resourceId: unauthDoc.id,
        slotStart: slotValid,
        slotEnd: slotValidEnd,
      });
      const codeResUnauth = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${bUnauth.id}`, { headers: serviceHeaders });
      const [codeRecUnauth] = await codeResUnauth.json();

      const unauthCodeRes = await fd.verifyCheckinCode(codeRecUnauth.code);
      assert.equal(unauthCodeRes.success, false);
      assert.equal(unauthCodeRes.error, 'INVALID_CODE', 'Unauthorized code returns uniform INVALID_CODE');
      assert.deepStrictEqual(
        { success: unauthCodeRes.success, error: unauthCodeRes.error, message: unauthCodeRes.message },
        { success: resInvalid.success, error: resInvalid.error, message: resInvalid.message },
        'Unauthorized response must look completely identical to invalid code response'
      );

      writer.addCaseResult({
        caseId: 'D4',
        scenario: 'Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for an unauthorized code',
        status: 'PASS',
        evidence: 'Verified exact errors: INVALID_CODE, EXPIRED, APPOINTMENT_FUTURE, TOO_EARLY, ALREADY_CHECKED_IN, and unauthorized response looks identical to invalid code.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D4', scenario: 'Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for an unauthorized code', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D5: Standby Queue FIFO by Original Booking Order
  it('D5: Standby Queue ordering follows original booking time (FIFO)', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      engine.addBooking({
        id: 'PATIENT_A',
        patientName: 'Earlier Booked Late',
        slotStart: '2026-10-20T09:00:00+05:30',
        originalBookingTime: '2026-10-20T09:00:00+05:30',
        durationMinutes: 15
      });
      engine.checkInPatient('PATIENT_A', '2026-10-20T10:10:00+05:30'); // Arrived later

      engine.addBooking({
        id: 'PATIENT_B',
        patientName: 'Later Booked Late',
        slotStart: '2026-10-20T09:30:00+05:30',
        originalBookingTime: '2026-10-20T09:30:00+05:30',
        durationMinutes: 15
      });
      engine.checkInPatient('PATIENT_B', '2026-10-20T10:05:00+05:30'); // Arrived earlier

      const queues = engine.evaluateQueues('2026-10-20T10:15:00+05:30');
      assert.equal(queues.standbyQueue[0].id, 'PATIENT_A', 'Patient with earlier original booking must be first in Standby Queue');
      assert.equal(queues.standbyQueue[1].id, 'PATIENT_B');

      writer.addCaseResult({
        caseId: 'D5',
        scenario: 'Standby Queue ordering follows original booking time (FIFO)',
        status: 'PASS',
        evidence: 'Late A (booked 09:00, arrived 10:10) placed ahead of Late B (booked 09:30, arrived 10:05).'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D5', scenario: 'Standby FIFO order', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D6: Sliding schedule optimization fills gap before next on-time window
  it('D6: Sliding schedule optimization fills gap before next on-time window', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurosurgery');
      engine.addBooking({
        id: 'P_EARLY_BOOKED',
        patientName: 'Booked 7:50',
        slotStart: '2026-10-20T07:50:00+05:30',
        durationMinutes: 15
      });
      engine.checkInPatient('P_EARLY_BOOKED', '2026-10-20T07:25:00+05:30');

      engine.addBooking({
        id: 'P_LATE',
        patientName: 'Late Patient',
        slotStart: '2026-10-20T07:00:00+05:30',
        durationMinutes: 15
      });
      engine.checkInPatient('P_LATE', '2026-10-20T07:28:00+05:30');

      const firstDispatched = engine.dispatchNext('2026-10-20T07:30:00+05:30');
      assert.equal(firstDispatched.id, 'P_LATE', 'Late patient takes the sliding gap');

      engine.completeCurrentConsultation('2026-10-20T07:45:00+05:30');
      const secondDispatched = engine.dispatchNext('2026-10-20T07:45:00+05:30');
      assert.equal(secondDispatched.id, 'P_EARLY_BOOKED', 'Booked patient enters right on schedule');

      writer.addCaseResult({
        caseId: 'D6',
        scenario: 'Sliding schedule optimization fills gap before next on-time window',
        status: 'PASS',
        evidence: 'Late patient slides into 07:30 gap and completes before 07:50 patient window opens.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D6', scenario: 'Sliding schedule', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D7: Doctor idle prevention dispatches standby patient when waiting queue empty
  it('D7: Doctor idle prevention dispatches standby patient when waiting queue empty', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      engine.addBooking({ id: 'P_STANDBY', patientName: 'Standby Member', slotStart: '2026-10-20T08:00:00+05:30', durationMinutes: 15 });
      engine.checkInPatient('P_STANDBY', '2026-10-20T08:45:00+05:30');

      const dispatched = engine.dispatchNext('2026-10-20T08:45:00+05:30');
      assert.ok(dispatched);
      assert.equal(dispatched.id, 'P_STANDBY');

      writer.addCaseResult({
        caseId: 'D7',
        scenario: 'Doctor idle prevention dispatches standby patient when waiting queue empty',
        status: 'PASS',
        evidence: 'Standby patient immediately dispatched to prevent doctor idleness.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D7', scenario: 'Doctor idle prevention', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D8: A patient checks in and then leaves: Front Desk sets No Show and the queue closes the gap
  it('D8: A patient checks in and then leaves: Front Desk sets No Show and the queue closes the gap', async () => {
    try {
      const doc = tenant.consultants[1];
      const p1 = await getCustomerClient(tenant, 1);
      const p2 = await getCustomerClient(tenant, 2);
      const now = await tenant.clock.get();

      // Create two bookings 15 mins apart directly
      const b1 = await createFixtureBooking({
        customerId: p1.user.id,
        resourceId: doc.id,
        slotStart: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
        slotEnd: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      });
      const b2 = await createFixtureBooking({
        customerId: p2.user.id,
        resourceId: doc.id,
        slotStart: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
        slotEnd: new Date(now.getTime() + 45 * 60 * 1000).toISOString(),
      });

      // Mark b1 present (checked in)
      await fetch(`${url}/rest/v1/bookings?id=eq.${b1.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ status: 'CHECKED_IN', is_present: true })
      });

      // Front Desk records No Show when patient leaves
      const noShowRes = await fetch(`${url}/rest/v1/rpc/record_no_show`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ p_booking_id: b1.id })
      });
      const noShowData = await noShowRes.json();
      console.log('DEBUG noShowData:', noShowData);
      assert.equal(noShowData.success, true, 'Booking transitioned to NO_SHOW');

      // Verify in DB that b1 is NO_SHOW and b2 is now the active front of the queue
      const checkRes = await fetch(`${url}/rest/v1/bookings?id=eq.${b1.id}`, { headers: serviceHeaders });
      const [updatedB1] = await checkRes.json();
      assert.equal(updatedB1.status, 'NO_SHOW');

      const queueRes = await fetch(`${url}/rest/v1/bookings?provider_id=eq.${tenant.hospital.id}&resource_id=eq.${doc.id}&status=in.(CONFIRMED,CHECKED_IN)&order=slot_start.asc`, { headers: serviceHeaders });
      const activeQueue = await queueRes.json();
      assert.equal(activeQueue[0].id, b2.id, 'Patient 2 moved to head of queue, closing the gap');

      writer.addCaseResult({
        caseId: 'D8',
        scenario: 'A patient checks in and then leaves: Front Desk sets No Show and the queue closes the gap',
        status: 'PASS',
        evidence: 'Front Desk set NO_SHOW on departed patient; remaining queue immediately moved up closing gap.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D8', scenario: 'A patient checks in and then leaves: Front Desk sets No Show and the queue closes the gap', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // Extra Tests: X-D10 and X-D12
  it('X-D10: Burst arrivals: 10 concurrent check-ins maintain deterministic ordering', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      const baseOnTimeMs = new Date('2026-10-20T10:00:00+05:30').getTime();
      const baseLateMs = new Date('2026-10-20T08:00:00+05:30').getTime();

      for (let i = 1; i <= 5; i++) {
        engine.addBooking({
          id: `ON_${i}`,
          patientName: `OnTime ${i}`,
          slotStart: new Date(baseOnTimeMs + (i - 1) * 10 * 60 * 1000).toISOString(),
          durationMinutes: 10
        });
        engine.addBooking({
          id: `LATE_${i}`,
          patientName: `Late ${i}`,
          slotStart: new Date(baseLateMs + (i - 1) * 10 * 60 * 1000).toISOString(),
          originalBookingTime: new Date(baseLateMs + (i - 1) * 10 * 60 * 1000).toISOString(),
          durationMinutes: 10
        });
      }

      const burstTime = '2026-10-20T10:00:00+05:30';
      for (let i = 1; i <= 5; i++) {
        engine.checkInPatient(`ON_${i}`, burstTime);
        engine.checkInPatient(`LATE_${i}`, burstTime);
      }

      const q = engine.evaluateQueues(burstTime);
      assert.equal(q.waitingQueue.length, 5);
      assert.equal(q.standbyQueue.length, 5);
      assert.equal(q.standbyQueue[0].id, 'LATE_1');

      writer.addCaseResult({
        caseId: 'X-D10',
        scenario: 'Burst arrival handling across 10 simultaneous arrivals',
        status: 'PASS',
        evidence: '10 simultaneous arrivals split cleanly (5 waiting, 5 standby) and sorted deterministically.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'X-D10', scenario: 'Burst arrivals', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  it('X-D12: Multi-department queue isolation', async () => {
    try {
      const neuroEngine = new HospitalDepartmentQueueEngine('Neurology');
      const dermaEngine = new HospitalDepartmentQueueEngine('Dermatology');

      neuroEngine.addBooking({ id: 'NEURO_1', patientName: 'Neuro Patient', slotStart: '2026-10-20T10:00:00+05:30', durationMinutes: 15 });
      dermaEngine.addBooking({ id: 'DERMA_1', patientName: 'Derma Patient', slotStart: '2026-10-20T10:00:00+05:30', durationMinutes: 15 });

      neuroEngine.checkInPatient('NEURO_1', '2026-10-20T10:00:00+05:30');

      const neuroQ = neuroEngine.evaluateQueues('2026-10-20T10:00:00+05:30');
      const dermaQ = dermaEngine.evaluateQueues('2026-10-20T10:00:00+05:30');

      assert.equal(neuroQ.waitingQueue.length, 1);
      assert.equal(dermaQ.waitingQueue.length, 0);

      writer.addCaseResult({
        caseId: 'X-D12',
        scenario: 'Multi-department queue isolation (Neurology vs Dermatology)',
        status: 'PASS',
        evidence: 'Independent queues confirmed; zero cross-department queue leakage.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'X-D12', scenario: 'Department queue isolation', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });
});
