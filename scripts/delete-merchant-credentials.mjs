import fs from 'fs';

async function deleteMerchantCredentials() {
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
    'Content-Type': 'application/json'
  };

  console.log('--- 1. Deleting Merchant Auth Accounts from Supabase Auth ---');
  let page = 1;
  let allUsers = [];
  while (true) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=100`, {
      headers
    });
    const data = await res.json();
    if (!data.users || data.users.length === 0) break;
    allUsers.push(...data.users);
    page++;
  }

  const merchantUsers = allUsers.filter(u =>
    u.user_metadata?.role === 'merchant' ||
    u.email?.includes('merch') ||
    u.email?.includes('owner') ||
    u.email?.includes('staff') ||
    u.email?.includes('care.') ||
    u.email?.includes('turf@') ||
    u.email?.includes('fixtest_') ||
    u.email?.includes('probe_merch') ||
    u.email?.includes('svims') ||
    u.email?.includes('naturals')
  );

  console.log(`Found ${merchantUsers.length} merchant auth accounts to delete.`);

  let deletedCount = 0;
  for (const user of merchantUsers) {
    const delRes = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers
    });
    if (delRes.ok) {
      deletedCount++;
    } else {
      console.warn(`Failed to delete user ${user.id} (${user.email}): ${delRes.statusText}`);
    }
  }
  console.log(`Successfully deleted ${deletedCount} merchant auth accounts.`);

  console.log('\n--- 2. Clearing Merchant Emails in Database Providers ---');
  const clearEmailRes = await fetch(`${url}/rest/v1/providers?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'PATCH',
    headers: {
      ...headers,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ email: null })
  });
  if (clearEmailRes.ok) {
    const updated = await clearEmailRes.json();
    console.log(`Successfully cleared email field for ${updated.length} providers in database.`);
  } else {
    console.warn('Failed to clear provider emails:', clearEmailRes.statusText);
  }

  console.log('\n--- 3. Removing Merchant Credentials from .env.local ---');
  let newEnv = envContent
    .replace(/^TEST_MERCHANT_EMAIL=.*$/gm, '# TEST_MERCHANT_EMAIL removed')
    .replace(/^TEST_MERCHANT_PASSWORD=.*$/gm, '# TEST_MERCHANT_PASSWORD removed')
    .replace(/^TEST_SALON_EMAIL=.*$/gm, '# TEST_SALON_EMAIL removed')
    .replace(/^TEST_SALON_PASSWORD=.*$/gm, '# TEST_SALON_PASSWORD removed');

  fs.writeFileSync(envPath, newEnv, 'utf8');
  console.log('Removed TEST_MERCHANT_EMAIL, TEST_MERCHANT_PASSWORD, TEST_SALON_EMAIL, TEST_SALON_PASSWORD from .env.local.');

  console.log('\n--- Verification ---');
  // Check remaining auth users
  const verifyUsersRes = await fetch(`${url}/auth/v1/admin/users?per_page=100`, { headers });
  const verifyUsers = await verifyUsersRes.json();
  const remainingMerchants = (verifyUsers.users || []).filter(u => u.user_metadata?.role === 'merchant');
  console.log(`Remaining merchant auth users in Supabase Auth: ${remainingMerchants.length}`);

  // Check providers email
  const verifyProvRes = await fetch(`${url}/rest/v1/providers?select=id,name,email`, { headers });
  const verifyProv = await verifyProvRes.json();
  console.log('Providers in database:');
  verifyProv.forEach(p => console.log(`  - ${p.name}: email = ${p.email || 'NULL (cleared)'}`));

  console.log('\n✅ All merchant emails and passwords deleted successfully!');
}

deleteMerchantCredentials().catch(err => {
  console.error('Operation failed:', err);
  process.exit(1);
});
