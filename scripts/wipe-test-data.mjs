import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
});

export async function wipeTestData() {
  const client = await pool.connect();
  try {
    console.log('🧹 Wiping all test data, appointments, providers, staff, and auth users...');
    await client.query('BEGIN');
    await client.query("SET LOCAL app.trusted_write = 'true'");
    
    // 1. Truncate all transactional, entity, and logging tables
    await client.query(`
      TRUNCATE TABLE 
        public.bookings,
        public.payments,
        public.appointment_checkin_codes,
        public.doctor_front_desk_assignments,
        public.department_members,
        public.departments,
        public.resource_availability,
        public.resources,
        public.providers,
        public.push_tokens,
        public.staff_checkin_rate_limits,
        public.audit_logs,
        public.admin_audit_logs,
        public.notification_logs,
        public.app_logs,
        public.user_consents,
        public.account_deletion_requests,
        public.merchant_memberships,
        public.test_provider_clock_links,
        public.test_tenant_clocks,
        public.contact_reveal_audit,
        public.crash_alert_dedup,
        public.city_settlements,
        public.city_waitlist,
        public.profiles
      CASCADE;
    `);

    // 2. Clear all auth users (cascades to auth.identities, auth.sessions, auth.mfa_*, etc.)
    await client.query('DELETE FROM auth.users;');

    await client.query('COMMIT');
    console.log('✅ Database completely clean! 0 test users, 0 test providers, 0 test bookings.');
    console.log('✨ Categories, sub-categories, and cities preserved for clean user setup.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to wipe test data:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Allow direct execution: node scripts/wipe-test-data.mjs
if (process.argv[1]?.endsWith('wipe-test-data.mjs')) {
  wipeTestData();
}
