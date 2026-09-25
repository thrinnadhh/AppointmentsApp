const fs = require('fs');
const { createClient } = require('../apps/merchant-web/node_modules/@supabase/supabase-js');

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
  console.log('ITEM 8: ALL-TABLES WRITE-SURFACE AUDIT ACROSS ROLES');
  console.log('Target Project:', new URL(url).host);
  console.log('================================================================\n');

  const sbAnon = createClient(url, anonKey);
  const sbAdmin = createClient(url, serviceKey);

  // 1. Authenticate Merchant A (Owner of Dental: 11111111-1111-1111-1111-111111111111)
  const authA = await sbAnon.auth.signInWithPassword({
    email: env.TEST_MERCHANT_EMAIL,
    password: env.TEST_MERCHANT_PASSWORD
  });
  const tokenA = authA.data?.session?.access_token;
  const userA = authA.data?.user?.id;

  // 2. Authenticate Merchant B (Owner of Salon: 22222222-2222-2222-2222-222222222222)
  const authB = await sbAnon.auth.signInWithPassword({
    email: env.TEST_SALON_EMAIL,
    password: env.TEST_SALON_PASSWORD
  });
  const tokenB = authB.data?.session?.access_token;
  const userB = authB.data?.user?.id;

  // 3. Create and authenticate Test Customer
  const custEmail = `audit_customer_${Date.now()}@example.com`;
  const custPw = 'CustomerSecret2026!';
  const authCust = await sbAdmin.auth.admin.createUser({
    email: custEmail,
    password: custPw,
    email_confirm: true,
    user_metadata: { role: 'customer', full_name: 'Audit Customer' }
  });
  const custId = authCust.data?.user?.id;

  // Create customer profile
  await sbAdmin.from('profiles').upsert({
    id: custId,
    full_name: 'Audit Customer',
    email: custEmail,
    role: 'customer'
  });

  const custSignIn = await sbAnon.auth.signInWithPassword({
    email: custEmail,
    password: custPw
  });
  const tokenCust = custSignIn.data?.session?.access_token;

  console.log('Authenticated Roles:');
  console.log(' - Customer ID:', custId);
  console.log(' - Merchant A ID (Dental):', userA);
  console.log(' - Merchant B ID (Salon):', userB);
  console.log('----------------------------------------------------------------\n');

  const reports = [];

  async function testMutation(roleName, token, table, method, path, body, expectedReason) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const status = res.status;
    let data;
    try { data = await res.json(); } catch { data = await res.text(); }

    // In PostgREST:
    // 401/403/42501 = permission denied (RLS / trigger / grant block)
    // 200/204 with [] = 0 rows updated (RLS USING clause returned false)
    // Non-empty array on PATCH/POST/DELETE = successful mutation!
    const isMutationSuccess = (status === 200 || status === 201) && Array.isArray(data) && data.length > 0;
    const isBlocked = !isMutationSuccess;

    const record = {
      role: roleName,
      table,
      action: `${method} /${path}`,
      status,
      blocked: isBlocked ? 'BLOCKED' : 'VULNERABLE (ALLOWED)',
      explanation: isBlocked ? (status === 403 || status === 401 ? 'Explicit RLS/Grant Deny' : (Array.isArray(data) && data.length === 0 ? 'RLS Filter: 0 rows modified' : `HTTP ${status}: ${data?.code || data?.message || 'Blocked'}`)) : 'UNEXPECTED WRITE',
      expected: expectedReason
    };
    reports.push(record);
    console.log(`[${roleName}] -> ${method} ${table}: HTTP ${status} -> ${record.blocked} (${record.explanation})`);
  }

  console.log('--- 1. TESTS AS CUSTOMER ---');
  // Attempt to steal ownership and alter status of provider
  await testMutation('Customer', tokenCust, 'providers', 'PATCH', 'providers?id=eq.11111111-1111-1111-1111-111111111111', {
    owner_id: custId,
    status: 'ACTIVE'
  }, 'Should be blocked by RLS');

  // Attempt to reset strikes and penalty balance on provider
  await testMutation('Customer', tokenCust, 'providers', 'PATCH', 'providers?id=eq.11111111-1111-1111-1111-111111111111', {
    cancellation_strikes: 0,
    penalty_balance: 0.00,
    is_booking_frozen: false
  }, 'Should be blocked by RLS');

  // Attempt to lower resource price
  await testMutation('Customer', tokenCust, 'resources', 'PATCH', 'resources?provider_id=eq.11111111-1111-1111-1111-111111111111', {
    price: 1.00,
    deposit_amount: 1.00
  }, 'Should be blocked by RLS');

  // Attempt to insert fake payment directly
  await testMutation('Customer', tokenCust, 'payments', 'POST', 'payments', {
    booking_id: 'e2ca6647-3960-4923-a5c5-012855daa063',
    gateway_payment_id: 'pay_fake_' + Date.now(),
    amount: 100.00,
    status: 'CAPTURED',
    currency: 'INR'
  }, 'Should be blocked by table grant / RLS');

  // Attempt to escalate role to admin
  await testMutation('Customer', tokenCust, 'profiles', 'PATCH', `profiles?id=eq.${custId}`, {
    role: 'admin'
  }, 'Should be blocked by guard_profile_governance');

  // Attempt to tamper platform config
  await testMutation('Customer', tokenCust, 'platform_config', 'PATCH', 'platform_config?key=eq.gst_active', {
    value: 'true'
  }, 'Should be blocked by RLS');

  // Attempt to insert fake city settlement
  await testMutation('Customer', tokenCust, 'city_settlements', 'POST', 'city_settlements', {
    city_id: 'tirupati',
    settlement_cycle: '2026-W38',
    total_platform_fee: 10000.00
  }, 'Should be blocked by RLS');

  console.log('\n--- 2. TESTS AS CROSS-MERCHANT (Merchant B on Merchant A Venue) ---');
  // Merchant B attempts to hijack Merchant A provider
  await testMutation('Cross-Merchant', tokenB, 'providers', 'PATCH', 'providers?id=eq.11111111-1111-1111-1111-111111111111', {
    owner_id: userB,
    name: 'Hijacked by B'
  }, 'Should be blocked by tenant isolation RLS');

  // Merchant B attempts to deactivate Merchant A resources
  await testMutation('Cross-Merchant', tokenB, 'resources', 'PATCH', 'resources?provider_id=eq.11111111-1111-1111-1111-111111111111', {
    is_active: false
  }, 'Should be blocked by tenant isolation RLS');

  // Merchant B attempts to insert ownership membership on Merchant A provider
  await testMutation('Cross-Merchant', tokenB, 'merchant_memberships', 'POST', 'merchant_memberships', {
    user_id: userB,
    provider_id: '11111111-1111-1111-1111-111111111111',
    role: 'owner'
  }, 'Should be blocked by RLS');

  console.log('\n--- 3. TESTS AS VENUE OWNER (Merchant A on Own Venue) ---');
  // Merchant A attempts to alter own strikes & penalties
  await testMutation('Merchant A', tokenA, 'providers', 'PATCH', 'providers?id=eq.11111111-1111-1111-1111-111111111111', {
    cancellation_strikes: 0,
    penalty_balance: 0.00,
    is_booking_frozen: false
  }, 'Merchant must not be able to wipe own penalties / strikes');

  // Merchant A attempts to elevate own role to admin
  await testMutation('Merchant A', tokenA, 'profiles', 'PATCH', `profiles?id=eq.${userA}`, {
    role: 'admin'
  }, 'Should be blocked by guard_profile_governance');

  // Merchant A attempts to write directly to payments table
  await testMutation('Merchant A', tokenA, 'payments', 'POST', 'payments', {
    booking_id: 'e2ca6647-3960-4923-a5c5-012855daa063',
    gateway_payment_id: 'pay_merchant_fake_' + Date.now(),
    amount: 500.00,
    status: 'CAPTURED',
    currency: 'INR'
  }, 'Should be blocked by table grant / RLS');

  // Cleanup
  try {
    await sbAdmin.auth.admin.deleteUser(custId);
    await sbAdmin.from('profiles').delete().eq('id', custId);
  } catch {}

  console.log('\n================================================================');
  console.log('AUDIT TABLE SUMMARY:');
  console.table(reports);
}

run().catch(console.error);
