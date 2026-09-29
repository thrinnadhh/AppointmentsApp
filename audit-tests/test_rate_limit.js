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

async function main() {
  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: merchantEmail, password: merchantPassword })
  });
  const { access_token } = await authRes.json();

  // Find confirmed booking
  const bkgRes = await fetch(`${url}/rest/v1/bookings?status=eq.CONFIRMED&limit=1`, {
    headers: { 'apikey': anonKey, 'Authorization': `Bearer ${access_token}` }
  });
  const bkgs = await bkgRes.json();
  const bookingId = bkgs[0].id;
  console.log('Testing rate limit on booking ID:', bookingId);

  let successCount = 0;
  let blockedCount = 0;

  for (let i = 1; i <= 25; i++) {
    const res = await fetch(`${url}/rest/v1/rpc/reveal_customer_contact`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_booking_id: bookingId })
    });
    const status = res.status;
    const data = await res.json();
    if (status === 200) {
      successCount++;
    } else {
      blockedCount++;
      console.log(`Call #${i}: HTTP ${status} | Code: ${data.code} | Message: ${data.message}`);
    }
  }

  console.log(`\nResults: ${successCount} successful, ${blockedCount} blocked by rate limit.`);
}

main().catch(console.error);
