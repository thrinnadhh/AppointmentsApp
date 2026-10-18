import fs from 'fs';

/**
 * reset-hospital-test-data.mjs
 * Cleans up all isolated seed data created for Hospital Vertical tests:
 * - Hospital A ([TEST-HOSP-A] Tirupati Apex Hospital)
 * - Hospital B ([TEST-HOSP-B] Balaji Care Clinic)
 * - Non-hospital salon ([TEST-SALON] Tirupati Royal Salon & Spa)
 * - Associated test auth users, department members, bookings, and audit logs
 */
export async function resetHospitalTestData() {
  const envPath = 'apps/merchant-web/.env.local';
  if (!fs.existsSync(envPath)) {
    console.error('.env.local not found');
    process.exit(1);
  }
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
  };

  console.log('🧹 [RESET] Cleaning up Hospital Vertical test data...');

  // 1. Find all test providers
  const provRes = await fetch(`${url}/rest/v1/providers?select=id,name&or=(name.ilike.[TEST-HOSP-A]*,name.ilike.[TEST-HOSP-B]*,name.ilike.[TEST-SALON]*)`, {
    headers
  });
  const providers = await provRes.json();
  const providerIds = (Array.isArray(providers) ? providers : []).map(p => p.id);

  if (providerIds.length > 0) {
    console.log(`Found ${providerIds.length} test provider(s) to remove:`, providers.map(p => p.name));

    // Delete check-in codes
    await fetch(`${url}/rest/v1/appointment_checkin_codes?shop_id=in.(${providerIds.join(',')})`, {
      method: 'DELETE',
      headers
    });

    // Delete audit logs
    await fetch(`${url}/rest/v1/audit_logs?merchant_id=in.(${providerIds.join(',')})`, {
      method: 'DELETE',
      headers
    });

    // Delete bookings
    await fetch(`${url}/rest/v1/bookings?provider_id=in.(${providerIds.join(',')})`, {
      method: 'DELETE',
      headers: { ...headers, 'Prefer': 'return=minimal' }
    });

    // Delete department members
    await fetch(`${url}/rest/v1/department_members?merchant_id=in.(${providerIds.join(',')})`, {
      method: 'DELETE',
      headers
    });

    // Delete departments
    await fetch(`${url}/rest/v1/departments?merchant_id=in.(${providerIds.join(',')})`, {
      method: 'DELETE',
      headers
    });

    // Delete resources
    await fetch(`${url}/rest/v1/resources?provider_id=in.(${providerIds.join(',')})`, {
      method: 'DELETE',
      headers
    });

    // Delete memberships
    await fetch(`${url}/rest/v1/merchant_memberships?provider_id=in.(${providerIds.join(',')})`, {
      method: 'DELETE',
      headers
    });

    // Delete providers
    await fetch(`${url}/rest/v1/providers?id=in.(${providerIds.join(',')})`, {
      method: 'DELETE',
      headers
    });
  }

  // 2. Remove test Auth users
  const listUsersRes = await fetch(`${url}/auth/v1/admin/users?per_page=100`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const usersJson = await listUsersRes.json();
  const testUsers = (usersJson.users || []).filter(u => 
    u.email && (
      u.email.endsWith('@test-tirupati.local') ||
      u.email.includes('.invalid') ||
      u.email.startsWith('test.patient.') ||
      u.email.includes('test-hosp')
    )
  );

  console.log(`Found ${testUsers.length} test auth user(s) to remove.`);
  for (const u of testUsers) {
    // Clean profile first
    await fetch(`${url}/rest/v1/profiles?id=eq.${u.id}`, {
      method: 'DELETE',
      headers
    });
    // Delete auth user
    await fetch(`${url}/auth/v1/admin/users/${u.id}`, {
      method: 'DELETE',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
  }

  console.log('✅ [RESET] Complete. Database is clean of test harness data.');
}

if (process.argv[1] && process.argv[1].endsWith('reset-hospital-test-data.mjs')) {
  resetHospitalTestData().catch(err => {
    console.error('Reset error:', err);
    process.exit(1);
  });
}
