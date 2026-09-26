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
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

async function testDirectAnonymize() {
  // Create a quick dummy user in auth
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email: `test_anon_err_${Date.now()}@appointments4u.test`, password: 'Password123!' })
  });
  const u = await res.json();
  console.log('Created user:', u.id);

  // Call anonymize_user_data directly
  const rpcRes = await fetch(`${url}/rest/v1/rpc/anonymize_user_data`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_user_id: u.id })
  });
  const rpcData = await rpcRes.json();
  console.log('RPC response status:', rpcRes.status);
  console.log('RPC response body:', rpcData);

  // Cleanup
  await fetch(`${url}/auth/v1/admin/users/${u.id}`, {
    method: 'DELETE',
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
}

testDirectAnonymize().catch(console.error);
