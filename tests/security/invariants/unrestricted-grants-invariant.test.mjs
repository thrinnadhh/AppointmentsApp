import { test } from 'node:test';
import assert from 'node:assert';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RESTRICTED_PROCEDURES = [
  'purge_old_app_logs',
  'expire_stale_standby_queue',
  'mask_old_notification_logs',
  'enqueue_refund_request',
  'cron_daily_cleanup',
  'cron_expire_no_shows',
  'cron_trigger_queue_consumers',
  'release_expired_holds',
  'cancel_unpaid_pending_bookings',
  'enqueue_booking_reminders',
  'purge_expired_waitlist_entries',
  'trigger_whatsapp_sender_cron',
  'replay_dlq_message',
  'read_queue_with_dlq',
  'set_booking_slot_for_reminder',
  'advance_test_clock',
  'set_test_clock'
];

test('Invariant: Internal maintenance and queue procedures must not have public/anon execute grants', async () => {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  try {
    const query = `
      SELECT 
          p.proname AS func_name,
          pg_get_function_identity_arguments(p.oid) AS args,
          p.prosrc AS body,
          has_function_privilege('anon', p.oid, 'execute') AS anon_exec,
          has_function_privilege('authenticated', p.oid, 'execute') AS auth_exec
      FROM pg_proc p
      WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
        AND p.proname = ANY($1::text[])
      ORDER BY p.proname;
    `;

    const { rows } = await client.query(query, [RESTRICTED_PROCEDURES]);
    assert.ok(rows.length > 0, 'Database catalog must return restricted procedures');

    const violations = [];
    for (const row of rows) {
      const fullName = `${row.func_name}(${row.args})`;
      const hasInFunctionCheck = 
        row.body.includes('auth.uid()') ||
        row.body.includes('is_admin') ||
        row.body.includes('get_user_authorized_providers') ||
        row.body.includes('auth.role()');

      if (row.anon_exec) {
        violations.push({ procedure: fullName, error: 'EXECUTABLE_BY_ANON' });
      } else if (row.auth_exec && !hasInFunctionCheck) {
        violations.push({ procedure: fullName, error: 'EXECUTABLE_BY_AUTHENTICATED_WITHOUT_RBAC' });
      }
    }

    assert.deepStrictEqual(violations, [], `Restricted procedures must not have unprivileged execution grants: ${JSON.stringify(violations)}`);
  } finally {
    await client.end();
  }
});
