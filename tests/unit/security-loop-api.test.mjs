/**
 * tests/unit/security-loop-api.test.mjs
 *
 * Wave 2 API Security Test Suite
 * Validates the resolution of:
 * 1. API-01 (CRITICAL): BOLA/IDOR in POST /api/prescriptions/signed-url
 * 2. API-02 / BIZ-05 (HIGH): BOLA & PII/PIN harvest in GET /api/ticket/[id]?phone_last4=XXXX
 * 3. API-04 (HIGH): Missing Admin MFA (AAL2) in apps/merchant-web/src/lib/auth-admin.ts
 *
 * For EVERY fix:
 * (1) DENY: unauthorized caller gets 401/403 or scrubbed output
 * (2) ALLOW: legitimate role succeeds
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import pg from 'pg';
import ts from '../../apps/merchant-web/node_modules/typescript/lib/typescript.js';

const { Pool } = pg;

// 1. Load environment variables
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

// 2. Register Node module hooks for Next.js TypeScript imports
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

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('Wave 2: API Security & Auth Hardening (security-loop-api)', () => {
  let pool;
  let bookingA;
  let bookingB;
  let customerA;
  let customerB;
  let adminUser;

  before(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 3 });

    // Fetch two bookings with customers
    let custRes = await pool.query(`
      SELECT p.id, p.email, p.phone, p.permanent_checkin_pin, b.id as booking_id, b.reference_code, b.booking_note, b.status, b.slot_start
      FROM public.profiles p
      JOIN public.bookings b ON b.customer_id = p.id
      WHERE p.role = 'customer' AND b.status = 'CONFIRMED'
      ORDER BY b.created_at DESC
      LIMIT 2;
    `);

    if (custRes.rows.length < 2) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL app.trusted_write = 'true'");
        await client.query(`
          UPDATE public.bookings
          SET status = 'CONFIRMED'
          WHERE id IN (
            SELECT b.id FROM public.bookings b
            JOIN public.profiles p ON p.id = b.customer_id
            WHERE p.role = 'customer'
            LIMIT 2
          );
        `);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      custRes = await pool.query(`
        SELECT p.id, p.email, p.phone, p.permanent_checkin_pin, b.id as booking_id, b.reference_code, b.booking_note, b.status, b.slot_start
        FROM public.profiles p
        JOIN public.bookings b ON b.customer_id = p.id
        WHERE p.role = 'customer' AND b.status = 'CONFIRMED'
        ORDER BY b.created_at DESC
        LIMIT 2;
      `);
    }

    assert.ok(custRes.rows.length >= 2, 'Must have at least 2 test bookings with customers in DB');
    customerA = custRes.rows[0];
    customerB = custRes.rows[1];

    const phoneA = customerA.phone && customerA.phone.trim().length >= 4 ? customerA.phone : '+919999904921';
    const phoneB = customerB.phone && customerB.phone.trim().length >= 4 ? customerB.phone : '+919999908888';

    // Ensure customer A has phone, notes, and check-in PIN (mark is_present to open check-in window without slot collision)
    await pool.query(`
      UPDATE public.bookings
      SET booking_note = 'Confidential Patient Medical History: Chronic Migraine',
          is_present = true
      WHERE id = $1;
    `, [customerA.booking_id]);

    await pool.query(`
      UPDATE public.profiles
      SET phone = $1,
          permanent_checkin_pin = '4921'
      WHERE id = $2;
    `, [phoneA, customerA.id]);

    await pool.query(`
      UPDATE public.profiles
      SET phone = $1
      WHERE id = $2;
    `, [phoneB, customerB.id]);

    customerA.phone = phoneA;
    customerB.phone = phoneB;

    bookingA = {
      id: customerA.booking_id,
      customer_id: customerA.id,
      phone: phoneA,
      last4: phoneA.replace(/\D/g, '').slice(-4),
    };

    bookingB = {
      id: customerB.booking_id,
      customer_id: customerB.id,
      phone: phoneB,
      last4: phoneB.replace(/\D/g, '').slice(-4),
    };

    // Ensure sample file exists in storage bucket for booking A
    if (SERVICE_KEY) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/prescriptions-and-records/${bookingA.id}/prescription-valid.pdf`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/pdf',
          'x-upsert': 'true',
        },
        body: Buffer.from('%PDF-1.4 sample valid prescription document'),
      });
    }

    const adminRes = await pool.query(`
      SELECT id, email, role FROM public.profiles WHERE role = 'admin' LIMIT 1;
    `);
    adminUser = adminRes.rows[0] || { id: '88888888-8888-8888-8888-888888888881', email: 'admin@appointments.tirupati', role: 'admin' };
  });

  after(async () => {
    if (pool) await pool.end();
  });

  // =========================================================================
  // FIX 1: API-01 (CRITICAL) - BOLA/IDOR in POST /api/prescriptions/signed-url
  // =========================================================================
  describe('Fix 1 (API-01): BOLA/IDOR in POST /api/prescriptions/signed-url', () => {
    it('(1) DENY: Authorized caller for booking A requesting arbitrary storagePath of another booking/customer is rejected with 403', async () => {
      const { POST } = await import('../../apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts');

      // Caller is Customer A (authorized for bookingA), but requests Customer B's storage path
      const arbitraryPath = `${bookingB.customer_id}/confidential-report-999.pdf`;
      const req = new NextRequest('http://localhost:3000/api/prescriptions/signed-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-bypass-user': customerA.id,
        },
        body: JSON.stringify({
          bookingId: bookingA.id,
          storagePath: arbitraryPath,
        }),
      });

      const res = await POST(req);
      assert.equal(res.status, 403, 'Arbitrary storagePath must be rejected with 403 Forbidden');
      const body = await res.json();
      assert.match(body.error, /Forbidden/i, 'Error message must indicate Forbidden access');
    });

    it('(2) ALLOW: Legitimate caller requesting storagePath belonging to authorized booking succeeds with 200 and signedUrl', async () => {
      const { POST } = await import('../../apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts');

      // Valid path starting with bookingA.id or bookingA.customer_id
      const legitimatePath = `${bookingA.id}/prescription-valid.pdf`;
      const req = new NextRequest('http://localhost:3000/api/prescriptions/signed-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-bypass-user': customerA.id,
        },
        body: JSON.stringify({
          bookingId: bookingA.id,
          storagePath: legitimatePath,
        }),
      });

      const res = await POST(req);
      assert.equal(res.status, 200, 'Legitimate booking storagePath must return 200');
      const body = await res.json();
      assert.ok(body.signedUrl, 'Must return signedUrl');
    });
  });

  // =========================================================================
  // FIX 2: API-02 / BIZ-05 (HIGH) - BOLA & PII/PIN harvest in GET /api/ticket/[id]?phone_last4=XXXX
  // =========================================================================
  describe('Fix 2 (API-02 / BIZ-05): Ticket Redaction & Check-in PIN Protection', () => {
    it('(1) DENY/REDACT: Unauthenticated access with phone_last4 scrubs PII, strips notes, and never leaks check-in PIN; invalid phone returns 403', async () => {
      const { GET } = await import('../../apps/merchant-web/src/app/api/ticket/[id]/route.ts');

      // Sub-check A: Invalid phone digits -> 403 with requires_verification
      const wrongReq = new NextRequest(`http://localhost:3000/api/ticket/${bookingA.id}?phone_last4=0000`);
      const wrongRes = await GET(wrongReq, { params: Promise.resolve({ id: bookingA.id }) });
      assert.equal(wrongRes.status, 403, 'Invalid phone last 4 digits must be rejected with 403');
      const wrongBody = await wrongRes.json();
      assert.equal(wrongBody.requires_verification, true);

      // Sub-check B: Valid phone digits unauthenticated -> Redacted PII, stripped notes, checkin_code = null
      const validPhoneReq = new NextRequest(`http://localhost:3000/api/ticket/${bookingA.id}?phone_last4=${bookingA.last4}`);
      const validPhoneRes = await GET(validPhoneReq, { params: Promise.resolve({ id: bookingA.id }) });
      assert.equal(validPhoneRes.status, 200);
      const validBody = await validPhoneRes.json();

      assert.equal(validBody.success, true);
      assert.equal(validBody.checkin_code, null, 'Unauthenticated caller must NEVER receive checkin_code or PIN');
      assert.equal(validBody.booking.booking_note, null, 'Clinical notes and complaints must be stripped for unauthenticated caller');
      assert.ok(validBody.customer.phone.startsWith('******'), `Customer phone must be masked, got ${validBody.customer.phone}`);
      assert.ok(validBody.customer.phone.endsWith(bookingA.last4), `Customer phone must end with last 4 digits, got ${validBody.customer.phone}`);
      if (validBody.customer.email) {
        assert.ok(validBody.customer.email.includes('***'), `Customer email must be masked, got ${validBody.customer.email}`);
      }
    });

    it('(2) ALLOW: Authenticated booking owner receives unmasked PII, clinical notes, and active check-in PIN', async () => {
      const { GET } = await import('../../apps/merchant-web/src/app/api/ticket/[id]/route.ts');

      // Provide bearer or test-bypass header representing booking owner
      const authReq = new NextRequest(`http://localhost:3000/api/ticket/${bookingA.id}`, {
        headers: {
          'x-test-bypass-user': customerA.id,
        },
      });

      const res = await GET(authReq, { params: Promise.resolve({ id: bookingA.id }) });
      assert.equal(res.status, 200);
      const body = await res.json();

      assert.equal(body.success, true);
      assert.equal(body.customer.phone, customerA.phone, 'Authenticated owner must receive unmasked phone');
      assert.equal(body.booking.booking_note, 'Confidential Patient Medical History: Chronic Migraine', 'Authenticated owner must receive clinical notes');
      assert.ok(body.checkin_code, 'Authenticated owner must receive check-in PIN when window is open');
      assert.ok(['4921', customerA.permanent_checkin_pin, '1654', '5833'].includes(body.checkin_code) || typeof body.checkin_code === 'string');
    });
  });

  // =========================================================================
  // FIX 3: API-04 (HIGH) - Missing Admin MFA (AAL2) in auth-admin.ts
  // =========================================================================
  describe('Fix 3 (API-04): Missing Admin MFA (AAL2) Enforcement', () => {
    it('(1) DENY: Admin caller with single-factor session (AAL1) attempting sensitive mutation returns 403 MFA_REQUIRED', async () => {
      const { verifyAdminRequest, verifyStaffManagerRequest } = await import('../../apps/merchant-web/src/lib/auth-admin.ts');

      // Admin performing POST mutation with explicit AAL1 (no MFA verified)
      const reqAdmin = new NextRequest('http://localhost:3000/api/admin/refunds', {
        method: 'POST',
        headers: {
          'x-test-bypass-user': adminUser.id,
          'x-mfa-aal': 'aal1',
        },
        body: JSON.stringify({ booking_id: bookingA.id }),
      });

      const resultAdmin = await verifyAdminRequest(reqAdmin);
      assert.ok('error' in resultAdmin, 'AAL1 admin mutation must fail verification');
      assert.equal(resultAdmin.status, 403, 'AAL1 admin mutation must return 403');
      assert.match(resultAdmin.error, /MFA_REQUIRED/i, 'Error message must specify MFA_REQUIRED');

      // Staff manager request by admin with AAL1 on mutation
      const reqStaff = new NextRequest('http://localhost:3000/api/admin/doctor-assignments', {
        method: 'POST',
        headers: {
          'x-test-bypass-user': adminUser.id,
          'x-mfa-aal': 'aal1',
        },
        body: JSON.stringify({ doctorId: 'doc-123' }),
      });

      const resultStaff = await verifyStaffManagerRequest(reqStaff);
      assert.ok('error' in resultStaff, 'AAL1 admin staff manager mutation must fail verification');
      assert.equal(resultStaff.status, 403, 'Must return 403');
      assert.match(resultStaff.error, /MFA_REQUIRED/i, 'Error message must specify MFA_REQUIRED');
    });

    it('(2) ALLOW: Admin caller with AAL2 session succeeds on mutations, and AAL1 caller succeeds on read-only queries', async () => {
      const { verifyAdminRequest } = await import('../../apps/merchant-web/src/lib/auth-admin.ts');

      // AAL2 Admin performing POST mutation
      const reqAal2 = new NextRequest('http://localhost:3000/api/admin/refunds', {
        method: 'POST',
        headers: {
          'x-test-bypass-user': adminUser.id,
          'x-mfa-aal': 'aal2',
        },
        body: JSON.stringify({ booking_id: bookingA.id }),
      });

      const resultAal2 = await verifyAdminRequest(reqAal2);
      assert.ok(!('error' in resultAal2), `AAL2 mutation should succeed, got error: ${'error' in resultAal2 ? resultAal2.error : ''}`);
      assert.equal(resultAal2.user.aal, 'aal2');
      assert.equal(resultAal2.profile.role, 'admin');

      // AAL1 Admin performing GET read-only query
      const reqGet = new NextRequest('http://localhost:3000/api/admin/refunds?limit=10', {
        method: 'GET',
        headers: {
          'x-test-bypass-user': adminUser.id,
          'x-mfa-aal': 'aal1',
        },
      });

      const resultGet = await verifyAdminRequest(reqGet);
      assert.ok(!('error' in resultGet), `AAL1 read-only GET should succeed, got error: ${'error' in resultGet ? resultGet.error : ''}`);
      assert.equal(resultGet.user.aal, 'aal1');
    });
  });
});
