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

async function checkAnonRpcs() {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const data = await res.json();
  const paths = Object.keys(data.paths || {});
  const rpcs = paths.filter(p => p.startsWith('/rpc/')).map(p => p.replace(/^\/rpc\//, ''));

  console.log(`Auditing ${rpcs.length} RPCs as anon...`);
  const executableByAnon = [];
  const blockedFromAnon = [];

  for (const rpc of rpcs) {
    const testRes = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const testJson = await testRes.json().catch(() => ({}));
    
    // Status 401, 403, or Postgres code 42501 means forbidden/no execute grant
    const isPermissionDenied =
      testRes.status === 401 ||
      testRes.status === 403 ||
      testJson?.code === '42501' ||
      (typeof testJson?.message === 'string' && testJson.message.toLowerCase().includes('permission denied'));

    if (isPermissionDenied) {
      blockedFromAnon.push({ rpc, status: testRes.status, code: testJson?.code });
    } else {
      executableByAnon.push({ rpc, status: testRes.status, msg: testJson?.message || 'executed' });
    }
  }

  console.log('\n--- RPCs EXECUTABLE BY ANON (OR PUBLIC) ---');
  console.log(JSON.stringify(executableByAnon, null, 2));

  console.log(`\n--- RPCs BLOCKED FROM ANON (${blockedFromAnon.length}) ---`);
  console.log(blockedFromAnon.map(b => b.rpc).join(', '));
}

checkAnonRpcs().catch(console.error);
