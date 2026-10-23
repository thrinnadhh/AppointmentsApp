/**
 * tests/scripts/reset-mission-test-state.mjs
 * 
 * Resets dynamic transactional test state (bookings, payments, check-in codes, audit logs)
 * for all test providers without deleting providers, accounts, or services.
 * Resets test clock back to 09:00 IST.
 */

import pg from 'pg';

const { Pool } = pg;

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 5,
  idleTimeoutMillis: 2000,
  allowExitOnIdle: true
});

export async function resetMissionState() {
  console.log('[RESET] Resetting mission transactional state...');
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.trusted_write = 'true'");

    // 1. Delete appointment check-in codes for test providers
    await client.query(`
      DELETE FROM public.appointment_checkin_codes
      WHERE provider_id IN (
        SELECT id FROM public.providers WHERE name LIKE '[TEST_%'
      )
    `);

    // 2. Delete payments for test bookings
    await client.query(`
      DELETE FROM public.payments
      WHERE booking_id IN (
        SELECT b.id FROM public.bookings b
        JOIN public.providers p ON p.id = b.provider_id
        WHERE p.name LIKE '[TEST_%'
      )
    `);

    // 3. Delete notification logs for test bookings
    await client.query(`
      DELETE FROM public.notification_logs
      WHERE booking_id IN (
        SELECT b.id FROM public.bookings b
        JOIN public.providers p ON p.id = b.provider_id
        WHERE p.name LIKE '[TEST_%'
      )
    `);

    // 4. Delete bookings for test providers
    await client.query(`
      DELETE FROM public.bookings
      WHERE provider_id IN (
        SELECT id FROM public.providers WHERE name LIKE '[TEST_%'
      )
    `);

    // 4b. Re-populate the 4 pre-allocated confirmed slots for the Fully Booked Edge Store
    await client.query(`
      INSERT INTO public.bookings (customer_id, provider_id, resource_id, slot_start, slot_end, status, payment_status, deposit_amount, platform_fee)
      SELECT 
        c.id, p.id, r.id, s.slot_start, s.slot_end, 'CONFIRMED', 'CAPTURED', 50, 5
      FROM public.providers p
      JOIN public.resources r ON r.provider_id = p.id
      CROSS JOIN (
        VALUES 
          ('2026-10-22T09:00:00+05:30'::timestamptz, '2026-10-22T09:30:00+05:30'::timestamptz),
          ('2026-10-22T09:30:00+05:30'::timestamptz, '2026-10-22T10:00:00+05:30'::timestamptz),
          ('2026-10-22T10:00:00+05:30'::timestamptz, '2026-10-22T10:30:00+05:30'::timestamptz),
          ('2026-10-22T10:30:00+05:30'::timestamptz, '2026-10-22T11:00:00+05:30'::timestamptz)
      ) AS s(slot_start, slot_end)
      CROSS JOIN LATERAL (
        SELECT id FROM public.profiles WHERE email LIKE 'customer.test.%@appointments-test.local' LIMIT 1
      ) c
      WHERE p.name LIKE '%Fully Booked%'
      ON CONFLICT DO NOTHING;
    `);

    // 5. Reset test tenant clock to 2026-10-22 09:00 IST
    await client.query(`
      UPDATE public.test_tenant_clocks
      SET simulated_time = '2026-10-22T09:00:00+05:30', updated_at = now()
      WHERE tenant_prefix = 'MISSION'
    `);

    await client.query('COMMIT');
    console.log('✓ Reset complete: Transactional state cleared, clock reset to 09:00 IST.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reset failure:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith('reset-mission-test-state.mjs')) {
  resetMissionState()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
