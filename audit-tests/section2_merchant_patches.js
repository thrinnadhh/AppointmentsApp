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
const merchantEmail = env.TEST_MERCHANT_EMAIL;
const merchantPassword = env.TEST_MERCHANT_PASSWORD;

async function testSection2_4() {
  console.log("=== Test 2.4: Merchant A PATCH fields on Venue A Booking ===");

  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: merchantEmail, password: merchantPassword })
  });
  const { access_token: token } = await authRes.json();
  const headers = { apikey: anonKey, Authorization: `Bearer ${token}` };

  // Fetch one booking for Venue A
  const bRes = await fetch(`${url}/rest/v1/merchant_bookings?select=id,status,payment_status,deposit_amount,total_amount&limit=1`, { headers });
  const bookings = await bRes.json();
  if (!bookings || bookings.length === 0) {
    console.log("No bookings found for Venue A");
    return;
  }
  const targetBooking = bookings[0];
  console.log("Target Booking Initial State:", targetBooking);

  const testFields = [
    { field: 'payment_status', payload: { payment_status: 'CAPTURED' } },
    { field: 'status', payload: { status: 'CONFIRMED' } },
    { field: 'deposit_amount', payload: { deposit_amount: 1.00 } },
    { field: 'platform_fee', payload: { platform_fee: 0.00 } },
    { field: 'total_amount', payload: { total_amount: 1.00 } },
    { field: 'invoice_number', payload: { invoice_number: 'INV-HACK-001' } },
    { field: 'gateway_payment_id', payload: { gateway_payment_id: 'pay_tampered_fake' } }
  ];

  for (const t of testFields) {
    const res = await fetch(`${url}/rest/v1/bookings?id=eq.${targetBooking.id}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(t.payload)
    });
    const data = await res.json();
    console.log(`PATCH ${t.field} -> HTTP ${res.status}:`, Array.isArray(data) ? (data.length > 0 ? "UPDATED: " + JSON.stringify(data[0][t.field]) : "0 rows updated") : data);
  }
}

testSection2_4().catch(console.error);
