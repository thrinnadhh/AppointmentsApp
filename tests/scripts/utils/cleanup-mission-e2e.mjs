/**
 * tests/scripts/cleanup-mission-e2e.mjs
 * 
 * Complete cleanup script to purge all [TEST_% providers, accounts, and clock links.
 */

import pg from 'pg';

const { Pool } = pg;

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 5,
  idleTimeoutMillis: 2000,
  allowExitOnIdle: true
});

export async function cleanupMissionData() {
  console.log('[CLEANUP] Purging all mission test entities...');
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.trusted_write = 'true'");

    // 1. Delete all bookings for test providers
    await client.query(`
      DELETE FROM public.bookings
      WHERE provider_id IN (
        SELECT id FROM public.providers WHERE name LIKE '[TEST_%'
      )
    `);

    // 2. Delete test provider clock links
    await client.query(`
      DELETE FROM public.test_provider_clock_links
      WHERE tenant_prefix = 'MISSION'
    `);

    // 3. Delete test clock
    await client.query(`
      DELETE FROM public.test_tenant_clocks
      WHERE tenant_prefix = 'MISSION'
    `);

    // 4. Delete doctor front desk assignments for test providers
    await client.query(`
      DELETE FROM public.doctor_front_desk_assignments
      WHERE provider_id IN (
        SELECT id FROM public.providers WHERE name LIKE '[TEST_%'
      )
    `);

    // 5. Delete department members for test providers
    await client.query(`
      DELETE FROM public.department_members
      WHERE merchant_id IN (
        SELECT id FROM public.providers WHERE name LIKE '[TEST_%'
      )
    `);

    // 6. Delete departments for test providers
    await client.query(`
      DELETE FROM public.departments
      WHERE merchant_id IN (
        SELECT id FROM public.providers WHERE name LIKE '[TEST_%'
      )
    `);

    // 7. Delete resources for test providers
    await client.query(`
      DELETE FROM public.resources
      WHERE provider_id IN (
        SELECT id FROM public.providers WHERE name LIKE '[TEST_%'
      )
    `);

    // 8. Delete merchant memberships
    await client.query(`
      DELETE FROM public.merchant_memberships
      WHERE provider_id IN (
        SELECT id FROM public.providers WHERE name LIKE '[TEST_%'
      )
    `);

    // 9. Delete test providers
    await client.query(`
      DELETE FROM public.providers
      WHERE name LIKE '[TEST_%'
    `);

    // 10. Delete test auth users & profiles
    await client.query(`
      DELETE FROM auth.users
      WHERE email LIKE 'customer.test.%@appointments-test.local'
         OR email LIKE '%.doc@mission-test.local'
         OR email LIKE 'fd%@mission-test.local'
         OR email LIKE 'merchant.store%@mission-test.local'
         OR email = 'admin.hospital@mission-test.local'
    `);

    await client.query('COMMIT');
    console.log('✓ Cleanup complete: All test entities cleanly removed.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cleanup failure:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith('cleanup-mission-e2e.mjs')) {
  cleanupMissionData()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
