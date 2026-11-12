import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

/**
 * tests/unit/hospital-per-consultant-gaps.test.mjs
 * 
 * Subtask 1: Reproduce the gaps first.
 * These tests prove each gap from the inspection report:
 * 1. Front Desk reading another Consultant's bookings in the same department
 * 2. Front Desk checking in another Consultant's patient via check-in code
 * 3. Front Desk calling mark_present_manually on an unassigned doctor
 * 4. Consultant reading another Consultant's bookings in the whole department
 * 5. Unauthorized check-in codes returning WRONG_SHOP or UNAUTHORIZED_DEPARTMENT (leaking existence)
 * 6. Missing audit entries in public.audit_logs on check-in and booking status updates
 * 
 * Done when: the tests exist and fail for the right reasons.
 */

describe('Subtask 1: Hospital Per-Consultant RBAC Gaps Reproduction', () => {
  let url;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let hospB;
  let tokens = {};
  let deptNeuro;
  let doc1;
  let doc2;
  let bookingDoc1;
  let bookingDoc2;
  let checkinCodeDoc2;
  let dermaBookingCode;

  before(async () => {
    const envPath = 'apps/merchant-web/.env.local';
    const envContent = fs.readFileSync(envPath, 'utf8');
    const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
    const keyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);
    url = urlMatch[1];
    serviceKey = keyMatch[1];

    serviceHeaders = {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
    hospA = manifest.hospitalA;
    hospB = manifest.hospitalB;

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

    deptNeuro = hospA.departments.find(d => d.name === 'Neurology');

    // 1. Fetch Doctor 1 in Neurology (bind to neuroDoc user_id)
    const doc1Res = await fetch(`${url}/rest/v1/resources?provider_id=eq.${hospA.id}&name=ilike.*Sharma*`, { headers: serviceHeaders });
    const res1 = await doc1Res.json();
    doc1 = Array.isArray(res1) ? res1[0] : null;

    if (doc1) {
      await fetch(`${url}/rest/v1/resources?id=eq.${doc1.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({
          attributes: {
            ...(doc1.attributes || {}),
            user_id: tokens.neuroDoc.user.id,
            email: 'neuro.doc@test-tirupati.local'
          }
        })
      });
    }

    // 2. Fetch or create Doctor 2 in the SAME department (Neurology)
    const checkDoc2Res = await fetch(`${url}/rest/v1/resources?provider_id=eq.${hospA.id}&name=ilike.*Patel*`, { headers: serviceHeaders });
    const existingDoc2 = await checkDoc2Res.json();
    if (existingDoc2 && existingDoc2.length > 0) {
      doc2 = existingDoc2[0];
    } else {
      const createDoc2Res = await fetch(`${url}/rest/v1/resources`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: hospA.id,
          name: 'Dr. K. Patel (Neurologist 2)',
          department_id: deptNeuro.id,
          type: 'doctor',
          deposit_amount: 100,
          duration_minutes: 15,
          capacity: 1,
          is_active: true,
          attributes: { department: 'Neurology', price: 500 }
        })
      });
      const created = await createDoc2Res.json();
      doc2 = created[0];
    }

    // 3. Assign Front Desk (neuroDesk) to Doctor 1 ONLY in doctor_front_desk_assignments
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
        id_card_number: 'HOSP-FD-001'
      })
    });

    // Ensure neuroDesk is ONLY a department member (not an owner in merchant_memberships)
    await fetch(`${url}/rest/v1/merchant_memberships?user_id=eq.${tokens.neuroDesk.user.id}`, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    // 4. Create distinct test bookings for Doctor 1 and Doctor 2
    // Doctor 2 slot is set within the active check-in window (slot_start = now + 10 mins)
    const today = '2026-10-19';
    const now = new Date();
    const slotStart1 = new Date(now.getTime() + 120 * 60 * 1000).toISOString();
    const slotEnd1 = new Date(now.getTime() + 135 * 60 * 1000).toISOString();
    const slotStart2 = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    const slotEnd2 = new Date(now.getTime() + 25 * 60 * 1000).toISOString();

    // Clean any previous test bookings
    await fetch(`${url}/rest/v1/bookings?reference_code=in.(GAP-TEST-DOC1,GAP-TEST-DOC2)`, {
      method: 'DELETE',
      headers: serviceHeaders
    });
    await fetch(`${url}/rest/v1/bookings?resource_id=eq.${doc2.id}&status=in.(CONFIRMED,CHECKED_IN)`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ status: 'COMPLETED' })
    });

    const b1Res = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient1.user.id,
        provider_id: hospA.id,
        resource_id: doc1.id,
        department_id: deptNeuro.id,
        slot_start: slotStart1,
        slot_end: slotEnd1,
        status: 'CONFIRMED',
        is_present: false,
        reference_code: 'GAP-TEST-DOC1',
        total_amount: 500,
        deposit_amount: 100,
        platform_fee: 10,
        payment_status: 'CAPTURED',
        queue_position: 1
      })
    });
    const b1Data = await b1Res.json();
    bookingDoc1 = Array.isArray(b1Data) ? b1Data[0] : null;

    const b2Res = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient2.user.id,
        provider_id: hospA.id,
        resource_id: doc2.id,
        department_id: deptNeuro.id,
        slot_start: slotStart2,
        slot_end: slotEnd2,
        status: 'CONFIRMED',
        is_present: false,
        reference_code: 'GAP-TEST-DOC2',
        total_amount: 500,
        deposit_amount: 100,
        platform_fee: 10,
        payment_status: 'CAPTURED',
        queue_position: 2
      })
    });
    const b2Data = await b2Res.json();
    bookingDoc2 = Array.isArray(b2Data) ? b2Data[0] : null;

    // Clean any auto-generated code and insert known code for Doctor 2 booking
    checkinCodeDoc2 = '7788';
    await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${bookingDoc2.id}`, {
      method: 'DELETE',
      headers: serviceHeaders
    });
    await fetch(`${url}/rest/v1/appointment_checkin_codes?code=eq.7788`, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    await fetch(`${url}/rest/v1/appointment_checkin_codes`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        booking_id: bookingDoc2.id,
        provider_id: hospA.id,
        customer_id: bookingDoc2.customer_id,
        code: checkinCodeDoc2,
        appointment_date: today
      })
    });

    // Locate Dermatology booking code for cross-department tests
    const dermaBooking = manifest.bookings.find(b => b.department_name === 'Dermatology');
    dermaBookingCode = dermaBooking?.checkin_code || '3539';

    // Reset rate limits for neuroDesk
    await fetch(`${url}/rest/v1/staff_checkin_rate_limits?user_id=eq.${tokens.neuroDesk.user.id}`, {
      method: 'DELETE',
      headers: serviceHeaders
    });
  });

  function userHeaders(userAuth) {
    return {
      'apikey': serviceKey,
      'Authorization': `Bearer ${userAuth.token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  // ---------------------------------------------------------------------------
  // Gap 1: Front Desk reading another Consultant's bookings
  // ---------------------------------------------------------------------------
  it('Gap 1: Front Desk assigned to Doctor 1 must NOT read Doctor 2 bookings in same department', async () => {
    // neuroDesk is assigned ONLY to doc1 (Sharma).
    // She queries bookings for doc2 (Patel) in Neurology.
    const res = await fetch(`${url}/rest/v1/bookings?resource_id=eq.${doc2.id}`, {
      headers: userHeaders(tokens.neuroDesk)
    });
    const data = await res.json();

    // Target rule: Front desk should only see bookings for their assigned consultant(s).
    // Current gap: members_read_department_bookings returns all department bookings.
    assert.equal(
      data.length,
      0,
      `Front Desk should see 0 bookings for unassigned doctor, but saw ${data.length} bookings (RLS leak)`
    );
  });

  // ---------------------------------------------------------------------------
  // Gap 2: Front Desk checking in another Consultant's patient
  // ---------------------------------------------------------------------------
  it('Gap 2: Front Desk must NOT check in patient of unassigned Doctor 2', async () => {
    // Reset rate limits for neuroDesk
    await fetch(`${url}/rest/v1/staff_checkin_rate_limits?user_id=eq.${tokens.neuroDesk.user.id}`, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    // neuroDesk calls verify_checkin_code with checkinCodeDoc2 (belonging to doc2)
    const res = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({
        p_shop_id: hospA.id,
        p_code: checkinCodeDoc2
      })
    });
    const data = await res.json();

    // Target rule: Front Desk can ONLY check in patients for their assigned consultant(s).
    // Current gap: verify_checkin_code does not check consultant assignment and fails to reject with INVALID_CODE.
    assert.equal(
      data.success,
      false,
      'Front Desk should NOT be able to check in a patient for an unassigned consultant'
    );
    assert.equal(
      data.error,
      'INVALID_CODE',
      `Unassigned consultant code must be rejected with uniform INVALID_CODE, got: ${data.error || data.message}`
    );
  });

  // ---------------------------------------------------------------------------
  // Gap 3: mark_present_manually on an unassigned doctor
  // ---------------------------------------------------------------------------
  it('Gap 3: Front Desk calling mark_present_manually on unassigned Doctor 2 must be rejected', async () => {
    // Ensure bookingDoc2 is in CONFIRMED status
    await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc2.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ status: 'CONFIRMED', is_present: false })
    });

    // neuroDesk calls mark_present_manually on bookingDoc2
    const res = await fetch(`${url}/rest/v1/rpc/mark_present_manually`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({
        p_booking_id: bookingDoc2.id
      })
    });
    const data = await res.json();

    // Target rule: Only Admin, the assigned Front Desk, or the Consultant can call mark_present_manually.
    // Current gap: mark_present_manually does not check consultant assignment and fails to reject with FORBIDDEN.
    assert.equal(
      data.success,
      false,
      'mark_present_manually must reject Front Desk not assigned to this doctor'
    );
    assert.equal(
      data.error,
      'FORBIDDEN',
      `Expected FORBIDDEN error for unassigned doctor mark_present_manually, got: ${data.error || data.message}`
    );
  });

  // ---------------------------------------------------------------------------
  // Gap 4: Consultant reading the whole department
  // ---------------------------------------------------------------------------
  it('Gap 4: Consultant (Doctor 1) must NOT read Doctor 2 bookings in same department', async () => {
    // neuroDoc is Doctor 1 (Sharma).
    // He queries bookings in Neurology for Doctor 2 (Patel).
    const res = await fetch(`${url}/rest/v1/bookings?resource_id=eq.${doc2.id}`, {
      headers: userHeaders(tokens.neuroDoc)
    });
    const data = await res.json();

    // Target rule: Consultant can only see their own appointments.
    // Current gap: members_read_department_bookings gives access to all department bookings.
    assert.equal(
      data.length,
      0,
      `Consultant should see 0 bookings for another doctor in same department, but saw ${data.length}`
    );
  });

  // ---------------------------------------------------------------------------
  // Gap 5: Unauthorized codes returning WRONG_SHOP or UNAUTHORIZED_DEPARTMENT
  // ---------------------------------------------------------------------------
  it('Gap 5: verify_checkin_code must NOT leak existence via WRONG_SHOP or UNAUTHORIZED_DEPARTMENT', async () => {
    // Clear rate limits
    await fetch(`${url}/rest/v1/staff_checkin_rate_limits?user_id=eq.${tokens.neuroDesk.user.id}`, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    // 1. Cross-shop check (calling Hospital B with Hospital A code)
    const resWrongShop = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
      method: 'POST',
      headers: userHeaders(tokens.adminBalaji),
      body: JSON.stringify({
        p_shop_id: hospB.id,
        p_code: checkinCodeDoc2
      })
    });
    const dataWrongShop = await resWrongShop.json();

    // Target rule: return identical INVALID_CODE (no WRONG_SHOP)
    // Current gap: returns WRONG_SHOP
    assert.equal(
      dataWrongShop.error,
      'INVALID_CODE',
      `Cross-shop code returned "${dataWrongShop.error}" instead of uniform "INVALID_CODE"`
    );

    // 2. Cross-department check (Dermatology code called by Neurology staff)
    const resCrossDept = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({
        p_shop_id: hospA.id,
        p_code: dermaBookingCode
      })
    });
    const dataCrossDept = await resCrossDept.json();

    // Target rule: return identical INVALID_CODE (no UNAUTHORIZED_DEPARTMENT)
    // Current gap: returns UNAUTHORIZED_DEPARTMENT
    assert.equal(
      dataCrossDept.error,
      'INVALID_CODE',
      `Cross-department code returned "${dataCrossDept.error}" instead of uniform "INVALID_CODE"`
    );
  });

  // ---------------------------------------------------------------------------
  // Gap 6: Missing audit entries on check-in and status changes
  // ---------------------------------------------------------------------------
  it('Gap 6: public.audit_logs must record check-in and status transition events', async () => {
    // Check audit logs for any entry recording check-in on bookingDoc1
    const res = await fetch(`${url}/rest/v1/audit_logs?action=in.(CHECKIN_CODE,CHECKIN_MANUAL,STATUS_CHANGE)`, {
      headers: serviceHeaders
    });
    const logs = await res.json();

    // Target rule: Write a public.audit_logs entry for code check-in, manual check-in, status changes
    // Current gap: check-in RPCs do not write any audit log entry to public.audit_logs
    assert.ok(
      Array.isArray(logs) && logs.length > 0,
      'public.audit_logs must contain entries for check-in and booking operations, but found 0 entries'
    );
  });

  after(async () => {
    await fetch(`${url}/rest/v1/bookings?reference_code=in.(GAP-TEST-DOC1,GAP-TEST-DOC2)`, {
      method: 'DELETE',
      headers: serviceHeaders
    });
  });
});
