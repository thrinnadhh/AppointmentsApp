import fs from 'fs';

async function cleanMockData() {
  const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
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

  const OFFICIAL_PROVIDER_IDS = [
    '11111111-1111-1111-1111-111111111111', // Sri Venkateswara Dental & Implant Care
    '22222222-2222-2222-2222-222222222222', // Saptagiri Heritage Dining
    '33333333-3333-3333-3333-333333333333', // Tirupati Premier Turf & Gaming Arena
    '44444444-4444-4444-4444-444444444444', // Naturals Luxury Salon & Spa
    '55555555-5555-5555-5555-555555555555', // Tirumala Pet Clinic & Grooming Spa
    '58f2808d-86a9-489f-838d-7b066302426f', // Trinadh Multispecialty Hospital
  ];

  console.log('--- Starting Mock Data Cleanup ---');

  // 1. Delete notification logs
  console.log('1. Cleaning test notification logs...');
  const delNotifsRes = await fetch(`${url}/rest/v1/notification_logs?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers
  });
  const delNotifs = await delNotifsRes.json().catch(() => []);
  console.log(`   Deleted ${Array.isArray(delNotifs) ? delNotifs.length : 'all'} notification logs.`);

  // 2. Delete test payments
  console.log('2. Cleaning test payments...');
  const delPaymentsRes = await fetch(`${url}/rest/v1/payments?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers
  });
  const delPayments = await delPaymentsRes.json().catch(() => []);
  console.log(`   Deleted ${Array.isArray(delPayments) ? delPayments.length : 'all'} test payments.`);

  // 3. Delete test bookings
  console.log('3. Cleaning test bookings...');
  const delBookingsRes = await fetch(`${url}/rest/v1/bookings?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers
  });
  const delBookings = await delBookingsRes.json().catch(() => []);
  console.log(`   Deleted ${Array.isArray(delBookings) ? delBookings.length : 'all'} test bookings.`);

  // 4. Fetch all providers and identify test ones
  console.log('4. Identifying test providers to remove...');
  const provRes = await fetch(`${url}/rest/v1/providers?select=id,name`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const allProviders = await provRes.json();
  const testProviders = allProviders.filter(p => !OFFICIAL_PROVIDER_IDS.includes(p.id));
  console.log(`   Found ${allProviders.length} total providers; ${testProviders.length} are test/generated venues.`);

  const testProviderIds = testProviders.map(p => p.id);

  if (testProviderIds.length > 0) {
    // Split into batches of 30 to avoid URL length limits
    const batchSize = 30;
    for (let i = 0; i < testProviderIds.length; i += batchSize) {
      const batch = testProviderIds.slice(i, i + batchSize);
      const idFilter = `in.(${batch.join(',')})`;

      // Delete merchant memberships for test providers
      await fetch(`${url}/rest/v1/merchant_memberships?provider_id=${idFilter}`, {
        method: 'DELETE',
        headers
      }).catch(() => {});

      // Delete resources for test providers
      await fetch(`${url}/rest/v1/resources?provider_id=${idFilter}`, {
        method: 'DELETE',
        headers
      }).catch(() => {});

      // Delete test providers
      await fetch(`${url}/rest/v1/providers?id=${idFilter}`, {
        method: 'DELETE',
        headers
      }).catch(() => {});
    }
    console.log(`   Successfully removed ${testProviderIds.length} test providers and their resources.`);
  }

  // Verification
  console.log('\n--- Final Verification ---');
  for (const table of ['providers', 'resources', 'bookings', 'payments', 'notification_logs']) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
      method: 'HEAD',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Prefer': 'count=exact' }
    });
    console.log(`Table [${table}]: Remaining rows = ${res.headers.get('content-range') || '0'}`);
  }

  // Print remaining official providers
  const finalProvRes = await fetch(`${url}/rest/v1/providers?select=id,name,category_id,city`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const finalProviders = await finalProvRes.json();
  console.log('\nOfficial Retained Providers:');
  finalProviders.forEach((p, idx) => {
    console.log(`  ${idx + 1}. [${p.category_id}] ${p.name} (${p.city}) - ID: ${p.id}`);
  });

  console.log('\n✅ Mock data cleanup complete!');
}

cleanMockData().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
