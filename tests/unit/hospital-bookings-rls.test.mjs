import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

/**
 * tests/unit/hospital-bookings-rls.test.mjs
 * 
 * Subtask 3 Verification:
 * Validates locked-down Row Level Security on public.bookings:
 * - Hospital Admin: Can read and update all hospital bookings
 * - Front Desk: Can read and update ONLY assigned consultant bookings
 * - Consultant: Can read and update ONLY their own bookings
 * - Unassigned Doctor: Front Desk & other Consultants receive 0 rows on SELECT and cannot UPDATE
 * - Customers: Can read and update their own bookings
 * - Non-hospital providers (salons): Unchanged legacy access
 */

describe('Subtask 3: Hospital Bookings RLS Lockdown', () => {
  let url;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let salon;
  let tokens = {};
  let doc1;
  let doc2;
  let bookingDoc1;
  let bookingDoc2;
  let salonBooking;

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
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');
    tokens.patient2 = await login('test.patient.02@test-tirupati.local');
    tokens.salonOwner = await login(salon.ownerEmail || 'salon.royal@test-tirupati.local');

    const deptNeuro = hospA.departments.find(d => d.name === 'Neurology');

    // Fetch Doctor 1 and Doctor 2 in Neurology
    const docsRes = await fetch(`${url}/rest/v1/resources?provider_id=eq.${hospA.id}`, { headers: serviceHeaders });
    const docs = await docsRes.json();
    doc1 = docs.find(d => d.name.includes('Sharma'));
    doc2 = docs.find(d => d.name.includes('Patel'));

    // Bind Doctor 1 to neuroDoc user_id
    await fetch(`${url}/rest/v1/resources?id=eq.${doc1.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ user_id: tokens.neuroDoc.user.id })
    });

    // Assign neuroDesk to Doctor 1 ONLY in doctor_front_desk_assignments
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
        id_card_number: 'HOSP-FD-TEST-RLS'
      })
    });

    // Create test bookings for Doctor 1 and Doctor 2
    const now = new Date();
    const slotStart1 = new Date(now.getTime() + 180 * 60 * 1000).toISOString();
    const slotEnd1 = new Date(now.getTime() + 195 * 60 * 1000).toISOString();
    const slotStart2 = new Date(now.getTime() + 200 * 60 * 1000).toISOString();
    const slotEnd2 = new Date(now.getTime() + 215 * 60 * 1000).toISOString();

    await fetch(`${url}/rest/v1/bookings?reference_code=in.(RLS-TEST-DOC1,RLS-TEST-DOC2,RLS-TEST-SALON)`, {
      method: 'DELETE',
      headers: serviceHeaders
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
        reference_code: 'RLS-TEST-DOC1',
        total_amount: 500,
        deposit_amount: 100,
        platform_fee: 10,
        payment_status: 'CAPTURED',
        queue_position: 1
      })
    });
    bookingDoc1 = (await b1Res.json())[0];

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
        reference_code: 'RLS-TEST-DOC2',
        total_amount: 500,
        deposit_amount: 100,
        platform_fee: 10,
        payment_status: 'CAPTURED',
        queue_position: 2
      })
    });
    bookingDoc2 = (await b2Res.json())[0];

    // Salon booking for regression verification
    const salonDoc = (await (await fetch(`${url}/rest/v1/resources?provider_id=eq.${salon.id}`, { headers: serviceHeaders })).json())[0];
    const bSalonRes = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient1.user.id,
        provider_id: salon.id,
        resource_id: salonDoc.id,
        slot_start: slotStart1,
        slot_end: slotEnd1,
        status: 'CONFIRMED',
        is_present: false,
        reference_code: 'RLS-TEST-SALON',
        total_amount: 300,
        deposit_amount: 50,
        platform_fee: 10,
        payment_status: 'CAPTURED',
        queue_position: 1
      })
    });
    salonBooking = (await bSalonRes.json())[0];
  });

  function userHeaders(userAuth) {
    return {
      'apikey': serviceKey,
      'Authorization': `Bearer ${userAuth.token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  // 1. Hospital Admin Read & Update
  it('1. Hospital Admin can read and update all bookings in the hospital', async () => {
    const res = await fetch(`${url}/rest/v1/bookings?id=in.(${bookingDoc1.id},${bookingDoc2.id})`, {
      headers: userHeaders(tokens.adminApex)
    });
    const data = await res.json();
    assert.equal(data.length, 2, 'Admin must see bookings for both doc1 and doc2');

    // Admin updates note/queue_position
    const updateRes = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc1.id}`, {
      method: 'PATCH',
      headers: userHeaders(tokens.adminApex),
      body: JSON.stringify({ estimated_wait_minutes: 10 })
    });
    assert.equal(updateRes.status, 200, 'Admin must be permitted to update hospital bookings');
  });

  // 2. Front Desk Read & Update Isolation
  it('2. Front Desk can read and update ONLY assigned doctor bookings', async () => {
    // Read assigned doc1 booking
    const resDoc1 = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc1.id}`, {
      headers: userHeaders(tokens.neuroDesk)
    });
    const dataDoc1 = await resDoc1.json();
    assert.equal(dataDoc1.length, 1, 'Front Desk must see assigned doc1 booking');

    // Read unassigned doc2 booking
    const resDoc2 = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc2.id}`, {
      headers: userHeaders(tokens.neuroDesk)
    });
    const dataDoc2 = await resDoc2.json();
    assert.equal(dataDoc2.length, 0, 'Front Desk must NOT see unassigned doc2 booking');

    // Update assigned doc1 booking
    const updateAssigned = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc1.id}`, {
      method: 'PATCH',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ estimated_wait_minutes: 15 })
    });
    assert.equal(updateAssigned.status, 200, 'Front Desk must be able to update assigned doctor booking');

    // Attempt update unassigned doc2 booking
    const updateUnassigned = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc2.id}`, {
      method: 'PATCH',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ estimated_wait_minutes: 20 })
    });
    const updatedRows = await updateUnassigned.json();
    assert.equal(updatedRows.length, 0, 'Front Desk must NOT update unassigned doctor booking (0 rows modified)');
  });

  // 3. Consultant Read & Update Isolation
  it('3. Consultant can read and update ONLY their own appointments', async () => {
    // Read own doc1 booking
    const resOwn = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc1.id}`, {
      headers: userHeaders(tokens.neuroDoc)
    });
    const dataOwn = await resOwn.json();
    assert.equal(dataOwn.length, 1, 'Consultant must see own booking');

    // Read other doctor doc2 booking
    const resOther = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc2.id}`, {
      headers: userHeaders(tokens.neuroDoc)
    });
    const dataOther = await resOther.json();
    assert.equal(dataOther.length, 0, 'Consultant must NOT see another doctor booking');

    // Attempt update other doctor booking
    const updateOther = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc2.id}`, {
      method: 'PATCH',
      headers: userHeaders(tokens.neuroDoc),
      body: JSON.stringify({ estimated_wait_minutes: 25 })
    });
    const updatedRows = await updateOther.json();
    assert.equal(updatedRows.length, 0, 'Consultant must NOT modify another doctor booking (0 rows modified)');
  });

  // 4. Customer Access Unchanged
  it('4. Customer can read their own bookings and cannot read others', async () => {
    const resOwn = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc1.id}`, {
      headers: userHeaders(tokens.patient1)
    });
    const dataOwn = await resOwn.json();
    assert.equal(dataOwn.length, 1, 'Patient 1 must read own booking');

    const resOther = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingDoc2.id}`, {
      headers: userHeaders(tokens.patient1)
    });
    const dataOther = await resOther.json();
    assert.equal(dataOther.length, 0, 'Patient 1 must NOT read Patient 2 booking');
  });

  // 5. Non-Hospital Providers (Salons) Regression Check
  it('5. Salon merchant can read and update salon bookings normally without hospital helpers', async () => {
    const res = await fetch(`${url}/rest/v1/bookings?id=eq.${salonBooking.id}`, {
      headers: userHeaders(tokens.salonOwner)
    });
    const data = await res.json();
    assert.equal(data.length, 1, 'Salon owner can read salon booking');

    const updateRes = await fetch(`${url}/rest/v1/bookings?id=eq.${salonBooking.id}`, {
      method: 'PATCH',
      headers: userHeaders(tokens.salonOwner),
      body: JSON.stringify({ estimated_wait_minutes: 5 })
    });
    assert.equal(updateRes.status, 200, 'Salon owner can update salon booking');
  });
});
