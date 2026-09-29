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

async function getAuthToken(email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  return data.access_token;
}

async function run() {
  console.log('================================================================');
  console.log('ROLE-BASED WRITE-SURFACE & TENANT ISOLATION AUDIT');
  console.log('Target Project:', new URL(url).host);
  console.log('================================================================\n');

  // Fetch two distinct merchants and a customer
  const provRes = await fetch(`${url}/rest/v1/providers?select=id,name,owner_id,is_verified,commission_rate&limit=2`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [venueA, venueB] = await provRes.json();
  console.log(`Venue A: ${venueA.id} (${venueA.name}, owner=${venueA.owner_id})`);
  console.log(`Venue B: ${venueB.id} (${venueB.name}, owner=${venueB.owner_id})\n`);

  // Get owner A profile/email and owner B profile/email
  const pARes = await fetch(`${url}/rest/v1/profiles?id=eq.${venueA.owner_id}&select=id,email`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [profileA] = await pARes.json();

  const pBRes = await fetch(`${url}/rest/v1/profiles?id=eq.${venueB.owner_id}&select=id,email`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [profileB] = await pBRes.json();

  // Test Customer
  const custRes = await fetch(`${url}/rest/v1/profiles?role=eq.customer&limit=1&select=id,email`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [custProfile] = await custRes.json();

  // Create temporary sessions using admin generateLink or password
  // Let's create tokens using admin user impersonation or signing
  // We can generate tokens via /auth/v1/admin/users
  console.log('Auditing table mutation attempts via REST with Customer JWT & Cross-Merchant JWT...');

  // Helper to test write as a specific user
  async function testWrite(userId, testName, table, method, path, body) {
    // Generate a temporary magic link or impersonation token
    const tokenRes = await fetch(`${url}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', email: `impersonate_${userId.slice(0, 8)}@test.com` })
    });
    // Or we can sign in or test via PostgREST with user id in headers or check RLS policies
  }

  // Let's check RLS policies directly across all public tables!
  console.log('Querying pg_policies and table permissions directly...');
}

run().catch(console.error);
