const fs = require('fs');

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
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

async function run() {
  console.log('================================================================');
  console.log('ANON & UNRELATED CUSTOMER RPC AUDIT WITH REAL ARGUMENTS');
  console.log('Target Project:', new URL(url).host);
  console.log('================================================================\n');

  // Create a real customer user and sign in
  const email = `audit_unrelated_cust_${Date.now()}@example.com`;
  const pw = 'CustomerSec123!Aa';
  const uRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password: pw,
      email_confirm: true,
      user_metadata: { role: 'customer', full_name: 'Unrelated Customer' }
    })
  });
  const uData = await uRes.json();
  const customerId = uData.id;

  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw })
  });
  const authData = await authRes.json();
  const customerToken = authData.access_token;
  console.log('Created and authenticated unrelated customer:', customerId);

  const testCases = [
    {
      name: 'admin_fetch_merchants',
      args: { p_city_id: 'tirupati' }
    },
    {
      name: 'get_merchant_bookings',
      args: { p_provider_id: '11111111-1111-1111-1111-111111111111' }
    },
    {
      name: 'is_admin',
      args: { p_user_id: customerId }
    },
    {
      name: 'get_user_authorized_providers',
      args: { p_user_id: customerId }
    },
    {
      name: 'get_active_cities',
      args: { p_include_expanding: true }
    },
    {
      name: 'search_directory',
      args: { p_query: 'dental' }
    },
    {
      name: 'get_nearby_providers',
      args: { p_lat: 13.6288, p_lng: 79.4192, p_category: 'clinics', p_radius_meters: 15000 }
    }
  ];

  for (const tc of testCases) {
    console.log(`\n=== Testing ${tc.name} ===`);

    // 1. Anon call
    const resAnon = await fetch(`${url}/rest/v1/rpc/${tc.name}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tc.args)
    });
    const anonStatus = resAnon.status;
    let anonData;
    try { anonData = await resAnon.json(); } catch { anonData = await resAnon.text(); }
    const anonDataSnippet = JSON.stringify(anonData).slice(0, 160);
    console.log(`  [ANON] HTTP ${anonStatus}:`, anonDataSnippet);

    // 2. Unrelated Customer call
    const resCust = await fetch(`${url}/rest/v1/rpc/${tc.name}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tc.args)
    });
    const custStatus = resCust.status;
    let custDataRes;
    try { custDataRes = await resCust.json(); } catch { custDataRes = await resCust.text(); }
    const custDataSnippet = JSON.stringify(custDataRes).slice(0, 160);
    console.log(`  [CUSTOMER] HTTP ${custStatus}:`, custDataSnippet);
  }

  // Cleanup test user
  await fetch(`${url}/auth/v1/admin/users/${customerId}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  console.log('\nCleaned up test customer.');
}

run().catch(console.error);
