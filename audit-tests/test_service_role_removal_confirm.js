const fs = require('fs');

function loadEnv() {
  const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  });
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = 'http://localhost:3000';

async function loginUser(email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  return data.access_token;
}

async function createAuthUser(email, password) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'customer' }
    })
  });
  const data = await res.json();
  return data.id;
}

async function deleteAuthUser(userId) {
  await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`
    }
  });
}

async function run() {
  console.log('=================================================================');
  console.log('LIVE AUDIT: /api/bookings/confirm SERVICE ROLE BEARER TOKEN REMOVAL');
  console.log('App Target:', appUrl);
  console.log('Supabase Host:', new URL(url).host);
  console.log('=================================================================\n');

  const ts = Date.now();
  const emailA = `cust_confirm_a_${ts}@test.local`;
  const emailB = `cust_confirm_b_${ts}@test.local`;
  const password = `Pass_${ts}!Aa`;

  let userAId, userBId, bookingId;

  try {
    userAId = await createAuthUser(emailA, password);
    userBId = await createAuthUser(emailB, password);

    const tokenA = await loginUser(emailA, password);
    const tokenB = await loginUser(emailB, password);

    // Get an existing provider and resource for booking creation
    const provRes = await fetch(`${url}/rest/v1/providers?select=id&limit=1`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
    const [provider] = await provRes.json();

    const resRes = await fetch(`${url}/rest/v1/resources?provider_id=eq.${provider.id}&limit=1`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
    const [resource] = await resRes.json();

    // Create a held booking for Customer A via create_booking_hold RPC
    const holdRes = await fetch(`${url}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_customer_id: userAId,
        p_resource_id: resource.id,
        p_slot_start: new Date(Date.now() + 86400000).toISOString(),
        p_slot_end: new Date(Date.now() + 86400000 + 1800000).toISOString()
      })
    });
    const holdData = await holdRes.json();
    if (!holdData.booking_id) {
      throw new Error(`Hold failed: ${JSON.stringify(holdData)}`);
    }
    bookingId = holdData.booking_id;
    console.log(`Created test held booking: ID = ${bookingId} (Customer = ${userAId})\n`);

    // -------------------------------------------------------------------------
    // TEST 1: Service Role Key as Bearer Token (THE CRITICAL TEST)
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Attempt /api/bookings/confirm with Authorization: Bearer <SERVICE_ROLE_KEY> ---');
    const serviceRoleRes = await fetch(`${appUrl}/api/bookings/confirm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId,
        gateway_payment_id: `pay_service_key_${ts}`
      })
    });
    const serviceRoleStatus = serviceRoleRes.status;
    const serviceRoleJson = await serviceRoleRes.json();
    console.log(`HTTP Status: ${serviceRoleStatus} (Expected: 401)`);
    console.log('Response Body:', serviceRoleJson);
    const test1Passed = serviceRoleStatus === 401 && serviceRoleJson.error?.includes('Unauthorized');
    console.log(`Result: [${test1Passed ? 'PASS - 401 UNAUTHORIZED CONFIRMED' : 'FAIL'}]\n`);

    // -------------------------------------------------------------------------
    // TEST 2: Unauthenticated Call
    // -------------------------------------------------------------------------
    console.log('--- TEST 2: Attempt /api/bookings/confirm with NO Authorization Header ---');
    const unauthRes = await fetch(`${appUrl}/api/bookings/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId,
        gateway_payment_id: `pay_unauth_${ts}`
      })
    });
    const unauthStatus = unauthRes.status;
    const unauthJson = await unauthRes.json();
    console.log(`HTTP Status: ${unauthStatus} (Expected: 401)`);
    console.log('Response Body:', unauthJson);
    const test2Passed = unauthStatus === 401;
    console.log(`Result: [${test2Passed ? 'PASS - 401 UNAUTHORIZED' : 'FAIL'}]\n`);

    // -------------------------------------------------------------------------
    // TEST 3: Unauthorized Customer B Attempting to Confirm Customer A's Booking
    // -------------------------------------------------------------------------
    console.log('--- TEST 3: Attempt with Customer B JWT on Customer A Booking ---');
    const custBRes = await fetch(`${appUrl}/api/bookings/confirm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenB}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId,
        gateway_payment_id: `pay_b_on_a_${ts}`
      })
    });
    const custBStatus = custBRes.status;
    const custBJson = await custBRes.json();
    console.log(`HTTP Status: ${custBStatus} (Expected: 403)`);
    console.log('Response Body:', custBJson);
    const test3Passed = custBStatus === 403;
    console.log(`Result: [${test3Passed ? 'PASS - 403 FORBIDDEN' : 'FAIL'}]\n`);

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    const allPassed = test1Passed && test2Passed && test3Passed;
    console.log('=================================================================');
    console.log(`FINAL VERDICT: ${allPassed ? 'ALL TESTS PASSED - SERVICE ROLE BYPASS FULLY REMOVED' : 'FAILED'}`);
    console.log('=================================================================');

    if (!allPassed) process.exit(1);

  } finally {
    if (bookingId) {
      await fetch(`${url}/rest/v1/bookings?id=eq.${bookingId}`, {
        method: 'DELETE',
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
      });
    }
    if (userAId) await deleteAuthUser(userAId);
    if (userBId) await deleteAuthUser(userBId);
  }
}

run().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
