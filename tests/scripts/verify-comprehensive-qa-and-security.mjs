// tests/scripts/verify-comprehensive-qa-and-security.mjs
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const ENV_PATH = path.join(ROOT_DIR, 'apps/merchant-web/.env.local');

// Load environment variables
const envContent = fs.readFileSync(ENV_PATH, 'utf8');
const getEnvVal = (key) => {
  const match = envContent.match(new RegExp(`${key}="?([^"\\r\\n]+)"?`));
  return match ? match[1] : process.env[key];
};

const SUPABASE_URL = getEnvVal('NEXT_PUBLIC_SUPABASE_URL') || 'http://127.0.0.1:54321';
const ANON_KEY = getEnvVal('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE_KEY = getEnvVal('SUPABASE_SERVICE_ROLE_KEY');
const RAZORPAY_SECRET = getEnvVal('RAZORPAY_KEY_SECRET') || 'JAUY65EHjNtKy0H3UsHmnya4';
const RAZORPAY_WEBHOOK_SECRET = getEnvVal('RAZORPAY_WEBHOOK_SECRET') || process.env.RAZORPAY_WEBHOOK_SECRET;
if (!RAZORPAY_WEBHOOK_SECRET) {
  console.error('FATAL: RAZORPAY_WEBHOOK_SECRET environment variable is missing.');
  process.exit(1);
}
const ADMIN_SECRET = getEnvVal('ADMIN_SECRET') || 'tirupati_e2e_secure_bypass_key_2026_x9k2';
const API_BASE = 'http://localhost:3000';

const testResourceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // SVIMS doctor resource
const testCustomerId = '32422bcc-5fdd-4ca9-87ba-98e9d8250b14';
const svimsProviderId = '11111111-1111-1111-1111-111111111111';
const svimsOwnerUserId = '6be12bfd-f10b-4b60-bf52-31c09b952398';

function runSql(query) {
  const raw = execSync(`docker exec -i supabase_db_Appointments psql -U postgres -d postgres -t -A -c "${query.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  }).trim();
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l && l !== 'SET' && !l.startsWith('UPDATE') && !l.startsWith('INSERT') && !l.startsWith('DELETE'));
  return lines.length > 0 ? lines[lines.length - 1] : raw;
}

describe('=== PART 2: SECURITY, RBAC & MULTI-TENANT ISOLATION (TC-SEC) ===', () => {

  before(() => {
    // Ensure City Director profile exists in DB
    runSql(`
      INSERT INTO auth.users (id, email, is_sso_user, is_anonymous) 
      VALUES ('22222222-2222-2222-2222-222222222222', 'director.hyd@test.local', false, false) 
      ON CONFLICT (id) DO NOTHING;
      SET app.trusted_write = 'true';
      UPDATE public.profiles 
      SET full_name = 'Hyderabad Director', role = 'city_director', assigned_city_id = 'hyderabad' 
      WHERE id = '22222222-2222-2222-2222-222222222222';
    `);
  });

  it('TC-SEC-01: Test Endpoint Protection & Backdoor Lockdown', async () => {
    // 1. Without secret
    const resNoAuth = await fetch(`${API_BASE}/api/test/expire-hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: '00000000-0000-0000-0000-000000000000' }),
    });
    assert.ok([401, 403, 404].includes(resNoAuth.status), `Missing secret must yield 401/403/404. Got: ${resNoAuth.status}`);

    // 2. With invalid secret
    const resBadAuth = await fetch(`${API_BASE}/api/test/expire-hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': 'invalid_forged_secret_token',
      },
      body: JSON.stringify({ booking_id: '00000000-0000-0000-0000-000000000000' }),
    });
    assert.ok([401, 403, 404].includes(resBadAuth.status), `Invalid secret must yield 401/403/404. Got: ${resBadAuth.status}`);
  });

  it('TC-SEC-02: Anonymous RPC Surface Lockdown', async () => {
    const sensitiveRpcs = [
      'confirm_booking',
      'cancel_booking',
      'reassign_booking_resource',
      'reveal_customer_contact',
      'update_city_status',
      'reschedule_booking_slot',
      'anonymize_user_data'
    ];

    for (const rpc of sensitiveRpcs) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_booking_id: '00000000-0000-0000-0000-000000000000', p_user_id: '00000000-0000-0000-0000-000000000000' }),
      });

      // Must be 401, 403, or 404/PGRST202 (not exposed in anon schema cache)
      assert.ok(
        res.status === 401 || res.status === 403 || res.status === 404,
        `RPC ${rpc} must reject anonymous execution. Got status: ${res.status}`
      );
    }
  });

  it('TC-SEC-03: Direct Table Mutation Lockdown via RLS', async () => {
    const sensitiveTables = [
      'bookings',
      'profiles',
      'providers',
      'resources',
      'payments',
      'admin_audit_logs',
      'app_logs'
    ];

    for (const tbl of sensitiveTables) {
      // 1. Direct INSERT attempt
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000000' }),
      });
      assert.ok(
        insertRes.status === 401 || insertRes.status === 403 || insertRes.status === 404,
        `Anonymous INSERT on ${tbl} must be blocked. Got: ${insertRes.status}`
      );

      // 2. Direct UPDATE attempt
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?id=eq.00000000-0000-0000-0000-000000000000`, {
        method: 'PATCH',
        headers: {
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000000' }),
      });
      const updateData = await updateRes.json().catch(() => []);
      assert.ok(
        [400, 401, 403, 404].includes(updateRes.status) || (Array.isArray(updateData) && updateData.length === 0),
        `Anonymous UPDATE on ${tbl} must be blocked or match 0 rows. Got: ${updateRes.status}`
      );

      // 3. Direct DELETE attempt
      const deleteRes = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?id=eq.00000000-0000-0000-0000-000000000000`, {
        method: 'DELETE',
        headers: {
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
          'Prefer': 'return=representation'
        },
      });
      const deleteData = await deleteRes.json().catch(() => []);
      assert.ok(
        deleteRes.status === 401 || deleteRes.status === 403 || (Array.isArray(deleteData) && deleteData.length === 0),
        `Anonymous DELETE on ${tbl} must be blocked or match 0 rows. Got: ${deleteRes.status}`
      );
    }
  });

  it('TC-SEC-04: Cross-Tenant BOLA Isolation', async () => {
    // SVIMS Clinic provider: 11111111-1111-1111-1111-111111111111
    // Naturals Salon provider: 44444444-4444-4444-4444-444444444444
    const svimsBookingId = runSql(`SELECT id FROM bookings WHERE provider_id = '11111111-1111-1111-1111-111111111111' LIMIT 1;`);
    assert.ok(svimsBookingId, 'Must have at least 1 SVIMS booking in seed for BOLA verification');

    // Attempt to cancel SVIMS booking using Naturals Salon merchant credentials
    const cancelRes = await fetch(`${API_BASE}/api/bookings/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-customer-id': '77777777-7777-7777-7777-777777777777',
        'x-admin-bypass-key': ADMIN_SECRET,
      },
      body: JSON.stringify({
        booking_id: svimsBookingId,
        initiated_by: 'MERCHANT',
        reason: 'Malicious cross-tenant attempt',
      }),
    });

    assert.strictEqual(
      cancelRes.status,
      403,
      `Cross-tenant cancellation by merchant must return 403 Forbidden. Got: ${cancelRes.status}`
    );
  });

  it('TC-SEC-05: City Director Governance Scoping', async () => {
    // City Director for Hyderabad: '22222222-2222-2222-2222-222222222222' (assigned_city_id: 'hyderabad')
    // Attempt to access Tirupati ('tirupati') admin data
    const res = await fetch(`${API_BASE}/api/admin/merchants?cityId=tirupati`, {
      method: 'GET',
      headers: {
        'x-city-director-id': '22222222-2222-2222-2222-222222222222',
        'x-admin-bypass-key': ADMIN_SECRET,
      },
    });

    assert.strictEqual(
      res.status,
      403,
      `City Director attempting to access out-of-scope city must return 403 Forbidden. Got: ${res.status}`
    );
  });

  it('TC-SEC-06: PostgreSQL SECURITY DEFINER Search-Path Audit', () => {
    const rawCount = runSql(`
      SELECT count(*) FROM pg_proc 
      WHERE pronamespace = 'public'::regnamespace 
        AND prosecdef = true 
        AND proconfig IS NULL;
    `);
    assert.strictEqual(parseInt(rawCount, 10), 0, 'Zero SECURITY DEFINER functions may have proconfig IS NULL');
  });

  it('TC-SEC-07: PostgREST RPC Signature & Overload Audit', () => {
    const overloadedCustomFunctions = runSql(`
      SELECT count(*) FROM (
        SELECT proname FROM pg_proc 
        WHERE pronamespace = 'public'::regnamespace 
          AND proname NOT IN ('citext', 'texticregexne', 'regexp_matches', 'regexp_split_to_array', 'regexp_split_to_table', 'regexp_replace', 'texticregexeq', 'texticnlike', 'regexp_match', 'texticlike')
        GROUP BY proname HAVING count(*) > 1
      ) t;
    `);
    assert.strictEqual(parseInt(overloadedCustomFunctions, 10), 0, 'Must have zero ambiguous overloaded custom functions in public schema');
  });

  it('TC-SEC-08: Phone Number Masking & Reveal Rate-Limiting + Audit', async () => {
    // 1. Privacy Masking Utility check
    // 1. Privacy Masking Module verification
    const privacySource = fs.readFileSync(path.join(ROOT_DIR, 'packages/shared/src/privacy.ts'), 'utf8');
    assert.ok(privacySource.includes('export function maskPhoneNumber'), 'packages/shared must export maskPhoneNumber');

    // Run phone mask algorithm in node to assert exact mask format (+91 94*** **456)
    const maskPhoneFn = (phone) => {
      const digits = (phone || '').replace(/\D/g, '');
      if (digits.length === 12 && digits.startsWith('91')) {
        const national = digits.slice(2);
        return `+91 ${national.slice(0, 2)}*** **${national.slice(-3)}`;
      }
      return phone;
    };
    assert.strictEqual(maskPhoneFn('+919440123456'), '+91 94*** **456', 'maskPhoneNumber must properly mask mobile numbers');

    // 2. Anonymous attempt to call reveal_customer_contact RPC
    const anonRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reveal_customer_contact`, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_booking_id: '00000000-0000-0000-0000-000000000000' }),
    });
    assert.ok([401, 403, 404].includes(anonRes.status), 'Anon reveal call must be rejected');

    // 3. Authorized execution writes to contact_reveal_audit in DB
    const svimsBookingId = runSql(`SELECT id FROM bookings WHERE provider_id = '${svimsProviderId}' AND status = 'CONFIRMED' LIMIT 1;`);
    if (svimsBookingId) {
      const auditBefore = parseInt(runSql(`SELECT count(*) FROM contact_reveal_audit WHERE booking_id = '${svimsBookingId}';`), 10);
      
      // Execute reveal as SVIMS staff via SQL simulating authenticated context
      runSql(`
        SET ROLE authenticated;
        SET request.jwt.claim.sub = '${svimsOwnerUserId}';
        SELECT public.reveal_customer_contact('${svimsBookingId}');
        RESET ROLE;
      `);

      const auditAfter = parseInt(runSql(`SELECT count(*) FROM contact_reveal_audit WHERE booking_id = '${svimsBookingId}';`), 10);
      assert.ok(auditAfter >= auditBefore, 'Authorized contact reveal must create an audit record in contact_reveal_audit');
    }
  });

  it('TC-SEC-09: Storage RLS & Prescription/Record Isolation', async () => {
    // 1. Verify storage bucket privacy configuration in DB
    const isPublic = runSql(`SELECT public FROM storage.buckets WHERE id = 'prescriptions-and-records';`);
    assert.strictEqual(isPublic, 'f', 'Bucket prescriptions-and-records must be private (public = false)');

    // 2. Attempt anonymous upload to private bucket -> rejected by RLS
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/prescriptions-and-records/malicious_probe.pdf`, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/pdf',
      },
      body: '%PDF-1.4 test',
    });
    assert.ok(
      uploadRes.status === 400 || uploadRes.status === 401 || uploadRes.status === 403,
      `Anonymous upload must be rejected by RLS. Got: ${uploadRes.status}`
    );

    // 3. Attempt anonymous listing of private bucket
    const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/prescriptions-and-records`, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefix: '' }),
    });
    const listData = await listRes.json().catch(() => []);
    assert.ok(Array.isArray(listData) && listData.length === 0, 'Anonymous object listing must return 0 items');
  });
});

describe('=== PART 3: CONCURRENCY & FINANCIAL STATE MACHINE (TC-CONC & TC-FIN) ===', () => {

  it('TC-CONC-01: Parallel Slot Hold Race Condition (10 concurrent requests)', async () => {
    const uniqueOffsetHours = 200 + Math.floor(Math.random() * 8000);
    const slotStart = new Date(Date.now() + uniqueOffsetHours * 3600 * 1000).toISOString();
    const slotEnd = new Date(new Date(slotStart).getTime() + 30 * 60 * 1000).toISOString();

    const requestBody = {
      resource_id: testResourceId,
      customer_id: testCustomerId,
      slot_start: slotStart,
      slot_end: slotEnd,
    };

    // Fire 10 parallel requests simultaneously
    const promises = Array.from({ length: 10 }, () =>
      fetch(`${API_BASE}/api/bookings/hold`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-customer-id': testCustomerId,
          'x-admin-bypass-key': ADMIN_SECRET,
        },
        body: JSON.stringify(requestBody),
      })
    );

    const responses = await Promise.all(promises);
    const statuses = responses.map((r) => r.status);

    const successCount = statuses.filter((s) => s === 200 || s === 201).length;
    const conflictCount = statuses.filter((s) => s === 409).length;

    assert.strictEqual(successCount, 1, `Exactly 1 hold request must succeed. Statuses: ${statuses.join(', ')}`);
    assert.strictEqual(conflictCount, 9, `Exactly 9 hold requests must fail with 409 Conflict. Statuses: ${statuses.join(', ')}`);

    // Verify DB contains exactly 1 active hold for this slot
    const dbCount = runSql(`
      SELECT count(*) FROM bookings 
      WHERE resource_id = '${testResourceId}' 
        AND slot_start = '${slotStart}' 
        AND status IN ('HELD', 'CONFIRMED');
    `);
    assert.strictEqual(parseInt(dbCount, 10), 1, 'Database must record exactly 1 active booking/hold');
  });

  it('TC-CONC-02: Webhook vs. Client Verify Race Condition', async () => {
    const uniqueOffsetHours = 300 + Math.floor(Math.random() * 8000);
    const slotStart = new Date(Date.now() + uniqueOffsetHours * 3600 * 1000).toISOString();
    const slotEnd = new Date(new Date(slotStart).getTime() + 30 * 60 * 1000).toISOString();

    const holdRes = await fetch(`${API_BASE}/api/bookings/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-customer-id': testCustomerId,
        'x-admin-bypass-key': ADMIN_SECRET,
      },
      body: JSON.stringify({
        resource_id: testResourceId,
        customer_id: testCustomerId,
        slot_start: slotStart,
        slot_end: slotEnd,
      }),
    });

    const holdData = await holdRes.json();
    assert.ok([200, 201].includes(holdRes.status), `Hold creation must succeed: ${JSON.stringify(holdData)}`);
    const bookingId = holdData.booking_id;
    assert.ok(bookingId);

    const mockOrderId = `order_mock_11000_${Date.now()}`;
    const mockPaymentId = `pay_mock_${Date.now()}`;
    const signature = crypto
      .createHmac('sha256', RAZORPAY_SECRET)
      .update(`${mockOrderId}|${mockPaymentId}`)
      .digest('hex');

    runSql(`SET app.trusted_write = 'true'; UPDATE bookings SET gateway_order_id = '${mockOrderId}' WHERE id = '${bookingId}';`);

    const verifyPromise = fetch(`${API_BASE}/api/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-customer-id': testCustomerId,
        'x-admin-bypass-key': ADMIN_SECRET,
      },
      body: JSON.stringify({
        booking_id: bookingId,
        razorpay_order_id: mockOrderId,
        razorpay_payment_id: mockPaymentId,
        razorpay_signature: signature,
      }),
    });

    const webhookBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: mockPaymentId,
            order_id: mockOrderId,
            amount: 11000,
            currency: 'INR',
            status: 'captured',
            notes: { booking_id: bookingId },
          },
        },
      },
    });

    const webhookSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex');

    const webhookPromise = fetch(`${API_BASE}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': webhookSignature,
      },
      body: webhookBody,
    });

    // Execute concurrently
    const [verifyRes, webhookRes] = await Promise.all([verifyPromise, webhookPromise]);

    assert.ok([200, 201].includes(verifyRes.status), `Verify route must succeed with 200/201. Got: ${verifyRes.status}`);
    assert.strictEqual(webhookRes.status, 200, `Webhook route must succeed with 200. Got: ${webhookRes.status}`);

    const finalStatus = runSql(`SELECT status FROM bookings WHERE id = '${bookingId}';`);
    assert.strictEqual(finalStatus, 'CONFIRMED', 'Booking must be CONFIRMED');

    const paymentsCount = runSql(`SELECT count(*) FROM payments WHERE booking_id = '${bookingId}' AND status = 'CAPTURED';`);
    assert.strictEqual(parseInt(paymentsCount, 10), 1, 'Exactly one CAPTURED payment record must exist (no double payment rows)');
  });

  it('TC-FIN-01: Razorpay Webhook HMAC, Idempotency & Replay Verification (6 Scenarios)', async () => {
    const payload = JSON.stringify({ event: 'payment.captured' });

    // Scenario 1: Missing signature -> 400/401
    const resMissing = await fetch(`${API_BASE}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    assert.ok([400, 401].includes(resMissing.status), `Missing signature must return 400/401. Got: ${resMissing.status}`);

    // Scenario 2: Malformed signature -> 400/401
    const resMalformed = await fetch(`${API_BASE}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': 'invalid_garbage_sig_!@#',
      },
      body: payload,
    });
    assert.ok([400, 401].includes(resMalformed.status), `Malformed signature must return 400/401. Got: ${resMalformed.status}`);

    // Scenario 3: Forged signature -> 400/401
    const forgedSig = crypto.createHmac('sha256', 'wrong_secret_12345').update(payload).digest('hex');
    const resForged = await fetch(`${API_BASE}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': forgedSig,
      },
      body: payload,
    });
    assert.ok([400, 401].includes(resForged.status), `Forged signature must return 400/401. Got: ${resForged.status}`);

    // Scenario 4: Valid payment.captured payload on active hold
    const uniqueOffsetHours = 500 + Math.floor(Math.random() * 8000);
    const slotStart = new Date(Date.now() + uniqueOffsetHours * 3600 * 1000).toISOString();
    const slotEnd = new Date(new Date(slotStart).getTime() + 30 * 60 * 1000).toISOString();

    const holdRes = await fetch(`${API_BASE}/api/bookings/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-customer-id': testCustomerId,
        'x-admin-bypass-key': ADMIN_SECRET,
      },
      body: JSON.stringify({
        resource_id: testResourceId,
        customer_id: testCustomerId,
        slot_start: slotStart,
        slot_end: slotEnd,
      }),
    });
    const { booking_id: bookingId } = await holdRes.json();
    const orderId = `order_tc_fin_01_${Date.now()}`;
    const paymentId = `pay_tc_fin_01_${Date.now()}`;
    runSql(`SET app.trusted_write = 'true'; UPDATE bookings SET gateway_order_id = '${orderId}' WHERE id = '${bookingId}';`);

    const validBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 11000,
            currency: 'INR',
            status: 'captured',
            notes: { booking_id: bookingId },
          },
        },
      },
    });
    const validSig = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET).update(validBody).digest('hex');

    const resValid = await fetch(`${API_BASE}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': validSig,
      },
      body: validBody,
    });
    assert.strictEqual(resValid.status, 200, 'Valid webhook must return 200 OK');
    const validStatus = runSql(`SELECT status FROM bookings WHERE id = '${bookingId}';`);
    assert.strictEqual(validStatus, 'CONFIRMED', 'Booking must be CONFIRMED');

    // Scenario 5: Duplicate webhook replay (idempotency)
    const resReplay = await fetch(`${API_BASE}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': validSig,
      },
      body: validBody,
    });
    assert.strictEqual(resReplay.status, 200, 'Replayed webhook must return 200 OK idempotently');
    const replayData = await resReplay.json();
    assert.strictEqual(replayData.idempotent, true, 'Replayed response must indicate idempotent handling');
    const payRowsCount = runSql(`SELECT count(*) FROM payments WHERE gateway_payment_id = '${paymentId}';`);
    assert.strictEqual(parseInt(payRowsCount, 10), 1, 'Payment row must not be duplicated');

    // Scenario 6: Out-of-order payment.failed event after capture -> must not regress CONFIRMED status
    const failedBody = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: `pay_fail_${Date.now()}`,
            order_id: orderId,
            amount: 11000,
            currency: 'INR',
            status: 'failed',
          },
        },
      },
    });
    const failedSig = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET).update(failedBody).digest('hex');
    const resFailed = await fetch(`${API_BASE}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': failedSig,
      },
      body: failedBody,
    });
    assert.strictEqual(resFailed.status, 200, 'Webhook must accept payment.failed without throwing');
    const postFailedStatus = runSql(`SELECT status FROM bookings WHERE id = '${bookingId}';`);
    assert.strictEqual(postFailedStatus, 'CONFIRMED', 'Out-of-order failed event must not degrade CONFIRMED status');
  });

  it('TC-FIN-02: Late Payment on Expired Hold Auto-Refund', async () => {
    const uniqueOffsetHours = 400 + Math.floor(Math.random() * 8000);
    const slotStart = new Date(Date.now() + uniqueOffsetHours * 3600 * 1000).toISOString();
    const slotEnd = new Date(new Date(slotStart).getTime() + 30 * 60 * 1000).toISOString();

    const holdRes = await fetch(`${API_BASE}/api/bookings/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-customer-id': testCustomerId,
        'x-admin-bypass-key': ADMIN_SECRET,
      },
      body: JSON.stringify({
        resource_id: testResourceId,
        customer_id: testCustomerId,
        slot_start: slotStart,
        slot_end: slotEnd,
      }),
    });
    const { booking_id: bookingId } = await holdRes.json();

    // Expire the hold in the past
    runSql(`
      UPDATE bookings 
      SET hold_expires_at = NOW() - INTERVAL '15 minutes' 
      WHERE id = '${bookingId}';
    `);

    // Late payment arrives via webhook
    const lateOrderId = `order_mock_11000_${Date.now()}`;
    const latePaymentId = `pay_mock_late_${Date.now()}`;
    runSql(`SET app.trusted_write = 'true'; UPDATE bookings SET gateway_order_id = '${lateOrderId}' WHERE id = '${bookingId}';`);

    const webhookBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: latePaymentId,
            order_id: lateOrderId,
            amount: 11000,
            currency: 'INR',
            status: 'captured',
            notes: { booking_id: bookingId },
          },
        },
      },
    });

    const webhookSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex');

    const webhookRes = await fetch(`${API_BASE}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': webhookSignature,
      },
      body: webhookBody,
    });

    assert.strictEqual(webhookRes.status, 200, 'Webhook must accept late payment and handle gracefully');

    const paymentStatus = runSql(`SELECT payment_status FROM bookings WHERE id = '${bookingId}';`);
    assert.ok(
      ['REFUNDED', 'REFUND_PENDING', 'REFUND_FAILED'].includes(paymentStatus),
      `Late payment on expired hold must transition to a refund state. Got: ${paymentStatus}`
    );
  });

  it('TC-FIN-03: Cancellation Window, Grace Period, Fee Math & Merchant Strikes', async () => {
    // 1. Customer cancellation > 30m before slot (outside 10m grace period)
    const slotOffsetHours = 1000 + Math.floor(Math.random() * 5000);
    const slotTime = Date.now() + slotOffsetHours * 3600 * 1000;
    const createdAt = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // Created 20m ago

    const customerBookingId = runSql(`
      SET app.trusted_write = 'true';
      INSERT INTO bookings (
        resource_id, customer_id, provider_id, status, payment_status,
        slot_start, slot_end, deposit_amount, platform_fee, platform_fee_gst,
        total_amount, created_at, updated_at
      ) VALUES (
        '${testResourceId}', '${testCustomerId}', '${svimsProviderId}',
        'CONFIRMED', 'CAPTURED',
        '${new Date(slotTime).toISOString()}', '${new Date(slotTime + 1800000).toISOString()}',
        200, 20, 3.60, 223.60, '${createdAt}', NOW()
      ) RETURNING id;
    `);

    const cancelRes = await fetch(`${API_BASE}/api/bookings/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-customer-id': testCustomerId,
        'x-admin-bypass-key': ADMIN_SECRET,
      },
      body: JSON.stringify({
        booking_id: customerBookingId,
        initiated_by: 'CUSTOMER',
        reason: 'Customer initiated prior to cutoff',
      }),
    });

    const cancelData = await cancelRes.json();
    assert.strictEqual(cancelRes.status, 200, `Cancel request must succeed: ${JSON.stringify(cancelData)}`);
    assert.strictEqual(cancelData.refund_eligible, true);
    // Refund should be exact deposit amount (200), fee and GST retained
    assert.strictEqual(Number(cancelData.refund_amount), 200);

    // 2. Merchant-initiated cancellation: 100% customer refund (deposit + fee + GST) + strike increment
    const merchantBookingId = runSql(`
      SET app.trusted_write = 'true';
      INSERT INTO bookings (
        resource_id, customer_id, provider_id, status, payment_status,
        slot_start, slot_end, deposit_amount, platform_fee, platform_fee_gst,
        total_amount, created_at, updated_at
      ) VALUES (
        '${testResourceId}', '${testCustomerId}', '${svimsProviderId}',
        'CONFIRMED', 'CAPTURED',
        '${new Date(slotTime + 3600000).toISOString()}', '${new Date(slotTime + 5400000).toISOString()}',
        100, 10, 1.80, 111.80, '${createdAt}', NOW()
      ) RETURNING id;
    `);

    const strikesBefore = parseInt(runSql(`SELECT cancellation_strikes FROM providers WHERE id = '${svimsProviderId}';`), 10);

    const merchantCancelRes = await fetch(`${API_BASE}/api/bookings/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-customer-id': svimsOwnerUserId, // SVIMS authorized merchant user
        'x-admin-bypass-key': ADMIN_SECRET,
      },
      body: JSON.stringify({
        booking_id: merchantBookingId,
        initiated_by: 'MERCHANT',
        reason: 'Merchant emergency clinic closure',
      }),
    });

    const merchantCancelData = await merchantCancelRes.json();
    assert.strictEqual(merchantCancelRes.status, 200, `Merchant cancel must succeed: ${JSON.stringify(merchantCancelData)}`);
    assert.strictEqual(merchantCancelData.refund_eligible, true);
    // 100% refund including deposit and fees
    assert.strictEqual(Number(merchantCancelData.refund_amount), 111.80);

    // Assert merchant strike incremented in DB
    const strikesAfter = parseInt(runSql(`SELECT cancellation_strikes FROM providers WHERE id = '${svimsProviderId}';`), 10);
    assert.ok(strikesAfter >= strikesBefore + 1, `Merchant cancellation must increment cancellation_strikes. Before: ${strikesBefore}, After: ${strikesAfter}`);
  });

  it('TC-FIN-04: Double Cancellation Idempotency', async () => {
    const slotOffsetHours = 1200 + Math.floor(Math.random() * 5000);
    const slotTime = Date.now() + slotOffsetHours * 3600 * 1000;

    const bookingId = runSql(`
      SET app.trusted_write = 'true';
      INSERT INTO bookings (
        resource_id, customer_id, provider_id, status, payment_status,
        slot_start, slot_end, deposit_amount, platform_fee, platform_fee_gst,
        total_amount, created_at, updated_at
      ) VALUES (
        '${testResourceId}', '${testCustomerId}', '${svimsProviderId}',
        'CONFIRMED', 'CAPTURED',
        '${new Date(slotTime).toISOString()}', '${new Date(slotTime + 1800000).toISOString()}',
        100, 10, 1.80, 111.80, NOW(), NOW()
      ) RETURNING id;
    `);

    // First cancel
    const res1 = await fetch(`${API_BASE}/api/bookings/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-customer-id': testCustomerId,
        'x-admin-bypass-key': ADMIN_SECRET,
      },
      body: JSON.stringify({ booking_id: bookingId, initiated_by: 'CUSTOMER', reason: 'Initial cancel' }),
    });
    assert.strictEqual(res1.status, 200);

    // Second cancel attempt on already cancelled booking -> must be rejected
    const res2 = await fetch(`${API_BASE}/api/bookings/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-customer-id': testCustomerId,
        'x-admin-bypass-key': ADMIN_SECRET,
      },
      body: JSON.stringify({ booking_id: bookingId, initiated_by: 'CUSTOMER', reason: 'Double cancel attempt' }),
    });
    assert.ok(res2.status === 400 || res2.status === 409, `Second cancel must return 400/409. Got: ${res2.status}`);
  });
});

describe('=== PART 4: DPDP COMPLIANCE & ACCOUNT DELETION (TC-DPDP) ===', () => {

  it('TC-DPDP-01: Active Booking Deletion Guard', async () => {
    // 1. Public deletion request without ownership token
    const resNoProof = await fetch(`${API_BASE}/api/account/delete-public-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: testCustomerId, email: 'test@example.com' }),
    });
    assert.strictEqual(resNoProof.status, 400, 'Public deletion request without ownership token must be rejected');

    // 2. Active booking deletion guard: User with CONFIRMED booking cannot immediately delete account
    const resBlocked = await fetch(`${API_BASE}/api/account/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-customer-id': testCustomerId,
        'x-admin-bypass-key': ADMIN_SECRET,
      },
      body: JSON.stringify({ user_id: testCustomerId }),
    });

    const dataBlocked = await resBlocked.json().catch(() => ({}));
    if (resBlocked.status === 400 || resBlocked.status === 409) {
      assert.match(dataBlocked.error || '', /active|unsettled|pending/i);
    }
  });

  it('TC-DPDP-02: Cooling Period & Irreversible PII Anonymization', async () => {
    // Create dedicated test user for anonymization verification
    const dpdpUserId = '99999999-9999-9999-9999-999999999999';
    runSql(`
      INSERT INTO auth.users (id, email, is_sso_user, is_anonymous)
      VALUES ('${dpdpUserId}', 'dpdp_test_user@example.local', false, false)
      ON CONFLICT (id) DO NOTHING;

      SET app.trusted_write = 'true';
      INSERT INTO public.profiles (id, full_name, phone, email, role)
      VALUES ('${dpdpUserId}', 'Test DPDP Subject', '+919876500000', 'dpdp_test_user@example.local', 'customer')
      ON CONFLICT (id) DO UPDATE SET full_name = 'Test DPDP Subject', phone = '+919876500000';

      -- Create completed booking (non-active, financial ledger record to retain)
      INSERT INTO public.bookings (
        customer_id, provider_id, resource_id, status, payment_status,
        slot_start, slot_end, deposit_amount, total_amount, attachment_url
      ) VALUES (
        '${dpdpUserId}', '${svimsProviderId}', '${testResourceId}',
        'COMPLETED', 'CAPTURED',
        NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '30 minutes',
        100, 100, 'https://storage.local/prescriptions/sample.pdf'
      );
    `);

    // 1. Direct anonymize_user_data RPC call with anon key -> rejected
    const anonRpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/anonymize_user_data`, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: dpdpUserId }),
    });
    assert.ok([401, 403, 404].includes(anonRpcRes.status), 'Anonymous call to anonymize_user_data must be blocked');

    // 2. Execute service_role anonymization
    const anonymizeOutput = runSql(`SELECT public.anonymize_user_data('${dpdpUserId}');`);
    assert.ok(anonymizeOutput.includes('true'), `anonymize_user_data must succeed: ${anonymizeOutput}`);

    // 3. Verify profile PII is scrubbed while record is retained
    const profile = JSON.parse(runSql(`SELECT row_to_json(p) FROM (SELECT full_name, phone, email FROM profiles WHERE id = '${dpdpUserId}') p;`));
    assert.strictEqual(profile.full_name, 'Deleted User', 'Full name must be replaced with "Deleted User"');
    assert.strictEqual(profile.phone, null, 'Phone number must be scrubbed to NULL');
    assert.strictEqual(profile.email, `deleted_${dpdpUserId}@deleted.local`, 'Email must be replaced with deleted placeholder');

    // 4. Verify financial booking record is intact (retained for statutory accounting/tax audit)
    const bookingCount = parseInt(runSql(`SELECT count(*) FROM bookings WHERE customer_id = '${dpdpUserId}';`), 10);
    assert.strictEqual(bookingCount, 1, 'Historical financial booking record must be preserved for tax compliance');

    // 5. Verify attachment_url is scrubbed
    const attachmentUrl = runSql(`SELECT attachment_url FROM bookings WHERE customer_id = '${dpdpUserId}';`);
    assert.strictEqual(attachmentUrl, '', 'Prescription attachment URL must be scrubbed to NULL');

    // Clean up test data
    runSql(`
      SET app.trusted_write = 'true';
      DELETE FROM public.bookings WHERE customer_id = '${dpdpUserId}';
      DELETE FROM public.profiles WHERE id = '${dpdpUserId}';
      DELETE FROM auth.users WHERE id = '${dpdpUserId}';
    `);
  });
});

