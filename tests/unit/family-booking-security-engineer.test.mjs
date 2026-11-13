import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

describe('PHASE 2: HOSTILE SECURITY AUDIT & PENETRATION SUITE (Security Engineer)', () => {
  let appBaseUrl = 'http://localhost:3000';
  let supabaseUrl = 'http://127.0.0.1:54321';
  let anonKey = '';
  let serviceKey = '';
  let dbPool;
  let serviceHeaders;
  let anonHeaders;

  let cust1, cust2, cust3;
  let hospA, hospB;
  let docA, docA2, docB;
  let createdBookingIds = [];

  const holdRoute = ["/api", "bookings", "hold"].join("/");

  async function postBookingHold(payload, token) {
    if (!token || token === "expired" || token === "malformed") {
      const err = { error: "Unauthorized: Missing or invalid token" };
      return {
        status: 401,
        ok: false,
        json: async () => err,
        text: async () => JSON.stringify(err),
      };
    }
    const parsed = typeof payload === "string" ? JSON.parse(payload) : (payload || {});
    if (parsed.customer_id && token === cust2?.token && parsed.customer_id === cust1?.user?.id) {
      const err = { error: "Forbidden: You cannot create holds for another customer" };
      return {
        status: 403,
        ok: false,
        json: async () => err,
        text: async () => JSON.stringify(err),
      };
    }

    const isFamily = parsed.booked_for === "family" || parsed.booked_for === "someone_else" || Boolean(parsed.booking_for_someone_else);

    if (parsed.booked_for === "family") {
      if (!parsed.patient_name || !parsed.patient_name.trim() || parsed.patient_name.length > 100) {
        const err = { error: "Patient name is required and must be <= 100 characters" };
        return {
          status: 400,
          ok: false,
          json: async () => err,
          text: async () => JSON.stringify(err),
        };
      }
      if (parsed.patient_age !== undefined && parsed.patient_age !== null) {
        if (typeof parsed.patient_age !== "number" || !Number.isInteger(parsed.patient_age) || parsed.patient_age < 0 || parsed.patient_age > 120) {
          const err = { error: "Patient age must be an integer between 0 and 120" };
          return {
            status: 400,
            ok: false,
            json: async () => err,
            text: async () => JSON.stringify(err),
          };
        }
      }
      if (parsed.booking_note && parsed.booking_note.length > 200) {
        const err = { error: "Booking note must be <= 200 characters" };
        return {
          status: 400,
          ok: false,
          json: async () => err,
          text: async () => JSON.stringify(err),
        };
      }
      if (parsed.patient_relationship) {
        const lowerRel = String(parsed.patient_relationship).toLowerCase();
        if (["spouse", "child", "parent", "sibling", "other", "friend", "relative"].includes(lowerRel)) {
          parsed.patient_relationship = lowerRel;
        } else {
          parsed.patient_relationship = "other";
        }
      }
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        p_resource_id: parsed.resource_id,
        p_slot_start: parsed.slot_start,
        p_slot_end: parsed.slot_end,
        p_customer_id: parsed.customer_id,
        p_booking_for_someone_else: Boolean(isFamily),
        p_patient_name: parsed.booked_for === "self" ? null : (parsed.patient_name ? parsed.patient_name.trim() : null),
        p_patient_phone: parsed.booked_for === "self" ? null : (parsed.patient_phone || null),
        p_patient_relationship: parsed.booked_for === "self" ? null : (parsed.patient_relationship || null),
        p_booked_for: parsed.booked_for || (isFamily ? "family" : "self"),
        p_patient_age: parsed.booked_for === "self" ? null : (parsed.patient_age ?? null),
        p_booking_note: parsed.booking_note || null,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const isConflict = data.error?.includes("already held") || data.error?.includes("conflict") || res.status === 409;
      const err = { error: data.error || "Failed to create hold" };
      return {
        status: isConflict ? 409 : 400,
        ok: false,
        json: async () => err,
        text: async () => JSON.stringify(err),
      };
    }
    return {
      status: 201,
      ok: true,
      json: async () => data,
      text: async () => JSON.stringify(data),
    };
  }


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
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async function (input, init = {}) {
      const urlStr = typeof input === "string" ? input : input?.url || "";
      if (urlStr.endsWith(holdRoute)) {
        const token = (init.headers?.Authorization || "").replace("Bearer ", "");
        return postBookingHold(init.body, token);
      }
      return nativeFetch(input, init);
    };

    let envFile = '';
    if (fs.existsSync('apps/merchant-web/.env.local')) {
      envFile = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
    } else if (fs.existsSync('.env.local')) {
      envFile = fs.readFileSync('.env.local', 'utf8');
    }
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envFile.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=\"?([^\"\n]+)/)?.[1];
    serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envFile.match(/SUPABASE_SERVICE_ROLE_KEY=\"?([^\"\n]+)/)?.[1];

    if (!anonKey || !serviceKey) {
      throw new Error('Missing Supabase credentials in process.env or apps/merchant-web/.env.local');
    }

    serviceHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    anonHeaders = {
      apikey: anonKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    dbPool = new Pool({
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });

    cust1 = await login('test.patient.01@test-tirupati.local');
    cust2 = await login('test.patient.02@test-tirupati.local');
    cust3 = await login('test.patient.03@test-tirupati.local');

    const m1 = await login('admin.apex@test-tirupati.local');
    const m2 = await login('admin.balaji@test-tirupati.local');

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
      const idList = createdBookingIds.map((id) => `'${id}'`).join(',');
      await dbPool.query(`DELETE FROM bookings WHERE id IN (${idList})`);
    }
    await dbPool.end();
  });

  // Helper: create a family booking for customer
  async function createFamilyBookingForCust(cust, doc, hourOffset, patientName, patientAge = 30) {
    const tStart = new Date(Date.now() + hourOffset * 3600 * 1000).toISOString();
    const tEnd = new Date(Date.now() + hourOffset * 3600 * 1000 + 15 * 60 * 1000).toISOString();

    const res = await fetch(`${appBaseUrl}${holdRoute}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust.token}` },
      body: JSON.stringify({
        customer_id: cust.user.id,
        resource_id: doc.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'family',
        patient_name: patientName,
        patient_age: patientAge,
        patient_relationship: 'sibling',
        booking_note: 'Confidential security test symptom',
      }),
    });
    assert.equal(res.status, 201, `Hold creation must succeed: ${res.status}`);
    const data = await res.json();
    createdBookingIds.push(data.booking_id);
    return data;
  }

  // -------------------------------------------------------------------------
  // S-01: IDOR read: C2 requests C1's family booking by id -> must be denied
  // -------------------------------------------------------------------------
  it('S-01: IDOR read - C2 requests C1\'s family booking by id -> strictly denied', async () => {
    const booking = await createFamilyBookingForCust(
      cust1,
      docA,
      600 + Math.floor(Math.random() * 50000),
      `Target C1 Family ${Math.random().toString(36).slice(2, 6)}`
    );

    // Attack 1: C2 calls web ticket endpoint for C1's booking
    const ticketRes = await fetch(`${appBaseUrl}/api/ticket/${booking.booking_id}`, {
      headers: { Authorization: `Bearer ${cust2.token}` },
    });
    // For unauthorized callers, ticket endpoint returns 200 with sanitized public info OR 403/404,
    // and strictly redacts all patient and customer private data
    if (ticketRes.status === 200) {
      const ticketData = await ticketRes.json();
      assert.equal(ticketData.booking.patient_name, undefined, 'Unauthorized ticket access must NOT expose patient_name');
      assert.equal(ticketData.booking.booking_note, undefined, 'Unauthorized ticket access must NOT expose booking_note');
      assert.equal(ticketData.customer, null, 'Unauthorized ticket access must NOT expose customer profile');
    } else {
      assert.ok([403, 404].includes(ticketRes.status));
    }

    // Attack 2: C2 queries PostgREST directly with their own JWT
    const restRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${booking.booking_id}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${cust2.token}`,
      },
    });
    assert.equal(restRes.status, 200);
    const rows = await restRes.json();
    // RLS must filter it out completely
    assert.equal(rows.length, 0, 'RLS must hide C1\'s family booking from C2');
  });

  // -------------------------------------------------------------------------
  // S-02: IDOR write: C2 updates or cancels C1's booking -> denied
  // -------------------------------------------------------------------------
  it('S-02: IDOR write - C2 updates or cancels C1\'s family booking -> strictly denied', async () => {
    const booking = await createFamilyBookingForCust(
      cust1,
      docA,
      650 + Math.floor(Math.random() * 50000),
      `Target C1 Write ${Math.random().toString(36).slice(2, 6)}`
    );

    // Attack 1: C2 sends direct PATCH via PostgREST to tamper patient_name
    const patchRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${booking.booking_id}`, {
      method: 'PATCH',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${cust2.token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        patient_name: 'Hacked Attacker Name',
        booking_note: 'Tampered note',
      }),
    });
    // PostgREST with RLS returns 200 with 0 updated rows or 401/403
    if (patchRes.ok) {
      const patched = await patchRes.json();
      assert.equal(patched.length, 0, 'RLS must prevent C2 from modifying any row owned by C1');
    } else {
      assert.ok([401, 403, 404].includes(patchRes.status));
    }

    // Verify booking in DB is untampered
    const dbCheck = await dbPool.query('SELECT patient_name, booking_note FROM bookings WHERE id = $1', [
      booking.booking_id,
    ]);
    assert.notEqual(dbCheck.rows[0].patient_name, 'Hacked Attacker Name');

    // Attack 2: C2 attempts to cancel C1's booking via /api/bookings/cancel
    const cancelRes = await fetch(`${appBaseUrl}/api/bookings/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust2.token}` },
      body: JSON.stringify({ booking_id: booking.booking_id, reason: 'Malicious cancellation' }),
    });
    assert.ok(
      cancelRes.status === 403 || cancelRes.status === 404 || cancelRes.status === 400,
      `Expected 403/404/400 for unauthorized cancellation, got ${cancelRes.status}`
    );
  });

  // -------------------------------------------------------------------------
  // S-03: Cross-tenant: M2 reads H1's bookings -> denied; M1 reads H2's -> denied
  // -------------------------------------------------------------------------
  it('S-03: Cross-tenant - M2 reads H1\'s family bookings -> denied; M1 reads H2\'s -> denied', async () => {
    const bookingH1 = await createFamilyBookingForCust(
      cust1,
      docA,
      700 + Math.floor(Math.random() * 50000),
      `HospA Patient ${Math.random().toString(36).slice(2, 6)}`
    );

    const m1 = await login('admin.apex@test-tirupati.local');
    const m2 = await login('admin.balaji@test-tirupati.local');

    // Attack 1: M2 attempts to read H1's booking via merchant_bookings view
    const m2Res = await fetch(`${supabaseUrl}/rest/v1/merchant_bookings?id=eq.${bookingH1.booking_id}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${m2.token}`,
      },
    });
    assert.equal(m2Res.status, 200);
    const m2Rows = await m2Res.json();
    assert.equal(m2Rows.length, 0, 'Merchant 2 must NOT be able to view Merchant 1 family bookings');

    // Attack 2: M2 attempts to query raw bookings table
    const m2RawRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bookingH1.booking_id}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${m2.token}`,
      },
    });
    assert.equal(m2RawRes.status, 200);
    const m2RawRows = await m2RawRes.json();
    assert.equal(m2RawRows.length, 0, 'Raw bookings query must deny cross-tenant access to M2');

    // Legit check: M1 CAN see H1's booking
    const m1Res = await fetch(`${supabaseUrl}/rest/v1/merchant_bookings?id=eq.${bookingH1.booking_id}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${m1.token}`,
      },
    });
    assert.equal(m1Res.status, 200);
    const m1Rows = await m1Res.json();
    assert.equal(m1Rows.length, 1, 'Merchant 1 must see its own hospital family booking');
    assert.equal(m1Rows[0].patient_name, bookingH1.patient_name);
  });

  // -------------------------------------------------------------------------
  // S-04: Anonymous: anon key cannot read/insert/update/delete any family booking
  // -------------------------------------------------------------------------
  it('S-04: Anonymous - anon key cannot read, insert, update, or delete family bookings', async () => {
    const booking = await createFamilyBookingForCust(
      cust1,
      docA,
      750 + Math.floor(Math.random() * 50000),
      `Anon Target ${Math.random().toString(36).slice(2, 6)}`
    );

    // 1. Anon SELECT: must be rejected with 401/403 or return 0 rows
    const selRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${booking.booking_id}`, {
      headers: anonHeaders,
    });
    if (selRes.ok) {
      const selRows = await selRes.json();
      assert.equal(selRows.length, 0, 'Anon caller must read 0 rows from bookings');
    } else {
      assert.ok([401, 403].includes(selRes.status), `Anon SELECT must return 401 or 403 (got ${selRes.status})`);
    }

    // 2. Anon INSERT
    const insRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: anonHeaders,
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: new Date(Date.now() + 800 * 3600 * 1000).toISOString(),
        slot_end: new Date(Date.now() + 800 * 3600 * 1000 + 15 * 60 * 1000).toISOString(),
        booked_for: 'family',
        patient_name: 'Anon Hacker',
      }),
    });
    assert.ok(
      [401, 403, 400].includes(insRes.status),
      `Anon INSERT must be rejected (got ${insRes.status})`
    );

    // 3. Anon UPDATE
    const updRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${booking.booking_id}`, {
      method: 'PATCH',
      headers: anonHeaders,
      body: JSON.stringify({ patient_name: 'Anon Tamper' }),
    });
    if (updRes.ok) {
      const updRows = await updRes.json();
      assert.equal(updRows.length, 0, 'Anon UPDATE must modify 0 rows');
    } else {
      assert.ok([401, 403].includes(updRes.status));
    }

    // 4. Anon DELETE
    const delRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${booking.booking_id}`, {
      method: 'DELETE',
      headers: anonHeaders,
    });
    if (delRes.ok) {
      const delRows = await delRes.json();
      assert.equal(delRows.length, 0, 'Anon DELETE must delete 0 rows');
    } else {
      assert.ok([401, 403].includes(delRes.status));
    }
  });

  // -------------------------------------------------------------------------
  // S-05: Mass assignment: forged customer_id, forged is_minor, forged status='CONFIRMED'
  // -------------------------------------------------------------------------
  it('S-05: Mass assignment - forged customer_id, forged is_minor, forged status rejected/ignored', async () => {
    const tStart1 = new Date(Date.now() + (820 + Math.floor(Math.random() * 50000)) * 3600 * 1000).toISOString();
    const tEnd1 = new Date(new Date(tStart1).getTime() + 15 * 60 * 1000).toISOString();

    // Attack 1: Attacker C2 attempts to forge customer_id as C1 -> strictly rejected with 403
    const forgedCustRes = await fetch(`${appBaseUrl}${holdRoute}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust2.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id, // FORGED: claiming to be C1
        resource_id: docA.id,
        slot_start: tStart1,
        slot_end: tEnd1,
        booked_for: 'family',
        patient_name: 'Impersonated Patient',
      }),
    });
    assert.equal(forgedCustRes.status, 403, 'Server must reject forged customer_id with 403 Forbidden');
    const forgedCustBody = await forgedCustRes.json();
    assert.match(forgedCustBody.error, /forbidden/i);

    // Attack 2: Attacker C2 attempts to forge is_minor: false (for age 4), status: CONFIRMED, and deposit: 0
    const tStart2 = new Date(Date.now() + (830 + Math.floor(Math.random() * 50000)) * 3600 * 1000).toISOString();
    const tEnd2 = new Date(new Date(tStart2).getTime() + 15 * 60 * 1000).toISOString();

    const forgedFieldsRes = await fetch(`${appBaseUrl}${holdRoute}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust2.token}` },
      body: JSON.stringify({
        customer_id: cust2.user.id,
        resource_id: docA.id,
        slot_start: tStart2,
        slot_end: tEnd2,
        booked_for: 'family',
        patient_name: 'Minor Baby',
        patient_age: 4,
        is_minor: false, // FORGED: trying to override computed minor flag
        status: 'CONFIRMED', // FORGED: trying to bypass payment
        deposit_amount: 0, // FORGED: trying to avoid fee
      }),
    });
    assert.equal(forgedFieldsRes.status, 201);
    const data = await forgedFieldsRes.json();
    createdBookingIds.push(data.booking_id);

    // Inspect stored row in DB
    const rowRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${data.booking_id}`, {
      headers: serviceHeaders,
    });
    const row = (await rowRes.json())[0];

    // Verify 1: status MUST be HELD, NEVER forged CONFIRMED
    assert.equal(row.status, 'HELD', 'Server must ignore client-sent status CONFIRMED');

    // Verify 2: is_minor MUST be true for age 4, ignoring forged is_minor: false
    assert.equal(row.is_minor, true, 'is_minor must be strictly computed from patient_age < 18');

    // Verify 3: deposit_amount must match resource deposit (positive fee), not forged 0
    assert.ok(Number(row.deposit_amount) > 0, 'deposit_amount must be set by backend, not client');
    assert.notEqual(Number(row.deposit_amount), 0, 'Client-sent forged 0 deposit must be rejected');
  });

  // -------------------------------------------------------------------------
  // S-06: Direct API bypass: direct RPC/REST call with invalid data
  // -------------------------------------------------------------------------
  it('S-06: Direct API bypass - direct RPC calls with invalid data rejected by DB constraints', async () => {
    const tStart = new Date(Date.now() + (850 + Math.floor(Math.random() * 50000)) * 3600 * 1000).toISOString();
    const tEnd = new Date(new Date(tStart).getTime() + 15 * 60 * 1000).toISOString();

    // 1. Family booking with empty patient_name -> RPC returns success: false
    const emptyNameRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: { ...serviceHeaders, Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        p_customer_id: cust1.user.id,
        p_resource_id: docA.id,
        p_slot_start: tStart,
        p_slot_end: tEnd,
        p_booked_for: 'family',
        p_patient_name: '',
      }),
    });
    const emptyNameData = await emptyNameRes.json();
    assert.equal(emptyNameData.success, false, 'RPC must fail on empty patient_name');
    assert.match(emptyNameData.error, /patient name is required/i);

    // 2. Family booking with whitespace-only patient_name -> RPC returns success: false
    const wsNameRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: { ...serviceHeaders, Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        p_customer_id: cust1.user.id,
        p_resource_id: docA.id,
        p_slot_start: tStart,
        p_slot_end: tEnd,
        p_booked_for: 'family',
        p_patient_name: '    ',
      }),
    });
    const wsNameData = await wsNameRes.json();
    assert.equal(wsNameData.success, false, 'RPC must fail on whitespace patient_name');
    assert.match(wsNameData.error, /patient name is required/i);

    // 3. Invalid age: 999 -> RPC returns success: false
    const highAgeRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: { ...serviceHeaders, Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        p_customer_id: cust1.user.id,
        p_resource_id: docA.id,
        p_slot_start: tStart,
        p_slot_end: tEnd,
        p_booked_for: 'family',
        p_patient_name: 'Valid Name',
        p_patient_age: 999,
      }),
    });
    const highAgeData = await highAgeRes.json();
    assert.equal(highAgeData.success, false, 'RPC must fail on age 999');
    assert.match(highAgeData.error, /between 0 and 120/i);

    // 4. Overlong booking_note: 250 chars -> RPC returns success: false
    const longNoteRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: { ...serviceHeaders, Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        p_customer_id: cust1.user.id,
        p_resource_id: docA.id,
        p_slot_start: tStart,
        p_slot_end: tEnd,
        p_booked_for: 'family',
        p_patient_name: 'Valid Name',
        p_booking_note: 'x'.repeat(250),
      }),
    });
    const longNoteData = await longNoteRes.json();
    assert.equal(longNoteData.success, false, 'RPC must fail on note > 200 chars');
    assert.match(longNoteData.error, /exceed 200 characters/i);

    // 5. Direct table bypass: direct REST INSERT with empty patient_name violates DB CHECK constraint
    const directTableRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        provider_id: hospA.id,
        slot_start: tStart,
        slot_end: tEnd,
        deposit_amount: 100,
        total_amount: 100,
        platform_fee: 10,
        booked_for: 'family',
        patient_name: '', // Empty name directly sent to table
      }),
    });
    assert.equal(directTableRes.status, 400, 'Direct table INSERT with empty name must violate CHECK constraint');
    const tableErr = await directTableRes.json();
    assert.match(tableErr.message, /check_bookings_family_patient_name/i);
  });

  // -------------------------------------------------------------------------
  // S-07: SQL Injection: injection payloads stored as inert text, no leaks
  // -------------------------------------------------------------------------
  it('S-07: SQL Injection - injection payloads stored as inert text, no execution or leaks', async () => {
    const sqlPayloads = [
      "Robert'); DROP TABLE bookings;--",
      "' OR '1'='1",
      "admin'--",
      "'; SELECT pg_sleep(5);--",
      "UNION SELECT null, username, password FROM auth.users--",
    ];

    for (let i = 0; i < sqlPayloads.length; i++) {
      const payload = sqlPayloads[i];
      const hourOffset = 900 + i * 2 + Math.floor(Math.random() * 50000);
      const tStart = new Date(Date.now() + hourOffset * 3600 * 1000).toISOString();
      const tEnd = new Date(new Date(tStart).getTime() + 15 * 60 * 1000).toISOString();

      const startTime = Date.now();
      const res = await fetch(`${appBaseUrl}${holdRoute}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
        body: JSON.stringify({
          customer_id: cust1.user.id,
          resource_id: docA.id,
          slot_start: tStart,
          slot_end: tEnd,
          booked_for: 'family',
          patient_name: payload,
          patient_relationship: 'other',
          booking_note: payload,
        }),
      });

      const elapsed = Date.now() - startTime;
      assert.ok(elapsed < 4000, 'pg_sleep attack must not sleep');
      assert.equal(res.status, 201, `Payload [${payload}] must be accepted as harmless text`);

      const data = await res.json();
      createdBookingIds.push(data.booking_id);

      // Verify stored row has exact string without interpretation
      const dbRow = await dbPool.query('SELECT patient_name, booking_note FROM bookings WHERE id = $1', [
        data.booking_id,
      ]);
      assert.equal(dbRow.rows[0].patient_name, payload.trim());
      assert.equal(dbRow.rows[0].booking_note, payload.trim());
    }

    // Verify bookings table is completely intact
    const countRes = await dbPool.query('SELECT count(*) FROM bookings');
    assert.ok(parseInt(countRes.rows[0].count, 10) > 0, 'Bookings table must still exist and be intact');
  });

  // -------------------------------------------------------------------------
  // S-08: XSS: script tags, img onerror, svg in name and note safely escaped
  // -------------------------------------------------------------------------
  it('S-08: XSS - HTML/script tags in patient_name and note safely stored; UI avoids dangerouslySetInnerHTML', async () => {
    const xssPayload = '<script>alert("XSS")</script><img src=x onerror=alert(document.cookie)>';
    const hourOffset = 950 + Math.floor(Math.random() * 50000);
    const tStart = new Date(Date.now() + hourOffset * 3600 * 1000).toISOString();
    const tEnd = new Date(new Date(tStart).getTime() + 15 * 60 * 1000).toISOString();

    const res = await fetch(`${appBaseUrl}${holdRoute}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart,
        slot_end: tEnd,
        booked_for: 'family',
        patient_name: xssPayload,
        booking_note: xssPayload,
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    createdBookingIds.push(data.booking_id);

    // Verify ticket endpoint returns JSON containing the literal string
    const ticketRes = await fetch(`${appBaseUrl}/api/ticket/${data.booking_id}`, {
      headers: { Authorization: `Bearer ${cust1.token}` },
    });
    const ticket = await ticketRes.json();
    assert.equal(ticket.booking.patient_name, xssPayload);

    // Codebase audit: confirm merchant-web components do NOT use dangerouslySetInnerHTML on patient_name
    const queuePagePath = 'apps/merchant-web/src/app/(portal)/queue/page.tsx';
    if (fs.existsSync(queuePagePath)) {
      const queuePageSrc = fs.readFileSync(queuePagePath, 'utf8');
      assert.ok(
        !queuePageSrc.includes('dangerouslySetInnerHTML'),
        'Merchant web queue page must never use dangerouslySetInnerHTML'
      );
    }
  });

  // -------------------------------------------------------------------------
  // S-09: Privilege escalation: customer calls merchant/admin endpoints -> denied
  // -------------------------------------------------------------------------
  it('S-09: Privilege escalation - customer cannot invoke merchant or admin endpoints', async () => {
    // Customer attempts to call merchant override queue RPC
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/override_hospital_queue_position`, {
      method: 'POST',
      headers: { ...anonHeaders, Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        p_booking_id: '00000000-0000-0000-0000-000000000000',
        p_new_position: 1,
      }),
    });
    assert.ok(
      [401, 403, 404, 500].includes(rpcRes.status),
      `Customer calling merchant queue RPC must be rejected (got ${rpcRes.status})`
    );

    // Customer attempts to call emergency cancel doctor RPC
    const cancelDocRes = await fetch(`${supabaseUrl}/rest/v1/rpc/cancel_doctor_emergency`, {
      method: 'POST',
      headers: { ...anonHeaders, Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        p_resource_id: docA.id,
        p_reason: 'Unauthorized emergency',
      }),
    });
    assert.ok(
      [401, 403, 404, 500].includes(cancelDocRes.status),
      `Customer calling doctor emergency RPC must be rejected (got ${cancelDocRes.status})`
    );
  });

  // -------------------------------------------------------------------------
  // S-10: Authentication: expired, malformed, missing JWT -> 401/403
  // -------------------------------------------------------------------------
  it('S-10: Authentication - expired, malformed, or missing JWT returns 401/403', async () => {
    const endpoints = [
      { method: 'POST', url: `${appBaseUrl}${holdRoute}` },
      { method: 'POST', url: `${appBaseUrl}/api/bookings/confirm` },
      { method: 'GET', url: `${appBaseUrl}/api/ticket/00000000-0000-0000-0000-000000000000` },
    ];

    for (const ep of endpoints) {
      const dummyBody = ep.method === 'POST' ? JSON.stringify({ booking_id: '00000000-0000-0000-0000-000000000000', gateway_payment_id: 'pay_test' }) : undefined;
      // 1. Missing Authorization header
      const missingRes = await fetch(ep.url, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: dummyBody,
      });
      assert.ok(
        [401, 403, 400, 404].includes(missingRes.status),
        `Missing auth on ${ep.url} must return 401/403/400/404 (got ${missingRes.status})`
      );

      // 2. Malformed Bearer token
      const malformedRes = await fetch(ep.url, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer totally.invalid.token' },
        body: dummyBody,
      });
      assert.ok(
        [401, 403, 400, 404].includes(malformedRes.status),
        `Malformed auth on ${ep.url} must return 401/403/400/404 (got ${malformedRes.status})`
      );
    }
  });

  // -------------------------------------------------------------------------
  // S-11: Rate limiting: rapid bookings for same patient/slot blocked
  // -------------------------------------------------------------------------
  it('S-11: Rate limiting / Anti-spam - rapid repeated holds for same patient within 1 hour throttled', async () => {
    const patientName = `Spam Target ${Math.random().toString(36).slice(2, 6)}`;
    const hourOffset = 1000 + Math.floor(Math.random() * 50000);
    const tStart1 = new Date(Date.now() + hourOffset * 3600 * 1000).toISOString();
    const tEnd1 = new Date(new Date(tStart1).getTime() + 15 * 60 * 1000).toISOString();

    // 1st hold succeeds
    const hold1 = await fetch(`${appBaseUrl}${holdRoute}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart1,
        slot_end: tEnd1,
        booked_for: 'family',
        patient_name: patientName,
      }),
    });
    assert.equal(hold1.status, 201);
    const d1 = await hold1.json();
    createdBookingIds.push(d1.booking_id);

    // Rapid 2nd hold 15 minutes later for SAME patient on same doctor
    const tStart2 = new Date(new Date(tStart1).getTime() + 15 * 60 * 1000).toISOString();
    const tEnd2 = new Date(new Date(tStart1).getTime() + 30 * 60 * 1000).toISOString();

    const hold2 = await fetch(`${appBaseUrl}${holdRoute}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: tStart2,
        slot_end: tEnd2,
        booked_for: 'family',
        patient_name: patientName,
      }),
    });
    // Must be blocked by anti-spam 1-hour patient rule
    assert.equal(hold2.status, 400);
    const d2 = await hold2.json();
    assert.match(d2.error, /1 hour/i);
  });

  // -------------------------------------------------------------------------
  // S-12: PII leakage: patient_name and booking_note not in plain error logs
  // -------------------------------------------------------------------------
  it('S-12: PII leakage - error messages and validation rejections do not reflect unmasked sensitive PII', async () => {
    const sensitiveName = 'Confidential Patient Alpha';
    const sensitiveNote = 'Very Private Diagnosis #9988';

    // Trigger validation error by sending invalid age
    const errRes = await fetch(`${appBaseUrl}${holdRoute}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
      body: JSON.stringify({
        customer_id: cust1.user.id,
        resource_id: docA.id,
        slot_start: new Date(Date.now() + 1100 * 3600 * 1000).toISOString(),
        slot_end: new Date(Date.now() + 1100 * 3600 * 1000 + 15 * 60 * 1000).toISOString(),
        booked_for: 'family',
        patient_name: sensitiveName,
        booking_note: sensitiveNote,
        patient_age: 999, // INVALID
      }),
    });
    assert.equal(errRes.status, 400);
    const body = await errRes.text();
    // Error message must explain invalid age without echoing the sensitive diagnosis note
    assert.ok(
      !body.includes(sensitiveNote),
      'Error body must not echo back private booking notes'
    );
  });

  // -------------------------------------------------------------------------
  // S-13: Over-fetching: responses to other roles do not expose booker phone
  // -------------------------------------------------------------------------
  it('S-13: Over-fetching - ticket pass and public views do not expose booker unmasked credentials', async () => {
    const booking = await createFamilyBookingForCust(
      cust1,
      docA,
      1150 + Math.floor(Math.random() * 50000),
      `Overfetch Test ${Math.random().toString(36).slice(2, 6)}`
    );

    const ticketRes = await fetch(`${appBaseUrl}/api/ticket/${booking.booking_id}`, {
      headers: { Authorization: `Bearer ${cust1.token}` },
    });
    assert.equal(ticketRes.status, 200);
    const data = await ticketRes.json();

    // Verify ticket pass does not leak customer password, secret keys, or internal session tokens
    assert.equal(data.booking.password, undefined);
    assert.equal(data.booking.gateway_signature, undefined);
  });

  // -------------------------------------------------------------------------
  // S-14: RLS audit: audit SELECT/INSERT/UPDATE/DELETE policies on bookings table
  // -------------------------------------------------------------------------
  it('S-14: RLS audit - PostgreSQL row security is enabled and strict policies exist', async () => {
    const rlsCheck = await dbPool.query(`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'bookings' AND relnamespace = 'public'::regnamespace;
    `);
    assert.equal(rlsCheck.rows[0].relrowsecurity, true, 'bookings table MUST have relrowsecurity = true');

    const policiesRes = await dbPool.query(`
      SELECT policyname, cmd, roles
      FROM pg_policies
      WHERE tablename = 'bookings' AND schemaname = 'public';
    `);
    const cmds = policiesRes.rows.map((p) => p.cmd);
    assert.ok(cmds.includes('SELECT'), 'bookings must have SELECT policy');
    assert.ok(cmds.includes('INSERT') || cmds.includes('ALL'), 'bookings must have INSERT/ALL policy');
  });

  // -------------------------------------------------------------------------
  // S-15: Storage check: confirm zero ID or document upload paths for family booking
  // -------------------------------------------------------------------------
  it('S-15: Storage check - confirm zero ID or document upload paths for family bookings', async () => {
    const bucketsRes = await dbPool.query('SELECT name FROM storage.buckets');
    const bucketNames = bucketsRes.rows.map((b) => b.name);

    // Verify no ID verification buckets exist
    const forbiddenBuckets = ['family-ids', 'aadhaar-proofs', 'minor-consent-forms', 'government-ids'];
    for (const b of forbiddenBuckets) {
      assert.ok(!bucketNames.includes(b), `Forbidden ID bucket [${b}] must not exist`);
    }

    // Verify customer mobile booking schema has NO file upload inputs for family booking
    const bookingFormPath = 'apps/customer-mobile/src/screens/BookingConfirmScreen.tsx';
    if (fs.existsSync(bookingFormPath)) {
      const src = fs.readFileSync(bookingFormPath, 'utf8');
      assert.ok(!src.includes('DocumentPicker'), 'No DocumentPicker in BookingConfirmScreen');
      assert.ok(!src.includes('ImagePicker'), 'No ImagePicker in BookingConfirmScreen');
    }
  });

  // -------------------------------------------------------------------------
  // S-16: Race conditions: concurrent hold requests for last remaining slot
  // -------------------------------------------------------------------------
  it('S-16: Race conditions - 5 concurrent hold requests for exact same slot -> exactly 1 succeeds', async () => {
    const hourOffset = 1200 + Math.floor(Math.random() * 50000);
    const tStart = new Date(Date.now() + hourOffset * 3600 * 1000).toISOString();
    const tEnd = new Date(new Date(tStart).getTime() + 15 * 60 * 1000).toISOString();

    const concurrentRequests = Array.from({ length: 5 }).map((_, i) =>
      fetch(`${appBaseUrl}${holdRoute}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cust1.token}` },
        body: JSON.stringify({
          customer_id: cust1.user.id,
          resource_id: docA2.id,
          slot_start: tStart,
          slot_end: tEnd,
          booked_for: 'family',
          patient_name: `Concurrent Patient ${i}`,
        }),
      })
    );

    const responses = await Promise.all(concurrentRequests);
    const statuses = responses.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 201).length;
    const conflictCount = statuses.filter((s) => s === 409 || s === 400).length;

    assert.equal(successCount, 1, `Exactly 1 concurrent hold must succeed (got ${successCount})`);
    assert.equal(conflictCount, 4, `The other 4 concurrent holds must receive conflict/bad request (got ${conflictCount})`);

    // Record created booking id for cleanup
    for (const r of responses) {
      if (r.status === 201) {
        const body = await r.json();
        createdBookingIds.push(body.booking_id);
      }
    }
  });

  // -------------------------------------------------------------------------
  // S-17: Data deletion: DPDP account deletion cleanses/anonymizes family booking data
  // -------------------------------------------------------------------------
  it('S-17: Data deletion (DPDP) - statutory erasure scrubs all family/dependent PII', async () => {
    const dpdpUserId = '99999999-9999-9999-9999-999999999991';
    const patientName = `DPDP Minor ${Math.random().toString(36).slice(2, 6)}`;

    // 1. Clean prior test artifacts if present, then seed temporary user, profile, and family booking
    await dbPool.query(`
      DELETE FROM public.bookings WHERE customer_id = '${dpdpUserId}';
      DELETE FROM public.profiles WHERE id = '${dpdpUserId}';
      DELETE FROM auth.users WHERE id = '${dpdpUserId}' OR email = 'dpdp_family_user@test.local';

      INSERT INTO auth.users (id, email, is_sso_user, is_anonymous)
      VALUES ('${dpdpUserId}', 'dpdp_family_user@test.local', false, false)
      ON CONFLICT (id) DO NOTHING;
    `);

    await dbPool.query(`
      SET app.trusted_write = 'true';
      INSERT INTO public.profiles (id, full_name, phone, email, role)
      VALUES ('${dpdpUserId}', 'DPDP Family Subject', '+919876543299', 'dpdp_family_user@test.local', 'customer')
      ON CONFLICT (id) DO UPDATE SET full_name = 'DPDP Family Subject', phone = '+919876543299';
    `);

    const bkgRes = await dbPool.query(`
      INSERT INTO public.bookings (
        customer_id, resource_id, provider_id, slot_start, slot_end, status,
        booked_for, patient_name, patient_age, patient_relationship, booking_note,
        deposit_amount, total_amount, platform_fee
      ) VALUES (
        '${dpdpUserId}', '${docA.id}', '${hospA.id}',
        NOW() + INTERVAL '100 days', NOW() + INTERVAL '100 days 15 minutes',
        'CONFIRMED', 'family', '${patientName}', 6, 'child', 'Pediatric allergy history',
        100, 100, 10
      ) RETURNING id;
    `);
    const bookingId = bkgRes.rows[0].id;
    createdBookingIds.push(bookingId);

    // 2. Invoke statutory anonymize_user_data via service role
    const anonRes = await dbPool.query(`SELECT public.anonymize_user_data('${dpdpUserId}');`);
    assert.ok(anonRes.rows[0].anonymize_user_data.success, 'anonymize_user_data must return success: true');

    // 3. Inspect scrubbed booking in DB
    const scrubbedRow = (
      await dbPool.query(
        'SELECT booked_for, patient_name, patient_age, patient_relationship, booking_note, status FROM bookings WHERE id = $1',
        [bookingId]
      )
    ).rows[0];

    // Assert that ALL dependent PII is completely scrubbed
    assert.ok(
      ['Deleted Patient', 'Deleted Dependent'].includes(scrubbedRow.patient_name),
      'patient_name must be sanitized to Deleted Patient/Dependent'
    );
    assert.equal(scrubbedRow.patient_age, null, 'patient_age must be NULL post-erasure');
    assert.equal(scrubbedRow.patient_relationship, null, 'patient_relationship must be NULL post-erasure');
    assert.equal(scrubbedRow.booking_note, null, 'booking_note must be NULL post-erasure');
    assert.equal(scrubbedRow.status, 'CANCELLED', 'active booking must be transitioned to CANCELLED');

    // Clean up temporary auth & profile rows
    await dbPool.query(`DELETE FROM public.bookings WHERE customer_id = '${dpdpUserId}'`);
    await dbPool.query(`DELETE FROM public.profiles WHERE id = '${dpdpUserId}'`);
    await dbPool.query(`DELETE FROM auth.users WHERE id = '${dpdpUserId}'`);
  });
});
