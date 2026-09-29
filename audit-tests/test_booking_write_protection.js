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
const merchantEmail = env.TEST_MERCHANT_EMAIL || 'merchant@example.com';
const merchantPassword = env.TEST_MERCHANT_PASSWORD || 'password';

async function getMerchantToken() {
  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email: merchantEmail, password: merchantPassword })
  });
  const data = await authRes.json();
  return data.access_token;
}

async function testBookingWriteProtection() {
  console.log('--- Testing Booking Write Protection ---');
  const token = await getMerchantToken();
  if (!token) {
    console.error('Failed to authenticate merchant');
    return;
  }

  // 1. Fetch a booking belonging to Merchant A
  const bkgRes = await fetch(`${url}/rest/v1/merchant_bookings?select=id,status&limit=1`, {
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${token}`
    }
  });
  const bkgs = await bkgRes.json();
  if (!bkgs.length) {
    console.log('No booking found for merchant');
    return;
  }
  const bookingId = bkgs[0].id;
  console.log('Testing against booking ID:', bookingId);

  const testPatches = [
    { field: 'payment_status', body: { payment_status: 'captured' } },
    { field: 'deposit_amount', body: { deposit_amount: 1.00 } },
    { field: 'gateway_payment_id', body: { gateway_payment_id: 'fake_id' } },
    { field: 'platform_fee', body: { platform_fee: 0.00 } },
    { field: 'total_amount', body: { total_amount: 1.00 } },
    { field: 'invoice_number', body: { invoice_number: 'INV-TEST-001' } },
    { field: 'status', body: { status: 'CONFIRMED' } }
  ];

  for (const { field, body } of testPatches) {
    const patchRes = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(body)
    });
    const status = patchRes.status;
    let resText = await patchRes.text();
    let json;
    try { json = JSON.parse(resText); } catch {}

    const wasUpdated = Array.isArray(json) && json.length > 0;
    console.log(`PATCH [${field}]: HTTP ${status} | Row updated: ${wasUpdated} | Response: ${resText.slice(0, 100)}`);
  }
}

testBookingWriteProtection().catch(console.error);
