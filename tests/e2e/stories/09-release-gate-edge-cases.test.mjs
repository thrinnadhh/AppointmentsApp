// ============================================================================
// Group 9: Backend Release Gate Edge Cases (SG-01, SG-02, SG-03)
// 1. SG-01: Consultant invite link expiry after 7 days (7-Day TTL)
// 2. SG-02: Post-cancellation retry race condition (concurrency row lock)
// 3. SG-03: Client network disconnection resilience & idempotency (check-in retry)
// ============================================================================

import {
  loadStoryManifest,
  getStoryConfig,
  directDb,
  globalCollector,
} from './story-helpers.mjs';

function logResult(flowName, expected, actual, pass) {
  const resultStr = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`[FLOW TOUCHED] ${flowName} | [EXPECTED] ${expected} | [ACTUAL] ${actual} | [RESULT] ${resultStr}`);
}

export async function runReleaseGateEdgeCases(collector = globalCollector) {
  console.log('\n======================================================================');
  console.log('🛡️ RELEASE GATE FINAL EDGE CASES VERIFICATION (A7, J2, J3)');
  console.log('======================================================================\n');

  const manifest = loadStoryManifest();
  const config = getStoryConfig();

  const h1 = manifest.hospitals.H1;
  const docSharma = h1.consultants.sharma;
  const u1 = manifest.customers.U1;
  const u3 = manifest.customers.U3;
  const fd1 = h1.frontDesk.fd1;

  let allPassed = true;

  // =========================================================================
  // 1. Test A7: Consultant Invite Expiry (7-Day TTL)
  // =========================================================================
  console.log('--- 1. Test A7: Consultant Invite Expiry (7-Day TTL) ---');
  let testDeptId = null;
  let expiredInviteId = null;

  try {
    // Create an isolated department to ensure no 3-member quota constraint collision
    const deptRes = await directDb(
      'INSERT INTO public.departments (merchant_id, name) VALUES ($1, $2) RETURNING id;',
      [h1.provider.id, `Audit Dept ${Date.now()}`]
    );
    testDeptId = deptRes[0].id;

    // Forcibly clean prior invites for test user and insert expired invite (created 8 days ago, expired 1 day ago)
    await directDb('DELETE FROM public.department_members WHERE email = $1;', [u3.email]);
    const inviteRes = await directDb(
      `INSERT INTO public.department_members (
        merchant_id, department_id, email, status, role, created_at, invited_at, invite_expires_at
      ) VALUES (
        $1, $2, $3, $4, $5, now() - interval '8 days', now() - interval '8 days', now() - interval '1 day'
      ) RETURNING id, email, status, invite_expires_at;`,
      [h1.provider.id, testDeptId, u3.email, 'invited', 'consultant']
    );
    expiredInviteId = inviteRes[0].id;

    // Attempt to accept expired invite via PUT /api/hospital/members
    const acceptRes = await fetch(`${config.appUrl}/api/hospital/members`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${u3.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'accept' }),
    });

    const acceptJson = await acceptRes.json().catch(() => ({}));
    const isExpiredRejection =
      (acceptRes.status === 410 || acceptRes.status === 400 || acceptRes.status === 403) &&
      (acceptJson.expired === true || acceptJson.error?.toLowerCase().includes('expired'));

    if (!isExpiredRejection) allPassed = false;

    logResult(
      'SG-01: Consultant Invite Expiry (7-Day TTL)',
      'HTTP 410/400/403 Expired Rejection (7-Day TTL Enforced)',
      `HTTP ${acceptRes.status} Rejection (error="${acceptJson.error || 'N/A'}", expired=${acceptJson.expired})`,
      isExpiredRejection
    );

    collector.record({
      id: 'SG-01',
      hospital: 'H1',
      customer: 'U3',
      expected: 'HTTP 410 Expired Rejection',
      actual: `HTTP ${acceptRes.status} (${acceptJson.error || 'Expired'})`,
      result: isExpiredRejection ? 'PASS' : 'FAIL',
    });
  } catch (err) {
    allPassed = false;
    logResult('SG-01: Consultant Invite Expiry (7-Day TTL)', 'HTTP 410 Expired Rejection', `Error: ${err.message}`, false);
  } finally {
    if (expiredInviteId) {
      await directDb('DELETE FROM public.department_members WHERE id = $1;', [expiredInviteId]).catch(() => {});
    }
    if (testDeptId) {
      await directDb('DELETE FROM public.departments WHERE id = $1;', [testDeptId]).catch(() => {});
    }
  }

  // =========================================================================
  // 2. Test J2: Cancellation Retry Race Condition
  // =========================================================================
  console.log('\n--- 2. Test J2: Cancellation Retry Race Condition ---');
  let raceBookingId = null;

  try {
    const offsetMin = Math.floor(Math.random() * 50000) + 15000;
    const slotRes = await directDb(
      `INSERT INTO public.bookings (
        provider_id, resource_id, customer_id, slot_start, slot_end, status, payment_status, deposit_amount, total_amount, reference_code
      ) VALUES (
        $1, $2, $3, now() + ($5 || ' minutes')::interval, now() + ($5 || ' minutes')::interval + interval '15 minutes', 'CONFIRMED', 'CAPTURED', 200, 500, $4
      ) RETURNING id`,
      [h1.provider.id, docSharma.resourceId, u1.id, `RACE-J2-${Date.now()}`, `${offsetMin}`]
    );
    raceBookingId = slotRes[0].id;

    const cancelPayload = JSON.stringify({ booking_id: raceBookingId, reason: 'Concurrent race condition test' });
    const cancelHeaders = {
      'Authorization': `Bearer ${u1.token}`,
      'Content-Type': 'application/json',
    };

    // Fire two concurrent cancellation requests at the exact same millisecond
    const [res1, res2] = await Promise.all([
      fetch(`${config.appUrl}/api/bookings/cancel`, { method: 'POST', headers: cancelHeaders, body: cancelPayload }),
      fetch(`${config.appUrl}/api/bookings/cancel`, { method: 'POST', headers: cancelHeaders, body: cancelPayload }),
    ]);

    const json1 = await res1.json().catch(() => ({}));
    const json2 = await res2.json().catch(() => ({}));

    // Exactly one must succeed (200), and the other must be rejected (400 or 409)
    const oneSucceeded = (res1.status === 200 && res2.status !== 200) || (res2.status === 200 && res1.status !== 200);
    const loserRejectedProperly = [400, 409].includes(res1.status === 200 ? res2.status : res1.status);

    // Verify DB integrity: booking is CANCELLED exactly once
    const dbBooking = await directDb('SELECT status, payment_status FROM public.bookings WHERE id = $1;', [raceBookingId]);
    const dbClean = dbBooking[0]?.status === 'CANCELLED';

    const passJ2 = oneSucceeded && loserRejectedProperly && dbClean;
    if (!passJ2) allPassed = false;

    const winnerStatus = res1.status === 200 ? `Req 1: HTTP 200 (CANCELLED)` : `Req 2: HTTP 200 (CANCELLED)`;
    const loserStatus = res1.status === 200 ? `Req 2: HTTP ${res2.status} (${json2.error})` : `Req 1: HTTP ${res1.status} (${json1.error})`;

    logResult(
      'SG-02: Cancellation Retry Race Condition',
      'Single Successful Cancellation (HTTP 200) & Race Loser Rejected (HTTP 400/409)',
      `${winnerStatus} | ${loserStatus}`,
      passJ2
    );

    collector.record({
      id: 'SG-02',
      hospital: 'H1',
      customer: 'U1',
      expected: '1 Success (HTTP 200) + 1 Conflict/Error (HTTP 400/409)',
      actual: `${winnerStatus} | ${loserStatus}`,
      result: passJ2 ? 'PASS' : 'FAIL',
    });
  } catch (err) {
    allPassed = false;
    logResult('SG-02: Cancellation Retry Race Condition', 'HTTP 200 & HTTP 400/409', `Error: ${err.message}`, false);
  }

  // =========================================================================
  // 3. Test SG-03: Idempotency & Network Drop Resilience
  // =========================================================================
  console.log('\n--- 3. Test SG-03: Idempotency & Network Drop Resilience ---');
  let idempBookingId = null;

  try {
    const offsetMin = Math.floor(Math.random() * 50000) + 25000;
    const slotRes = await directDb(
      `INSERT INTO public.bookings (
        provider_id, resource_id, customer_id, slot_start, slot_end, status, payment_status, deposit_amount, total_amount, reference_code
      ) VALUES (
        $1, $2, $3, now() + ($5 || ' minutes')::interval, now() + ($5 || ' minutes')::interval + interval '15 minutes', 'CONFIRMED', 'CAPTURED', 200, 500, $4
      ) RETURNING id`,
      [h1.provider.id, docSharma.resourceId, u1.id, `IDEMP-SG3-${Date.now()}`, `${offsetMin}`]
    );
    idempBookingId = slotRes[0].id;

    // Create unique 4-digit check-in code record
    const checkinPin = String(Math.floor(Math.random() * 8999) + 1000);
    await directDb(
      `INSERT INTO public.appointment_checkin_codes (
        booking_id, provider_id, customer_id, code, appointment_date
      ) VALUES (
        $1, $2, $3, $4, CURRENT_DATE
      ) ON CONFLICT (booking_id) DO UPDATE SET code = $4;`,
      [idempBookingId, h1.provider.id, u1.id, checkinPin]
    );

    const checkinPayload = JSON.stringify({ code: checkinPin, shopId: h1.provider.id });
    const checkinHeaders = {
      'Authorization': `Bearer ${fd1.token}`,
      'Content-Type': 'application/json',
    };

    // Call 1: Initial mutating request
    const checkinRes1 = await fetch(`${config.appUrl}/api/bookings/checkin`, {
      method: 'POST',
      headers: checkinHeaders,
      body: checkinPayload,
    });
    const checkinJson1 = await checkinRes1.json().catch(() => ({}));

    // Call 2: Simulated network retry from client
    const checkinRes2 = await fetch(`${config.appUrl}/api/bookings/checkin`, {
      method: 'POST',
      headers: checkinHeaders,
      body: checkinPayload,
    });
    const checkinJson2 = await checkinRes2.json().catch(() => ({}));

    // Call 1 should succeed with 200, Call 2 should be handled gracefully with 200 (ALREADY_CHECKED_IN) or 409
    const call1Success = checkinRes1.status === 200 && checkinJson1.success === true;
    const call2Graceful =
      (checkinRes2.status === 200 || checkinRes2.status === 409) &&
      (checkinJson2.error === 'ALREADY_CHECKED_IN' || checkinJson2.message?.toLowerCase().includes('already'));

    // Verify DB integrity: booking is CHECKED_IN with is_present=true and no duplicates
    const dbBooking = await directDb('SELECT status, is_present, checked_in_at FROM public.bookings WHERE id = $1;', [idempBookingId]);
    const dbClean = dbBooking[0]?.status === 'CHECKED_IN' && dbBooking[0]?.is_present === true;

    const passJ3 = call1Success && call2Graceful && dbClean;
    if (!passJ3) allPassed = false;

    logResult(
      'SG-03: Idempotency & Network Drop Resilience',
      'Initial Check-In HTTP 200 & Graceful Retry HTTP 200/409 (ALREADY_CHECKED_IN)',
      `Call 1: HTTP ${checkinRes1.status} (CHECKED_IN) | Call 2: HTTP ${checkinRes2.status} (${checkinJson2.error || 'Graceful Response'})`,
      passJ3
    );

    collector.record({
      id: 'SG-03',
      hospital: 'H1',
      customer: 'U1',
      expected: 'Call 1: HTTP 200 (Success) | Call 2: HTTP 200/409 (ALREADY_CHECKED_IN)',
      actual: `Call 1: HTTP ${checkinRes1.status} | Call 2: HTTP ${checkinRes2.status} (${checkinJson2.error || 'OK'})`,
      result: passJ3 ? 'PASS' : 'FAIL',
    });
  } catch (err) {
    allPassed = false;
    logResult('SG-03: Idempotency & Network Drop Resilience', 'HTTP 200 & Graceful Retry', `Error: ${err.message}`, false);
  }

  console.log('\n======================================================================');
  console.log(`🏁 GATE RESULT: ${allPassed ? 'ALL THREE EDGE CASES CLEARED ✅' : 'FAILURES DETECTED ❌'}`);
  console.log('======================================================================\n');

  return allPassed;
}

if (process.argv[1] && process.argv[1].endsWith('09-release-gate-edge-cases.test.mjs')) {
  runReleaseGateEdgeCases()
    .then((success) => setTimeout(() => process.exit(success ? 0 : 1), 100))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
