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

const tables = [
  'providers',
  'services',
  'resources',
  'payments',
  'invoices',
  'merchant_memberships',
  'user_consents',
  'reviews',
  'cities',
  'city_settlements',
  'city_waitlist',
  'platform_config',
  'admin_audit_logs',
  'notification_logs',
  'contact_reveal_audit',
  'contact_reveal_anomalies',
  'account_deletion_requests',
  'profiles',
  'bookings',
  'categories',
  'sub_categories'
];

async function checkTableWrites() {
  console.log('Auditing table write permissions for ANON role...\n');
  const anonAllowed = [];

  for (const table of tables) {
    // 1. Test INSERT
    const insRes = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ dummy_nonexistent_field: 'test' })
    });
    const insJson = await insRes.json().catch(() => ({}));
    const insDenied =
      insRes.status === 401 ||
      insRes.status === 403 ||
      insJson?.code === '42501' ||
      (typeof insJson?.message === 'string' && insJson.message.includes('permission denied'));

    // 2. Test UPDATE
    const updRes = await fetch(`${url}/rest/v1/${table}?id=eq.00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ dummy_nonexistent_field: 'test' })
    });
    const updJson = await updRes.json().catch(() => ({}));
    const updDenied =
      updRes.status === 401 ||
      updRes.status === 403 ||
      updJson?.code === '42501' ||
      (typeof updJson?.message === 'string' && updJson.message.includes('permission denied'));

    // 3. Test DELETE
    const delRes = await fetch(`${url}/rest/v1/${table}?id=eq.00000000-0000-0000-0000-000000000000`, {
      method: 'DELETE',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Prefer': 'return=minimal'
      }
    });
    const delJson = await delRes.json().catch(() => ({}));
    const delDenied =
      delRes.status === 401 ||
      delRes.status === 403 ||
      delJson?.code === '42501' ||
      (typeof delJson?.message === 'string' && delJson.message.includes('permission denied'));

    console.log(`Table ${table.padEnd(26)}: INSERT=${insDenied ? 'DENIED' : 'ALLOWED(' + insRes.status + ')'}, UPDATE=${updDenied ? 'DENIED' : 'ALLOWED(' + updRes.status + ')'}, DELETE=${delDenied ? 'DENIED' : 'ALLOWED(' + delRes.status + ')'}`);
    if (!insDenied || !updDenied || !delDenied) {
      anonAllowed.push({ table, ins: !insDenied, upd: !updDenied, del: !delDenied });
    }
  }

  console.log('\n--- TABLES WITH PERMISSIVE WRITE FOR ANON ---');
  console.log(JSON.stringify(anonAllowed, null, 2));
}

checkTableWrites().catch(console.error);
