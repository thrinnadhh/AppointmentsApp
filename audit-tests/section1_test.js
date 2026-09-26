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

async function runSection1() {
  console.log("=== AUDIT SECTION 1: CUSTOMER DATA MASKING ===");
  console.log("Supabase URL configured:", url ? "YES" : "NO");
  console.log("Merchant Credentials configured:", (merchantEmail && merchantPassword) ? "YES" : "NO");

  if (!url || !anonKey) {
    console.log("BLOCKED: Missing Supabase URL or Anon Key");
    return;
  }

  // 1. Authenticate as Merchant A
  let merchantToken = null;
  let merchantUserId = null;
  if (merchantEmail && merchantPassword) {
    try {
      const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: merchantEmail, password: merchantPassword })
      });
      const authData = await authRes.json();
      if (authRes.status === 200 && authData.access_token) {
        merchantToken = authData.access_token;
        merchantUserId = authData.user.id;
        console.log("Merchant A Authentication: SUCCESS (HTTP 200)");
      } else {
        console.log("Merchant A Authentication FAILED: HTTP", authRes.status, authData.error_description || authData.message);
      }
    } catch (e) {
      console.log("Merchant A Authentication ERROR:", e.message);
    }
  } else {
    console.log("Merchant A Credentials MISSING: Cannot perform authenticated merchant tests");
  }

  // Test 1.1: Call merchant bookings view
  if (merchantToken) {
    try {
      const res = await fetch(`${url}/rest/v1/merchant_bookings?select=*&limit=5`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${merchantToken}`
        }
      });
      const data = await res.json();
      console.log("\n--- Test 1.1: GET /rest/v1/merchant_bookings ---");
      console.log("HTTP Status:", res.status);
      if (Array.isArray(data)) {
        console.log("Rows returned:", data.length);
        const phones = data.map(b => b.customer_phone);
        console.log("Customer phone samples:", phones);
        const hasUnmasked = phones.some(p => p && !p.includes('*') && p !== 'Not provided');
        console.log("Unmasked raw phone detected?:", hasUnmasked ? "FAIL (RAW PHONE FOUND)" : "PASS (All masked)");
      } else {
        console.log("Response:", data);
      }
    } catch (e) {
      console.log("Test 1.1 Error:", e.message);
    }
  }

  // Test 1.5: GET /rest/v1/profiles for customer IDs as Merchant A
  if (merchantToken) {
    try {
      const res = await fetch(`${url}/rest/v1/profiles?role=eq.customer&select=id,full_name,phone`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${merchantToken}`
        }
      });
      const data = await res.json();
      console.log("\n--- Test 1.5: GET /rest/v1/profiles?role=eq.customer ---");
      console.log("HTTP Status:", res.status);
      console.log("Customer rows returned:", Array.isArray(data) ? data.length : data);
    } catch (e) {
      console.log("Test 1.5 Error:", e.message);
    }
  }

  // Test 1.6: Anon key request with no login
  try {
    console.log("\n--- Test 1.6: Unauthenticated Anon Access ---");
    const mbRes = await fetch(`${url}/rest/v1/merchant_bookings?select=*`, {
      headers: { apikey: anonKey }
    });
    console.log("merchant_bookings status:", mbRes.status, "(expected 401/403 or empty)");

    const craRes = await fetch(`${url}/rest/v1/contact_reveal_audit?select=*`, {
      headers: { apikey: anonKey }
    });
    console.log("contact_reveal_audit status:", craRes.status, "(expected 401/403 or empty)");

    const rpcRes = await fetch(`${url}/rest/v1/rpc/reveal_customer_contact`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_booking_id: '00000000-0000-0000-0000-000000000000' })
    });
    console.log("reveal_customer_contact status:", rpcRes.status, "(expected 401/403 or error)");
  } catch (e) {
    console.log("Test 1.6 Error:", e.message);
  }

  // Test 1.8: UPDATE or DELETE on contact_reveal_audit as Merchant A
  if (merchantToken) {
    try {
      console.log("\n--- Test 1.8: UPDATE / DELETE on contact_reveal_audit as Merchant A ---");
      const patchRes = await fetch(`${url}/rest/v1/contact_reveal_audit?limit=1`, {
        method: 'PATCH',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${merchantToken}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ user_id: merchantUserId })
      });
      console.log("PATCH status:", patchRes.status, await patchRes.text());

      const delRes = await fetch(`${url}/rest/v1/contact_reveal_audit?limit=1`, {
        method: 'DELETE',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${merchantToken}`,
          Prefer: 'return=representation'
        }
      });
      console.log("DELETE status:", delRes.status, await delRes.text());
    } catch (e) {
      console.log("Test 1.8 Error:", e.message);
    }
  }
}

runSection1().catch(console.error);
