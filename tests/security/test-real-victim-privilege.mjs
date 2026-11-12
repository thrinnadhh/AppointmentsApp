// tests/security/test-real-victim-privilege.mjs
/**
 * Privilege Escalation & Cross-Tenant Boundary Test with REAL Victim
 * 
 * Verifies that Customer A cannot:
 * 1. PATCH Customer B's profile (full_name, role)
 * 2. Read Customer B's bookings via PostgREST
 * 3. Probe Customer B's status or details via RPCs (is_admin, hospital_role, get_user_authorized_providers, get_masked_customer_info)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';

let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (fs.existsSync(path.join(ROOT_DIR, 'apps/merchant-web/.env.local'))) {
  const envContent = fs.readFileSync(path.join(ROOT_DIR, 'apps/merchant-web/.env.local'), 'utf8');
  const anonMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY="([^"]+)"/);
  const serviceMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);
  if (anonMatch && !anonKey) anonKey = anonMatch[1];
  if (serviceMatch && !serviceKey) serviceKey = serviceMatch[1];
}

async function runPrivilegeTest() {
  console.log('=== REAL VICTIM PRIVILEGE ESCALATION TEST ===\n');

  // Step 1: Create real accounts for Customer A and Customer B
  const emailA = `customer-a-${Date.now()}@real-customer.test`;
  const emailB = `customer-b-victim-${Date.now()}@real-victim.test`;
  const password = 'RealVictimPass2026!';

  console.log(`1. Provisioning Customer A: ${emailA}`);
  const resUserA = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email: emailA, password, email_confirm: true })
  });
  const userA = await resUserA.json();
  console.log(`   Customer A ID: ${userA.id}`);

  console.log(`2. Provisioning Customer B (Victim): ${emailB}`);
  const resUserB = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email: emailB, password, email_confirm: true })
  });
  const userB = await resUserB.json();
  console.log(`   Customer B (Victim) ID: ${userB.id}`);

  // Set initial profile for Customer B
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userB.id}`, {
    method: 'PATCH',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      full_name: 'Original Victim Name',
      phone: '+919876543210',
      role: 'customer'
    })
  });

  // Create a real booking for Customer B
  const providerRes = await fetch(`${SUPABASE_URL}/rest/v1/providers?limit=1`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [provider] = await providerRes.json();
  const resourceRes = await fetch(`${SUPABASE_URL}/rest/v1/resources?provider_id=eq.${provider.id}&limit=1`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [resource] = await resourceRes.json();

  const victimBookingId = crypto.randomUUID();
  await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: victimBookingId,
      customer_id: userB.id,
      provider_id: provider.id,
      resource_id: resource.id,
      status: 'CONFIRMED',
      payment_status: 'CAPTURED',
      slot_start: new Date(Date.now() + 86400000).toISOString(),
      slot_end: new Date(Date.now() + 90000000).toISOString(),
      deposit_amount: 100,
      total_amount: 100
    })
  });
  console.log(`   Created booking ${victimBookingId} belonging to Customer B\n`);

  // Log in as Customer A to obtain genuine access token
  console.log('3. Authenticating as Customer A...');
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email: emailA, password })
  });
  const sessionA = await loginRes.json();
  const tokenA = sessionA.access_token;
  assert.ok(tokenA, 'Failed to obtain access token for Customer A');
  console.log('   Customer A authenticated successfully.\n');

  const headersA = {
    'apikey': anonKey,
    'Authorization': `Bearer ${tokenA}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // ATTACK 1: Customer A tries to PATCH Customer B's profile (full_name and role)
  console.log('=== ATTACK 1: Customer A tries to PATCH Customer B profile (full_name and role) ===');
  console.log(`Command: PATCH /rest/v1/profiles?id=eq.${userB.id}`);
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userB.id}`, {
    method: 'PATCH',
    headers: headersA,
    body: JSON.stringify({
      full_name: 'Hacked By Customer A',
      role: 'admin'
    })
  });
  const patchStatus = patchRes.status;
  const patchBody = await patchRes.text();
  console.log(`Status: ${patchStatus}`);
  console.log(`Body: ${patchBody}`);

  // Verify DB state: Victim's profile must be unchanged
  const bProfileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userB.id}`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [bProfile] = await bProfileRes.json();
  assert.strictEqual(bProfile.full_name, 'Original Victim Name', 'Victim full_name was tampered!');
  assert.strictEqual(bProfile.role, 'customer', 'Victim role was elevated!');
  console.log('✔ Result: PATCH was blocked by RLS (0 rows updated in PostgREST, victim profile unchanged).\n');

  // ATTACK 2: Customer A tries to read Customer B's bookings via PostgREST
  console.log('=== ATTACK 2: Customer A tries to read Customer B bookings ===');
  console.log(`Command: GET /rest/v1/bookings?customer_id=eq.${userB.id}`);
  const getBkgRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?customer_id=eq.${userB.id}`, {
    method: 'GET',
    headers: headersA
  });
  const getBkgStatus = getBkgRes.status;
  const getBkgBody = await getBkgRes.text();
  console.log(`Status: ${getBkgStatus}`);
  console.log(`Body: ${getBkgBody}`);
  const getBkgData = JSON.parse(getBkgBody);
  assert.deepStrictEqual(getBkgData, [], 'Customer A must receive empty array when querying Customer B bookings');
  console.log('✔ Result: SELECT returned empty array [] (RLS prevented reading victim bookings).\n');

  // ATTACK 3: Customer A calls RPCs with Customer B's UUID
  console.log('=== ATTACK 3: Customer A calls RPCs with Customer B UUID ===');

  // 3a. is_admin with Customer B's UUID
  console.log('3a. POST /rest/v1/rpc/is_admin with Customer B UUID:');
  const rpcAdminRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ p_user_id: userB.id })
  });
  console.log(`Status: ${rpcAdminRes.status}`);
  const rpcAdminBody = await rpcAdminRes.text();
  console.log(`Body: ${rpcAdminBody}`);
  assert.strictEqual(JSON.parse(rpcAdminBody), false, 'is_admin must ignore p_user_id and evaluate for caller (false)');

  // 3b. hospital_role with Customer B's UUID
  console.log('\n3b. POST /rest/v1/rpc/hospital_role with Customer B UUID:');
  const rpcRoleRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hospital_role`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ p_provider_id: provider.id, p_user_id: userB.id })
  });
  console.log(`Status: ${rpcRoleRes.status}`);
  const rpcRoleBody = await rpcRoleRes.text();
  console.log(`Body: ${rpcRoleBody}`);
  assert.strictEqual(JSON.parse(rpcRoleBody), 'none', 'hospital_role must ignore p_user_id and evaluate for caller (none)');

  // 3c. get_user_authorized_providers with Customer B's UUID
  console.log('\n3c. POST /rest/v1/rpc/get_user_authorized_providers with Customer B UUID:');
  const rpcProvsRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_user_authorized_providers`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ p_user_id: userB.id })
  });
  console.log(`Status: ${rpcProvsRes.status}`);
  const rpcProvsBody = await rpcProvsRes.text();
  console.log(`Body: ${rpcProvsBody}`);
  assert.deepStrictEqual(JSON.parse(rpcProvsBody), [], 'get_user_authorized_providers must ignore p_user_id and return []');

  // 3d. get_masked_customer_info with Customer B's UUID
  console.log('\n3d. POST /rest/v1/rpc/get_masked_customer_info with Customer B UUID:');
  const rpcMaskRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_masked_customer_info`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ p_customer_id: userB.id })
  });
  console.log(`Status: ${rpcMaskRes.status}`);
  const rpcMaskBody = await rpcMaskRes.text();
  console.log(`Body: ${rpcMaskBody}`);
  assert.deepStrictEqual(JSON.parse(rpcMaskBody), [], 'get_masked_customer_info must deny access and return []');

  console.log('\n✔ ALL REAL-VICTIM PRIVILEGE TESTS PASSED CLEANLY!');
}

runPrivilegeTest().catch((err) => {
  console.error('Privilege test failed:', err);
  process.exit(1);
});
