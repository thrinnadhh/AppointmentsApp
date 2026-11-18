import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * tests/unit/checkin-pin-collisions.test.mjs
 *
 * Verifies PIN check-in safety under collisions and cross-hospital boundaries:
 * 1. Unique PIN works (1 match checks in immediately).
 * 2. Two customers with the same PIN at the same hospital on the same day -> picker returned, nobody checked in.
 * 3. Selecting a match from the collision picker -> check-in requires selected booking_id and checks in only that booking.
 * 4. Same PIN but different hospitals -> only this hospital's booking matches.
 * 5. Same PIN but booking is tomorrow -> invalid check-in code.
 * 6. Cross-hospital boundary: Staff from hospital A cannot check in hospital B's booking.
 * 7. Front Desk assignment scoping: Front Desk assigned to consultant X cannot check in consultant Y's patient.
 * 8. UI Component contract: FastPassCheckinPanel contains the multiple-matches picker and selection handlers.
 */

describe('Check-In PIN Collision & Cross-Hospital Safety Suite', { concurrency: 1 }, () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let hospB;
  let tokens = {};
  let neuroDocId; // Dr. A. Sharma (Assigned to neuroDesk)
  let dermaDocId; // Dr. C. Rao (Unassigned to neuroDesk)
  let genmedDocId; // Hospital B Doctor
  let createdBookingIds = [];

  const appBaseUrl = 'http://localhost:3000';

  // Returns an ISO slot for today (IST) that is guaranteed not to overlap with doctor seed bookings (seed bookings are 03:30-10:45 UTC)
  function getSafeTodaySlot(hourUtc, minuteUtc = 0, durationMinutes = 15) {
    const d = new Date();
    d.setUTCHours(hourUtc, minuteUtc, 0, 0);
    const start = d.toISOString();
    const end = new Date(d.getTime() + durationMinutes * 60 * 1000).toISOString();
    return { slotStart: start, slotEnd: end };
  }

  async function cleanupBookings() {
    const validIds = createdBookingIds.filter(Boolean);
    if (validIds.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/appointment_checkin_codes?booking_id=in.(${validIds.join(',')})`, {
        method: 'DELETE',
        headers: serviceHeaders,
      });
      await fetch(`${supabaseUrl}/rest/v1/bookings?id=in.(${validIds.join(',')})`, {
        method: 'DELETE',
        headers: serviceHeaders,
      });
      createdBookingIds = [];
    }
  }

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

    // Dynamically query providers to survive re-seeding and UUID regenerations
    const provRes = await fetch(`${supabaseUrl}/rest/v1/providers?select=id,name`, { headers: serviceHeaders });
    const providers = await provRes.json();
    const hospARecord = Array.isArray(providers) ? providers.find(p => p.name.includes('[TEST-HOSP-A]')) : null;
    const hospBRecord = Array.isArray(providers) ? providers.find(p => p.name.includes('[TEST-HOSP-B]')) : null;
    hospA = { id: hospARecord ? hospARecord.id : manifest.hospitalA.id };
    hospB = { id: hospBRecord ? hospBRecord.id : manifest.hospitalB.id };

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
    tokens.neuroDesk = await login('neuro.desk@test-tirupati.local');
    tokens.genmedDesk = await login('genmed.desk@test-tirupati.local');
    // Use patient 2, 3, 4 which have no pre-existing active/checked-in bookings for today
    tokens.patient2 = await login('test.patient.02@test-tirupati.local');
    tokens.patient3 = await login('test.patient.03@test-tirupati.local');
    tokens.patient4 = await login('test.patient.04@test-tirupati.local');

    // Dynamically query active clinic doctors and assignments from the seeded local database
    const fdRes = await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments?select=doctor_id,user_id,provider_id`, { headers: serviceHeaders });
    const fdAssignments = await fdRes.json();
    const neuroAssign = Array.isArray(fdAssignments) ? fdAssignments.find(a => a.user_id === tokens.neuroDesk.user.id) : null;
    const genmedAssign = Array.isArray(fdAssignments) ? fdAssignments.find(a => a.user_id === tokens.genmedDesk.user.id) : null;

    if (neuroAssign?.doctor_id) {
      neuroDocId = neuroAssign.doctor_id;
    } else {
      const docRes = await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}&name=like.*Neurologist*&select=id`, { headers: serviceHeaders });
      const docs = await docRes.json();
      neuroDocId = docs?.[0]?.id;
    }

    if (genmedAssign?.doctor_id) {
      genmedDocId = genmedAssign.doctor_id;
    } else {
      const docRes = await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospB.id}&name=like.*Physician*&select=id`, { headers: serviceHeaders });
      const docs = await docRes.json();
      genmedDocId = docs?.[0]?.id;
    }

    // Query dermatology doctor (unassigned to neuroDesk)
    const dermaRes = await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}&name=like.*Dermatologist*&select=id`, { headers: serviceHeaders });
    const dermaDocs = await dermaRes.json();
    dermaDocId = dermaDocs?.[0]?.id;

    // Clear any pre-existing seed bookings for patient 2, 3, 4 to guarantee a clean test slate
    await fetch(`${supabaseUrl}/rest/v1/bookings?customer_id=in.(${tokens.patient2.user.id},${tokens.patient3.user.id},${tokens.patient4.user.id})`, {
      method: 'DELETE',
      headers: serviceHeaders,
    });

    // Ensure all test patients (01-15) have dedicated distinct PINs (1001-1015) so seed bookings never collide with test PINs
    for (let i = 1; i <= 15; i++) {
      const num = i < 10 ? `0${i}` : `${i}`;
      await fetch(`${supabaseUrl}/rest/v1/profiles?email=eq.test.patient.${num}@test-tirupati.local`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ permanent_checkin_pin: `10${num}` }),
      });
    }

    // Purge any temporary appointment codes that might match our test PIN suite
    await fetch(`${supabaseUrl}/rest/v1/appointment_checkin_codes?code=in.(8811,9922,9933,7733,6644,7711)`, {
      method: 'DELETE',
      headers: serviceHeaders,
    });

    // Clear any active rate limits for the test staff accounts
    await fetch(`${supabaseUrl}/rest/v1/staff_checkin_rate_limits?user_id=in.(${tokens.neuroDesk.user.id},${tokens.genmedDesk.user.id})`, {
      method: 'DELETE',
      headers: serviceHeaders,
    });
  });

  beforeEach(async () => {
    await cleanupBookings();
  });

  after(async () => {
    await cleanupBookings();
  });

  it('1. Unique PIN works: exactly 1 match at this hospital today -> successfully checks in', async () => {
    const pin = '8811';
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient2.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ permanent_checkin_pin: pin }),
    });

    const ts = Date.now();
    const { slotStart, slotEnd } = getSafeTodaySlot(11, 30);

    const bRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient2.user.id,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        booking_for_someone_else: true,
        patient_name: 'Patient Two Uniq',
        reference_code: `PIN-TEST-UNIQ-${ts}`,
      }),
    });
    const [booking] = await bRes.json();
    assert.ok(booking?.id, 'Booking must be created');
    createdBookingIds.push(booking.id);

    // Call check-in API as Hospital A front desk
    const res = await fetch(`${appBaseUrl}/api/bookings/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
      },
      body: JSON.stringify({
        code: pin,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.booking_id, booking.id);
    assert.equal(typeof data.service_doctor, 'string');

    // Confirm DB status updated to CHECKED_IN
    const checkRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${booking.id}&select=status,is_present`, {
      headers: serviceHeaders,
    });
    const [updated] = await checkRes.json();
    assert.equal(updated.status, 'CHECKED_IN');
    assert.equal(updated.is_present, true);
  });

  it('2. Two customers same PIN same hospital same day -> returns picker response, nobody checked in', async () => {
    const sharedPin = '9922';

    // Set shared PIN on both patient 2 and patient 3
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient2.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ permanent_checkin_pin: sharedPin }),
    });
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient3.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ permanent_checkin_pin: sharedPin }),
    });

    const ts = Date.now();
    const { slotStart: slotStart1, slotEnd: slotEnd1 } = getSafeTodaySlot(12, 0);
    const { slotStart: slotStart2, slotEnd: slotEnd2 } = getSafeTodaySlot(12, 30);

    // Booking 1 for Patient 2
    const b1Res = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient2.user.id,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        slot_start: slotStart1,
        slot_end: slotEnd1,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        booking_for_someone_else: true,
        patient_name: 'Patient Alpha',
        reference_code: `COLLISION-1-${ts}`,
      }),
    });
    const [b1] = await b1Res.json();
    assert.ok(b1?.id, 'Booking 1 must be created');
    createdBookingIds.push(b1.id);

    // Booking 2 for Patient 3
    const b2Res = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient3.user.id,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        slot_start: slotStart2,
        slot_end: slotEnd2,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        booking_for_someone_else: true,
        patient_name: 'Patient Beta',
        reference_code: `COLLISION-2-${ts}`,
      }),
    });
    const [b2] = await b2Res.json();
    assert.ok(b2?.id, 'Booking 2 must be created');
    createdBookingIds.push(b2.id);

    // Call check-in API with shared PIN
    const res = await fetch(`${appBaseUrl}/api/bookings/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
      },
      body: JSON.stringify({
        code: sharedPin,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, false, 'Multiple matches must not check in automatically');
    assert.equal(data.multiple_matches, true, 'Must flag multiple_matches');
    assert.equal(data.error, 'MULTIPLE_MATCHES');
    assert.ok(Array.isArray(data.matches), 'Must return matches array');
    assert.equal(data.matches.length, 2, 'Must contain exactly 2 collision matches');

    // Verify match payload structure
    for (const match of data.matches) {
      assert.ok(match.booking_id, 'Match must have booking_id');
      assert.ok(match.consultant_name, 'Match must have consultant_name');
      assert.ok(match.slot_time, 'Match must have slot_time');
      assert.ok(match.customer_first_name, 'Match must have customer_first_name');
      assert.ok(match.phone_last_2, 'Match must have phone_last_2');
    }

    // CRITICAL: Prove NOBODY was checked in!
    const check1 = await (await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${b1.id}`, { headers: serviceHeaders })).json();
    const check2 = await (await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${b2.id}`, { headers: serviceHeaders })).json();
    assert.equal(check1[0].status, 'CONFIRMED', 'Booking 1 must remain CONFIRMED');
    assert.equal(check1[0].is_present, false, 'Booking 1 must NOT be marked present');
    assert.equal(check2[0].status, 'CONFIRMED', 'Booking 2 must remain CONFIRMED');
    assert.equal(check2[0].is_present, false, 'Booking 2 must NOT be marked present');
  });

  it('3. Selecting a match from collisions -> check-in requires selected booking_id and checks in only that booking', async () => {
    const sharedPin = '9933';

    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient2.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ permanent_checkin_pin: sharedPin }),
    });
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient3.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ permanent_checkin_pin: sharedPin }),
    });

    const ts = Date.now();
    const { slotStart: slotStart1, slotEnd: slotEnd1 } = getSafeTodaySlot(13, 0);
    const { slotStart: slotStart2, slotEnd: slotEnd2 } = getSafeTodaySlot(13, 30);

    const [b1] = await (await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient2.user.id,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        slot_start: slotStart1,
        slot_end: slotEnd1,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        booking_for_someone_else: true,
        patient_name: 'Patient Three',
        reference_code: `PICK-TEST-1-${ts}`,
      }),
    })).json();
    createdBookingIds.push(b1.id);

    const [b2] = await (await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient3.user.id,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        slot_start: slotStart2,
        slot_end: slotEnd2,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        booking_for_someone_else: true,
        patient_name: 'Patient Four',
        reference_code: `PICK-TEST-2-${ts}`,
      }),
    })).json();
    createdBookingIds.push(b2.id);

    // Receptionist selects Booking 2
    const res = await fetch(`${appBaseUrl}/api/bookings/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
      },
      body: JSON.stringify({
        code: sharedPin,
        booking_id: b2.id,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.booking_id, b2.id);

    // Verify Booking 2 is now CHECKED_IN
    const check2 = await (await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${b2.id}`, { headers: serviceHeaders })).json();
    assert.equal(check2[0].status, 'CHECKED_IN');
    assert.equal(check2[0].is_present, true);

    // Verify Booking 1 remains CONFIRMED and untouched
    const check1 = await (await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${b1.id}`, { headers: serviceHeaders })).json();
    assert.equal(check1[0].status, 'CONFIRMED');
    assert.equal(check1[0].is_present, false);
  });

  it('4. Same PIN but different hospitals -> only this hospital booking matches', async () => {
    const crossPin = '7733';

    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient2.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ permanent_checkin_pin: crossPin }),
    });
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient3.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ permanent_checkin_pin: crossPin }),
    });

    const ts = Date.now();
    const { slotStart, slotEnd } = getSafeTodaySlot(14, 0);

    // Patient 2 booked at Hospital A
    const [bA] = await (await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient2.user.id,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        booking_for_someone_else: true,
        patient_name: 'Patient Five',
        reference_code: `CROSS-HOSP-A-${ts}`,
      }),
    })).json();
    assert.ok(bA?.id, 'Booking A must be created');
    createdBookingIds.push(bA.id);

    // Patient 3 booked at Hospital B
    const [bB] = await (await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient3.user.id,
        provider_id: hospB.id,
        resource_id: genmedDocId,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        booking_for_someone_else: true,
        patient_name: 'Patient Six',
        reference_code: `CROSS-HOSP-B-${ts}`,
      }),
    })).json();
    assert.ok(bB?.id, 'Booking B must be created');
    createdBookingIds.push(bB.id);

    // Staff at Hospital A submits crossPin
    const resA = await fetch(`${appBaseUrl}/api/bookings/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
      },
      body: JSON.stringify({
        code: crossPin,
      }),
    });

    assert.equal(resA.status, 200);
    const dataA = await resA.json();
    assert.equal(dataA.success, true);
    assert.equal(dataA.booking_id, bA.id, 'Must match Hospital A booking only');

    // Confirm Hospital B booking was untouched
    const checkB = await (await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bB.id}`, { headers: serviceHeaders })).json();
    assert.equal(checkB[0].status, 'CONFIRMED');
    assert.equal(checkB[0].is_present, false);
  });

  it('5. Same PIN but booking is tomorrow -> invalid check-in code', async () => {
    const tomorrowPin = '6644';
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient2.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ permanent_checkin_pin: tomorrowPin }),
    });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const slotStart = tomorrow.toISOString();
    const slotEnd = new Date(tomorrow.getTime() + 15 * 60 * 1000).toISOString();

    const [bTomorrow] = await (await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient2.user.id,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        booking_for_someone_else: true,
        patient_name: 'Patient Seven',
        reference_code: `TOMORROW-${Date.now()}`,
      }),
    })).json();
    assert.ok(bTomorrow?.id, 'Tomorrow booking must be created');
    createdBookingIds.push(bTomorrow.id);

    // Hospital A desk tries to check in tomorrow PIN today
    const res = await fetch(`${appBaseUrl}/api/bookings/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
      },
      body: JSON.stringify({
        code: tomorrowPin,
      }),
    });

    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, 'INVALID_CODE');

    // Tomorrow booking remains CONFIRMED
    const checkTom = await (await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bTomorrow.id}`, { headers: serviceHeaders })).json();
    assert.equal(checkTom[0].status, 'CONFIRMED');
    assert.equal(checkTom[0].is_present, false);
  });

  it('6. Staff from Hospital A cannot check in Hospital B booking (derived server-side)', async () => {
    // Booking exists at Hospital B for today
    const ts = Date.now();
    const { slotStart, slotEnd } = getSafeTodaySlot(14, 30);

    const [bHospB] = await (await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient2.user.id,
        provider_id: hospB.id,
        resource_id: genmedDocId,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        booking_for_someone_else: true,
        patient_name: 'Patient Eight',
        reference_code: `HOSP-B-ONLY-${ts}`,
      }),
    })).json();
    assert.ok(bHospB?.id, 'Hospital B booking must be created');
    createdBookingIds.push(bHospB.id);

    // Staff from Hospital A tries to check in Hospital B booking by sending spoofed shopId
    const res = await fetch(`${appBaseUrl}/api/bookings/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
      },
      body: JSON.stringify({
        booking_id: bHospB.id,
        shopId: hospB.id,
        is_offline_walk_in: true,
      }),
    });

    assert.equal(res.status, 403, 'Cross-hospital access must be strictly forbidden');
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, 'FORBIDDEN');

    // Booking at Hospital B remains untouched
    const check = await (await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bHospB.id}`, { headers: serviceHeaders })).json();
    assert.equal(check[0].status, 'CONFIRMED');
    assert.equal(check[0].is_present, false);
  });

  it('7. Front Desk assigned to consultant X cannot check in consultant Y patient', async () => {
    const pin = '7711';
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient2.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ permanent_checkin_pin: pin }),
    });

    const ts = Date.now();
    const { slotStart, slotEnd } = getSafeTodaySlot(15, 0);

    // Patient 2 has booking with Consultant Y (dermaDocId, unassigned for neuroDesk)
    const [bUnassigned] = await (await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient2.user.id,
        provider_id: hospA.id,
        resource_id: dermaDocId,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        booking_for_someone_else: true,
        patient_name: 'Patient Nine',
        reference_code: `UNASSIGNED-DOC-${ts}`,
      }),
    })).json();
    assert.ok(bUnassigned?.id, 'Unassigned doctor booking must be created');
    createdBookingIds.push(bUnassigned.id);

    // neuroDesk attempts to check in patient for dermaDoc
    const res = await fetch(`${appBaseUrl}/api/bookings/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
      },
      body: JSON.stringify({
        code: pin,
      }),
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error === 'UNAUTHORIZED' || data.error === 'FORBIDDEN');
    assert.match(data.message, /not assigned to this doctor|not authorized/i);

    // Patient remains CONFIRMED
    const check = await (await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bUnassigned.id}`, { headers: serviceHeaders })).json();
    assert.equal(check[0].status, 'CONFIRMED');
    assert.equal(check[0].is_present, false);
  });

  it('8. Front Desk UI Component Contract: FastPassCheckinPanel renders multiple-matches picker and handles match selection', () => {
    const panelSrc = fs.readFileSync('apps/merchant-web/src/components/frontdesk/FastPassCheckinPanel.tsx', 'utf8');

    // Verifies picker UI test id exists in component
    assert.ok(
      panelSrc.includes('data-testid="multiple-matches-picker"'),
      'FastPassCheckinPanel must contain data-testid="multiple-matches-picker"'
    );

    // Verifies dynamic match button test id exists
    assert.ok(
      panelSrc.includes('data-testid={`match-select-btn-${match.booking_id}`}'),
      'FastPassCheckinPanel must render match-select-btn-${match.booking_id}'
    );

    // Verifies handleSelectMatch passes selected bookingId
    assert.ok(
      panelSrc.includes('onVerifyCode(pendingCode, bookingId)'),
      'FastPassCheckinPanel must call onVerifyCode with pendingCode and selected bookingId'
    );
  });
});
