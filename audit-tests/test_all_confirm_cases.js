const fs = require('fs');
const crypto = require('crypto');

function loadEnv() {
  const content = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const RZP_SECRET = env.RAZORPAY_KEY_SECRET;
const APP_URL = 'http://localhost:3000';

async function createUser(email, password, role) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { role }
    })
  });
  const data = await res.json();
  if (!data.id) throw new Error(`User creation failed: ${JSON.stringify(data)}`);
  return data.id;
}

async function loginUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Login failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function deleteUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
}

async function getBookingDbState(bookingId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=id,status,payment_status,gateway_payment_id,deposit_amount`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const rows = await res.json();
  return rows[0] || null;
}

async function run() {
  console.log('======================================================================');
  console.log('LIVE VERIFICATION: /api/bookings/confirm SECURITY & AUTH AUDIT');
  console.log('App Target: http://localhost:3000');
  console.log('Supabase Host:', new URL(SUPABASE_URL).host);
  console.log('======================================================================\n');

  const stamp = Date.now();
  const emailA = `cust_a_${stamp}@audit.local`;
  const emailB = `cust_b_${stamp}@audit.local`;
  const password = `TestPass_${stamp}!Aa`;

  let userAId, userBId, bookingId;

  try {
    // 1. Provision Users & Tokens
    console.log('1. Provisioning Test Fixtures:');
    userAId = await createUser(emailA, password, 'customer');
    userBId = await createUser(emailB, password, 'customer');
    console.log(`   - Customer A created (ID: ${userAId})`);
    console.log(`   - Customer B created (ID: ${userBId})`);

    const tokenA = await loginUser(emailA, password);
    const tokenB = await loginUser(emailB, password);
    console.log('   - Acquired valid JWTs for Customer A and Customer B');

    // 2. Fetch resource & create Held Booking for Customer A
    const resRes = await fetch(`${SUPABASE_URL}/rest/v1/resources?select=id,provider_id&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const [resource] = await resRes.json();

    const slotStart = new Date(Date.now() + 86400000 * 2).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 2 + 1800000).toISOString();

    const holdRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_customer_id: userAId,
        p_resource_id: resource.id,
        p_slot_start: slotStart,
        p_slot_end: slotEnd
      })
    });
    const holdData = await holdRes.json();
    if (!holdData.booking_id) throw new Error(`Hold failed: ${JSON.stringify(holdData)}`);
    bookingId = holdData.booking_id;

    // Set gateway_order_id so order verification can be validated
    const testOrderId = `order_${stamp}`;
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ gateway_order_id: testOrderId })
    });

    console.log(`   - Held Booking created: ${bookingId} (Initial DB Status: HELD)\n`);

    // =========================================================================
    // PART 1: SERVICE ROLE BEARER TOKEN ATTEMPT (PASS: 401, FAIL: 200 or CONFIRMED)
    // =========================================================================
    console.log('======================================================================');
    console.log('PART 1: Attempt with Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>');
    console.log('======================================================================');
    const madeUpPaymentId = `pay_madeup_service_key_${stamp}`;

    const serviceRoleRes = await fetch(`${APP_URL}/api/bookings/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId,
        gateway_payment_id: madeUpPaymentId
      })
    });

    const srStatus = serviceRoleRes.status;
    const srBody = await serviceRoleRes.json();
    console.log(`HTTP Status: ${srStatus} (Expected: 401 Unauthorized)`);
    console.log('Response Body:', JSON.stringify(srBody, null, 2));

    const dbStateAfterSR = await getBookingDbState(bookingId);
    console.log(`DB Verification: Status = "${dbStateAfterSR.status}", Payment = "${dbStateAfterSR.payment_status}", GatewayPaymentId = ${dbStateAfterSR.gateway_payment_id}`);

    const part1Passed = srStatus === 401 && dbStateAfterSR.status === 'HELD' && dbStateAfterSR.status !== 'CONFIRMED';
    console.log(`Part 1 Result: [${part1Passed ? 'PASS - 401 RETURNED & BOOKING REMAINS HELD' : 'FAIL'}]\n`);

    if (!part1Passed) {
      throw new Error(`Part 1 failed: Status ${srStatus}, DB Status: ${dbStateAfterSR.status}`);
    }

    // =========================================================================
    // PART 2: 4-CASE TEST SUITE
    // =========================================================================
    console.log('======================================================================');
    console.log('PART 2: Re-run 4-Case Standard Security Test Suite');
    console.log('======================================================================');

    // Case 2.1: Unauthenticated
    console.log('\n--- Case 2.1: Unauthenticated Request (No Auth Header) ---');
    const unauthRes = await fetch(`${APP_URL}/api/bookings/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId,
        gateway_payment_id: `pay_unauth_${stamp}`
      })
    });
    const unauthStatus = unauthRes.status;
    const unauthBody = await unauthRes.json();
    console.log(`HTTP Status: ${unauthStatus} (Expected: 401)`);
    console.log('Response:', unauthBody);
    const case1Pass = unauthStatus === 401;
    console.log(`Case 2.1 Result: [${case1Pass ? 'PASS' : 'FAIL'}]`);

    // Case 2.2: Wrong Customer (Customer B on Customer A Booking)
    console.log('\n--- Case 2.2: Wrong Customer (Customer B attempting to confirm Customer A booking) ---');
    const wrongCustRes = await fetch(`${APP_URL}/api/bookings/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenB}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId,
        gateway_payment_id: `pay_wrong_cust_${stamp}`
      })
    });
    const wrongCustStatus = wrongCustRes.status;
    const wrongCustBody = await wrongCustRes.json();
    console.log(`HTTP Status: ${wrongCustStatus} (Expected: 403)`);
    console.log('Response:', wrongCustBody);
    const case2Pass = wrongCustStatus === 403;
    console.log(`Case 2.2 Result: [${case2Pass ? 'PASS' : 'FAIL'}]`);

    // Case 2.3: Fake / Unverified Payment ID (Customer A without valid signature)
    console.log('\n--- Case 2.3: Fake / Unverified Payment ID (Customer A with unverified payment) ---');
    const fakePayRes = await fetch(`${APP_URL}/api/bookings/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId,
        gateway_payment_id: 'pay_fake_unverified_xyz'
      })
    });
    const fakePayStatus = fakePayRes.status;
    const fakePayBody = await fakePayRes.json();
    console.log(`HTTP Status: ${fakePayStatus} (Expected: 400)`);
    console.log('Response:', fakePayBody);
    const case3Pass = fakePayStatus === 400;
    console.log(`Case 2.3 Result: [${case3Pass ? 'PASS' : 'FAIL'}]`);

    // Case 2.4: Valid Payment with Legitimate Customer A JWT & Cryptographic Signature
    console.log('\n--- Case 2.4: Valid Payment with Legitimate Customer A JWT & HMAC-SHA256 Signature ---');
    const legitimatePaymentId = `pay_valid_${stamp}`;
    const validSignature = crypto
      .createHmac('sha256', RZP_SECRET)
      .update(`${testOrderId}|${legitimatePaymentId}`)
      .digest('hex');

    const validPayRes = await fetch(`${APP_URL}/api/bookings/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId,
        gateway_payment_id: legitimatePaymentId,
        razorpay_order_id: testOrderId,
        razorpay_signature: validSignature
      })
    });
    const validPayStatus = validPayRes.status;
    const validPayBody = await validPayRes.json();
    console.log(`HTTP Status: ${validPayStatus} (Expected: 200)`);
    console.log('Response Body:', JSON.stringify(validPayBody, null, 2));

    const dbStateFinal = await getBookingDbState(bookingId);
    console.log(`DB Verification: Status = "${dbStateFinal.status}", Payment = "${dbStateFinal.payment_status}", GatewayPaymentId = "${dbStateFinal.gateway_payment_id}"`);

    const case4Pass = validPayStatus === 200 && validPayBody.success === true && dbStateFinal.status === 'CONFIRMED' && dbStateFinal.payment_status === 'CAPTURED';
    console.log(`Case 2.4 Result: [${case4Pass ? 'PASS - BOOKING OFFICIALLY CONFIRMED' : 'FAIL'}]`);

    // =========================================================================
    // OVERALL AUDIT SUMMARY
    // =========================================================================
    const allPassed = part1Passed && case1Pass && case2Pass && case3Pass && case4Pass;
    console.log('\n======================================================================');
    console.log(`FINAL AUDIT VERDICT: ${allPassed ? 'ALL TESTS PASSED (100% SECURE & VERIFIED)' : 'FAILED'}`);
    console.log('======================================================================\n');

    if (!allPassed) process.exit(1);

  } finally {
    console.log('Teardown: Cleaning up test fixtures...');
    if (bookingId) {
      await fetch(`${SUPABASE_URL}/rest/v1/payments?booking_id=eq.${bookingId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
      await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
    }
    if (userAId) await deleteUser(userAId);
    if (userBId) await deleteUser(userBId);
    console.log('Teardown complete.');
  }
}

run().catch(err => {
  console.error('Audit run error:', err);
  process.exit(1);
});
