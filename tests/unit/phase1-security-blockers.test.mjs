import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import pg from 'pg';
import ts from '../../apps/merchant-web/node_modules/typescript/lib/typescript.js';
import { seedHospitalTestData } from '../../scripts/seed-hospital-test-data.mjs';

const { Pool, Client } = pg;

// 1. Load environment variables from apps/merchant-web/.env.local or .env.local before importing route modules
const envPaths = [path.resolve('apps/merchant-web/.env.local'), path.resolve('.env.local')];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2];
      }
    }
  }
}

// 2. Register Node module hooks so Next.js TypeScript route handlers can be imported directly
const webRoot = path.resolve('apps/merchant-web');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const target = path.join(webRoot, 'src', specifier.slice(2));
      for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js', '']) {
        if (fs.existsSync(target + ext) && fs.statSync(target + ext).isFile()) {
          return nextResolve(pathToFileURL(target + ext).href, context);
        }
      }
    }
    if (specifier === '@supabase/ssr') {
      return nextResolve(
        pathToFileURL(path.join(webRoot, 'node_modules/@supabase/ssr/dist/module/index.js')).href,
        context
      );
    }
    if (specifier === 'next/server' || specifier === 'next/headers') {
      return nextResolve(
        pathToFileURL(path.join(webRoot, 'node_modules', specifier + '.js')).href,
        context
      );
    }
    if (
      !specifier.startsWith('.') &&
      !specifier.startsWith('/') &&
      !specifier.startsWith('node:') &&
      !specifier.startsWith('file:')
    ) {
      const nm = path.join(webRoot, 'node_modules', specifier);
      if (fs.existsSync(nm)) {
        return nextResolve(specifier, {
          ...context,
          parentURL: pathToFileURL(path.join(webRoot, 'package.json')).href,
        });
      }
    }
    if (
      specifier.startsWith('.') &&
      context.parentURL &&
      context.parentURL.startsWith('file:') &&
      (!context.parentURL.includes('node_modules') || context.parentURL.includes('@supabase+ssr'))
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const target = path.resolve(parentDir, specifier);
      for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js', '']) {
        if (fs.existsSync(target + ext) && fs.statSync(target + ext).isFile()) {
          return nextResolve(pathToFileURL(target + ext).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.ts') || url.endsWith('.tsx')) {
      const source = fs.readFileSync(fileURLToPath(url), 'utf8');
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
        fileName: fileURLToPath(url),
      });
      return { format: 'module', shortCircuit: true, source: transpiled.outputText };
    }
    return nextLoad(url, context);
  },
});

