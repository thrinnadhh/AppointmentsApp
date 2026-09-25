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

async function revertBooking() {
  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: merchantEmail, password: merchantPassword })
  });
  const { access_token: token } = await authRes.json();
  const headers = { apikey: anonKey, Authorization: `Bearer ${token}` };

  const targetBookingId = 'a5128b2f-cd78-41be-9bcc-51b296c4e15e';
  const res = await fetch(`${url}/rest/v1/bookings?id=eq.${targetBookingId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'CANCELLED',
      platform_fee: 10.00,
      total_amount: 110.00,
      invoice_number: null
    })
  });
  console.log("Reverted booking clean state: HTTP", res.status, await res.text());
}

revertBooking().catch(console.error);
