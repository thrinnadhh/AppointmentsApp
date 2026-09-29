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
const merchantEmail = env.TEST_MERCHANT_EMAIL || env.MERCHANT_A_EMAIL;
const merchantPassword = env.TEST_MERCHANT_PASSWORD || env.MERCHANT_A_PASSWORD;

async function runRevealTests() {
  // Sign in as Merchant A
  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: merchantEmail, password: merchantPassword })
  });
  const { access_token: merchantToken } = await authRes.json();
  const headers = { apikey: anonKey, Authorization: `Bearer ${merchantToken}` };

  // Fetch bookings for Merchant A
  const bRes = await fetch(`${url}/rest/v1/merchant_bookings?select=id,status,provider_id,customer_phone`, { headers });
  const bookings = await bRes.json();
  console.log(`Fetched ${bookings.length} bookings for Merchant A`);

  const confirmed = bookings.find(b => b.status === 'CONFIRMED');
  const nonConfirmed = bookings.find(b => b.status !== 'CONFIRMED');

  console.log("Confirmed booking sample ID:", confirmed ? confirmed.id : "NONE");
  console.log("Non-confirmed booking sample ID:", nonConfirmed ? `${nonConfirmed.id} (${nonConfirmed.status})` : "NONE");

  // 1.2: Call reveal on CONFIRMED booking
  if (confirmed) {
    const r1 = await fetch(`${url}/rest/v1/rpc/reveal_customer_contact`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_booking_id: confirmed.id })
    });
    const d1 = await r1.json();
    console.log("\n--- 1.2: reveal_customer_contact on CONFIRMED booking ---");
    console.log("Status:", r1.status);
    console.log("Response:", {
      success: d1.success,
      booking_id: d1.booking_id,
      phone_redacted: d1.phone ? d1.phone.slice(0, 3) + '***' + d1.phone.slice(-3) : null,
      full_name: d1.full_name
    });
  }

  // 1.3: Call reveal on non-confirmed booking
  if (nonConfirmed) {
    const r2 = await fetch(`${url}/rest/v1/rpc/reveal_customer_contact`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_booking_id: nonConfirmed.id })
    });
    const d2 = await r2.json();
    console.log("\n--- 1.3: reveal_customer_contact on NON-CONFIRMED booking ---");
    console.log("Status:", r2.status);
    console.log("Response:", d2);
  }

  // 1.4: Call reveal on Merchant B's booking (or non-existent / non-owned booking)
  const dummyBookingId = '22222222-2222-2222-2222-222222222222';
  const r3 = await fetch(`${url}/rest/v1/rpc/reveal_customer_contact`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_booking_id: dummyBookingId })
  });
  const d3 = await r3.json();
  console.log("\n--- 1.4: reveal_customer_contact on unowned booking ---");
  console.log("Status:", r3.status);
  console.log("Response:", d3);

  // 1.8: Test UPDATE and DELETE on contact_reveal_audit
  console.log("\n--- 1.8: UPDATE and DELETE on contact_reveal_audit as Merchant A ---");
  const dummyAuditId = '00000000-0000-0000-0000-000000000000';
  const patchRes = await fetch(`${url}/rest/v1/contact_reveal_audit?id=eq.${dummyAuditId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: '00000000-0000-0000-0000-000000000000' })
  });
  const patchData = await patchRes.json();
  console.log("PATCH status:", patchRes.status, "Rows updated:", Array.isArray(patchData) ? patchData.length : patchData);

  const delRes = await fetch(`${url}/rest/v1/contact_reveal_audit?id=eq.${dummyAuditId}`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=representation' }
  });
  const delData = await delRes.json();
  console.log("DELETE status:", delRes.status, "Rows deleted:", Array.isArray(delData) ? delData.length : delData);
}

runRevealTests().catch(console.error);
