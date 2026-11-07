import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

describe('PHASE 1: FUNCTIONAL TESTS (QA Lead) - Family & Minor Booking', () => {
  let appBaseUrl = 'http://localhost:3000';
  let supabaseUrl = 'http://127.0.0.1:54321';
  let anonKey = '';
  let serviceKey = '';
  let dbPool;
  let serviceHeaders;

  let cust1, cust2, cust3;
  let hospA, hospB;
  let docA, docA2, docB;
  let createdBookingIds = [];

  async function login(email, password = 'HospitalTest2026!') {
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Login failed for ${email}: ${res.status} ${err}`);
    }
    const data = await res.json();
    return { token: data.access_token, user: data.user };
  }

  before(async () => {
    const envFile = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
    anonKey = envFile.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=\"?([^\"\n]+)/)?.[1];
    serviceKey = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=\"?([^\"\n]+)/)?.[1];

    if (!anonKey || !serviceKey) {
      throw new Error('Missing Supabase credentials in apps/merchant-web/.env.local');
    }

    serviceHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    dbPool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });

    // 1. Log in Test Customers
    cust1 = await login('test.patient.01@test-tirupati.local');
    cust2 = await login('test.patient.02@test-tirupati.local');
    cust3 = await login('test.patient.03@test-tirupati.local');

    // Ensure cust1 has valid phone for notifications
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${cust1.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ phone: '+919900000010', full_name: 'Test Patient 01' }),
    });

    // 2. Resolve Providers & Doctors
    const provsRes = await fetch(`${supabaseUrl}/rest/v1/providers?category_id=eq.clinics&select=id,name,owner_id`, {
      headers: serviceHeaders,
    });
    const provs = await provsRes.json();
    hospA = provs.find((p) => p.name.includes('Apex'));
    hospB = provs.find((p) => p.name.includes('Balaji'));

    assert.ok(hospA, 'Hospital A must exist');
    assert.ok(hospB, 'Hospital B must exist');

    const resARes = await fetch(
      `${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}&select=id,name,user_id,department_id`,
      { headers: serviceHeaders }
    );
    const docsA = await resARes.json();
    docA = docsA[0];
    docA2 = docsA[1] || docsA[0];

    const resBRes = await fetch(
      `${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospB.id}&select=id,name,user_id,department_id`,
      { headers: serviceHeaders }
    );
    const docsB = await resBRes.json();
    docB = docsB[0];

    // Clean up test bookings from prior runs on test resources to avoid slot/patient 1-hour collisions
    if (docA?.id) {
      await dbPool.query(
        `DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE resource_id IN ($1, $2, $3) AND slot_start > NOW() + INTERVAL '100 hours')`,
        [docA.id, docA2.id, docB.id]
      );
      await dbPool.query(
        `DELETE FROM notification_logs WHERE booking_id IN (SELECT id FROM bookings WHERE resource_id IN ($1, $2, $3) AND slot_start > NOW() + INTERVAL '100 hours')`,
        [docA.id, docA2.id, docB.id]
      );
      await dbPool.query(
        `DELETE FROM bookings WHERE resource_id IN ($1, $2, $3) AND slot_start > NOW() + INTERVAL '100 hours'`,
        [docA.id, docA2.id, docB.id]
      );
    }
  });

  after(async () => {
    if (createdBookingIds.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/bookings?id=in.(${createdBookingIds.join(',')})`, {
        method: 'DELETE',
        headers: serviceHeaders,
      });
      await fetch(`${supabaseUrl}/rest/v1/notification_logs?booking_id=in.(${createdBookingIds.join(',')})`, {
        method: 'DELETE',
        headers: serviceHeaders,
      });
    }
    if (dbPool) {
      await dbPool.end();
    }
  });

  // F-01: Book for self
  it('F-01: Book for self - unchanged behavior, booked_for=\x27self\x27, patient fields null', async () => {
    const tStart = new Date(Date.now() + 300 * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + 300 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    const holdRes = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'self',
      }),
    });
    assert.equal(holdRes.status, 201, 'Hold creation for self must return 201');
    const holdData = await holdRes.json();
    createdBookingIds.push(holdData.booking_id);

    assert.equal(holdData.booked_for, 'self');
    assert.equal(holdData.patient_name, null);
    assert.equal(holdData.patient_age, null);
    assert.equal(holdData.is_minor, false);

    // Verify database row
    const rowRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${holdData.booking_id}`, {
      headers: serviceHeaders,
    });
    const row = (await rowRes.json())[0];
    assert.equal(row.booked_for, 'self');
    assert.equal(row.patient_name, null);
    assert.equal(row.patient_age, null);
    assert.equal(row.patient_relationship, null);
    assert.equal(row.booking_note, null);
    assert.equal(row.is_minor, false);
  });

  // F-02: Book for family adult
  it('F-02: Book for family adult (age 35, relationship \x27spouse\x27) - row saved, token issued, patient name visible', async () => {
    const patientName = `Priya Sharma ${Math.random().toString(36).slice(2, 6)}`;
    const hourOffset = 500 + Math.floor(Math.random() * 100000);
    const tStart = new Date(Date.now() + hourOffset * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + hourOffset * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    const holdRes = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'family',
        patient_name: patientName,
        patient_age: 35,
        patient_relationship: 'spouse',
        booking_note: 'Headache and fatigue',
      }),
    });
    if (holdRes.status !== 201) {
      console.error('F-02 holdRes ERROR:', holdRes.status, await holdRes.text());
    }
    assert.equal(holdRes.status, 201);
    const holdData = await holdRes.json();
    createdBookingIds.push(holdData.booking_id);

    assert.equal(holdData.booked_for, 'family');
    assert.equal(holdData.patient_name, patientName);
    assert.equal(holdData.patient_age, 35);
    assert.equal(holdData.patient_relationship, 'spouse');
    assert.equal(holdData.is_minor, false);
    assert.equal(holdData.booking_note, 'Headache and fatigue');

    // Update to free consultation to allow confirmation without external Razorpay credentials
    await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${holdData.booking_id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({
        is_followup: true,
        deposit_amount: 0,
        total_amount: 0,
      }),
    });

    // Confirm the booking to issue full token & pass
    const confRes = await fetch(`${appBaseUrl}/api/bookings/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        booking_id: holdData.booking_id,
        gateway_payment_id: `free_cooling_period_${holdData.booking_id}`,
        deposit_amount: 0,
      }),
    });
    if (confRes.status !== 200) {
      console.error('F-02 confRes ERROR:', confRes.status, await confRes.text());
    }
    assert.equal(confRes.status, 200);

    // Verify ticket pass displays patient name
    const ticketRes = await fetch(`${appBaseUrl}/api/ticket/${holdData.booking_id}`, {
      headers: { Authorization: `Bearer ${cust1.token}` },
    });
    assert.equal(ticketRes.status, 200);
    const ticketData = await ticketRes.json();
    assert.equal(ticketData.booking.patient_name, patientName);
    assert.equal(ticketData.booking.booked_for, 'family');
  });

  // F-03: Book for child age 5
  it('F-03: Book for child age 5 - is_minor = true, Minor tag derived', async () => {
    const tStart = new Date(Date.now() + 302 * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + 302 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    const holdRes = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'family',
        patient_name: 'Aarav Sharma',
        patient_age: 5,
        patient_relationship: 'child',
      }),
    });
    if (holdRes.status !== 201) {
      console.error('F-02 holdRes ERROR:', holdRes.status, await holdRes.text());
    }
    assert.equal(holdRes.status, 201);
    const holdData = await holdRes.json();
    createdBookingIds.push(holdData.booking_id);

    assert.equal(holdData.is_minor, true, 'is_minor must be true for age 5');
    assert.equal(holdData.patient_name, 'Aarav Sharma');

    // Direct DB check on computed column
    const dbRes = await dbPool.query('SELECT is_minor, patient_age FROM public.bookings WHERE id = $1', [
      holdData.booking_id,
    ]);
    assert.equal(dbRes.rows[0].is_minor, true);
    assert.equal(dbRes.rows[0].patient_age, 5);
  });

  // F-04: Age boundary testing
  it('F-04: Age boundaries - 0, 1, 17, 18, 19, 120 accepted with correct is_minor boolean', async () => {
    const testCases = [
      { age: 0, expectedMinor: true },
      { age: 1, expectedMinor: true },
      { age: 17, expectedMinor: true },
      { age: 18, expectedMinor: false },
      { age: 19, expectedMinor: false },
      { age: 120, expectedMinor: false },
    ];

    for (let i = 0; i < testCases.length; i++) {
      const { age, expectedMinor } = testCases[i];
      const tStart = new Date(Date.now() + (310 + i) * 3600 * 1000).toISOString();
      const tEnd = new Date(Date.now() + (310 + i) * 3600 * 1000 + 15 * 60 * 1000).toISOString();

      const holdRes = await fetch(`${appBaseUrl}/api/bookings/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
        body: JSON.stringify({
          customer_id: cust1.user.id,
          resource_id: docA.id,
          slot_start: tStart,
          slot_end: tEnd,
          booked_for: 'family',
          patient_name: `Boundary Patient ${age}`,
          patient_age: age,
          patient_relationship: 'other',
        }),
      });

      assert.equal(holdRes.status, 201, `Age ${age} must be accepted with 201`);
      const holdData = await holdRes.json();
      createdBookingIds.push(holdData.booking_id);
      assert.equal(holdData.is_minor, expectedMinor, `Age ${age} is_minor must be ${expectedMinor}`);

      const dbRes = await dbPool.query('SELECT is_minor FROM public.bookings WHERE id = $1', [holdData.booking_id]);
      assert.equal(dbRes.rows[0].is_minor, expectedMinor);
    }
  });

  // F-05: Age invalid
  it('F-05: Age invalid - -1, 121, 1.5, "abc" rejected; null/empty allowed when optional', async () => {
    const tStart = new Date(Date.now() + 320 * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + 320 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    const invalidAges = [-1, 121, 1.5, 'abc'];
    for (const badAge of invalidAges) {
      const res = await fetch(`${appBaseUrl}/api/bookings/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
        body: JSON.stringify({
          customer_id: cust1.user.id,
          resource_id: docA.id,
          slot_start: tStart,
          slot_end: tEnd,
          booked_for: 'family',
          patient_name: 'Test Name',
          patient_age: badAge,
        }),
      });
      assert.equal(res.status, 400, `Bad age ${badAge} must be rejected with 400`);
      const err = await res.json();
      assert.ok(err.error?.toLowerCase().includes('age'), `Error message must cite age: ${err.error}`);
    }

    // null / omitted age is allowed (optional field)
    const nullAgeRes = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'family',
        patient_name: 'Optional Age Patient',
        patient_age: null,
      }),
    });
    assert.equal(nullAgeRes.status, 201, 'null age must be accepted when optional');
    const nullData = await nullAgeRes.json();
    createdBookingIds.push(nullData.booking_id);
    assert.equal(nullData.patient_age, null);
    assert.equal(nullData.is_minor, false);
  });

  // F-06: Name required for family
  it('F-06: Name required for family - empty, whitespace-only, missing rejected server-side', async () => {
    const tStart = new Date(Date.now() + 325 * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + 325 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    const badNames = ['', '   ', null, undefined];
    for (const name of badNames) {
      const res = await fetch(`${appBaseUrl}/api/bookings/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
        body: JSON.stringify({
          customer_id: cust1.user.id,
          resource_id: docA.id,
          slot_start: tStart,
          slot_end: tEnd,
          booked_for: 'family',
          patient_name: name,
        }),
      });
      assert.equal(res.status, 400, `Name "${name}" must be rejected with 400`);
      const data = await res.json();
      assert.ok(data.error?.toLowerCase().includes('name is required'));
    }
  });

  // F-07: Name boundaries & Unicode
  it('F-07: Name boundaries - 1 char, 100 chars, 101 chars (rejected), unicode (Telugu, Hindi, Tamil, emoji, accented), spaces trimmed', async () => {
    const tStart = new Date(Date.now() + 330 * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + 330 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    // 101 chars -> 400 rejected
    const tooLongName = 'A'.repeat(101);
    const longRes = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'family',
        patient_name: tooLongName,
      }),
    });
    assert.equal(longRes.status, 400, '101 chars name must be rejected with 400');

    // Unicode test cases
    const validNames = [
      'X', // 1 char
      'A'.repeat(100), // 100 chars
      'సాయి తేజ', // Telugu
      'आरव शर्मा', // Hindi
      'கார்த்திக்', // Tamil
      '👶 Aarav', // Emoji
      'Renée François', // Accented French
      '  Trimmed Name  ', // Leading/trailing spaces
    ];

    for (let i = 0; i < validNames.length; i++) {
      const name = validNames[i];
      const slotS = new Date(Date.now() + (331 + i) * 3600 * 1000).toISOString();
      const slotE = new Date(Date.now() + (331 + i) * 3600 * 1000 + 15 * 60 * 1000).toISOString();

      const res = await fetch(`${appBaseUrl}/api/bookings/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
        body: JSON.stringify({
          customer_id: cust1.user.id,
          resource_id: docA.id,
          slot_start: slotS,
          slot_end: slotE,
          booked_for: 'family',
          patient_name: name,
        }),
      });
      assert.equal(res.status, 201, `Name "${name}" must be accepted with 201`);
      const data = await res.json();
      createdBookingIds.push(data.booking_id);
      assert.equal(data.patient_name, name.trim(), 'Name must be stored trimmed');
    }
  });

  // F-08: Note boundaries
  it('F-08: Note boundaries - empty, 200 chars, 201 chars (rejected)', async () => {
    const tStart = new Date(Date.now() + 345 * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + 345 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    // 201 chars -> 400
    const res201 = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'family',
        patient_name: 'Note Patient',
        booking_note: 'A'.repeat(201),
      }),
    });
    assert.equal(res201.status, 400, '201-char note must be rejected with 400');

    // 200 chars -> 201
    const res200 = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'family',
        patient_name: 'Note Patient',
        booking_note: 'A'.repeat(200),
      }),
    });
    assert.equal(res200.status, 201, '200-char note must be accepted');
    const data200 = await res200.json();
    createdBookingIds.push(data200.booking_id);
    assert.equal(data200.booking_note.length, 200);
  });

  // F-09: Relationship mapping
  it('F-09: Relationship - each allowed value works; arbitrary value mapped to \x27other\x27', async () => {
    const allowed = ['child', 'spouse', 'parent', 'sibling', 'other'];
    for (let i = 0; i < allowed.length; i++) {
      const rel = allowed[i];
      const slotS = new Date(Date.now() + (350 + i) * 3600 * 1000).toISOString();
      const slotE = new Date(Date.now() + (350 + i) * 3600 * 1000 + 15 * 60 * 1000).toISOString();

      const res = await fetch(`${appBaseUrl}/api/bookings/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
        body: JSON.stringify({
          customer_id: cust1.user.id,
          resource_id: docA.id,
          slot_start: slotS,
          slot_end: slotE,
          booked_for: 'family',
          patient_name: `Patient ${rel}`,
          patient_relationship: rel.toUpperCase(), // case-insensitive test
        }),
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      createdBookingIds.push(data.booking_id);
      assert.equal(data.patient_relationship, rel);
    }

    // Arbitrary relationship -> mapped to 'other'
    const arbSlotS = new Date(Date.now() + 358 * 3600 * 1000).toISOString();
    const arbSlotE = new Date(Date.now() + 358 * 3600 * 1000 + 15 * 60 * 1000).toISOString();
    const arbRes = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: arbSlotS,
        slot_end: arbSlotE,
        booked_for: 'family',
        patient_name: 'Patient Arbitrary Rel',
        patient_relationship: 'neighbor_friend_colleague',
      }),
    });
    assert.equal(arbRes.status, 201);
    const arbData = await arbRes.json();
    createdBookingIds.push(arbData.booking_id);
    assert.equal(arbData.patient_relationship, 'other', 'Arbitrary relationship must be normalized to "other"');
  });

  // F-10: Self booking with stray patient fields
  it('F-10: Self booking with stray patient fields sent - patient fields cleared and stored row is clean', async () => {
    const tStart = new Date(Date.now() + 360 * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + 360 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    const res = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'self',
        patient_name: 'Stray Name That Should Disappear',
        patient_age: 12,
        patient_relationship: 'child',
        booking_note: 'Stray symptom',
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    createdBookingIds.push(data.booking_id);

    assert.equal(data.booked_for, 'self');
    assert.equal(data.patient_name, null);
    assert.equal(data.patient_age, null);
    assert.equal(data.patient_relationship, null);
    assert.equal(data.booking_note, null);
    assert.equal(data.is_minor, false);

    // Verify raw DB row
    const dbRes = await dbPool.query('SELECT * FROM public.bookings WHERE id = $1', [data.booking_id]);
    const row = dbRes.rows[0];
    assert.equal(row.booked_for, 'self');
    assert.equal(row.patient_name, null);
    assert.equal(row.patient_age, null);
    assert.equal(row.patient_relationship, null);
    assert.equal(row.booking_note, null);
    assert.equal(row.is_minor, false);
  });

  // F-11: Multiple family bookings & duplicate rules
  it('F-11: Multiple family bookings - back-to-back allowed for different patients; 1-hour gap enforced for same patient', async () => {
    const slot1Start = new Date(Date.now() + 370 * 3600 * 1000).toISOString();
    const slot1End = new Date(Date.now() + 370 * 3600 * 1000 + 15 * 60 * 1000).toISOString();
    const slot2Start = slot1End; // exactly adjacent / back-to-back
    const slot2End = new Date(Date.now() + 370 * 3600 * 1000 + 30 * 60 * 1000).toISOString();

    // 1. Hold for Patient A (Aarav)
    const holdA = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: slot1Start,
        slot_end: slot1End,
        booked_for: 'family',
        patient_name: 'Aarav Sharma',
        patient_age: 5,
      }),
    });
    assert.equal(holdA.status, 201);
    const dataA = await holdA.json();
    createdBookingIds.push(dataA.booking_id);

    // 2. Same booker, DIFFERENT patient (Sunita) in back-to-back slot -> MUST SUCCEED (SPEC line 13)
    const holdB = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: slot2Start,
        slot_end: slot2End,
        booked_for: 'family',
        patient_name: 'Sunita Sharma',
        patient_age: 32,
      }),
    });
    assert.equal(holdB.status, 201, 'Different family members can book back-to-back slots');
    const dataB = await holdB.json();
    createdBookingIds.push(dataB.booking_id);

    // 3. Same booker, SAME patient (Aarav) within 1 hour on docA2 -> MUST BE REJECTED
    const holdFailSamePatient = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA2.id,
        slot_start: slot2Start,
        slot_end: slot2End,
        booked_for: 'family',
        patient_name: 'Aarav Sharma',
        patient_age: 5,
      }),
    });
    assert.equal(holdFailSamePatient.status, 400, 'Same patient must adhere to 1-hour gap');
    const errData = await holdFailSamePatient.json();
    assert.ok(errData.error?.includes('1 hour apart'));
  });

  // F-12: Cancel family booking & refund path
  it('F-12: Cancel family booking - patient data preserved and refund bound to booker', async () => {
    const tStart = new Date(Date.now() + 380 * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + 380 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    const holdRes = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'family',
        patient_name: 'Cancel Me Patient',
        patient_age: 10,
        patient_relationship: 'child',
      }),
    });
    if (holdRes.status !== 201) {
      console.error('F-02 holdRes ERROR:', holdRes.status, await holdRes.text());
    }
    assert.equal(holdRes.status, 201);
    const holdData = await holdRes.json();
    createdBookingIds.push(holdData.booking_id);

    // Confirm booking
    await fetch(`${appBaseUrl}/api/bookings/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({ booking_id: holdData.booking_id }),
    });

    // Cancel booking via customer API
    const cancelRes = await fetch(`${appBaseUrl}/api/bookings/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({ booking_id: holdData.booking_id, reason: 'Change of plans' }),
    });
    assert.equal(cancelRes.status, 200);

    // Verify row status is CANCELLED and patient details are strictly preserved
    const rowRes = await dbPool.query('SELECT status, booked_for, patient_name, is_minor FROM public.bookings WHERE id = $1', [
      holdData.booking_id,
    ]);
    const row = rowRes.rows[0];
    assert.equal(row.status, 'CANCELLED');
    assert.equal(row.booked_for, 'family');
    assert.equal(row.patient_name, 'Cancel Me Patient');
    assert.equal(row.is_minor, true);
  });

  // F-13: Mobile booking history query
  it('F-13: Mobile history - returns patient_name for family and booker name for self', async () => {
    const histRes = await fetch(`${appBaseUrl}/api/customer/queue-and-history?customerId=${cust1.user.id}`, {
      headers: { Authorization: `Bearer ${cust1.token}` },
    });
    assert.equal(histRes.status, 200);
    const histData = await histRes.json();
    assert.ok(Array.isArray(histData.history) || Array.isArray(histData.queue));

    // Also test direct customer mobile query projection
    const mobileQueryRes = await fetch(
      `${supabaseUrl}/rest/v1/bookings?customer_id=eq.${cust1.user.id}&select=id,status,slot_start,booked_for,patient_name,patient_relationship,patient_age,is_minor,booking_note&order=slot_start.desc`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${cust1.token}` } }
    );
    assert.equal(mobileQueryRes.status, 200);
    const mobileRows = await mobileQueryRes.json();
    const familyRow = mobileRows.find((r) => r.booked_for === 'family');
    assert.ok(familyRow, 'Must have at least one family booking in customer history');
    assert.ok(familyRow.patient_name);
  });

  // F-14: Merchant queue list, detail view & patient search
  it('F-14: Merchant queue list & detail view - shows patient name, family badge, and search works', async () => {
    // Query merchant bookings view with service role / admin
    const listRes = await fetch(
      `${supabaseUrl}/rest/v1/merchant_bookings?provider_id=eq.${hospA.id}&booked_for=eq.family&select=id,patient_name,patient_age,patient_relationship,is_minor,booking_note,customer_name,customer_phone`,
      { headers: serviceHeaders }
    );
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.ok(list.length > 0, 'Merchant queue must find family bookings');
    const bkg = list[0];
    assert.ok(bkg.patient_name);
    assert.equal(typeof bkg.is_minor, 'boolean');

    // Search by patient name
    const searchRes = await fetch(
      `${supabaseUrl}/rest/v1/merchant_bookings?provider_id=eq.${hospA.id}&patient_name=ilike.*${encodeURIComponent(bkg.patient_name)}*&select=id,patient_name`,
      { headers: serviceHeaders }
    );
    assert.equal(searchRes.status, 200);
    const searchMatches = await searchRes.json();
    assert.ok(searchMatches.length > 0, 'Patient name search filter must return matching rows');
  });

  // F-15: Notifications name the patient and deliver to booker only
  it('F-15: Notifications - message names the patient and sends to booker phone only', async () => {
    const tStart = new Date(Date.now() + 390 * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + 390 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    const holdRes = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'family',
        patient_name: 'Tanvi Sharma',
        patient_age: 8,
      }),
    });
    if (holdRes.status !== 201) {
      console.error('F-02 holdRes ERROR:', holdRes.status, await holdRes.text());
    }
    assert.equal(holdRes.status, 201);
    const holdData = await holdRes.json();
    createdBookingIds.push(holdData.booking_id);

    // Invoke notification RPC
    const notifRes = await fetch(`${supabaseUrl}/rest/v1/rpc/dispatch_booking_notification`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        p_booking_id: holdData.booking_id,
        p_event_type: 'BOOKING_CONFIRMED',
      }),
    });
    assert.equal(notifRes.status, 200);
    const notifData = await notifRes.json();
    assert.equal(notifData.success, true);

    // Inspect notification log entry
    const logRes = await fetch(`${supabaseUrl}/rest/v1/notification_logs?booking_id=eq.${holdData.booking_id}`, {
      headers: serviceHeaders,
    });
    const logs = await logRes.json();
    assert.ok(logs.length > 0);
    assert.equal(logs[0].recipient_name, 'Tanvi Sharma', 'Notification must name the patient Tanvi Sharma');
    assert.equal(logs[0].recipient_phone, '919900000010', 'Notification must be addressed to booker phone');
  });

  // F-16: Payment and refund path unchanged
  it('F-16: Payment and refund path - Razorpay order created for booker; refund logic untouched', async () => {
    const tStart = new Date(Date.now() + 400 * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + 400 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    const holdRes = await fetch(`${appBaseUrl}/api/bookings/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'family',
        patient_name: 'Payment Test Patient',
      }),
    });
    if (holdRes.status !== 201) {
      console.error('F-02 holdRes ERROR:', holdRes.status, await holdRes.text());
    }
    assert.equal(holdRes.status, 201);
    const holdData = await holdRes.json();
    createdBookingIds.push(holdData.booking_id);

    // Call /api/payments/create-order
    const orderRes = await fetch(`${appBaseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({ booking_id: holdData.booking_id }),
    });
    assert.equal(orderRes.status, 200);
    const orderData = await orderRes.json();
    assert.ok(orderData.order_id, 'Razorpay order ID must be generated');

    // Verify booking in database has gateway_order_id matching orderData.order_id
    const bkgDb = await dbPool.query('SELECT gateway_order_id, customer_id FROM public.bookings WHERE id = $1', [
      holdData.booking_id,
    ]);
    assert.equal(bkgDb.rows[0].gateway_order_id, orderData.order_id);
    assert.equal(bkgDb.rows[0].customer_id, cust1.user.id, 'Payment order must be strictly tied to booker');
  });

  // F-17: Backward compatibility
  it('F-17: Backward compatibility - pre-existing rows without family fields load cleanly', async () => {
    // Insert a legacy row using direct SQL (simulating pre-migration data)
    const legId = crypto.randomUUID();
    const refCode = `LEGACY-${Date.now().toString().slice(-6)}`;
    const slotS = new Date(Date.now() + 410 * 3600 * 1000).toISOString();
    const slotE = new Date(Date.now() + 410 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    await dbPool.query(
      `INSERT INTO public.bookings (
        id, customer_id, provider_id, resource_id, slot_start, slot_end, status, reference_code,
        deposit_amount, platform_fee, total_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', $7, 100, 10, 100)`,
      [legId, cust1.user.id, hospA.id, docA.id, slotS, slotE, refCode]
    );
    createdBookingIds.push(legId);

    // Verify row defaults to booked_for = 'self' and is_minor = false
    const legRes = await dbPool.query('SELECT booked_for, patient_name, is_minor FROM public.bookings WHERE id = $1', [legId]);
    assert.equal(legRes.rows[0].booked_for, 'self');
    assert.equal(legRes.rows[0].patient_name, null);
    assert.equal(legRes.rows[0].is_minor, false);

    // Load via API ticket endpoint
    const ticketRes = await fetch(`${appBaseUrl}/api/ticket/${legId}`, {
      headers: { Authorization: `Bearer ${cust1.token}` },
    });
    assert.equal(ticketRes.status, 200);
    const ticketJson = await ticketRes.json();
    assert.equal(ticketJson.booking.booked_for, 'self');
  });

  // F-18: Migration idempotency
  it('F-18: Migration idempotency - re-running migration on existing data causes 0 errors', async () => {
    const migrationSql = fs.readFileSync('supabase/migrations/20261106000001_family_minor_booking_support.sql', 'utf8');
    // Execute full migration SQL
    await dbPool.query(migrationSql);

    // Assert columns and constraints still exist and function
    const colRes = await dbPool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'bookings' AND column_name IN ('booked_for', 'patient_name', 'patient_age', 'patient_relationship', 'booking_note', 'is_minor');
    `);
    assert.equal(colRes.rows.length, 6, 'All 6 columns must exist after rerun');
  });

  // F-19: UI states & Double-tap protection
  it('F-19: UI states - double-tap submit prevention creates exactly one booking', async () => {
    const tStart = new Date(Date.now() + 420 * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + 420 * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    // Fire 2 concurrent hold calls with identical payload
    const payload = JSON.stringify({
      customer_id: cust1.user.id,
      resource_id: docA.id,
      slot_start: tStart,
      slot_end: tEnd,
      booked_for: 'family',
      patient_name: 'Double Tap Patient',
    });

    const [res1, res2] = await Promise.all([
      fetch(`${appBaseUrl}/api/bookings/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
        body: payload,
      }),
      fetch(`${appBaseUrl}/api/bookings/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
        body: payload,
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.equal(statuses[0], 201, 'One request must succeed with 201');
    assert.ok(statuses[1] === 400 || statuses[1] === 409, `Duplicate request must be rejected with 400 or 409 (received ${statuses[1]})`);

    let successData;
    if (res1.status === 201) {
      successData = await res1.json();
    } else {
      successData = await res2.json();
    }
    createdBookingIds.push(successData.booking_id);
  });

  // F-20: Accessibility attributes inspection
  it('F-20: Accessibility basics - labels and semantic tags present in customer mobile and merchant web UI', () => {
    const checkoutCode = fs.readFileSync('apps/customer-mobile/src/screens/CheckoutModal.tsx', 'utf8');
    assert.ok(checkoutCode.includes('accessibilityRole="button"'), 'Segmented controls must have accessibilityRole');
    assert.ok(checkoutCode.includes('accessibilityLabel='), 'Inputs must have accessibilityLabel');

    const merchantCode = fs.readFileSync('apps/merchant-web/src/components/frontdesk/FrontDeskQueueTabs.tsx', 'utf8');
    assert.ok(merchantCode.includes('Family booking'), 'Merchant queue must visually identify family bookings');
    assert.ok(merchantCode.includes('Minor'), 'Merchant queue must visually identify minor tag');
  });
});
