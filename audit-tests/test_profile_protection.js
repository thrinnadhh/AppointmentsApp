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
  console.log('--- Testing Profiles Column Protection ---');
  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: merchantEmail, password: merchantPassword })
  });
  const { access_token, user } = await authRes.json();
  const userId = user.id;
  console.log('Merchant User ID:', userId);

  const testPatches = [
    { field: 'role', body: { role: 'admin' } },
    { field: 'is_flagged', body: { is_flagged: true } },
    { field: 'no_show_count', body: { no_show_count: 99 } },
    { field: 'assigned_city_id', body: { assigned_city_id: 'tirupati' } },
    { field: 'default_provider_id', body: { default_provider_id: '00000000-0000-0000-0000-000000000001' } },
    { field: 'full_name', body: { full_name: user.user_metadata?.full_name || 'Verified Merchant' } }
  ];

  for (const { field, body } of testPatches) {
    const res = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(body)
    });
    const status = res.status;
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {}
    const updated = Array.isArray(json) && json.length > 0;
    console.log(`PATCH [${field}]: HTTP ${status} | Row updated: ${updated} | Response: ${text.slice(0, 100)}`);
  }
}

main().catch(console.error);
