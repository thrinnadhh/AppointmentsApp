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
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

async function run() {
  console.log('=== TEST 1: ANON CALL TO get_admin_audit_logs ===');
  const anonAuditRes = await fetch(`${url}/rest/v1/rpc/get_admin_audit_logs`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_limit: 5, p_admin_token: 'tirupati-superadmin-e2e-2026' })
  });
  const anonAuditData = await anonAuditRes.json().catch(() => ({}));
  console.log('Status with backdoor token:', anonAuditRes.status);
  console.log('Result sample:', Array.isArray(anonAuditData) ? `Returned ${anonAuditData.length} audit logs!` : anonAuditData);

  const anonAuditNoToken = await fetch(`${url}/rest/v1/rpc/get_admin_audit_logs`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_limit: 5 })
  });
  const anonAuditNoTokenData = await anonAuditNoToken.json().catch(() => ({}));
  console.log('Status without token:', anonAuditNoToken.status);
  console.log('Message:', anonAuditNoTokenData);

  console.log('\n=== SETUP: CREATE TEST CUSTOMER USER & GET JWT ===');
  const email = `test_customer_audit_${Date.now()}@example.com`;
  const userRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password: 'TestPassword123!',
      email_confirm: true,
      user_metadata: { role: 'customer', full_name: 'Audit Customer' }
    })
  });
  const userData = await userRes.json();
  const customerId = userData.id;

  // Insert profile
  await fetch(`${url}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({
      id: customerId,
      full_name: 'Audit Customer',
      email,
      role: 'customer'
    })
  });

  // Authenticate customer to get JWT
  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword123!' })
  });
  const authData = await authRes.json();
  const customerJwt = authData.access_token;
  console.log('Authenticated as customer:', customerId);

  console.log('\n=== TEST 2: CAN AUTHENTICATED CUSTOMER CALL confirm_booking_payment? ===');
  // First, find or create a held booking
  // Find a resource
  const resResource = await fetch(`${url}/rest/v1/resources?select=id,provider_id,deposit_amount&limit=1`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [resource] = await resResource.json();

  // Create a booking directly as held
  const slotStart = new Date(Date.now() + 86400000).toISOString();
  const slotEnd = new Date(Date.now() + 86400000 + 3600000).toISOString();
  const createBookingRes = await fetch(`${url}/rest/v1/bookings`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      customer_id: customerId,
      provider_id: resource.provider_id,
      resource_id: resource.id,
      slot_start: slotStart,
      slot_end: slotEnd,
      status: 'HELD',
      payment_status: 'PENDING',
      deposit_amount: 100.00,
      platform_fee: 10.00,
      total_amount: 110.00
    })
  });
  const [booking] = await createBookingRes.json();
  console.log('Created held booking:', booking?.id);

  // Now customer calls confirm_booking_payment directly through PostgREST
  const confirmRes = await fetch(`${url}/rest/v1/rpc/confirm_booking_payment`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${customerJwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_booking_id: booking.id,
      p_gateway_payment_id: 'pay_FAKECUSTOMER123',
      p_deposit_amount: 100.00
    })
  });
  const confirmData = await confirmRes.json().catch(() => ({}));
  console.log('confirm_booking_payment HTTP Status:', confirmRes.status);
  console.log('confirm_booking_payment Response:', confirmData);

  console.log('\n=== TEST 3: CAN create_booking_hold BE MANIPULATED WITH CRAFTED ARGUMENTS? ===');
  // Attempt A: Pass another user's customer_id (victim ID: 00000000-0000-0000-0000-000000000001)
  const victimId = '00000000-0000-0000-0000-000000000001';
  const holdForgedUserRes = await fetch(`${url}/rest/v1/rpc/create_booking_hold`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${customerJwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_resource_id: resource.id,
      p_slot_start: new Date(Date.now() + 172800000).toISOString(),
      p_slot_end: new Date(Date.now() + 172800000 + 3600000).toISOString(),
      p_customer_id: victimId
    })
  });
  const holdForgedData = await holdForgedUserRes.json().catch(() => ({}));
  console.log('Hold with forged customer_id HTTP Status:', holdForgedUserRes.status);
  console.log('Hold with forged customer_id Response:', holdForgedData);

  // Attempt B: Pass slot_end earlier than slot_start
  const holdInvertedSlotsRes = await fetch(`${url}/rest/v1/rpc/create_booking_hold`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${customerJwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_resource_id: resource.id,
      p_slot_start: new Date(Date.now() + 259200000).toISOString(),
      p_slot_end: new Date(Date.now() + 259200000 - 3600000).toISOString(), // earlier!
      p_customer_id: customerId
    })
  });
  const holdInvertedData = await holdInvertedSlotsRes.json().catch(() => ({}));
  console.log('Hold with inverted slot times HTTP Status:', holdInvertedSlotsRes.status);
  console.log('Hold with inverted slot times Response:', holdInvertedData);

  // Cleanup created test booking and user
  if (booking?.id) {
    await fetch(`${url}/rest/v1/bookings?id=eq.${booking.id}`, {
      method: 'DELETE',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
  }
  if (holdForgedData?.booking_id) {
    await fetch(`${url}/rest/v1/bookings?id=eq.${holdForgedData.booking_id}`, {
      method: 'DELETE',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
  }
  if (holdInvertedData?.booking_id) {
    await fetch(`${url}/rest/v1/bookings?id=eq.${holdInvertedData.booking_id}`, {
      method: 'DELETE',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
  }
  await fetch(`${url}/auth/v1/admin/users/${customerId}`, {
    method: 'DELETE',
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  console.log('\nCleanup finished.');
}

run().catch(console.error);
