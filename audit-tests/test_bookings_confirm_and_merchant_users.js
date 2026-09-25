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
const APP_URL = 'http://localhost:3000';

async function createUser(email, password, role, fullName) {
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
      user_metadata: { role, full_name: fullName },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Create user failed: ${JSON.stringify(data)}`);
  return data;
}

async function loginUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function deleteUser(userId) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('ITEM 1 & ITEM 9 LIVE PROOF SUITE');
  console.log('Target Staging Supabase:', new URL(SUPABASE_URL).host);
  console.log('Target App Server:', APP_URL);
  console.log('================================================================\n');

  const stamp = Date.now();
  const custAEmail = `cust_a_${stamp}@tirupati-test.com`;
  const custBEmail = `cust_b_${stamp}@tirupati-test.com`;
  const merchantEmail = `merch_${stamp}@tirupati-test.com`;
  const password = 'StrongPassword123!@';

  console.log('1. Setting up test users and seed entities...');
  const userA = await createUser(custAEmail, password, 'customer', 'Customer Alpha');
  const userB = await createUser(custBEmail, password, 'customer', 'Customer Beta');
  const userM = await createUser(merchantEmail, password, 'merchant', 'Merchant Owner');

  // Insert profile for customers and merchant
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([
      {
        id: userA.id,
        email: custAEmail,
        full_name: 'Customer Alpha',
        role: 'customer',
      },
      {
        id: userB.id,
        email: custBEmail,
        full_name: 'Customer Beta',
        role: 'customer',
      },
      {
        id: userM.id,
        email: merchantEmail,
        full_name: 'Merchant Owner',
        role: 'merchant',
      },
    ]),
  });
  if (!profRes.ok) console.error('Profiles insert error:', await profRes.text());

  const tokenA = await loginUser(custAEmail, password);
  const tokenB = await loginUser(custBEmail, password);
  const tokenM = await loginUser(merchantEmail, password);

  // Create provider and resource for merchant
  const provId = '22222222-2222-2222-2222-' + stamp.toString().slice(-12);
  const resId = '33333333-3333-3333-3333-' + stamp.toString().slice(-12);
  const otherProvId = '44444444-4444-4444-4444-' + stamp.toString().slice(-12);

  const provRes = await fetch(`${SUPABASE_URL}/rest/v1/providers`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        id: provId,
        owner_id: userM.id,
        name: 'Merchant Venue Test',
        address: '123 Main Street, Tirupati',
        city: 'Tirupati',
        city_id: 'tirupati',
        latitude: 13.6288,
        longitude: 79.4192,
        phone: '9848011223',
        opening_time: '09:00:00',
        closing_time: '21:00:00',
        category_id: 'salons',
        status: 'ACTIVE',
      },
      {
        id: otherProvId,
        owner_id: null,
        name: 'Another Merchant Venue',
        address: '456 Temple Road, Tirupati',
        city: 'Tirupati',
        city_id: 'tirupati',
        latitude: 13.6288,
        longitude: 79.4192,
        phone: '9848011224',
        opening_time: '09:00:00',
        closing_time: '21:00:00',
        category_id: 'clinics',
        status: 'ACTIVE',
      }
    ]),
  });
  if (!provRes.ok) console.error('Provider insert error:', await provRes.text());

  const memRes = await fetch(`${SUPABASE_URL}/rest/v1/merchant_memberships`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userM.id,
      provider_id: provId,
      role: 'owner',
    }),
  });
  if (!memRes.ok) console.error('Membership insert error:', await memRes.text());

  const rRes = await fetch(`${SUPABASE_URL}/rest/v1/resources`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: resId,
      provider_id: provId,
      name: 'Stylist Chair 1',
      type: 'slot',
      deposit_amount: 100,
      is_active: true,
    }),
  });
  if (!rRes.ok) console.error('Resource insert error:', await rRes.text());

  // Create a booking owned by Customer A
  const bookingId = '55555555-5555-5555-5555-' + stamp.toString().slice(-12);
  const slotStart = new Date(Date.now() + 86400000).toISOString();
  const slotEnd = new Date(Date.now() + 86400000 + 1800000).toISOString();
  const holdExpiry = new Date(Date.now() + 300000).toISOString();

  const bRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: bookingId,
      customer_id: userA.id,
      provider_id: provId,
      resource_id: resId,
      slot_start: slotStart,
      slot_end: slotEnd,
      status: 'HELD',
      payment_status: 'PENDING',
      deposit_amount: 100,
      platform_fee: 10,
      total_amount: 110,
      hold_expires_at: holdExpiry,
      gateway_order_id: `order_test_${stamp}`,
    }),
  });
  if (!bRes.ok) console.error('Booking insert error:', await bRes.text());

  console.log(`Created test booking ${bookingId} for Customer A.\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // TEST ITEM 1: /api/bookings/confirm SECURITY & VERIFICATION
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST 1.1: Unauthenticated call ---');
  const resUnauth = await fetch(`${APP_URL}/api/bookings/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      booking_id: bookingId,
      gateway_payment_id: 'pay_test_unauth',
    }),
  });
  console.log(`HTTP ${resUnauth.status} (Expected 401)`);
  const dataUnauth = await resUnauth.json();
  console.log('Response:', dataUnauth);
  if (resUnauth.status !== 401) throw new Error('Test 1.1 failed: Expected 401');

  console.log('\n--- TEST 1.2: Another customer (Customer B) attempting to confirm Customer A booking ---');
  const resAnotherCust = await fetch(`${APP_URL}/api/bookings/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenB}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      booking_id: bookingId,
      gateway_payment_id: 'pay_test_custb',
    }),
  });
  console.log(`HTTP ${resAnotherCust.status} (Expected 403)`);
  const dataAnotherCust = await resAnotherCust.json();
  console.log('Response:', dataAnotherCust);
  if (resAnotherCust.status !== 403) throw new Error('Test 1.2 failed: Expected 403');

  console.log('\n--- TEST 1.3: Fake / unverified payment ID ---');
  const resFakePay = await fetch(`${APP_URL}/api/bookings/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      booking_id: bookingId,
      gateway_payment_id: 'pay_fake_unverified_123',
    }),
  });
  console.log(`HTTP ${resFakePay.status} (Expected 400)`);
  const dataFakePay = await resFakePay.json();
  console.log('Response:', dataFakePay);
  if (resFakePay.status !== 400) throw new Error('Test 1.3 failed: Expected 400');

  console.log('\n--- TEST 1.4: Valid verified payment by legitimate Customer A ---');
  const orderId = `order_test_${stamp}`;
  const payId = `pay_test_${stamp}`;
  const rzpSecret = env.RAZORPAY_KEY_SECRET;
  const validSig = crypto.createHmac('sha256', rzpSecret).update(`${orderId}|${payId}`).digest('hex');

  const resValidPay = await fetch(`${APP_URL}/api/bookings/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      booking_id: bookingId,
      gateway_payment_id: payId,
      razorpay_order_id: orderId,
      razorpay_signature: validSig,
      deposit_amount: 100,
    }),
  });
  console.log(`HTTP ${resValidPay.status} (Expected 200)`);
  const dataValidPay = await resValidPay.json();
  console.log('Response:', dataValidPay);
  if (resValidPay.status !== 200 || dataValidPay.status !== 'CONFIRMED') {
    throw new Error('Test 1.4 failed: Expected 200 CONFIRMED');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST ITEM 9: /api/admin/users VENUE SCOPING & ROLE PERMISSIONS
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 9.1: Merchant trying to create an admin account ---');
  const resAdminCreate = await fetch(`${APP_URL}/api/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenM}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: `illegal_admin_${stamp}@test.com`,
      password: 'AdminPassword123!@',
      fullName: 'Illegal Admin',
      role: 'admin',
      providerId: provId,
    }),
  });
  console.log(`HTTP ${resAdminCreate.status} (Expected 403)`);
  const dataAdminCreate = await resAdminCreate.json();
  console.log('Response:', dataAdminCreate);
  if (resAdminCreate.status !== 403) throw new Error('Test 9.1 failed: Expected 403');

  console.log('\n--- TEST 9.2: Merchant trying to manage staff for another merchant venue ---');
  const resForeignVenue = await fetch(`${APP_URL}/api/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenM}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: `foreign_staff_${stamp}@test.com`,
      password: 'StaffPassword123!@',
      fullName: 'Foreign Staff',
      role: 'merchant',
      providerId: otherProvId, // foreign venue
    }),
  });
  console.log(`HTTP ${resForeignVenue.status} (Expected 403)`);
  const dataForeignVenue = await resForeignVenue.json();
  console.log('Response:', dataForeignVenue);
  if (resForeignVenue.status !== 403) throw new Error('Test 9.2 failed: Expected 403');

  console.log('\n--- TEST 9.3: Merchant managing staff for own venue ---');
  const staffEmail = `legit_staff_${stamp}@test.com`;
  const resOwnVenue = await fetch(`${APP_URL}/api/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenM}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: staffEmail,
      password: 'StaffPassword123!@',
      fullName: 'Legitimate Staff',
      role: 'merchant',
      providerId: provId, // own venue
    }),
  });
  console.log(`HTTP ${resOwnVenue.status} (Expected 201)`);
  const dataOwnVenue = await resOwnVenue.json();
  console.log('Response:', dataOwnVenue);
  if (resOwnVenue.status !== 201) throw new Error('Test 9.3 failed: Expected 201');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST ITEM 9b: /api/merchant/onboard HARDENING
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 9.4: /api/merchant/onboard weak password rejection ---');
  const resWeakPw = await fetch(`${APP_URL}/api/merchant/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'New Merchant',
      email: `weak_onboard_${stamp}@test.com`,
      password: 'weak', // < 8 chars
      shopName: 'Weak Salon',
      categoryId: 'salons',
      phone: '9848011223',
      tosAccepted: true,
      captchaToken: 'mock_captcha_verified',
    }),
  });
  console.log(`HTTP ${resWeakPw.status} (Expected 400)`);
  const dataWeakPw = await resWeakPw.json();
  console.log('Response:', dataWeakPw);
  if (resWeakPw.status !== 400) throw new Error('Test 9.4 failed: Expected 400');

  // Clean up entities
  console.log('\nCleaning up test entities...');
  await deleteUser(userA.id);
  await deleteUser(userB.id);
  await deleteUser(userM.id);
  if (dataOwnVenue?.user?.id) await deleteUser(dataOwnVenue.user.id);
  await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, { method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  await fetch(`${SUPABASE_URL}/rest/v1/resources?id=eq.${resId}`, { method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  await fetch(`${SUPABASE_URL}/rest/v1/providers?id=in.(${provId},${otherProvId})`, { method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });

  console.log('\n================================================================');
  console.log('ALL PROOF TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('\nFAILED TEST RUN:', err);
  process.exit(1);
});
