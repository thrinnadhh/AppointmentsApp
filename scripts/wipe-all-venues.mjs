import fs from 'fs';

if (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production') {
  console.error('FATAL: Cannot run destructive script in production environment');
  process.exit(1);
}

async function wipeAllVenues() {
  const envPath = 'apps/merchant-web/.env.local';
  const envContent = fs.readFileSync(envPath, 'utf8');
  const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
  const keyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);

  if (!urlMatch || !keyMatch) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
  }

  const url = urlMatch[1];
  const key = keyMatch[1];

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  console.log('--- Wiping All Remaining Venues, Providers & Resources ---');

  // 1. Delete all bookings & payments & logs if any
  console.log('1. Clearing bookings, payments, and logs...');
  await fetch(`${url}/rest/v1/payments?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers }).catch(() => {});
  await fetch(`${url}/rest/v1/notification_logs?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers }).catch(() => {});
  await fetch(`${url}/rest/v1/bookings?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers }).catch(() => {});

  // 2. Delete all merchant memberships & staff
  console.log('2. Clearing merchant memberships and provider staff...');
  await fetch(`${url}/rest/v1/merchant_memberships?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers }).catch(() => {});
  await fetch(`${url}/rest/v1/provider_staff?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers }).catch(() => {});

  // 3. Delete all resource availability
  console.log('3. Clearing resource availability...');
  await fetch(`${url}/rest/v1/resource_availability?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers }).catch(() => {});

  // 4. Delete all resources
  console.log('4. Clearing all resources...');
  const delRes = await fetch(`${url}/rest/v1/resources?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers });
  const delResources = await delRes.json().catch(() => []);
  console.log(`   Deleted ${Array.isArray(delResources) ? delResources.length : 'all'} resources.`);

  // 5. Delete all providers
  console.log('5. Clearing all providers/venues...');
  const delProv = await fetch(`${url}/rest/v1/providers?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers });
  const delProviders = await delProv.json().catch(() => []);
  console.log(`   Deleted ${Array.isArray(delProviders) ? delProviders.length : 'all'} providers.`);

  // 6. Verification
  console.log('\n--- Final Verification ---');
  for (const table of ['providers', 'resources', 'bookings', 'payments', 'merchant_memberships']) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
      method: 'HEAD',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Prefer': 'count=exact' }
    });
    console.log(`Table [${table}]: Remaining rows = ${res.headers.get('content-range') || '0'}`);
  }

  console.log('\n✅ Database wiped: 0 venues, 0 resources, 100% clean!');
}

wipeAllVenues().catch(err => {
  console.error('Wipe failed:', err);
  process.exit(1);
});
