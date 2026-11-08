import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

const { Client } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('Mantis Track 1 Database Hardening & SPEC Invariant Verification', () => {
  let client;
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let tokens = {};
  let doc1Id;
  let doc2Id;
  let neuroDeptId;
  let createdBookingIds = [];

  before(async () => {
    client = new Client({ connectionString: dbUrl });
    await client.connect();

    const envPath = 'apps/merchant-web/.env.local';
    const envContent = fs.readFileSync(envPath, 'utf8');
    const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
    const keyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);
    supabaseUrl = urlMatch[1];
    serviceKey = keyMatch[1];

    serviceHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
    hospA = manifest.hospitalA;
    neuroDeptId = hospA.departments.find((d) => d.name === 'Neurology').id;

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
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');
    tokens.patient2 = await login('test.patient.02@test-tirupati.local');
    tokens.neuroDesk = await login('neuro.desk@test-tirupati.local');

    const docsRes = await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}`, {
      headers: serviceHeaders,
    });
    const docs = await docsRes.json();
    doc1Id = docs.find((d) => d.name.includes('Sharma'))?.id || docs[0].id;
    doc2Id = docs.find((d) => d.name.includes('Patel'))?.id || docs[1].id;

    // Ensure neuroDesk is assigned to both doc1Id and doc2Id
    await client.query(`
      INSERT INTO public.doctor_front_desk_assignments (user_id, doctor_id, provider_id)
      VALUES 
        ('${tokens.neuroDesk.user.id}', '${doc1Id}', '${hospA.id}'),
        ('${tokens.neuroDesk.user.id}', '${doc2Id}', '${hospA.id}')
      ON CONFLICT DO NOTHING;
    `);
  });

  after(async () => {
    if (createdBookingIds.length > 0) {
      for (const id of createdBookingIds) {
        await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${id}`, {
          method: 'DELETE',
          headers: serviceHeaders,
        });
      }
    }
    await client.end();
  });

  it('1. Privilege Hygiene: public.sync_booking_for_family() must NOT be executable by anon or authenticated', async () => {
    const res = await client.query(`
      SELECT 
        has_function_privilege('anon', 'public.sync_booking_for_family()', 'EXECUTE') AS anon_can_exec,
        has_function_privilege('authenticated', 'public.sync_booking_for_family()', 'EXECUTE') AS auth_can_exec;
    `);

    assert.equal(
      res.rows[0].anon_can_exec,
      false,
      'anon role must not have execute privilege on trigger function sync_booking_for_family'
    );
    assert.equal(
      res.rows[0].auth_can_exec,
      false,
      'authenticated role must not have execute privilege on trigger function sync_booking_for_family'
    );
  });

  it('2. SPEC Invariant: Hospital patient arriving +7 minutes after slot_start (within +/-10m window) is NOT late in verify_checkin_code', async () => {
    const { rows: [{ now: dbNow }] } = await client.query('SELECT public.get_test_clock($1::uuid) as now', [hospA.id]);
    const now = new Date(dbNow);
    // Slot started 7 minutes ago (within the +/- 10 min window per SPEC.md)
    const slotStart = new Date(now.getTime() - 7 * 60 * 1000).toISOString();
    const slotEnd = new Date(now.getTime() + 23 * 60 * 1000).toISOString();

    // Clean up any out-of-order completed bookings for this doctor today
    await client.query(`
      DELETE FROM public.bookings
      WHERE resource_id = $1
        AND (slot_start AT TIME ZONE 'Asia/Kolkata')::date = ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
        AND slot_start > $2::timestamptz
        AND status IN ('IN_CONSULTATION', 'COMPLETED')
    `, [doc1Id, slotStart]);

    // Create confirmed test booking
    const bRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient1.user.id,
        provider_id: hospA.id,
        resource_id: doc1Id,
        department_id: neuroDeptId,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        reference_code: 'MANTIS-SPEC-01',
      }),
    });
    const bJson = await bRes.json();
    assert.ok(Array.isArray(bJson) && bJson.length > 0, `Booking creation failed: ${JSON.stringify(bJson)}`);
    const b = bJson[0];
    createdBookingIds.push(b.id);

    // Get customer's permanent PIN
    const profRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient1.user.id}&select=permanent_checkin_pin`,
      { headers: serviceHeaders }
    );
    const [{ permanent_checkin_pin: pin }] = await profRes.json();

    // Verify check-in code as front desk
    const verifyRes = await fetch(`${supabaseUrl}/rest/v1/rpc/verify_checkin_code`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_shop_id: hospA.id,
        p_code: pin,
      }),
    });

    const verifyData = await verifyRes.json();
    assert.equal(verifyData.success, true, `Verification failed: ${JSON.stringify(verifyData)}`);
    // PER SPEC.MD: Arrival window is +/- 10 minutes. A patient arriving at +7 minutes is ON TIME.
    assert.equal(
      verifyData.is_late,
      false,
      'Patient arriving 7 minutes after slot_start must be tagged as On Time (is_late: false) per SPEC.md'
    );
  });

  it('3. SPEC Invariant: Hospital patient arriving +7 minutes after slot_start (within +/-10m window) is NOT late in mark_present_manually', async () => {
    const { rows: [{ now: dbNow }] } = await client.query('SELECT public.get_test_clock($1::uuid) as now', [hospA.id]);
    const now = new Date(dbNow);
    // Slot started 7 minutes ago (within the +/- 10 min window per SPEC.md)
    const slotStart = new Date(now.getTime() - 7 * 60 * 1000).toISOString();
    const slotEnd = new Date(now.getTime() + 23 * 60 * 1000).toISOString();

    // Clean up any out-of-order completed bookings for this doctor today
    await client.query(`
      DELETE FROM public.bookings
      WHERE resource_id = $1
        AND (slot_start AT TIME ZONE 'Asia/Kolkata')::date = ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
        AND slot_start > $2::timestamptz
        AND status IN ('IN_CONSULTATION', 'COMPLETED')
    `, [doc2Id, slotStart]);

    // Create confirmed test booking for patient2 on doctor 2
    const bRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient2.user.id,
        provider_id: hospA.id,
        resource_id: doc2Id,
        department_id: neuroDeptId,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
        reference_code: 'MANTIS-SPEC-02',
      }),
    });
    const bJson = await bRes.json();
    assert.ok(Array.isArray(bJson) && bJson.length > 0, `Booking creation failed: ${JSON.stringify(bJson)}`);
    const b = bJson[0];
    createdBookingIds.push(b.id);

    // Call mark_present_manually as front desk
    const markRes = await fetch(`${supabaseUrl}/rest/v1/rpc/mark_present_manually`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_booking_id: b.id,
      }),
    });

    const markData = await markRes.json();
    assert.equal(markData.success, true, `Mark present failed: ${JSON.stringify(markData)}`);
    assert.equal(
      markData.is_late,
      false,
      'Patient marked present 7 minutes after slot_start must be tagged as On Time (is_late: false) per SPEC.md'
    );
  });

  it('4. Divergence Guard: SQL stored procedures and TypeScript queue-engine.ts must agree on arrival window / late threshold per SPEC.md', async () => {
    // 1. Read TypeScript source of truth
    const { ON_TIME_GRACE_MINUTES, ON_TIME_GRACE_MS } = await import('../../packages/shared/src/queue-engine.ts');
    assert.equal(ON_TIME_GRACE_MINUTES, 10, 'TypeScript ON_TIME_GRACE_MINUTES must be 10 per SPEC.md');
    assert.equal(ON_TIME_GRACE_MS, 10 * 60 * 1000, 'TypeScript ON_TIME_GRACE_MS must be 600,000ms');

    // 2. Read SQL stored procedures source of truth from database
    const procRes = await client.query(`
      SELECT p.proname, p.prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname IN ('verify_checkin_code', 'mark_present_manually')
    `);
    assert.equal(procRes.rows.length, 2, 'Expected both verify_checkin_code and mark_present_manually in private schema');

    for (const row of procRes.rows) {
      const match = row.prosrc.match(/v_is_late\s*:=.*?interval\s*'(\d+)\s*minutes'/i);
      assert.ok(match, `Could not parse late interval from ${row.proname}`);
      const sqlMinutes = parseInt(match[1], 10);
      assert.equal(
        sqlMinutes,
        ON_TIME_GRACE_MINUTES,
        `Divergence detected: ${row.proname} uses ${sqlMinutes}m in SQL, but TypeScript uses ${ON_TIME_GRACE_MINUTES}m! Must match SPEC.md (10m).`
      );
    }
  });
});
