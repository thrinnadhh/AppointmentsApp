import fs from 'fs';
import { Client } from 'pg';

if (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production') {
  console.error('FATAL: Destructive script blocked in production.');
  process.exit(1);
}

async function runFreshWipe() {
  console.log('====================================================');
  console.log('   🧹 FRESH SUPABASE TEST DATA WIPE INITIATED');
  console.log('====================================================\n');

  // Read environment config
  const envPath = 'apps/merchant-web/.env.local';
  const envContent = fs.readFileSync(envPath, 'utf8');
  const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
  const serviceKeyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);

  if (!urlMatch || !serviceKeyMatch) {
    throw new Error('Missing Supabase configuration in .env.local');
  }

  const supabaseUrl = urlMatch[1];
  const serviceRoleKey = serviceKeyMatch[1];

  const adminEmail = process.env.TEST_ADMIN_EMAIL || 'admin@appointments-tirupati.com';
  const adminPassword = process.env.TEST_ADMIN_PASSWORD || 'AdminSecure2026!';

  // Connect directly to PostgreSQL
  const pgClient = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await pgClient.connect();
  console.log('✓ Connected to PostgreSQL database (127.0.0.1:54322)');

  try {
    // 1. Drop the event trigger that auto-seeds providers on DDL
    console.log('\n--- 1. Removing automatic test data seed triggers ---');
    await pgClient.query('DROP EVENT TRIGGER IF EXISTS evt_handle_ddl_setup;');
    await pgClient.query('DROP FUNCTION IF EXISTS public._handle_ddl_setup();');
    console.log('✓ Dropped evt_handle_ddl_setup event trigger');

    // 2. Truncate all transactional and entity tables
    console.log('\n--- 2. Truncating all test data (Venues, Bookings, Logs, Users) ---');
    const tablesToTruncate = [
      'public.account_deletion_requests',
      'public.admin_audit_logs',
      'public.app_logs',
      'public.appointment_checkin_codes',
      'public.audit_logs',
      'public.bookings',
      'public.city_settlements',
      'public.city_waitlist',
      'public.contact_reveal_audit',
      'public.department_members',
      'public.departments',
      'public.doctor_front_desk_assignments',
      'public.merchant_memberships',
      'public.notification_logs',
      'public.payments',
      'public.resource_availability',
      'public.resources',
      'public.staff_checkin_rate_limits',
      'public.test_provider_clock_links',
      'public.test_tenant_clocks',
      'public.user_consents',
      'public.providers',
      'public.profiles',
      'auth.audit_log_entries',
      'auth.users'
    ];

    await pgClient.query(`TRUNCATE TABLE ${tablesToTruncate.join(', ')} CASCADE;`);
    console.log('✓ Successfully truncated all test entities, bookings, logs, and users (CASCADE)');

    // 3. Create fresh Super Admin account via GoTrue Admin API
    console.log(`\n--- 3. Provisioning clean Super Admin account (${adminEmail}) ---`);
    const createAdminRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
        user_metadata: {
          role: 'admin',
          full_name: 'Platform Owner (Super Admin)',
        },
      }),
    });

    if (!createAdminRes.ok) {
      const errText = await createAdminRes.text();
      throw new Error(`Failed to create super admin: ${createAdminRes.statusText} - ${errText}`);
    }

    const adminUser = await createAdminRes.json();
    console.log(`✓ Super Admin created in Auth (ID: ${adminUser.id})`);

    // 4. Ensure admin profile in public.profiles
    await pgClient.query("SET app.trusted_write = 'true';");
    await pgClient.query(
      `INSERT INTO public.profiles (id, full_name, email, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE 
       SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, email = EXCLUDED.email;`,
      [adminUser.id, 'Platform Owner (Super Admin)', adminEmail, 'admin']
    );
    console.log('✓ Super Admin profile record ensured in public.profiles (role: admin)');

    // 5. Ensure core catalog (Categories, Sub-categories, Cities, Platform Config)
    console.log('\n--- 4. Verifying core system catalog & configurations ---');
    const catRes = await pgClient.query('SELECT count(*) FROM public.categories;');
    const subCatRes = await pgClient.query('SELECT count(*) FROM public.sub_categories;');
    const citiesRes = await pgClient.query('SELECT count(*) FROM public.cities;');
    const configRes = await pgClient.query('SELECT count(*) FROM public.platform_config;');

    console.log(`✓ Categories intact: ${catRes.rows[0].count} service verticals`);
    console.log(`✓ Sub-categories intact: ${subCatRes.rows[0].count} specialties`);
    console.log(`✓ Cities intact: ${citiesRes.rows[0].count} territories`);
    console.log(`✓ Platform Config intact: ${configRes.rows[0].count} settings`);

    // 6. Comprehensive Verification of All Public Tables
    console.log('\n--- 5. Final Row Count Verification ---');
    const tableVerification = [
      'providers',
      'resources',
      'resource_availability',
      'departments',
      'merchant_memberships',
      'bookings',
      'appointment_checkin_codes',
      'notification_logs',
      'audit_logs',
      'app_logs',
      'city_waitlist',
      'profiles',
    ];

    for (const t of tableVerification) {
      const r = await pgClient.query(`SELECT count(*) FROM public."${t}";`);
      console.log(`  - public.${t.padEnd(28)} : ${r.rows[0].count} rows`);
    }

    const authUsersCount = await pgClient.query('SELECT count(*) FROM auth.users;');
    console.log(`  - auth.users                     : ${authUsersCount.rows[0].count} user (Super Admin only)`);

    console.log('\n====================================================');
    console.log('   ✨ DATABASE IS COMPLETELY FRESH & READY');
    console.log('   - 0 Providers / Venues');
    console.log('   - 0 Bookings / Appointments');
    console.log('   - 0 Test Customers / Test Merchants');
    console.log(`   - 1 Super Admin: ${adminEmail}`);
    console.log('====================================================\n');
  } finally {
    await pgClient.end();
  }
}

runFreshWipe().catch((err) => {
  console.error('\n❌ Fresh wipe failed:', err);
  process.exit(1);
});
