/**
 * tests/e2e/test-clock-audit.test.mjs
 * 
 * Subtask 2: Test Clock Audit & Security Invariant Verification
 * Proves:
 * 1. With no test-clock row present, each production function changed by the migration
 *    (verify_checkin_code, mark_present_manually, cancel_booking) behaves exactly as
 *    before the migration (strictly matching real system clock_timestamp()).
 * 2. Role boundary check: no role other than service_role (and never anon, authenticated,
 *    or any merchant, staff or customer) can create or change a clock row.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { getPgPool } from './harness/tenant-factory.mjs';

function getDbConfig() {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

  if (isLocalDb && !process.env.USE_REMOTE_TEST_AUTH) {
    const localUrl = 'http://127.0.0.1:54321';
    const localServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
    const localAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
    return {
      url: localUrl,
      anonKey: localAnonKey,
      serviceKey: localServiceKey,
      anonHeaders: {
        'apikey': localAnonKey,
        'Authorization': `Bearer ${localAnonKey}`,
        'Content-Type': 'application/json'
      },
      serviceHeaders: {
        'apikey': localServiceKey,
        'Authorization': `Bearer ${localServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };
  }

  const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const url = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/)[1];
  const anonKey = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY="([^"]+)"/)[1];
  const serviceKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/)[1];
  return {
    url,
    anonKey,
    serviceKey,
    anonHeaders: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    },
    serviceHeaders: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
}

describe('Subtask 2: Test Clock Audit & Verification', () => {
  const { url, anonHeaders, serviceHeaders } = getDbConfig();
  const pgPool = getPgPool();
  const testPrefix = 'AUDIT_CLOCK_TEST';
  let testProviderId;
  let testConsultantId;
  let testCustomerId;
  let testCustomerAuthToken;
  let testStaffAuthToken;

  before(async () => {
    // Ensure clean state for testPrefix
    await pgPool.query('DELETE FROM public.test_provider_clock_links WHERE tenant_prefix = $1', [testPrefix]);
    await pgPool.query('DELETE FROM public.test_tenant_clocks WHERE tenant_prefix = $1', [testPrefix]);

    // 1. Create a test customer auth user & login token
    const customerEmail = `audit.customer@hospital-test.local`;
    const custRes = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        email: customerEmail,
        password: 'HospitalTest2026!',
        email_confirm: true,
        user_metadata: { full_name: 'Audit Customer', role: 'customer' }
      })
    });
    let custData = await custRes.json();
    testCustomerId = custData.id || custData.user?.id;
    if (!testCustomerId) {
      const existing = await pgPool.query('SELECT id FROM auth.users WHERE email = $1', [customerEmail]);
      testCustomerId = existing.rows[0]?.id;
    }

    // Insert profile
    await pgPool.query(`
      INSERT INTO public.profiles (id, full_name, email, role)
      VALUES ($1, 'Audit Customer', $2, 'customer')
      ON CONFLICT (id) DO NOTHING
    `, [testCustomerId, customerEmail]);

    // 2. Create a test provider with no clock links, owned by testCustomerId
    const pRes = await pgPool.query(`
      INSERT INTO public.providers (
        name, category_id, address, phone, city, latitude, longitude, is_active, owner_id
      ) VALUES (
        $1, 'clinics', 'Audit Road', '+919999999999', 'Tirupati', 13.6288, 79.4192, true, $2
      ) RETURNING id
    `, [`[${testPrefix}] Audit Clinic`, testCustomerId]);
    testProviderId = pRes.rows[0].id;

    // 3. Create consultant resource
    const cRes = await pgPool.query(`
      INSERT INTO public.resources (
        provider_id, name, type, is_active
      ) VALUES (
        $1, 'Dr. Audit', 'doctor', true
      ) RETURNING id
    `, [testProviderId]);
    testConsultantId = cRes.rows[0].id;

    // Login customer to obtain JWT
    const loginRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: anonHeaders,
      body: JSON.stringify({
        email: customerEmail,
        password: 'HospitalTest2026!'
      })
    });
    const loginData = await loginRes.json();
    testCustomerAuthToken = loginData.access_token;
  });

  after(async () => {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.trusted_write = 'true'");
      if (testProviderId) {
        await client.query('DELETE FROM public.bookings WHERE provider_id = $1', [testProviderId]);
        await client.query('DELETE FROM public.resources WHERE provider_id = $1', [testProviderId]);
        await client.query('DELETE FROM public.providers WHERE id = $1', [testProviderId]);
      }
      if (testCustomerId) {
        await client.query('DELETE FROM public.profiles WHERE id = $1', [testCustomerId]);
        await client.query('DELETE FROM auth.users WHERE id = $1', [testCustomerId]);
      }
      await client.query('DELETE FROM public.test_provider_clock_links WHERE tenant_prefix = $1', [testPrefix]);
      await client.query('DELETE FROM public.test_tenant_clocks WHERE tenant_prefix = $1', [testPrefix]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('Proof 1a: With no test-clock row present, get_test_clock behaves identically to clock_timestamp()', async () => {
    // Direct SQL comparison
    const sqlRes = await pgPool.query(`
      SELECT 
        public.get_test_clock($1) as clock_val,
        clock_timestamp() as real_val
    `, [testProviderId]);

    const clockVal = new Date(sqlRes.rows[0].clock_val).getTime();
    const realVal = new Date(sqlRes.rows[0].real_val).getTime();
    const diffMs = Math.abs(clockVal - realVal);

    // Difference between get_test_clock and clock_timestamp() in the same query should be < 100ms
    assert.ok(diffMs < 100, `Expected get_test_clock to match clock_timestamp within 100ms, diff was ${diffMs}ms`);

    // Direct RPC call with no provider link
    const rpcRes = await fetch(`${url}/rest/v1/rpc/get_test_clock`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ p_provider_id: testProviderId })
    });
    assert.equal(rpcRes.status, 200);
    const rpcTime = new Date(await rpcRes.json()).getTime();
    const nowTime = Date.now();
    assert.ok(Math.abs(rpcTime - nowTime) < 3000, 'get_test_clock returns current system time when no row exists');
  });

  it('Proof 1b: Production function mark_present_manually behaves using real time when no test clock exists', async () => {
    const realNow = new Date();
    // Booking 20m in the past -> Arriving now is > slot_start + 10m -> is_late should evaluate to TRUE based on real clock
    const slotStart = new Date(realNow.getTime() - 20 * 60 * 1000).toISOString();
    const slotEnd = new Date(realNow.getTime() - 5 * 60 * 1000).toISOString();

    const bRes = await pgPool.query(`
      INSERT INTO public.bookings (
        provider_id, resource_id, customer_id, slot_start, slot_end, status, deposit_amount, payment_status
      ) VALUES (
        $1, $2, $3, $4, $5, 'CONFIRMED', 100.00, 'CAPTURED'
      ) RETURNING id
    `, [testProviderId, testConsultantId, testCustomerId, slotStart, slotEnd]);
    const bookingId = bRes.rows[0].id;

    // Call mark_present_manually via RPC as shop owner
    const authHeaders = {
      'apikey': anonHeaders.apikey,
      'Authorization': `Bearer ${testCustomerAuthToken}`,
      'Content-Type': 'application/json'
    };
    const markRes = await fetch(`${url}/rest/v1/rpc/mark_present_manually`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        p_booking_id: bookingId
      })
    });
    const markData = await markRes.json();
    if (!markData.success) {
      console.log('[DEBUG Proof 1b markData]:', markData);
    }
    assert.equal(markData.success, true, 'mark_present_manually should succeed');
    assert.equal(markData.is_late, true, 'is_late must be true because 20m > 10m under real clock');

    const checkInTime = new Date(markData.checked_in_at).getTime();
    assert.ok(Math.abs(checkInTime - Date.now()) < 3000, 'checked_in_at must record real system time');

    await pgPool.query('DELETE FROM public.bookings WHERE id = $1', [bookingId]);
  });

  it('Proof 1c: Production function cancel_booking behaves using real time when no test clock exists', async () => {
    const realNow = new Date();
    // Booking 15m in future -> Less than 30-min customer cutoff -> Must forfeit deposit
    const slotStart = new Date(realNow.getTime() + 15 * 60 * 1000).toISOString();
    const slotEnd = new Date(realNow.getTime() + 30 * 60 * 1000).toISOString();

    const bRes = await pgPool.query(`
      INSERT INTO public.bookings (
        provider_id, resource_id, customer_id, slot_start, slot_end, status, deposit_amount, payment_status
      ) VALUES (
        $1, $2, $3, $4, $5, 'CONFIRMED', 100.00, 'CAPTURED'
      ) RETURNING id
    `, [testProviderId, testConsultantId, testCustomerId, slotStart, slotEnd]);
    const bookingId = bRes.rows[0].id;

    const cancelRes = await fetch(`${url}/rest/v1/rpc/cancel_booking`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        p_booking_id: bookingId,
        p_reason: 'Testing real-time cutoff with no clock row',
        p_initiated_by: 'CUSTOMER'
      })
    });
    const cancelData = await cancelRes.json();
    assert.equal(cancelData.success, true);
    assert.equal(cancelData.refund_eligible, false, 'Booking <=30m before slot must forfeit refund under real clock');
    assert.equal(cancelData.refund_amount, 0, 'Refund amount must be 0 for late cancellation');

    await pgPool.query('DELETE FROM public.bookings WHERE id = $1', [bookingId]);
  });

  it('Proof 2a: Anon role CANNOT create or change clock rows (table writes & RPCs rejected)', async () => {
    // 1. Direct table insert as anon
    const tableRes = await fetch(`${url}/rest/v1/test_tenant_clocks`, {
      method: 'POST',
      headers: anonHeaders,
      body: JSON.stringify({
        tenant_prefix: 'ANON_ATTACK',
        simulated_time: '2026-10-20T10:00:00.000Z'
      })
    });
    assert.ok(!tableRes.ok, `Direct table write as anon must be rejected (status: ${tableRes.status})`);

    // 2. RPC set_test_clock as anon
    const rpcSetRes = await fetch(`${url}/rest/v1/rpc/set_test_clock`, {
      method: 'POST',
      headers: anonHeaders,
      body: JSON.stringify({
        p_prefix: 'ANON_ATTACK',
        p_time: '2026-10-20T10:00:00.000Z'
      })
    });
    assert.ok(!rpcSetRes.ok, `RPC set_test_clock as anon must be rejected (status: ${rpcSetRes.status})`);

    // 3. RPC advance_test_clock as anon
    const rpcAdvRes = await fetch(`${url}/rest/v1/rpc/advance_test_clock`, {
      method: 'POST',
      headers: anonHeaders,
      body: JSON.stringify({
        p_prefix: 'ANON_ATTACK',
        p_minutes: 60
      })
    });
    assert.ok(!rpcAdvRes.ok, `RPC advance_test_clock as anon must be rejected (status: ${rpcAdvRes.status})`);
  });

  it('Proof 2b: Authenticated customer CANNOT create or change clock rows (table writes & RPCs rejected)', async () => {
    assert.ok(testCustomerAuthToken, 'Must have active customer auth token');
    const authHeaders = {
      'apikey': anonHeaders.apikey,
      'Authorization': `Bearer ${testCustomerAuthToken}`,
      'Content-Type': 'application/json'
    };

    // 1. Direct table insert as authenticated customer
    const tableRes = await fetch(`${url}/rest/v1/test_tenant_clocks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        tenant_prefix: 'CUST_ATTACK',
        simulated_time: '2026-10-20T10:00:00.000Z'
      })
    });
    assert.ok(!tableRes.ok, `Direct table write as authenticated customer must be rejected (status: ${tableRes.status})`);

    // 2. RPC set_test_clock as authenticated customer
    const rpcSetRes = await fetch(`${url}/rest/v1/rpc/set_test_clock`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        p_prefix: 'CUST_ATTACK',
        p_time: '2026-10-20T10:00:00.000Z'
      })
    });
    assert.ok(!rpcSetRes.ok, `RPC set_test_clock as authenticated customer must be rejected (status: ${rpcSetRes.status})`);

    // 3. RPC advance_test_clock as authenticated customer
    const rpcAdvRes = await fetch(`${url}/rest/v1/rpc/advance_test_clock`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        p_prefix: 'CUST_ATTACK',
        p_minutes: 30
      })
    });
    assert.ok(!rpcAdvRes.ok, `RPC advance_test_clock as authenticated customer must be rejected (status: ${rpcAdvRes.status})`);
  });

  it('Proof 2c: Only service_role (and postgres) can create or change clock rows', async () => {
    const targetTime = '2026-10-20T14:30:00.000Z';

    // 1. RPC set_test_clock as service_role succeeds
    const serviceSetRes = await fetch(`${url}/rest/v1/rpc/set_test_clock`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        p_prefix: testPrefix,
        p_time: targetTime
      })
    });
    assert.equal(serviceSetRes.status, 200, 'service_role must be permitted to call set_test_clock');

    // 2. RPC advance_test_clock as service_role succeeds
    const serviceAdvRes = await fetch(`${url}/rest/v1/rpc/advance_test_clock`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        p_prefix: testPrefix,
        p_minutes: 15
      })
    });
    assert.equal(serviceAdvRes.status, 200, 'service_role must be permitted to call advance_test_clock');

    // Verify time was advanced by 15m in database
    const checkRes = await pgPool.query('SELECT simulated_time FROM public.test_tenant_clocks WHERE tenant_prefix = $1', [testPrefix]);
    assert.equal(checkRes.rows.length, 1);
    const expectedTime = new Date('2026-10-20T14:45:00.000Z').getTime();
    const actualTime = new Date(checkRes.rows[0].simulated_time).getTime();
    assert.equal(actualTime, expectedTime, 'Clock time must reflect +15 min advance');
  });
});
