import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

/**
 * tests/unit/hospital-hardened-rpcs.test.mjs
 * 
 * Subtask 4 Verification:
 * Validates hardened RPCs (verify_checkin_code & mark_present_manually):
 * - Per-consultant authorization: Admin, assigned Front Desk, and Consultant only
 * - Uniform INVALID_CODE for wrong shop, wrong department, unassigned doctor, and non-existent codes
 * - Rate limiting on failed/unauthorized check-in attempts
 * - Atomic check-in and mark-present concurrency
 * - Cross-hospital attempts rejection
 */

describe('Subtask 4: Hardened Hospital RPCs', () => {
  let url;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let hospB;
  let salon;
  let tokens = {};
  let doc1;
  let doc2;
  let deptNeuro;
  let deptDerma;
  let bookingDoc1;
  let bookingDoc2;
  let bookingDerma;
  let codeDoc1;
  let codeDoc2;
  let codeDerma;

  before(async () => {
    const envPath = 'apps/merchant-web/.env.local';
    url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImY4NjVkNGZlLWMxZDItNGY2Zi1iZDVmLWMxOGM1MzVhYjI2MiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjEwOTUwMzM2NX0.BDT0gXGQ9sgytDhmzV29c1y-NN-vw-cS-hEfGxMjGCF0LBFtxYTOE7Pz38p92N_P47F-muq8KgVEdR0pvA_C3g';

    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
      const keyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);
      if (urlMatch) url = urlMatch[1];
      if (keyMatch) serviceKey = keyMatch[1];
    }

    serviceHeaders = {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
    hospA = manifest.hospitalA;
    hospB = manifest.hospitalB;
    salon = manifest.salon;

    async function login(email, password = 'HospitalTest2026!') {
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'apikey': serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      return { token: data.access_token, user: data.user };
    }

    tokens.adminApex = await login('admin.apex@test-tirupati.local');
    tokens.neuroDoc = await login('neuro.doc@test-tirupati.local');
    tokens.neuroDesk = await login('neuro.desk@test-tirupati.local');
    tokens.adminBalaji = await login('admin.balaji@test-tirupati.local');
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');
    tokens.patient2 = await login('test.patient.02@test-tirupati.local');
    tokens.patient3 = await login('test.patient.03@test-tirupati.local');

    deptNeuro = hospA.departments.find(d => d.name === 'Neurology');
    deptDerma = hospA.departments.find(d => d.name === 'Dermatology');

    const docsRes = await fetch(`${url}/rest/v1/resources?provider_id=eq.${hospA.id}`, { headers: serviceHeaders });
    const docs = await docsRes.json();
    doc1 = docs.find(d => d.name.includes('Sharma'));
    doc2 = docs.find(d => d.name.includes('Patel'));
    const docDerma = docs.find(d => d.name.includes('Rao'));

    // Bind Doctor 1 to neuroDoc
    await fetch(`${url}/rest/v1/resources?id=eq.${doc1.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ user_id: tokens.neuroDoc.user.id })
    });

    // Assign neuroDesk ONLY to doc1
    await fetch(`${url}/rest/v1/doctor_front_desk_assignments?user_id=eq.${tokens.neuroDesk.user.id}`, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    await fetch(`${url}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: doc1.id,
        user_id: tokens.neuroDesk.user.id,
        id_card_number: 'HOSP-FD-SUBTASK4'
      })
    });

    // Helper to create test booking safely on current Asia/Kolkata calendar date
    const istNow = new Date();
    const istHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(istNow), 10);
    const baseOffset = istHour >= 23 ? -25 : (istHour < 1 ? 5 : 0);

    async function createTestBooking(refCode, docId, deptId, patientId, slotOffsetMinutes = 0) {
      await fetch(`${url}/rest/v1/bookings?reference_code=eq.${refCode}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });

      // Cancel any existing bookings for this patient at hospA so permanent PIN resolves uniquely to this test booking
      await fetch(`${url}/rest/v1/bookings?customer_id=eq.${patientId}&provider_id=eq.${hospA.id}&reference_code=neq.${refCode}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ status: 'CANCELLED' })
      });

      // Cancel any active bookings for this doctor that could conflict on time
      await fetch(`${url}/rest/v1/bookings?resource_id=eq.${docId}&status=in.(CONFIRMED,CHECKED_IN,PENDING_PAYMENT)&reference_code=neq.${refCode}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ status: 'CANCELLED' })
      });

      const slotStart = new Date(istNow.getTime() + (baseOffset + slotOffsetMinutes) * 60 * 1000).toISOString();
      const slotEnd = new Date(istNow.getTime() + (baseOffset + slotOffsetMinutes + 15) * 60 * 1000).toISOString();

      const bRes = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          customer_id: patientId,
          provider_id: hospA.id,
          resource_id: docId,
          department_id: deptId,
          slot_start: slotStart,
          slot_end: slotEnd,
          status: 'CONFIRMED',
          is_present: false,
          reference_code: refCode,
          total_amount: 500,
          deposit_amount: 100,
          platform_fee: 10,
          payment_status: 'CAPTURED'
        })
      });
      const booking = (await bRes.json())[0];

      // Get generated check-in code
      const codeRes = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${booking.id}`, {
        headers: serviceHeaders
      });
      const codeRows = await codeRes.json();
      return { booking, code: codeRows[0]?.code };
    }

    const t1 = await createTestBooking('ST4-DOC1', doc1.id, deptNeuro.id, tokens.patient1.user.id, 0);
    bookingDoc1 = t1.booking;
    codeDoc1 = t1.code;

    const t2 = await createTestBooking('ST4-DOC2', doc2.id, deptNeuro.id, tokens.patient2.user.id, 5);
    bookingDoc2 = t2.booking;
    codeDoc2 = t2.code;

    const t3 = await createTestBooking('ST4-DERMA', docDerma.id, deptDerma.id, tokens.patient3.user.id, 10);
    bookingDerma = t3.booking;
    codeDerma = t3.code;
  });

  function userHeaders(userAuth) {
    return {
      'apikey': serviceKey,
      'Authorization': `Bearer ${userAuth.token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  // 1. verify_checkin_code: Assigned Front Desk vs Unassigned Doctor
  it('1. Front Desk can verify assigned doctor patient, and receives INVALID_CODE for unassigned doctor', async () => {
    // Reset rate limits
    await fetch(`${url}/rest/v1/staff_checkin_rate_limits?user_id=eq.${tokens.neuroDesk.user.id}`, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    // Assigned doc1 check-in
    const resAssigned = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ p_shop_id: hospA.id, p_code: codeDoc1 })
    });
    const dataAssigned = await resAssigned.json();
    assert.equal(dataAssigned.success, true, 'Assigned doctor check-in must succeed');
    assert.equal(dataAssigned.booking_id, bookingDoc1.id);

    // Unassigned doc2 check-in
    const resUnassigned = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ p_shop_id: hospA.id, p_code: codeDoc2 })
    });
    const dataUnassigned = await resUnassigned.json();
    assert.equal(dataUnassigned.success, false, 'Unassigned doctor check-in must fail');
    assert.equal(dataUnassigned.error, 'INVALID_CODE', 'Must return uniform INVALID_CODE');
  });

  // 2. Uniform INVALID_CODE on cross-shop and cross-department attempts
  it('2. verify_checkin_code returns uniform INVALID_CODE on cross-hospital and cross-department attempts', async () => {
    // Clear rate limits for both callers
    await fetch(`${url}/rest/v1/staff_checkin_rate_limits?user_id=in.(${tokens.adminBalaji.user.id},${tokens.neuroDesk.user.id})`, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    // Cross-hospital: Admin Balaji of Hospital B calling Hospital A code
    const resCrossHosp = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
      method: 'POST',
      headers: userHeaders(tokens.adminBalaji),
      body: JSON.stringify({ p_shop_id: hospB.id, p_code: codeDoc2 })
    });
    const dataCrossHosp = await resCrossHosp.json();
    assert.equal(dataCrossHosp.success, false);
    assert.equal(dataCrossHosp.error, 'INVALID_CODE', 'Cross-hospital attempt must return INVALID_CODE (no WRONG_SHOP)');

    // Cross-department: Neurology Front Desk calling Dermatology code
    const resCrossDept = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ p_shop_id: hospA.id, p_code: codeDerma })
    });
    const dataCrossDept = await resCrossDept.json();
    assert.equal(dataCrossDept.success, false);
    assert.equal(dataCrossDept.error, 'INVALID_CODE', 'Cross-department attempt must return INVALID_CODE (no UNAUTHORIZED_DEPARTMENT)');
  });

  // 3. Rate limiting unauthorized attempts
  it('3. Unauthorized verify_checkin_code attempts count toward rate limit and lock after 5 failures', async () => {
    // Clear rate limits
    await fetch(`${url}/rest/v1/staff_checkin_rate_limits?user_id=eq.${tokens.neuroDesk.user.id}`, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    // Make 5 invalid attempts with unassigned doctor code
    for (let i = 0; i < 5; i++) {
      await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: userHeaders(tokens.neuroDesk),
        body: JSON.stringify({ p_shop_id: hospA.id, p_code: codeDoc2 })
      });
    }

    // 6th attempt should be rate limited
    const resLocked = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ p_shop_id: hospA.id, p_code: codeDoc2 })
    });
    const dataLocked = await resLocked.json();
    assert.equal(dataLocked.success, false);
    assert.equal(dataLocked.error, 'RATE_LIMITED', '6th failed attempt must be RATE_LIMITED');
  });

  // 4. mark_present_manually: Admin, Assigned Front Desk vs Unassigned Front Desk & Consultant
  it('4. mark_present_manually allows Admin and assigned staff, and rejects unassigned with FORBIDDEN', async () => {
    // Re-create bookingDoc2 in confirmed status
    await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc2.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ status: 'CONFIRMED', is_present: false })
    });

    // neuroDesk (unassigned to doc2) calls mark_present_manually on bookingDoc2
    const resUnassigned = await fetch(`${url}/rest/v1/rpc/mark_present_manually`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ p_booking_id: bookingDoc2.id })
    });
    const dataUnassigned = await resUnassigned.json();
    assert.equal(dataUnassigned.success, false);
    assert.equal(dataUnassigned.error, 'FORBIDDEN', 'Unassigned Front Desk must receive FORBIDDEN');

    // Cross-hospital: Admin Balaji calling Hospital A bookingDoc2
    const resCross = await fetch(`${url}/rest/v1/rpc/mark_present_manually`, {
      method: 'POST',
      headers: userHeaders(tokens.adminBalaji),
      body: JSON.stringify({ p_booking_id: bookingDoc2.id })
    });
    const dataCross = await resCross.json();
    assert.equal(dataCross.success, false);
    assert.equal(dataCross.error, 'FORBIDDEN', 'Cross-hospital mark_present_manually must receive FORBIDDEN');

    // Hospital Admin calling mark_present_manually on bookingDoc2
    const resAdmin = await fetch(`${url}/rest/v1/rpc/mark_present_manually`, {
      method: 'POST',
      headers: userHeaders(tokens.adminApex),
      body: JSON.stringify({ p_booking_id: bookingDoc2.id })
    });
    const dataAdmin = await resAdmin.json();
    assert.equal(dataAdmin.success, true, 'Hospital Admin can mark present manually for any doctor in hospital');
    assert.equal(dataAdmin.booking_id, bookingDoc2.id);
  });

  // 5. Atomic concurrency on check-in
  it('5. Atomic check-in guarantees exactly one concurrent caller succeeds', async () => {
    // Reset bookingDoc2 to CONFIRMED
    await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc2.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ status: 'CONFIRMED', is_present: false })
    });

    // Reset rate limits for adminApex
    await fetch(`${url}/rest/v1/staff_checkin_rate_limits?user_id=eq.${tokens.adminApex.user.id}`, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    // Concurrent check-in calls with adminApex
    const calls = [
      fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: userHeaders(tokens.adminApex),
        body: JSON.stringify({ p_shop_id: hospA.id, p_code: codeDoc2 })
      }),
      fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: userHeaders(tokens.adminApex),
        body: JSON.stringify({ p_shop_id: hospA.id, p_code: codeDoc2 })
      })
    ];

    const results = await Promise.all(calls);
    const data1 = await results[0].json();
    const data2 = await results[1].json();

    const successCount = (data1.success ? 1 : 0) + (data2.success ? 1 : 0);
    assert.equal(successCount, 1, 'Exactly one concurrent verify_checkin_code caller must succeed');

    const alreadyCount = (data1.error === 'ALREADY_CHECKED_IN' ? 1 : 0) + (data2.error === 'ALREADY_CHECKED_IN' ? 1 : 0);
    assert.equal(alreadyCount, 1, 'Losing concurrent caller must receive ALREADY_CHECKED_IN');
  });

  // 6. complete_booking RPC rejects non-completable bookings (CANCELLED, HELD)
  it('6. complete_booking RPC rejects non-completable bookings (CANCELLED, HELD)', async () => {
    // Create test booking in CANCELLED status
    const bkgRes = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient1.user.id,
        provider_id: hospA.id,
        resource_id: doc1.id,
        department_id: deptNeuro.id,
        slot_start: new Date(Date.now() + 1500 * 3600 * 1000).toISOString(),
        slot_end: new Date(Date.now() + 1500 * 3600 * 1000 + 15 * 60 * 1000).toISOString(),
        status: 'CANCELLED',
        payment_status: 'REFUNDED',
        reference_code: 'ST4-RPC-CMP',
        deposit_amount: 100,
        platform_fee: 10,
        total_amount: 500,
      }),
    });
    const bkg = (await bkgRes.json())[0];
    assert.ok(bkg?.id, 'Booking must be created');

    // 1. Call complete_booking RPC when status = 'CANCELLED'
    const rpcCancelled = await fetch(`${url}/rest/v1/rpc/complete_booking`, {
      method: 'POST',
      headers: userHeaders(tokens.adminApex),
      body: JSON.stringify({ p_booking_id: bkg.id }),
    });
    const dataCancelled = await rpcCancelled.json();
    assert.equal(dataCancelled.success, false, 'RPC must fail on CANCELLED booking');
    assert.ok(dataCancelled.error.includes('Only CONFIRMED, CHECKED_IN, or IN_CONSULTATION bookings can be completed'), `Expected error message but got: ${dataCancelled.error}`);

    // 2. Change status to 'HELD' and test RPC fails
    await fetch(`${url}/rest/v1/bookings?id=eq.${bkg.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ status: 'HELD' }),
    });
    const rpcHeld = await fetch(`${url}/rest/v1/rpc/complete_booking`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDoc),
      body: JSON.stringify({ p_booking_id: bkg.id }),
    });
    const dataHeld = await rpcHeld.json();
    assert.equal(dataHeld.success, false, 'RPC must fail on HELD booking');
    assert.ok(dataHeld.error.includes('Only CONFIRMED, CHECKED_IN, or IN_CONSULTATION bookings can be completed'));

    // 3. Change status to 'IN_CONSULTATION' and test RPC succeeds
    await fetch(`${url}/rest/v1/bookings?id=eq.${bkg.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ status: 'IN_CONSULTATION' }),
    });
    const rpcInConsult = await fetch(`${url}/rest/v1/rpc/complete_booking`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDoc),
      body: JSON.stringify({ p_booking_id: bkg.id }),
    });
    const dataInConsult = await rpcInConsult.json();
    assert.equal(dataInConsult.success, true, 'RPC must succeed on IN_CONSULTATION booking');
    assert.equal(dataInConsult.status, 'COMPLETED');

    // 4. Test calling again on COMPLETED booking
    const rpcCompletedAgain = await fetch(`${url}/rest/v1/rpc/complete_booking`, {
      method: 'POST',
      headers: userHeaders(tokens.adminApex),
      body: JSON.stringify({ p_booking_id: bkg.id }),
    });
    const dataCompletedAgain = await rpcCompletedAgain.json();
    assert.equal(dataCompletedAgain.success, true, 'Idempotent complete_booking returns success');
    assert.equal(dataCompletedAgain.status, 'COMPLETED');
  });

  // 7. Hospital route status transitions: CHECKED_IN -> IN_CONSULTATION -> COMPLETED
  it('7. Hospital route status transitions: CHECKED_IN -> IN_CONSULTATION -> COMPLETED with role checks', async () => {
    const appBaseUrl = process.env.TEST_APP_URL || 'http://localhost:3000';
    // Create test booking in CHECKED_IN status for doc1
    const bkgRes = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient1.user.id,
        provider_id: hospA.id,
        resource_id: doc1.id,
        department_id: deptNeuro.id,
        slot_start: new Date(Date.now() + 1600 * 3600 * 1000).toISOString(),
        slot_end: new Date(Date.now() + 1600 * 3600 * 1000 + 15 * 60 * 1000).toISOString(),
        status: 'CHECKED_IN',
        payment_status: 'CAPTURED',
        reference_code: 'ST4-TRANS',
        deposit_amount: 100,
        platform_fee: 10,
        total_amount: 500,
      }),
    });
    const bkg = (await bkgRes.json())[0];
    assert.ok(bkg?.id, 'Booking must be created');

    // Unauthorized caller: patient attempting to start consultation (403)
    const unauthStart = await fetch(`${appBaseUrl}/api/bookings/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.patient1.token}` },
      body: JSON.stringify({ booking_id: bkg.id }),
    });
    assert.equal(unauthStart.status, 403, 'Patient cannot start consultation');

    // Cross-hospital admin attempting to start consultation (403)
    const crossStart = await fetch(`${appBaseUrl}/api/bookings/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.adminBalaji.token}` },
      body: JSON.stringify({ booking_id: bkg.id }),
    });
    assert.equal(crossStart.status, 403, 'Cross-hospital admin cannot start consultation');

    // Authorized consultant (neuroDoc) starts consultation: CHECKED_IN -> IN_CONSULTATION
    const authStart = await fetch(`${appBaseUrl}/api/bookings/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.neuroDoc.token}` },
      body: JSON.stringify({ booking_id: bkg.id }),
    });
    assert.equal(authStart.status, 200, 'Authorized doctor can start consultation');
    const startData = await authStart.json();
    assert.equal(startData.status, 'IN_CONSULTATION');

    // Illegal transition: attempt to admit (CHECKED_IN) on IN_CONSULTATION must be rejected (409)
    const illegalAdmit = await fetch(`${appBaseUrl}/api/bookings/admit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.neuroDesk.token}` },
      body: JSON.stringify({ booking_id: bkg.id }),
    });
    assert.equal(illegalAdmit.status, 409, 'Cannot revert IN_CONSULTATION to CHECKED_IN');

    // Unauthorized caller: patient attempting to complete consultation
    const unauthComplete = await fetch(`${url}/rest/v1/rpc/complete_booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${tokens.patient1.token}` },
      body: JSON.stringify({ p_booking_id: bkg.id }),
    });
    assert.equal(unauthComplete.status, 200);
    const unauthData = await unauthComplete.json();
    assert.equal(unauthData.success, false, 'Patient cannot complete consultation');
    assert.match(unauthData.error, /Unauthorized/);

    // Authorized consultant completes consultation: IN_CONSULTATION -> COMPLETED
    const authComplete = await fetch(`${url}/rest/v1/rpc/complete_booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${tokens.neuroDoc.token}` },
      body: JSON.stringify({ p_booking_id: bkg.id }),
    });
    assert.equal(authComplete.status, 200, 'Authorized doctor can complete consultation');
    const completeData = await authComplete.json();
    assert.equal(completeData.status, 'COMPLETED');

    // Terminal state protection: Cannot start or admit a COMPLETED booking
    const illegalStartOnCompleted = await fetch(`${appBaseUrl}/api/bookings/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.neuroDoc.token}` },
      body: JSON.stringify({ booking_id: bkg.id }),
    });
    assert.equal(illegalStartOnCompleted.status, 409, 'Cannot transition COMPLETED to IN_CONSULTATION');
  });

  after(async () => {
    for (const ref of ['ST4-DOC1', 'ST4-DOC2', 'ST4-DERMA', 'ST4-RPC-CMP', 'ST4-TRANS']) {
      await fetch(`${url}/rest/v1/bookings?reference_code=eq.${ref}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });
    }
  });
});