const NextServer = await import('next/server');
const NextRequest = NextServer.NextRequest || NextServer.default?.NextRequest;

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('PHASE 1: Security Blockers Verification Suite', () => {
  let pool;
  let manifest;
  let hospA;
  let hospB;
  let tokens = {};
  let doc1;
  let doc2;
  let patient1Booking;
  let doc2Booking;
  let createdVenueIds = [];
  let createdBookingIds = [];

  async function login(email, password = 'HospitalTest2026!') {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    assert.ok(data.access_token, `Failed to login test user ${email}: ${JSON.stringify(data)}`);
    return { token: data.access_token, user: data.user };
  }

  before(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 5 });
    let needSeed = !fs.existsSync('scripts/test-seed-manifest.json');
    if (!needSeed) {
      try {
        const existingManifest = JSON.parse(
          fs.readFileSync('scripts/test-seed-manifest.json', 'utf8')
        );
        const chk = await pool.query(`SELECT id FROM public.providers WHERE id = $1`, [
          existingManifest.hospitalA?.id,
        ]);
        if (chk.rowCount === 0) needSeed = true;
      } catch {
        needSeed = true;
      }
    }
    if (needSeed) {
      await seedHospitalTestData();
    }
    manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
    hospA = manifest.hospitalA;
    hospB = manifest.hospitalB;

    // Ensure Dr. K. Patel (Neurologist 2) exists in Neurology department for sibling unit test suites
    const deptNeuro = hospA.departments?.find((d) => d.name === 'Neurology');
    if (deptNeuro) {
      const patelCheck = await pool.query(
        `SELECT id FROM public.resources WHERE provider_id = $1 AND name ILIKE '%Patel%'`,
        [hospA.id]
      );
      if (patelCheck.rowCount === 0) {
        await pool.query(
          `INSERT INTO public.resources (provider_id, name, department_id, type, deposit_amount, duration_minutes, capacity, is_active)
           VALUES ($1, 'Dr. K. Patel (Neurologist 2)', $2, 'doctor', 100, 15, 1, true)`,
          [hospA.id, deptNeuro.id]
        );
      }
    }

    tokens.adminApex = await login('admin.apex@test-tirupati.local');
    tokens.neuroDoc = await login('neuro.doc@test-tirupati.local');
    tokens.neuroDesk = await login('neuro.desk@test-tirupati.local');
    tokens.dermaDoc = await login('derma.doc@test-tirupati.local');
    tokens.adminBalaji = await login('admin.balaji@test-tirupati.local');
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');
    tokens.patient2 = await login('test.patient.02@test-tirupati.local');

    // Fetch Doctor 1 (bound to neuroDoc) and Doctor 2 (unassigned / different doctor in hospA)
    const docsRes = await pool.query(
      `SELECT id, name, department_id, user_id FROM public.resources WHERE provider_id = $1 ORDER BY created_at ASC`,
      [hospA.id]
    );
    assert.ok(docsRes.rows.length >= 2, 'Expected at least 2 doctor resources in Hospital A');
    doc1 = docsRes.rows[0];
    doc2 = docsRes.rows[1];

    await pool.query(`UPDATE public.resources SET user_id = $1 WHERE id = $2`, [
      tokens.neuroDoc.user.id,
      doc1.id,
    ]);
    await pool.query(`UPDATE public.resources SET user_id = $1 WHERE id = $2`, [
      tokens.dermaDoc.user.id,
      doc2.id,
    ]);

    // Ensure a deterministic confirmed booking for patient1 on doc1 and patient2 on doc2
    const b1Res = await pool.query(
      `INSERT INTO public.bookings (
        customer_id, provider_id, resource_id, department_id,
        slot_start, slot_end, status, payment_status, deposit_amount, total_amount,
        reference_code, is_present, queue_position
      ) VALUES (
        $1, $2, $3, $4,
        '2026-11-15T04:00:00Z', '2026-11-15T04:15:00Z', 'CONFIRMED', 'CAPTURED', 100, 500,
        'P1-SEC-REF-01', true, 1
      ) RETURNING *`,
      [tokens.patient1.user.id, hospA.id, doc1.id, doc1.department_id]
    );
    patient1Booking = b1Res.rows[0];
    createdBookingIds.push(patient1Booking.id);

    const b2Res = await pool.query(
      `INSERT INTO public.bookings (
        customer_id, provider_id, resource_id, department_id,
        slot_start, slot_end, status, payment_status, deposit_amount, total_amount,
        reference_code, is_present, queue_position
      ) VALUES (
        $1, $2, $3, $4,
        '2026-11-15T04:30:00Z', '2026-11-15T04:45:00Z', 'CONFIRMED', 'CAPTURED', 100, 500,
        'P1-SEC-REF-02', true, 2
      ) RETURNING *`,
      [tokens.patient2.user.id, hospA.id, doc2.id, doc2.department_id]
    );
    doc2Booking = b2Res.rows[0];
    createdBookingIds.push(doc2Booking.id);
  });

  after(async () => {
    if (pool) {
      if (createdBookingIds.length > 0) {
        await pool.query(`DELETE FROM public.bookings WHERE id = ANY($1::uuid[])`, [
          createdBookingIds,
        ]);
      }
      if (createdVenueIds.length > 0) {
        await pool.query(`DELETE FROM public.providers WHERE id = ANY($1::uuid[])`, [
          createdVenueIds,
        ]);
      }
      await pool.query(
        `DELETE FROM public.providers WHERE name IN ('Unauthorized Front Desk Venue', 'Unauthorized Customer Venue', '[TEST-PHASE1] Pending Venue Check')`
      );
      await pool.end();
    }
  });

  // ===========================================================================
  // 1.1 GET /api/customer/queue-and-history?booking_id=...
  // ===========================================================================
  describe('1.1 GET /api/customer/queue-and-history?booking_id=...', () => {
    it('redacts names, customer_id, reference_code, and payment fields for anonymous callers', async () => {
      const { GET } = await import(
        '../../apps/merchant-web/src/app/api/customer/queue-and-history/route.ts'
      );
      const url = `http://localhost:3000/api/customer/queue-and-history?booking_id=${patient1Booking.id}&provider_id=${hospA.id}&resource_id=${doc1.id}&date=2026-11-15`;
      const req = new NextRequest(url, {
        headers: { 'x-vercel-id': 'test-1', 'x-real-ip': '203.0.113.10' },
      });
      const res = await GET(req);
      assert.equal(res.status, 200);
      const body = await res.json();

      assert.equal(body.customerId, null, 'Anonymous caller must not receive customerId');
      assert.deepEqual(body.history, [], 'Anonymous caller must receive empty history');
      const targetSlot = body.queue.find(
        (s) => (s.slotStart || s.slotStartIso) && new Date(s.slotStart || s.slotStartIso).toISOString() === '2026-11-15T04:00:00.000Z'
      );
      assert.ok(targetSlot, 'Expected 04:00 UTC (09:30 IST) slot in queue');
      assert.equal(targetSlot.bookingId, null, 'Anonymous caller must not see bookingId');
      assert.equal(targetSlot.referenceCode, null, 'Anonymous caller must not see referenceCode');
      assert.equal(targetSlot.patientName, null, 'Anonymous caller must not see patientName');
      assert.equal(targetSlot.deposit_amount, undefined);
      assert.equal(targetSlot.payment_status, undefined);
    });

    it('redacts names, customer_id, reference_code, and payment fields for another customer', async () => {
      const { GET } = await import(
        '../../apps/merchant-web/src/app/api/customer/queue-and-history/route.ts'
      );
      const url = `http://localhost:3000/api/customer/queue-and-history?booking_id=${patient1Booking.id}&provider_id=${hospA.id}&resource_id=${doc1.id}&date=2026-11-15`;
      const req = new NextRequest(url, {
        headers: {
          Authorization: `Bearer ${tokens.patient2.token}`,
          'x-vercel-id': 'test-1',
          'x-real-ip': '203.0.113.11',
        },
      });
      const res = await GET(req);
      assert.equal(res.status, 200);
      const body = await res.json();

      assert.notEqual(
        body.customerId,
        patient1Booking.customer_id,
        'Other customer must not receive target booking customerId'
      );
      const targetSlot = body.queue.find(
        (s) => (s.slotStart || s.slotStartIso) && new Date(s.slotStart || s.slotStartIso).toISOString() === '2026-11-15T04:00:00.000Z'
      );
      assert.ok(targetSlot, 'Expected 04:00 UTC (09:30 IST) slot in queue');
      assert.equal(targetSlot.bookingId, null, 'Other customer must not see target bookingId');
      assert.equal(
        targetSlot.referenceCode,
        null,
        'Other customer must not see target referenceCode'
      );
      assert.equal(targetSlot.patientName, null, 'Other customer must not see target patientName');
    });

    it('returns own booking details to the booking owner', async () => {
      const { GET } = await import(
        '../../apps/merchant-web/src/app/api/customer/queue-and-history/route.ts'
      );
      const url = `http://localhost:3000/api/customer/queue-and-history?booking_id=${patient1Booking.id}&provider_id=${hospA.id}&resource_id=${doc1.id}&date=2026-11-15`;
      const req = new NextRequest(url, {
        headers: {
          Authorization: `Bearer ${tokens.patient1.token}`,
          'x-vercel-id': 'test-1',
          'x-real-ip': '203.0.113.12',
        },
      });
      const res = await GET(req);
      assert.equal(res.status, 200);
      const body = await res.json();

      assert.equal(body.customerId, tokens.patient1.user.id);
      const targetSlot = body.queue.find(
        (s) => (s.slotStart || s.slotStartIso) && new Date(s.slotStart || s.slotStartIso).toISOString() === '2026-11-15T04:00:00.000Z'
      );
      assert.ok(targetSlot, 'Expected 04:00 UTC (09:30 IST) slot in queue');
      assert.equal(targetSlot.bookingId, patient1Booking.id);
      assert.equal(targetSlot.referenceCode, 'P1-SEC-REF-01');
      assert.ok(targetSlot.patientName, 'Owner should see their own patientName');
    });

    it('returns booking details to authorized staff for that resource', async () => {
      const { GET } = await import(
        '../../apps/merchant-web/src/app/api/customer/queue-and-history/route.ts'
      );
      const url = `http://localhost:3000/api/customer/queue-and-history?booking_id=${patient1Booking.id}&provider_id=${hospA.id}&resource_id=${doc1.id}&date=2026-11-15`;
      const req = new NextRequest(url, {
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
          'x-vercel-id': 'test-1',
          'x-real-ip': '203.0.113.13',
        },
      });
      const res = await GET(req);
      assert.equal(res.status, 200);
      const body = await res.json();

      assert.equal(body.customerId, tokens.patient1.user.id);
      const targetSlot = body.queue.find(
        (s) => (s.slotStart || s.slotStartIso) && new Date(s.slotStart || s.slotStartIso).toISOString() === '2026-11-15T04:00:00.000Z'
      );
      assert.ok(targetSlot, 'Expected 04:00 UTC (09:30 IST) slot in queue');
      assert.equal(targetSlot.bookingId, patient1Booking.id);
      assert.equal(targetSlot.referenceCode, 'P1-SEC-REF-01');
      assert.ok(targetSlot.patientName, 'Authorized doctor should see patientName');
    });

    it('redacts PII when called by staff from another hospital', async () => {
      const { GET } = await import(
        '../../apps/merchant-web/src/app/api/customer/queue-and-history/route.ts'
      );
      const url = `http://localhost:3000/api/customer/queue-and-history?booking_id=${patient1Booking.id}&provider_id=${hospA.id}&resource_id=${doc1.id}&date=2026-11-15`;
      const req = new NextRequest(url, {
        headers: {
          Authorization: `Bearer ${tokens.adminBalaji.token}`,
          'x-vercel-id': 'test-1',
          'x-real-ip': '203.0.113.14',
        },
      });
      const res = await GET(req);
      assert.equal(res.status, 200);
      const body = await res.json();

      assert.notEqual(
        body.customerId,
        patient1Booking.customer_id,
        'Staff from another hospital must not receive target customerId'
      );
      const targetSlot = body.queue.find(
        (s) => (s.slotStart || s.slotStartIso) && new Date(s.slotStart || s.slotStartIso).toISOString() === '2026-11-15T04:00:00.000Z'
      );
      assert.ok(targetSlot);
      assert.equal(targetSlot.bookingId, null);
      assert.equal(targetSlot.referenceCode, null);
      assert.equal(targetSlot.patientName, null);
    });
  });

  // ===========================================================================
  // 1.2 GET /api/ticket/[id]
  // ===========================================================================
  describe('1.2 GET /api/ticket/[id]', () => {
    it('returns minimal public queue payload to unauthenticated callers (no reference_code, payment, customer, or hospital details)', async () => {
      const { GET } = await import(
        '../../apps/merchant-web/src/app/api/ticket/[id]/route.ts'
      );
      const req = new NextRequest(`http://localhost:3000/api/ticket/${patient1Booking.id}`);
      const res = await GET(req, { params: Promise.resolve({ id: patient1Booking.id }) });
      assert.equal(res.status, 200);
      const body = await res.json();

      assert.equal(body.success, true);
      assert.equal(body.booking.id, patient1Booking.id);
      assert.equal(body.booking.resource_id, doc1.id);
      assert.equal(body.booking.status, 'CONFIRMED');
      assert.equal(body.booking.reference_code, null, 'Public ticket must not leak reference_code');
      assert.equal(body.booking.payment_status, null, 'Public ticket must not leak payment_status');
      assert.equal(body.booking.deposit_amount, null, 'Public ticket must not leak deposit_amount');
      assert.equal(body.customer, null, 'Public ticket must not leak customer object');
      assert.equal(body.hospital, null, 'Public ticket must not leak hospital details');
      assert.equal(body.checkin_code, null, 'Public ticket must not leak checkin_code');
      assert.equal(body.doctor.id, doc1.id);
      assert.equal(body.doctor.name, undefined, 'Public ticket must not leak doctor name');
      assert.equal(body.doctor.price, undefined, 'Public ticket must not leak doctor price');
    });

    it('returns full ticket payload to the booking owner', async () => {
      const { GET } = await import(
        '../../apps/merchant-web/src/app/api/ticket/[id]/route.ts'
      );
      const req = new NextRequest(`http://localhost:3000/api/ticket/${patient1Booking.id}`, {
        headers: { Authorization: `Bearer ${tokens.patient1.token}` },
      });
      const res = await GET(req, { params: Promise.resolve({ id: patient1Booking.id }) });
      assert.equal(res.status, 200);
      const body = await res.json();

      assert.equal(body.booking.reference_code, 'P1-SEC-REF-01');
      assert.equal(body.booking.payment_status, 'CAPTURED');
      assert.equal(Number(body.booking.deposit_amount), 100);
      assert.ok(body.customer?.name);
      assert.ok(body.hospital?.name);
      assert.ok(body.doctor?.name);
    });
  });

  // ===========================================================================
  // 1.3 New migration: privileges + FOR UPDATE SKIP LOCKED concurrency
  // ===========================================================================
  describe('1.3 Cron RPC privileges & FOR UPDATE SKIP LOCKED concurrency', () => {
    it('revokes EXECUTE from PUBLIC, anon, and authenticated and grants only to service_role (verified via HTTP PostgREST RPC calls)', async () => {
      const ANON_KEY =
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

      const rpcEndpoints = [
        {
          name: 'expire_stale_standby_queue',
          sig: 'public.expire_stale_standby_queue(integer, uuid)',
          body: { p_threshold_minutes: 45, p_provider_id: hospA.id },
        },
        {
          name: 'release_expired_holds',
          sig: 'public.release_expired_holds()',
          body: {},
        },
        {
          name: 'process_expired_account_deletions',
          sig: 'public.process_expired_account_deletions()',
          body: {},
        },
      ];

      for (const rpc of rpcEndpoints) {
        // 1. Call over HTTP as anon -> must be rejected (401/403)
        const anonRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc.name}`, {
          method: 'POST',
          headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(rpc.body),
        });
        assert.ok(
          anonRes.status === 401 || anonRes.status === 403 || anonRes.status === 404,
          `anon HTTP call to ${rpc.name} must be rejected, got ${anonRes.status}`
        );

        // 2. Call over HTTP as authenticated customer -> must be rejected (401/403)
        const authRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc.name}`, {
          method: 'POST',
          headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${tokens.patient1.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(rpc.body),
        });
        assert.ok(
          authRes.status === 401 || authRes.status === 403 || authRes.status === 404,
          `authenticated HTTP call to ${rpc.name} must be rejected, got ${authRes.status}`
        );

        // 3. Call over HTTP as service_role -> must succeed (200)
        const srvRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc.name}`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(rpc.body),
        });
        assert.equal(
          srvRes.status,
          200,
          `service_role HTTP call to ${rpc.name} must succeed with 200, got ${srvRes.status}`
        );

        // 4. Verify pg_proc ACLs as well
        const res = await pool.query(
          `SELECT
             has_function_privilege('anon', $1, 'EXECUTE') AS anon_exec,
             has_function_privilege('authenticated', $1, 'EXECUTE') AS auth_exec,
             has_function_privilege('service_role', $1, 'EXECUTE') AS srv_exec,
             EXISTS (
               SELECT 1 FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
               LEFT JOIN LATERAL aclexplode(p.proacl) a ON true
               WHERE p.oid = $1::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
             ) AS public_exec`,
          [rpc.sig]
        );
        const row = res.rows[0];
        assert.equal(row.public_exec, false, `PUBLIC must not have EXECUTE on ${rpc.sig}`);
        assert.equal(row.anon_exec, false, `anon must not have EXECUTE on ${rpc.sig}`);
        assert.equal(row.auth_exec, false, `authenticated must not have EXECUTE on ${rpc.sig}`);
        assert.equal(row.srv_exec, true, `service_role must have EXECUTE on ${rpc.sig}`);
      }
    });

    it('two-session concurrency test: expire_stale_standby_queue skips locked rows with FOR UPDATE SKIP LOCKED', async () => {
      // Insert two expired unverified standby bookings on a past date (is_present=false, arrived > slot_start + 10m)
      const pastStart1 = '2026-10-01T03:00:00Z';
      const pastEnd1 = '2026-10-01T03:15:00Z';
      const pastArr1 = '2026-10-01T04:00:00Z';
      const pastStart2 = '2026-10-01T05:00:00Z';
      const pastEnd2 = '2026-10-01T05:15:00Z';
      const pastArr2 = '2026-10-01T06:00:00Z';

      const ins1 = await pool.query(
        `INSERT INTO public.bookings (customer_id, provider_id, resource_id, department_id, slot_start, slot_end, status, payment_status, deposit_amount, total_amount, reference_code, is_present, customer_arrived_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', 'CAPTURED', 100, 500, 'SKIP-LOCK-1', false, $7) RETURNING id`,
        [tokens.patient1.user.id, hospA.id, doc1.id, doc1.department_id, pastStart1, pastEnd1, pastArr1]
      );
      const ins2 = await pool.query(
        `INSERT INTO public.bookings (customer_id, provider_id, resource_id, department_id, slot_start, slot_end, status, payment_status, deposit_amount, total_amount, reference_code, is_present, customer_arrived_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', 'CAPTURED', 100, 500, 'SKIP-LOCK-2', false, $7) RETURNING id`,
        [tokens.patient2.user.id, hospA.id, doc1.id, doc1.department_id, pastStart2, pastEnd2, pastArr2]
      );
      const bLockId = ins1.rows[0].id;
      const bFreeId = ins2.rows[0].id;
      createdBookingIds.push(bLockId, bFreeId);

      const client1 = new Client({ connectionString: DB_URL });
      const client2 = new Client({ connectionString: DB_URL });
      await client1.connect();
      await client2.connect();

      try {
        await client1.query('BEGIN');
        await client1.query(`SELECT id FROM public.bookings WHERE id = $1 FOR UPDATE`, [bLockId]);

        await client2.query('BEGIN');
        await client2.query(`SET LOCAL statement_timeout = '1500ms'`);
        const res2 = await client2.query(
          `SELECT public.expire_stale_standby_queue(45, $1) AS result`,
          [hospA.id]
        );
        await client2.query('COMMIT');

        const resultObj = res2.rows[0].result;
        assert.ok(
          Number(resultObj.expired_count) >= 1,
          `Session 2 should expire the unlocked standby booking without blocking on Session 1: ${JSON.stringify(resultObj)}`
        );

        const freeStatus = await pool.query(`SELECT status FROM public.bookings WHERE id = $1`, [
          bFreeId,
        ]);
        assert.equal(freeStatus.rows[0].status, 'NO_SHOW');
      } finally {
        await client1.query('ROLLBACK').catch(() => {});
        await client2.query('ROLLBACK').catch(() => {});
        await client1.end();
        await client2.end();
      }
    });

    it('two-session concurrency test: process_expired_account_deletions skips locked rows with FOR UPDATE SKIP LOCKED', async () => {
      // Create two temporary users in auth.users + public.profiles + public.account_deletion_requests
      const delUser1Id = crypto.randomUUID();
      const delUser2Id = crypto.randomUUID();
      const client1 = new Client({ connectionString: DB_URL });
      const client2 = new Client({ connectionString: DB_URL });
      await client1.connect();
      await client2.connect();

      try {
        for (const [uid, email, phone] of [
          [delUser1Id, `del1.${Date.now()}@test-tirupati.local`, '9000088801'],
          [delUser2Id, `del2.${Date.now()}@test-tirupati.local`, '9000088802'],
        ]) {
          await pool.query(
            `INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
             VALUES ($1, $2, '{"full_name":"Temp Delete User"}'::jsonb, NOW(), NOW())`,
            [uid, email]
          );
          await pool.query(
            `INSERT INTO public.profiles (id, email, full_name, phone, role)
             VALUES ($1, $2, 'Temp Delete User', $3, 'customer')
             ON CONFLICT (id) DO UPDATE SET full_name = 'Temp Delete User', email = $2, phone = $3`,
            [uid, email, phone]
          );
        }

        const req1Res = await pool.query(
          `INSERT INTO public.account_deletion_requests (user_id, reason, requested_at, scheduled_for)
           VALUES ($1, 'Concurrency test locked row', NOW() - INTERVAL '31 days', NOW() - INTERVAL '1 hour')
           RETURNING id`,
          [delUser1Id]
        );
        const req2Res = await pool.query(
          `INSERT INTO public.account_deletion_requests (user_id, reason, requested_at, scheduled_for)
           VALUES ($1, 'Concurrency test unlocked row', NOW() - INTERVAL '31 days', NOW() - INTERVAL '1 hour')
           RETURNING id`,
          [delUser2Id]
        );
        const req1Id = req1Res.rows[0].id;
        const req2Id = req2Res.rows[0].id;

        // Session 1 locks req1 row with FOR UPDATE
        await client1.query('BEGIN');
        await client1.query(
          `SELECT id FROM public.account_deletion_requests WHERE id = $1 FOR UPDATE`,
          [req1Id]
        );

        // Session 2 runs process_expired_account_deletions() with a tight 1500ms statement_timeout
        await client2.query('BEGIN');
        await client2.query(`SET LOCAL statement_timeout = '1500ms'`);
        const purgeRes = await client2.query(
          `SELECT public.process_expired_account_deletions() AS purged_count`
        );
        await client2.query('COMMIT');

        assert.ok(
          Number(purgeRes.rows[0].purged_count) >= 1,
          `Session 2 must process unlocked deletion request without blocking on Session 1 (purged_count=${purgeRes.rows[0].purged_count})`
        );

        // Verify req2 was completed and anonymized, while req1 was skipped (completed_at IS NULL)
        const checkReq2 = await pool.query(
          `SELECT completed_at FROM public.account_deletion_requests WHERE id = $1`,
          [req2Id]
        );
        assert.ok(checkReq2.rows[0].completed_at, 'Unlocked deletion request must have completed_at set');

        const checkProf2 = await pool.query(
          `SELECT full_name, email, phone FROM public.profiles WHERE id = $1`,
          [delUser2Id]
        );
        assert.equal(checkProf2.rows[0].full_name, 'Deleted User');
        assert.equal(checkProf2.rows[0].phone, null);

        // Release Session 1 lock and verify req1 is still uncompleted
        await client1.query('ROLLBACK');
        const checkReq1 = await pool.query(
          `SELECT completed_at FROM public.account_deletion_requests WHERE id = $1`,
          [req1Id]
        );
        assert.equal(
          checkReq1.rows[0].completed_at,
          null,
          'Locked deletion request must be skipped by FOR UPDATE SKIP LOCKED'
        );
      } finally {
        await client1.query('ROLLBACK').catch(() => {});
        await client2.query('ROLLBACK').catch(() => {});
        await client1.end();
        await client2.end();
        await pool
          .query(`DELETE FROM public.account_deletion_requests WHERE user_id = ANY($1::uuid[])`, [
            [delUser1Id, delUser2Id],
          ])
          .catch(() => {});
        await pool
          .query(`DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`, [
            [delUser1Id, delUser2Id],
          ])
          .catch(() => {});
        await pool
          .query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [[delUser1Id, delUser2Id]])
          .catch(() => {});
      }
    });
  });

  // ===========================================================================
  // 1.4 is_caller_authorized_for_resource & /api/bookings/confirm & Step 4(a),(b),(c)
  // ===========================================================================
  describe('1.4 Per-consultant RBAC in 6 RPCs, mobile customer cancel, late-queue sweep, & /api/bookings/confirm', () => {
    it('rejects a consultant calling any of the 6 RPCs on another consultant booking in the same hospital, and revokes record_no_show from authenticated', async () => {
      const headersNeuroDoc = {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${tokens.neuroDoc.token}`,
        'Content-Type': 'application/json',
      };

      // Ensure doc2Booking is CONFIRMED and is_present=false so check-in / reschedule / cancel / complete guards reach RBAC
      await pool.query(
        `UPDATE public.bookings SET status = 'CONFIRMED', is_present = false WHERE id = $1`,
        [doc2Booking.id]
      );

      // 1. record_no_show over HTTP as authenticated neuroDoc -> rejected (401/403 permission denied)
      const noShowRpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_no_show`, {
        method: 'POST',
        headers: headersNeuroDoc,
        body: JSON.stringify({ p_booking_id: doc2Booking.id }),
      });
      assert.ok(
        noShowRpcRes.status === 401 || noShowRpcRes.status === 403 || noShowRpcRes.status === 404,
        `authenticated user must not have EXECUTE privilege on record_no_show (status=${noShowRpcRes.status})`
      );

      // 2. complete_booking on doc2Booking by neuroDoc (assigned to doc1)
      const compRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/complete_booking`, {
        method: 'POST',
        headers: headersNeuroDoc,
        body: JSON.stringify({ p_booking_id: doc2Booking.id }),
      });
      const compData = await compRes.json();
      assert.equal(
        Boolean(compData.success),
        false,
        `neuroDoc must not complete doc2Booking: ${JSON.stringify(compData)}`
      );

      // 3. reschedule_booking_slot on doc2Booking by neuroDoc
      const reschedRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reschedule_booking_slot`, {
        method: 'POST',
        headers: headersNeuroDoc,
        body: JSON.stringify({
          p_booking_id: doc2Booking.id,
          p_new_slot_start: '2026-11-16T05:00:00Z',
          p_new_slot_end: '2026-11-16T05:15:00Z',
        }),
      });
      const reschedData = await reschedRes.json();
      assert.equal(
        Boolean(reschedData.success),
        false,
        `neuroDoc must not reschedule doc2Booking: ${JSON.stringify(reschedData)}`
      );

      // 4. cancel_booking on doc2Booking by neuroDoc
      const cancelRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: headersNeuroDoc,
        body: JSON.stringify({
          p_booking_id: doc2Booking.id,
          p_initiated_by: 'MERCHANT',
          p_reason: 'Unauthorized cross-doctor cancel test',
        }),
      });
      const cancelData = await cancelRes.json();
      assert.equal(
        Boolean(cancelData.success),
        false,
        `neuroDoc must not cancel doc2Booking: ${JSON.stringify(cancelData)}`
      );

      // 5. mark_present_manually on doc2Booking by neuroDoc
      const markRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_present_manually`, {
        method: 'POST',
        headers: headersNeuroDoc,
        body: JSON.stringify({ p_booking_id: doc2Booking.id }),
      });
      const markData = await markRes.json();
      assert.equal(
        Boolean(markData.success),
        false,
        `neuroDoc must not mark_present_manually on doc2Booking: ${JSON.stringify(markData)}`
      );

      // 6. verify_checkin_code on doc2Booking by neuroDoc
      const todayIstRes = await pool.query(
        `SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS today_ist`
      );
      const todayIst = todayIstRes.rows[0].today_ist;
      const codeDoc2 = '991122';
      await pool.query(
        `INSERT INTO public.appointment_checkin_codes (booking_id, provider_id, customer_id, code, appointment_date)
         VALUES ($1, $2, $3, $4, $5::date)
         ON CONFLICT (booking_id) DO UPDATE SET code = EXCLUDED.code, appointment_date = EXCLUDED.appointment_date`,
        [doc2Booking.id, hospA.id, doc2Booking.customer_id, codeDoc2, todayIst]
      );
      const verifyCodeRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: headersNeuroDoc,
        body: JSON.stringify({ p_shop_id: hospA.id, p_code: codeDoc2 }),
      });
      const verifyCodeData = await verifyCodeRes.json();
      assert.equal(
        Boolean(verifyCodeData.success),
        false,
        `neuroDoc must not verify_checkin_code on doc2Booking: ${JSON.stringify(verifyCodeData)}`
      );

      // Restore is_present=true on doc2Booking
      await pool.query(`UPDATE public.bookings SET is_present = true WHERE id = $1`, [
        doc2Booking.id,
      ]);
    });

    it('Step 4(a): customer can cancel their own booking through the mobile call path (cancel_booking RPC) and cannot cancel someone else booking', async () => {
      const headersPatient1 = {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${tokens.patient1.token}`,
        'Content-Type': 'application/json',
      };

      // Create a future un-checked-in CONFIRMED booking for patient1 and another for patient2
      const p1BookRes = await pool.query(
        `INSERT INTO public.bookings (
          customer_id, provider_id, resource_id, department_id,
          slot_start, slot_end, status, payment_status, deposit_amount, total_amount,
          reference_code, is_present
        ) VALUES (
          $1, $2, $3, $4,
          NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 15 minutes', 'CONFIRMED', 'CAPTURED', 100, 500,
          'P1-CUST-CANCEL-OWN', false
        ) RETURNING id`,
        [tokens.patient1.user.id, hospA.id, doc1.id, doc1.department_id]
      );
      const p1OwnId = p1BookRes.rows[0].id;
      createdBookingIds.push(p1OwnId);

      const p2BookRes = await pool.query(
        `INSERT INTO public.bookings (
          customer_id, provider_id, resource_id, department_id,
          slot_start, slot_end, status, payment_status, deposit_amount, total_amount,
          reference_code, is_present
        ) VALUES (
          $1, $2, $3, $4,
          NOW() + INTERVAL '2 days 30 minutes', NOW() + INTERVAL '2 days 45 minutes', 'CONFIRMED', 'CAPTURED', 100, 500,
          'P1-CUST-CANCEL-OTHER', false
        ) RETURNING id`,
        [tokens.patient2.user.id, hospA.id, doc1.id, doc1.department_id]
      );
      const p2OtherId = p2BookRes.rows[0].id;
      createdBookingIds.push(p2OtherId);

      // 1. patient1 tries to cancel patient2's booking via cancel_booking RPC -> must fail
      const otherCancelRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: headersPatient1,
        body: JSON.stringify({
          p_booking_id: p2OtherId,
          p_reason: 'Customer trying to cancel another customer booking',
          p_initiated_by: 'CUSTOMER',
        }),
      });
      const otherCancelData = await otherCancelRes.json();
      assert.equal(
        Boolean(otherCancelData.success),
        false,
        `Customer must not be able to cancel another customer's booking: ${JSON.stringify(otherCancelData)}`
      );
      const p2StatusCheck = await pool.query(`SELECT status FROM public.bookings WHERE id = $1`, [
        p2OtherId,
      ]);
      assert.equal(p2StatusCheck.rows[0].status, 'CONFIRMED');

      // 2. patient1 cancels their own booking via cancel_booking RPC -> must succeed
      const ownCancelRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: headersPatient1,
        body: JSON.stringify({
          p_booking_id: p1OwnId,
          p_reason: 'Customer cancelling own booking from mobile app',
          p_initiated_by: 'CUSTOMER',
        }),
      });
      assert.equal(ownCancelRes.status, 200);
      const ownCancelData = await ownCancelRes.json();
      assert.equal(
        ownCancelData.success,
        true,
        `Customer must be able to cancel their own booking: ${JSON.stringify(ownCancelData)}`
      );
      assert.equal(ownCancelData.status, 'CANCELLED');
    });

    it('Step 4(b): late-queue EXPIRE_STALE_STANDBY action rejects customers and staff from another hospital, and allows authorized hospital staff', async () => {
      const { POST } = await import(
        '../../apps/merchant-web/src/app/api/bookings/late-queue/route.ts'
      );

      // 1. Customer (patient1) -> 403
      const reqCustomer = new NextRequest('http://localhost:3000/api/bookings/late-queue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.patient1.token}`,
        },
        body: JSON.stringify({
          action: 'EXPIRE_STALE_STANDBY',
          provider_id: hospA.id,
          threshold_minutes: 45,
        }),
      });
      const resCustomer = await POST(reqCustomer);
      assert.equal(
        resCustomer.status,
        403,
        'Customer must be rejected from EXPIRE_STALE_STANDBY with 403'
      );

      // 2. Staff from another hospital (adminBalaji from Hospital B targeting Hospital A) -> 403
      const reqOtherHosp = new NextRequest('http://localhost:3000/api/bookings/late-queue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.adminBalaji.token}`,
        },
        body: JSON.stringify({
          action: 'EXPIRE_STALE_STANDBY',
          provider_id: hospA.id,
          threshold_minutes: 45,
        }),
      });
      const resOtherHosp = await POST(reqOtherHosp);
      assert.equal(
        resOtherHosp.status,
        403,
        'Staff from another hospital must be rejected from EXPIRE_STALE_STANDBY with 403'
      );

      // 3. Authorized staff for Hospital A (adminApex) -> 200
      const reqHospAdmin = new NextRequest('http://localhost:3000/api/bookings/late-queue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.adminApex.token}`,
        },
        body: JSON.stringify({
          action: 'EXPIRE_STALE_STANDBY',
          provider_id: hospA.id,
          threshold_minutes: 45,
        }),
      });
      const resHospAdmin = await POST(reqHospAdmin);
      assert.equal(
        resHospAdmin.status,
        200,
        'Hospital admin for Hospital A must be allowed to run EXPIRE_STALE_STANDBY'
      );
      const bodyHospAdmin = await resHospAdmin.json();
      assert.equal(bodyHospAdmin.success, true);
    });

    it('Step 4(c): all 6 RPCs still work for the correct consultant and for a hospital admin', async () => {
      const { POST: postNoShow } = await import(
        '../../apps/merchant-web/src/app/api/bookings/no-show/route.ts'
      );

      // Ensure check_in module is enabled on doc1's department for consultant check-in verification
      await pool.query(
        `UPDATE public.departments
         SET allowed_modules = CASE
           WHEN 'check_in' = ANY(COALESCE(allowed_modules, ARRAY[]::text[])) THEN allowed_modules
           ELSE array_append(COALESCE(allowed_modules, ARRAY[]::text[]), 'check_in')
         END
         WHERE id = $1`,
        [doc1.department_id]
      );

      const todayIstRes = await pool.query(
        `SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS today_ist`
      );
      const todayIst = todayIstRes.rows[0].today_ist;

      for (const actor of [
        { label: 'correct consultant (neuroDoc on doc1)', token: tokens.neuroDoc.token, resObj: doc1 },
        { label: 'hospital admin (adminApex on doc2)', token: tokens.adminApex.token, resObj: doc2 },
      ]) {
        const headers = {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${actor.token}`,
          'Content-Type': 'application/json',
        };

        // Clear any leftover active bookings in the [NOW() - 2h, NOW() + 6h] window on this resource from prior test suites
        await pool.query(
          `DELETE FROM public.bookings
           WHERE resource_id = $1
             AND slot_start >= NOW() - INTERVAL '2 hours'
             AND slot_end <= NOW() + INTERVAL '6 hours'`,
          [actor.resObj.id]
        );

        // Helper to insert a fresh CONFIRMED booking for this actor's target resource
        async function createTestBooking(offsetMinutes, refSuffix) {
          const r = await pool.query(
            `INSERT INTO public.bookings (
              customer_id, provider_id, resource_id, department_id,
              slot_start, slot_end, status, payment_status, deposit_amount, total_amount,
              reference_code, is_present
            ) VALUES (
              $1, $2, $3, $4,
              NOW() + ($5::int || ' minutes')::interval,
              NOW() + (($5::int + 15) || ' minutes')::interval,
              'CONFIRMED', 'CAPTURED', 100, 500,
              $6, false
            ) RETURNING id`,
            [
              tokens.patient1.user.id,
              hospA.id,
              actor.resObj.id,
              actor.resObj.department_id,
              offsetMinutes,
              `P1-4C-${refSuffix}-${Math.floor(Math.random() * 100000)}`,
            ]
          );
          createdBookingIds.push(r.rows[0].id);
          return r.rows[0].id;
        }

        // 1. reschedule_booking_slot & complete_booking
        const b1 = await createTestBooking(180, 'RESCHED');
        const reschedRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reschedule_booking_slot`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            p_booking_id: b1,
            p_new_slot_start: new Date(Date.now() + 240 * 60_000).toISOString(),
            p_new_slot_end: new Date(Date.now() + 255 * 60_000).toISOString(),
          }),
        });
        const reschedData = await reschedRes.json();
        assert.equal(
          reschedData.success,
          true,
          `reschedule_booking_slot must succeed for ${actor.label}: ${JSON.stringify(reschedData)}`
        );

        const compRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/complete_booking`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ p_booking_id: b1 }),
        });
        const compData = await compRes.json();
        assert.equal(
          compData.success,
          true,
          `complete_booking must succeed for ${actor.label}: ${JSON.stringify(compData)}`
        );

        // 2. mark_present_manually (slot +15m to +30m)
        const b2 = await createTestBooking(15, 'MARK');
        const markRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_present_manually`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ p_booking_id: b2 }),
        });
        const markData = await markRes.json();
        assert.equal(
          markData.success,
          true,
          `mark_present_manually must succeed for ${actor.label}: ${JSON.stringify(markData)}`
        );

        // 3. verify_checkin_code (slot +40m to +55m, non-overlapping and within 60m check-in window)
        const b3 = await createTestBooking(40, 'CODE');
        const code = String(Math.floor(100000 + Math.random() * 899999));
        await pool.query(
          `INSERT INTO public.appointment_checkin_codes (booking_id, provider_id, customer_id, code, appointment_date)
           VALUES ($1, $2, $3, $4, $5::date)
           ON CONFLICT (booking_id) DO UPDATE SET code = EXCLUDED.code, appointment_date = EXCLUDED.appointment_date`,
          [b3, hospA.id, tokens.patient1.user.id, code, todayIst]
        );
        const codeRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_checkin_code`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ p_shop_id: hospA.id, p_code: code }),
        });
        const codeData = await codeRes.json();
        assert.equal(
          codeData.success,
          true,
          `verify_checkin_code must succeed for ${actor.label}: ${JSON.stringify(codeData)}`
        );

        // 4. cancel_booking
        const b4 = await createTestBooking(300, 'CANCEL');
        const cancelRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cancel_booking`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            p_booking_id: b4,
            p_reason: `Authorized cancel test by ${actor.label}`,
            p_initiated_by: 'MERCHANT',
          }),
        });
        const cancelData = await cancelRes.json();
        assert.equal(
          cancelData.success,
          true,
          `cancel_booking must succeed for ${actor.label}: ${JSON.stringify(cancelData)}`
        );

        // 5. record_no_show (via POST /api/bookings/no-show on a past slot after doctor_left = true)
        const b5 = await createTestBooking(-60, 'NOSHOW');
        await pool.query(
          `UPDATE public.resources
           SET attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{doctor_left}', 'true'::jsonb)
           WHERE id = $1`,
          [actor.resObj.id]
        );
        try {
          const noShowReq = new NextRequest('http://localhost:3000/api/bookings/no-show', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${actor.token}`,
            },
            body: JSON.stringify({ booking_id: b5 }),
          });
          const noShowRes = await postNoShow(noShowReq);
          assert.equal(
            noShowRes.status,
            200,
            `POST /api/bookings/no-show (calling record_no_show) must succeed for ${actor.label}`
          );
          const noShowBody = await noShowRes.json();
          assert.equal(noShowBody.success, true);
        } finally {
          await pool.query(
            `UPDATE public.resources
             SET attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{doctor_left}', 'false'::jsonb)
             WHERE id = $1`,
            [actor.resObj.id]
          );
        }
      }
    });

    it('/api/bookings/confirm requires authentication or verified signature and enforces isCallerAuthorizedForBooking', async () => {
      const { POST } = await import(
        '../../apps/merchant-web/src/app/api/bookings/confirm/route.ts'
      );

      // Create a HELD booking on doc2
      const holdRes = await pool.query(
        `INSERT INTO public.bookings (
          customer_id, provider_id, resource_id, department_id,
          slot_start, slot_end, status, payment_status, deposit_amount, total_amount,
          hold_expires_at, reference_code
        ) VALUES (
          $1, $2, $3, $4,
          '2026-11-15T06:00:00Z', '2026-11-15T06:15:00Z', 'HELD', 'PENDING', 100, 500,
          NOW() + INTERVAL '10 minutes', 'P1-HOLD-01'
        ) RETURNING id`,
        [tokens.patient2.user.id, hospA.id, doc2.id, doc2.department_id]
      );
      const holdId = holdRes.rows[0].id;
      createdBookingIds.push(holdId);

      // 1. Unauthenticated without signature -> 401
      const reqUnauth = new NextRequest('http://localhost:3000/api/bookings/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: holdId, gateway_payment_id: 'pay_unverified123' }),
      });
      const resUnauth = await POST(reqUnauth);
      assert.equal(resUnauth.status, 401, 'Unauthenticated confirm without signature must fail with 401');

      // 2. Authenticated as neuroDoc (doc1) trying to confirm doc2's booking without signature -> 403
      const reqWrongDoc = new NextRequest('http://localhost:3000/api/bookings/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
        },
        body: JSON.stringify({ booking_id: holdId, gateway_payment_id: 'pay_unverified123' }),
      });
      const resWrongDoc = await POST(reqWrongDoc);
      assert.equal(
        resWrongDoc.status,
        403,
        'Consultant from another resource must be rejected by isCallerAuthorizedForBooking with 403'
      );
    });
  });

  // ===========================================================================
  // 1.5 /api/payments/verify
  // ===========================================================================
  describe('1.5 /api/payments/verify ownership & attachment_url path prefix', () => {
    it('requires authentication, verifies booking ownership, and requires attachment_url to start with customer_id/', async () => {
      const { POST } = await import(
        '../../apps/merchant-web/src/app/api/payments/verify/route.ts'
      );

      const holdRes = await pool.query(
        `INSERT INTO public.bookings (
          customer_id, provider_id, resource_id, department_id,
          slot_start, slot_end, status, payment_status, deposit_amount, total_amount,
          hold_expires_at, reference_code, gateway_order_id
        ) VALUES (
          $1, $2, $3, $4,
          '2026-11-15T06:30:00Z', '2026-11-15T06:45:00Z', 'HELD', 'PENDING', 100, 500,
          NOW() + INTERVAL '10 minutes', 'P1-PAY-01', 'order_test_p1'
        ) RETURNING id`,
        [tokens.patient1.user.id, hospA.id, doc1.id, doc1.department_id]
      );
      const holdId = holdRes.rows[0].id;
      createdBookingIds.push(holdId);

      const secret = process.env.RAZORPAY_KEY_SECRET || 'test_secret';
      process.env.RAZORPAY_KEY_SECRET = secret;
      const orderId = 'order_test_p1';
      const paymentId = 'pay_test_p1';
      const validSig = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      // 1. Unauthenticated -> 401
      const reqUnauth = new NextRequest('http://localhost:3000/api/payments/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-vercel-id': 'v1',
          'x-real-ip': '198.51.100.1',
        },
        body: JSON.stringify({
          booking_id: holdId,
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSig,
        }),
      });
      const resUnauth = await POST(reqUnauth);
      assert.equal(resUnauth.status, 401, 'Unauthenticated /api/payments/verify must return 401');

      // 2. Other customer (patient2) -> 403
      const reqOther = new NextRequest('http://localhost:3000/api/payments/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.patient2.token}`,
          'x-vercel-id': 'v1',
          'x-real-ip': '198.51.100.2',
        },
        body: JSON.stringify({
          booking_id: holdId,
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSig,
        }),
      });
      const resOther = await POST(reqOther);
      assert.equal(resOther.status, 403, 'Non-owner /api/payments/verify must return 403');

      // 3. Owner with another customer's attachment_url prefix -> 400
      const reqBadAttachment = new NextRequest('http://localhost:3000/api/payments/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.patient1.token}`,
          'x-vercel-id': 'v1',
          'x-real-ip': '198.51.100.3',
        },
        body: JSON.stringify({
          booking_id: holdId,
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSig,
          attachment_url: `${tokens.patient2.user.id}/receipt.png`,
        }),
      });
      const resBadAttachment = await POST(reqBadAttachment);
      assert.equal(
        resBadAttachment.status,
        400,
        'attachment_url not starting with caller customer_id/ must return 400'
      );
    });
  });

  // ===========================================================================
  // 1.6 /api/bookings/no-show
  // ===========================================================================
  describe('1.6 /api/bookings/no-show production bypass removal', () => {
    it('rejects force_e2e_bypass when NODE_ENV is production', async () => {
      const { POST } = await import(
        '../../apps/merchant-web/src/app/api/bookings/no-show/route.ts'
      );
      // Create a future CONFIRMED booking with is_present = false on doc1
      const noShowRes = await pool.query(
        `INSERT INTO public.bookings (
          customer_id, provider_id, resource_id, department_id,
          slot_start, slot_end, status, payment_status, deposit_amount, total_amount,
          reference_code, is_present
        ) VALUES (
          $1, $2, $3, $4,
          '2026-11-15T08:00:00Z', '2026-11-15T08:15:00Z', 'CONFIRMED', 'CAPTURED', 100, 500,
          'P1-NOSHOW-01', false
        ) RETURNING id`,
        [tokens.patient1.user.id, hospA.id, doc1.id, doc1.department_id]
      );
      const futureBookingId = noShowRes.rows[0].id;
      createdBookingIds.push(futureBookingId);

      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const req = new NextRequest('http://localhost:3000/api/bookings/no-show', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.neuroDoc.token}`,
          },
          body: JSON.stringify({
            booking_id: futureBookingId,
            force_e2e_bypass: true,
          }),
        });
        const res = await POST(req);
        assert.equal(
          res.status,
          400,
          'force_e2e_bypass must not bypass premature slot_end / doctor_left checks when NODE_ENV=production'
        );
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
  });

  // ===========================================================================
  // 1.7 /api/bookings/offline
  // ===========================================================================
  describe('1.7 /api/bookings/offline walk-in profile failure handling', () => {
    it('returns an error (500) and creates nothing when creating the walk-in profile fails (no first-customer fallback)', async () => {
      const { POST } = await import(
        '../../apps/merchant-web/src/app/api/bookings/offline/route.ts'
      );
      const { getSupabaseAdmin } = await import('../../apps/merchant-web/src/lib/supabase.ts');
      const supabaseAdmin = getSupabaseAdmin();
      const origCreateUser = supabaseAdmin.auth.admin.createUser.bind(supabaseAdmin.auth.admin);

      // Stub auth.admin.createUser to fail for a brand-new walk-in customer phone
      supabaseAdmin.auth.admin.createUser = async () => ({
        data: { user: null },
        error: { message: 'Simulated auth.admin.createUser failure', status: 500 },
      });

      const unmappedWalkinPhone = '9000099988';
      const slotStart = new Date(Date.now() + 360 * 60_000).toISOString();

      try {
        const beforeCountRes = await pool.query(
          `SELECT count(*)::int AS cnt FROM public.bookings WHERE provider_id = $1 AND resource_id = $2`,
          [hospA.id, doc1.id]
        );
        const beforeCnt = beforeCountRes.rows[0].cnt;

        const req = new NextRequest('http://localhost:3000/api/bookings/offline', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.neuroDoc.token}`,
          },
          body: JSON.stringify({
            provider_id: hospA.id,
            resource_id: doc1.id,
            slot_start_time: slotStart,
            patient_name: 'Walk-in Profile Fail Patient',
            patient_phone: unmappedWalkinPhone,
          }),
        });
        const res = await POST(req);
        assert.equal(
          res.status,
          500,
          'POST /api/bookings/offline must fail with 500 when walk-in profile creation fails'
        );
        const body = await res.json();
        assert.match(
          body.error || '',
          /Simulated auth\.admin\.createUser failure|Failed to create walk-in/i
        );

        // Verify zero bookings were created (never attached to first customer in profiles)
        const afterCountRes = await pool.query(
          `SELECT count(*)::int AS cnt FROM public.bookings WHERE provider_id = $1 AND resource_id = $2`,
          [hospA.id, doc1.id]
        );
        assert.equal(
          afterCountRes.rows[0].cnt,
          beforeCnt,
          'No booking row may be created when walk-in customer profile creation fails'
        );
      } finally {
        supabaseAdmin.auth.admin.createUser = origCreateUser;
      }
    });
  });

  // ===========================================================================
  // 1.8 /api/merchant/upload-image & /api/admin/venues
  // ===========================================================================
  describe('1.8 /api/merchant/upload-image role check & /api/admin/venues pending status', () => {
    it('rejects a customer calling /api/merchant/upload-image with 403', async () => {
      const { POST } = await import(
        '../../apps/merchant-web/src/app/api/merchant/upload-image/route.ts'
      );
      const req = new NextRequest('http://localhost:3000/api/merchant/upload-image', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.patient1.token}`,
        },
      });
      const res = await POST(req);
      assert.equal(res.status, 403, 'Customer role must be rejected from /api/merchant/upload-image with 403');
    });

    it('rejects a customer or department staff calling POST /api/admin/venues and keeps newly created venues in PENDING_APPROVAL', async () => {
      const { POST } = await import(
        '../../apps/merchant-web/src/app/api/admin/venues/route.ts'
      );

      // 1. Customer role -> 403
      const reqCust = new NextRequest('http://localhost:3000/api/admin/venues', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.patient1.token}`,
        },
        body: JSON.stringify({
          name: 'Unauthorized Customer Venue',
          categoryId: 'clinics',
          address: '123 Fake St',
          phone: '9876543210',
        }),
      });
      const resCust = await POST(reqCust);
      assert.equal(resCust.status, 403, 'Customer must be rejected from POST /api/admin/venues');

      // 2. Hospital department staff (front_desk) -> 403
      const reqStaff = new NextRequest('http://localhost:3000/api/admin/venues', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
        },
        body: JSON.stringify({
          name: 'Unauthorized Front Desk Venue',
          categoryId: 'clinics',
          address: '123 Fake St',
          phone: '9876543210',
        }),
      });
      const resStaff = await POST(reqStaff);
      assert.equal(
        resStaff.status,
        403,
        'Department front_desk staff must not be allowed to create venues via POST /api/admin/venues'
      );

      // 3. Allowed role (merchant owner / hospital admin) -> creates venue in PENDING_APPROVAL status
      const reqMerchant = new NextRequest('http://localhost:3000/api/admin/venues', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.adminApex.token}`,
        },
        body: JSON.stringify({
          name: '[TEST-PHASE1] Pending Venue Check',
          categoryId: 'clinics',
          address: '456 Pending Rd, Tirupati',
          phone: '9876543210',
          ownerId: tokens.adminApex.user.id,
        }),
      });
      const resMerchant = await POST(reqMerchant);
      assert.ok(resMerchant.status === 200 || resMerchant.status === 201, `Expected 200/201, got ${resMerchant.status}`);
      const venueBody = await resMerchant.json();
      const createdVenue = venueBody.venue || venueBody.data;
      assert.ok(createdVenue?.id, 'Expected created venue ID');
      createdVenueIds.push(createdVenue.id);

      const dbVenue = await pool.query(`SELECT status FROM public.providers WHERE id = $1`, [
        createdVenue.id,
      ]);
      assert.equal(
        dbVenue.rows[0].status,
        'PENDING_APPROVAL',
        'Newly created venue must remain PENDING_APPROVAL until approved'
      );
    });
  });

  // ===========================================================================
  // 1.9 Rate limiting, getClientIp (Step 5), delete-public-request, startup Redis check
  // ===========================================================================
  describe('1.9 Rate limiting fail-closed in production, getClientIp (Step 5), and startup check', () => {
    it('Step 5: getClientIp trusts only deployment platform (Vercel) headers in strict order and ignores forged cf-ray / cf-connecting-ip / x-forwarded-for', async () => {
      const { getClientIp } = await import('../../apps/merchant-web/src/lib/auth-admin.ts');
      const prevProxy = process.env.TRUSTED_PROXY;
      const prevVercel = process.env.VERCEL;
      const prevCf = process.env.CLOUDFLARE_PROXY;
      delete process.env.TRUSTED_PROXY;
      delete process.env.VERCEL;
      delete process.env.CLOUDFLARE_PROXY;

      try {
        // 1. Off-Vercel / untrusted environment: forged cf-ray, cf-connecting-ip, x-vercel-id, x-real-ip, x-forwarded-for -> all ignored (undefined)
        const reqForgedDirect = new NextRequest('http://localhost:3000/api/test', {
          headers: {
            'cf-ray': '888forged-MAA',
            'cf-connecting-ip': '6.6.6.6',
            'x-vercel-id': 'forged::123',
            'x-vercel-forwarded-for': '6.6.6.6',
            'x-real-ip': '6.6.6.6',
            'x-forwarded-for': '6.6.6.6, 7.7.7.7',
          },
        });
        assert.equal(
          getClientIp(reqForgedDirect),
          undefined,
          'When not on Vercel/TRUSTED_PROXY, client-forged headers must never decide the IP'
        );

        // 2. On Vercel (process.env.VERCEL = '1'): client sends forged cf-ray + cf-connecting-ip + forged leftmost x-forwarded-for
        // Vercel edge injects x-vercel-id and sets x-vercel-forwarded-for / x-real-ip / rightmost x-forwarded-for
        process.env.VERCEL = '1';

        const reqVercelWithForgedCf = new NextRequest('http://localhost:3000/api/test', {
          headers: {
            'cf-ray': '888forged-MAA',
            'cf-connecting-ip': '6.6.6.6',
            'x-vercel-id': 'bom1::real-edge',
            'x-forwarded-for': '6.6.6.6, 203.0.113.55',
          },
        });
        assert.equal(
          getClientIp(reqVercelWithForgedCf),
          '203.0.113.55',
          'On Vercel, forged cf-ray + cf-connecting-ip and leftmost x-forwarded-for must be ignored in favor of rightmost Vercel hop'
        );

        // 3. Verify strict Vercel header priority order:
        // (1) req.ip -> (2) x-vercel-forwarded-for -> (3) x-real-ip -> (4) rightmost x-forwarded-for
        const reqOrderCheck = new NextRequest('http://localhost:3000/api/test', {
          headers: {
            'x-vercel-id': 'bom1::real-edge',
            'x-vercel-forwarded-for': '203.0.113.101',
            'x-real-ip': '203.0.113.102',
            'x-forwarded-for': '1.1.1.1, 203.0.113.103',
          },
        });
        assert.equal(
          getClientIp(reqOrderCheck),
          '203.0.113.101',
          'x-vercel-forwarded-for must take priority over x-real-ip and x-forwarded-for on Vercel'
        );

        const reqRealIpOrder = new NextRequest('http://localhost:3000/api/test', {
          headers: {
            'x-vercel-id': 'bom1::real-edge',
            'x-real-ip': '203.0.113.102',
            'x-forwarded-for': '1.1.1.1, 203.0.113.103',
          },
        });
        assert.equal(
          getClientIp(reqRealIpOrder),
          '203.0.113.102',
          'x-real-ip must take priority over x-forwarded-for when x-vercel-forwarded-for is absent'
        );

        // 4. End-to-end route proof on Vercel: real user request on Vercel (NODE_ENV=production, VERCEL=1)
        // resolves IP from Vercel edge headers and is NOT blocked by the missing-IP check
        const { GET: getQueue } = await import(
          '../../apps/merchant-web/src/app/api/customer/queue-and-history/route.ts'
        );
        const reqRealVercelUser = new NextRequest(
          `http://localhost:3000/api/customer/queue-and-history?booking_id=${patient1Booking.id}&provider_id=${hospA.id}&resource_id=${doc1.id}&date=2026-11-15`,
          {
            headers: {
              Authorization: `Bearer ${tokens.patient1.token}`,
              'x-vercel-id': 'bom1::prod-edge',
              'x-vercel-forwarded-for': '203.0.113.77',
            },
          }
        );
        const resRealVercelUser = await getQueue(reqRealVercelUser);
        assert.equal(
          resRealVercelUser.status,
          200,
          'Real user on Vercel with x-vercel-id + x-vercel-forwarded-for must resolve IP and succeed (200)'
        );
      } finally {
        if (prevProxy !== undefined) process.env.TRUSTED_PROXY = prevProxy;
        else delete process.env.TRUSTED_PROXY;
        if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
        else delete process.env.VERCEL;
        if (prevCf !== undefined) process.env.CLOUDFLARE_PROXY = prevCf;
        else delete process.env.CLOUDFLARE_PROXY;
      }
    });

    it('fails closed (429) in production mode when Redis env vars are missing across all 7 routes (both with Vercel IP and when no IP is found)', async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevVercel = process.env.VERCEL;
      const prevRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
      const prevRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
      process.env.NODE_ENV = 'production';
      process.env.VERCEL = '1';
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      try {
        const routes = [
          {
            name: 'payments/verify',
            mod: await import('../../apps/merchant-web/src/app/api/payments/verify/route.ts'),
            body: { booking_id: patient1Booking.id },
          },
          {
            name: 'payments/create-order',
            mod: await import('../../apps/merchant-web/src/app/api/payments/create-order/route.ts'),
            body: { booking_id: patient1Booking.id },
          },
          {
            name: 'merchant/onboard',
            mod: await import('../../apps/merchant-web/src/app/api/merchant/onboard/route.ts'),
            body: {
              fullName: 'Test Owner',
              email: 'test-onboard-rl@example.com',
              shopName: 'Test Shop',
              categoryId: 'clinics',
              phone: '+919876543210',
            },
          },
          {
            name: 'account/delete-public-request',
            mod: await import(
              '../../apps/merchant-web/src/app/api/account/delete-public-request/route.ts'
            ),
            body: { identifier: 'test@example.com' },
          },
          {
            name: 'bookings/hold',
            mod: await import('../../apps/merchant-web/src/app/api/bookings/hold/route.ts'),
            body: {
              resource_id: doc1.id,
              slot_start: '2026-11-20T09:00:00Z',
              slot_end: '2026-11-20T09:15:00Z',
              customer_id: tokens.patient1.user.id,
            },
          },
          {
            name: 'auth/otp/send',
            mod: await import('../../apps/merchant-web/src/app/api/auth/otp/send/route.ts'),
            body: { phone: '+919876543210' },
          },
          {
            name: 'auth/otp/verify',
            mod: await import('../../apps/merchant-web/src/app/api/auth/otp/verify/route.ts'),
            body: { phone: '+919876543210', token: '123456' },
          },
        ];

        for (const r of routes) {
          // Case A: Trusted Vercel IP header present, Redis missing in production -> 429
          const reqWithIp = new NextRequest(`http://localhost:3000/api/${r.name}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokens.patient1.token}`,
              'x-vercel-id': 'bom1::test',
              'x-vercel-forwarded-for': '203.0.113.99',
              'x-real-ip': '203.0.113.99',
            },
            body: JSON.stringify(r.body),
          });
          const resWithIp = await r.mod.POST(reqWithIp);
          assert.equal(
            resWithIp.status,
            429,
            `Route ${r.name} must fail closed (429) in production when Redis is missing (with IP)`
          );

          // Case B: No IP header determinable in production -> must ALSO fail closed (429)
          const reqNoIp = new NextRequest(`http://localhost:3000/api/${r.name}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokens.patient1.token}`,
            },
            body: JSON.stringify(r.body),
          });
          const resNoIp = await r.mod.POST(reqNoIp);
          assert.equal(
            resNoIp.status,
            429,
            `Route ${r.name} must fail closed (429) in production when no client IP can be determined`
          );
        }
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
        else delete process.env.VERCEL;
        if (prevRedisUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = prevRedisUrl;
        if (prevRedisToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = prevRedisToken;
      }
    });

    it('behaviorally enforces rate limit on delete-public-request even when x-e2e-bypass: true is sent, and throws at startup via instrumentation.register() when Redis is unconfigured in production', async () => {
      const { POST: postDeleteReq } = await import(
        '../../apps/merchant-web/src/app/api/account/delete-public-request/route.ts'
      );
      const { register } = await import('../../apps/merchant-web/src/instrumentation.ts');

      const prevVercel = process.env.VERCEL;
      const prevNodeEnvForRate = process.env.NODE_ENV;
      const prevBypassEnv = process.env.ENABLE_E2E_BYPASS;
      process.env.VERCEL = '1';
      process.env.NODE_ENV = 'development';
      delete process.env.ENABLE_E2E_BYPASS;
      try {
        // 1. Send 6 requests to /api/account/delete-public-request with x-e2e-bypass: true from the same IP (limit is 5 per 300s)
        const testIp = `203.0.113.${Math.floor(150 + Math.random() * 90)}`;
        const testEmail = `rate-test-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
        let firstStatus = 0;
        let lastStatus = 0;
        for (let i = 1; i <= 6; i++) {
          const req = new NextRequest('http://localhost:3000/api/account/delete-public-request', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokens.patient1.token}`,
              'x-e2e-bypass': 'true',
              'x-vercel-id': 'bom1::rate-test',
              'x-vercel-forwarded-for': testIp,
            },
            body: JSON.stringify({ identifier: testEmail }),
          });
          const res = await postDeleteReq(req);
          if (i === 1) firstStatus = res.status;
          lastStatus = res.status;
        }
        assert.notEqual(
          firstStatus,
          429,
          'First call to /api/account/delete-public-request must execute normally before hitting the 5-req limit'
        );
        assert.equal(
          lastStatus,
          429,
          '6th call to /api/account/delete-public-request with x-e2e-bypass: true must be rate-limited (429)'
        );
      } finally {
        process.env.NODE_ENV = prevNodeEnvForRate;
        if (prevBypassEnv !== undefined) process.env.ENABLE_E2E_BYPASS = prevBypassEnv;
        if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
        else delete process.env.VERCEL;
      }

      // 2. Invoke instrumentation.ts register() in production mode without Redis env vars -> must throw FATAL CONFIGURATION ERROR
      const prevNodeEnv = process.env.NODE_ENV;
      const prevPhase = process.env.NEXT_PHASE;
      const prevRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
      const prevRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
      process.env.NODE_ENV = 'production';
      delete process.env.NEXT_PHASE;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      try {
        await assert.rejects(
          async () => {
            await register();
          },
          /FATAL CONFIGURATION ERROR: Upstash Redis credentials/i,
          'instrumentation.register() must throw FATAL CONFIGURATION ERROR at production server startup when Redis is unconfigured'
        );
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        if (prevPhase !== undefined) process.env.NEXT_PHASE = prevPhase;
        if (prevRedisUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = prevRedisUrl;
        if (prevRedisToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = prevRedisToken;
      }
    });

    it('Correction 4: when no trusted IP is found, logs missing_trusted_client_ip and falls back to per-phone/per-user rate limits so one bad actor cannot lock out other users', async () => {
      const { POST: postDeleteReq } = await import(
        '../../apps/merchant-web/src/app/api/account/delete-public-request/route.ts'
      );
      const prevVercel = process.env.VERCEL;
      const prevProxy = process.env.TRUSTED_PROXY;
      const prevNodeEnv = process.env.NODE_ENV;
      const prevBypass = process.env.ENABLE_E2E_BYPASS;
      delete process.env.VERCEL;
      delete process.env.TRUSTED_PROXY;
      delete process.env.ENABLE_E2E_BYPASS;
      process.env.NODE_ENV = 'development';

      const warnings = [];
      const origWarn = console.warn;
      console.warn = (...args) => {
        warnings.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      };

      try {
        const attackerId = `attacker-${Date.now()}@example.com`;
        const honestUserId = `honest-${Date.now()}@example.com`;

        // Attacker sends 4 requests with NO trusted IP (per-identifier limit is 3 per 300s)
        let attackerLastStatus = 0;
        for (let i = 1; i <= 4; i++) {
          const req = new NextRequest('http://localhost:3000/api/account/delete-public-request', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-forwarded-for': '198.51.100.1', // untrusted header -> getClientIp returns undefined
            },
            body: JSON.stringify({ identifier: attackerId }),
          });
          const res = await postDeleteReq(req);
          attackerLastStatus = res.status;
        }

        assert.equal(
          attackerLastStatus,
          429,
          'Attacker exceeding per-identifier limit without a trusted IP must be rate-limited (429)'
        );
        assert.ok(
          warnings.some((w) => w.includes('missing_trusted_client_ip')),
          'Missing trusted IP event must be logged via console.warn'
        );

        // Honest user sends a request with NO trusted IP -> must NOT be locked out by the attacker!
        const honestReq = new NextRequest('http://localhost:3000/api/account/delete-public-request', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '198.51.100.2',
          },
          body: JSON.stringify({ identifier: honestUserId }),
        });
        const honestRes = await postDeleteReq(honestReq);
        assert.notEqual(
          honestRes.status,
          429,
          'Honest user must NOT be locked out when another caller exhausts their quota without a trusted IP'
        );
      } finally {
        console.warn = origWarn;
        process.env.NODE_ENV = prevNodeEnv;
        if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
        if (prevProxy !== undefined) process.env.TRUSTED_PROXY = prevProxy;
        if (prevBypass !== undefined) process.env.ENABLE_E2E_BYPASS = prevBypass;
      }
    });
  });
});
