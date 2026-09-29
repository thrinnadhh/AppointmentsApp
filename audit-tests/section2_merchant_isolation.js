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

async function testSection2_1() {
  console.log("=== Test 2.1: Multi-Tenant Merchant Isolation (Merchant A vs Merchant B) ===");

  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: merchantEmail, password: merchantPassword })
  });
  const { access_token: token } = await authRes.json();
  const headers = { apikey: anonKey, Authorization: `Bearer ${token}` };

  const merchantB_providerId = '44444444-4444-4444-4444-444444444444'; // Naturals Salon

  // 1. Try reading Merchant B's bookings via bookings table
  const bRes = await fetch(`${url}/rest/v1/bookings?provider_id=eq.${merchantB_providerId}&select=id,status`, { headers });
  const bData = await bRes.json();
  console.log("1. Read Merchant B bookings via /bookings:", bRes.status, "Rows:", Array.isArray(bData) ? bData.length : bData);

  // 2. Try reading Merchant B's bookings via merchant_bookings view
  const mbRes = await fetch(`${url}/rest/v1/merchant_bookings?provider_id=eq.${merchantB_providerId}&select=id,customer_name`, { headers });
  const mbData = await mbRes.json();
  console.log("2. Read Merchant B bookings via /merchant_bookings:", mbRes.status, "Rows:", Array.isArray(mbData) ? mbData.length : mbData);

  // 3. Try reading Merchant B's staff via merchant_memberships
  const staffRes = await fetch(`${url}/rest/v1/merchant_memberships?provider_id=eq.${merchantB_providerId}&select=*`, { headers });
  const staffData = await staffRes.json();
  console.log("3. Read Merchant B staff via /merchant_memberships:", staffRes.status, "Rows:", Array.isArray(staffData) ? staffData.length : staffData);

  // 4. Try updating Merchant B's bookings via PATCH
  const patchRes = await fetch(`${url}/rest/v1/bookings?provider_id=eq.${merchantB_providerId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'CANCELLED' })
  });
  const patchData = await patchRes.json();
  console.log("4. Modify Merchant B bookings via PATCH:", patchRes.status, "Rows updated:", Array.isArray(patchData) ? patchData.length : patchData);
}

testSection2_1().catch(console.error);
