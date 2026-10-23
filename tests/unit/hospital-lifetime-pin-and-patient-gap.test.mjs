import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Hospital Permanent PIN, 1-Hour Patient Gap & Doctor Emergency Policies', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let tokens = {};
  let neuroDocId;
  let neuroDeptId;
  let cardioDocId;
  let cardioDeptId;
  let testCustomerId;
  let customerToken;
  let createdBookingIds = [];

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
    cardioDeptId = hospA.departments.find((d) => d.name === 'Cardiology')?.id || neuroDeptId;

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
    tokens.frontDesk = await login('frontdesk.neuro@test-tirupati.local');
    testCustomerId = tokens.patient.user.id;
    customerToken = tokens.patient.token;

    // Fetch doctor resources
    const allDocs = await (
      await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}`, {
        headers: serviceHeaders,
      })
    ).json();

    const neuroDoc = allDocs.find((d) => d.name.includes('Neuro') || d.type === 'doctor');
    neuroDocId = neuroDoc ? neuroDoc.id : allDocs[0].id;

    const otherDoc = allDocs.find((d) => d.id !== neuroDocId) || allDocs[0];
    cardioDocId = otherDoc.id;
  });

  after(async () => {
    // Clean up test bookings
    if (createdBookingIds.length > 0) {
      for (const id of createdBookingIds) {
        await fetch(`${supabaseUrl}/rest/v1/appointment_checkin_codes?booking_id=eq.${id}`, {
          method: 'DELETE',
          headers: serviceHeaders,
        });
        await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${id}`, {
          method: 'DELETE',
          headers: serviceHeaders,
        });
      }
    }
  });

  it('1. Customer Profile has a permanent 4-digit lifetime check-in PIN', async () => {
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${testCustomerId}&select=id,full_name,permanent_checkin_pin`, {
      headers: serviceHeaders,
    });
    const profiles = await res.json();
    assert.equal(profiles.length, 1);
    const pin = profiles[0].permanent_checkin_pin;
    assert.ok(pin, 'Permanent check-in PIN must not be null');
    assert.match(pin, /^[0-9]{4}$/, 'PIN must be exactly 4 digits');

    // Test get_or_create_customer_checkin_pin RPC returns identical PIN
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/get_or_create_customer_checkin_pin`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ p_customer_id: testCustomerId }),
    });
    const fetchedPin = await rpcRes.json();
    assert.equal(fetchedPin, pin, 'get_or_create_customer_checkin_pin must return customer lifetime PIN');
  });

  it('2. Multiple bookings by same customer share identical lifetime PIN in appointment_checkin_codes', async () => {
    // Create 2 test bookings on tomorrow's date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const slot1Start = `${dateStr}T09:00:00Z`;
    const slot1End = `${dateStr}T09:30:00Z`;
    const slot2Start = `${dateStr}T14:00:00Z`;
    const slot2End = `${dateStr}T14:30:00Z`;

    // Booking 1
    const b1Res = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: testCustomerId,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        department_id: neuroDeptId,
        slot_start: slot1Start,
        slot_end: slot1End,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        reference_code: 'PIN-TEST-01',
      }),
    });
    const [b1] = await b1Res.json();
    createdBookingIds.push(b1.id);

    // Booking 2 (different doctor, same day)
    const b2Res = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: testCustomerId,
        provider_id: hospA.id,
        resource_id: cardioDocId,
        department_id: cardioDeptId,
        slot_start: slot2Start,
        slot_end: slot2End,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        reference_code: 'PIN-TEST-02',
      }),
    });
    const [b2] = await b2Res.json();
    createdBookingIds.push(b2.id);

    // Generate codes for both
    const code1Res = await fetch(`${supabaseUrl}/rest/v1/rpc/generate_appointment_checkin_code_for_booking`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ p_booking_id: b1.id }),
    });
    const code1 = await code1Res.json();

    const code2Res = await fetch(`${supabaseUrl}/rest/v1/rpc/generate_appointment_checkin_code_for_booking`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ p_booking_id: b2.id }),
    });
    const code2 = await code2Res.json();

    // Verify both codes match customer's permanent lifetime PIN
    const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${testCustomerId}&select=permanent_checkin_pin`, {
      headers: serviceHeaders,
    });
    const [{ permanent_checkin_pin: lifetimePin }] = await profRes.json();

    assert.equal(code1, lifetimePin, 'Booking 1 code must match lifetime PIN');
    assert.equal(code2, lifetimePin, 'Booking 2 code must match lifetime PIN');
    assert.equal(code1, code2, 'Both bookings must share the identical permanent lifetime PIN');
  });

  it('3. 1-Hour Gap: Same patient booking < 1 hour apart is strictly blocked with policy error message', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const dateStr = futureDate.toISOString().split('T')[0];

    const slot1Start = `${dateStr}T10:00:00Z`;
    const slot1End = `${dateStr}T10:30:00Z`;

    // Create an initial active confirmed booking for self
    const initRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: testCustomerId,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        department_id: neuroDeptId,
        slot_start: slot1Start,
        slot_end: slot1End,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        booking_for_someone_else: false,
        reference_code: 'GAP-TEST-01',
      }),
    });
    const [initBooking] = await initRes.json();
    createdBookingIds.push(initBooking.id);

    // Attempt to book another slot only 30 minutes later (11:00 to 11:30) for same patient (self)
    // Gap between 10:30 and 11:00 is 30m (< 60 minutes)
    const conflictingSlotStart = `${dateStr}T11:00:00Z`;
    const conflictingSlotEnd = `${dateStr}T11:30:00Z`;

    const conflictRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        p_resource_id: cardioDocId,
        p_slot_start: conflictingSlotStart,
        p_slot_end: conflictingSlotEnd,
        p_customer_id: testCustomerId,
        p_booking_for_someone_else: false,
      }),
    });
    const conflictData = await conflictRes.json();

    assert.equal(conflictData.success, false, 'Hold creation must fail due to < 1 hour gap');
    assert.match(
      conflictData.error,
      /Appointments for the same patient must be at least 1 hour apart/,
      'Error message must state 1-hour gap requirement'
    );
    assert.match(
      conflictData.error,
      /select 'Booking for someone else'/,
      'Error message must suggest booking for someone else'
    );
  });

  it('4. 1-Hour Gap: Same patient booking >= 1 hour apart succeeds', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const dateStr = futureDate.toISOString().split('T')[0];

    // Slot at 12:00 (gap from 10:30 to 12:00 is 90 minutes >= 60 minutes)
    const allowedSlotStart = `${dateStr}T12:00:00Z`;
    const allowedSlotEnd = `${dateStr}T12:30:00Z`;

    const holdRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        p_resource_id: cardioDocId,
        p_slot_start: allowedSlotStart,
        p_slot_end: allowedSlotEnd,
        p_customer_id: testCustomerId,
        p_booking_for_someone_else: false,
      }),
    });
    const holdData = await holdRes.json();

    assert.equal(holdData.success, true, 'Booking hold >= 1 hour apart must succeed');
    assert.ok(holdData.booking_id, 'Booking ID must be returned');
    createdBookingIds.push(holdData.booking_id);
  });

  it('5. Family / Friend Booking: Bypass 1-hour gap when booking for someone else', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const dateStr = futureDate.toISOString().split('T')[0];

    // Slot only 30m away from 10:30 (10:45 to 11:15), but for family member "Grandmother / +919876543210"
    const famSlotStart = `${dateStr}T10:45:00Z`;
    const famSlotEnd = `${dateStr}T11:15:00Z`;

    const famRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        p_resource_id: cardioDocId,
        p_slot_start: famSlotStart,
        p_slot_end: famSlotEnd,
        p_customer_id: testCustomerId,
        p_booking_for_someone_else: true,
        p_patient_name: 'Lakshmi Devi',
        p_patient_phone: '+919876543210',
        p_patient_relationship: 'family',
      }),
    });
    const famData = await famRes.json();

    assert.equal(famData.success, true, 'Booking for family/friend must bypass 1-hour gap with self');
    assert.ok(famData.booking_id, 'Booking ID must be returned');
    assert.equal(famData.booking_for_someone_else, true);
    assert.equal(famData.patient_name, 'Lakshmi Devi');
    createdBookingIds.push(famData.booking_id);
  });

  it('6. Doctor Emergency Cancel: Doctor did not arrive (offers Reschedule or Refund)', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 4);
    const dateStr = futureDate.toISOString().split('T')[0];

    const slotStart = `${dateStr}T11:00:00Z`;
    const slotEnd = `${dateStr}T11:30:00Z`;

    // Create confirmed booking
    const bRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: testCustomerId,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        department_id: neuroDeptId,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        platform_fee: 10,
        total_amount: 110,
        reference_code: 'EMERG-01',
      }),
    });
    const [b] = await bRes.json();
    createdBookingIds.push(b.id);

    // Cancel doctor emergency with p_doctor_arrived = false
    const cancelRes = await fetch(`${supabaseUrl}/rest/v1/rpc/cancel_doctor_emergency`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        p_doctor_resource_id: neuroDocId,
        p_effective_from: slotStart,
        p_reason: 'Doctor Sudden Illness',
        p_doctor_arrived: false,
      }),
    });
    const cancelData = await cancelRes.json();
    assert.equal(cancelData.success, true);
    assert.equal(cancelData.doctor_arrived, false);

    // Verify booking updated to CANCELLED with REFUND_PENDING and emergency flags
    const checkRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${b.id}&select=*`, {
      headers: serviceHeaders,
    });
    const [updatedBooking] = await checkRes.json();
    assert.equal(updatedBooking.status, 'CANCELLED');
    assert.equal(updatedBooking.payment_status, 'REFUND_PENDING');
    assert.equal(updatedBooking.emergency_cancelled, true);
    assert.equal(updatedBooking.emergency_doctor_arrived, false);

    // Test choose_emergency_option: WAIT must be rejected because doctor did not arrive
    const waitRes = await fetch(`${supabaseUrl}/rest/v1/rpc/choose_emergency_option`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        p_booking_id: b.id,
        p_choice: 'WAIT',
      }),
    });
    const waitData = await waitRes.json();
    assert.equal(waitData.success, false, 'Wait option must be rejected if doctor did not arrive');
    assert.match(waitData.error, /Wait option is only available when doctor arrived/);

    // Test choose_emergency_option: REFUND succeeds
    const refundRes = await fetch(`${supabaseUrl}/rest/v1/rpc/choose_emergency_option`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        p_booking_id: b.id,
        p_choice: 'REFUND',
      }),
    });
    const refundData = await refundRes.json();
    assert.equal(refundData.success, true);
    assert.equal(refundData.choice, 'REFUND');
  });

  it('7. Doctor Emergency Cancel: Doctor arrived mid-way (offers Wait, Reschedule, or Refund)', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const dateStr = futureDate.toISOString().split('T')[0];

    const slotStart = `${dateStr}T14:00:00Z`;
    const slotEnd = `${dateStr}T14:30:00Z`;

    // Create confirmed booking
    const bRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: testCustomerId,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        department_id: neuroDeptId,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        platform_fee: 10,
        total_amount: 110,
        reference_code: 'EMERG-02',
      }),
    });
    const [b] = await bRes.json();
    createdBookingIds.push(b.id);

    // Cancel doctor emergency with p_doctor_arrived = true (arrived mid-way)
    const cancelRes = await fetch(`${supabaseUrl}/rest/v1/rpc/cancel_doctor_emergency`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        p_doctor_resource_id: neuroDocId,
        p_effective_from: slotStart,
        p_reason: 'Emergency Surgery Called',
        p_doctor_arrived: true,
      }),
    });
    const cancelData = await cancelRes.json();
    assert.equal(cancelData.success, true);
    assert.equal(cancelData.doctor_arrived, true);

    // Patient choosing WAIT must succeed
    const waitRes = await fetch(`${supabaseUrl}/rest/v1/rpc/choose_emergency_option`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        p_booking_id: b.id,
        p_choice: 'WAIT',
      }),
    });
    const waitData = await waitRes.json();
    assert.equal(waitData.success, true, 'Wait option must succeed when doctor arrived mid-session');
    assert.equal(waitData.choice, 'WAIT');

    // Verify booking updated to WAITING
    const checkRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${b.id}&select=status,emergency_patient_choice`, {
      headers: serviceHeaders,
    });
    const [updatedBooking] = await checkRes.json();
    assert.equal(updatedBooking.status, 'WAITING');
    assert.equal(updatedBooking.emergency_patient_choice, 'WAIT');
  });
});
