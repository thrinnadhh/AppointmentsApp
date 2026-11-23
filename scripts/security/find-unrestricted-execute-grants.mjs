#!/usr/bin/env node
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const client = new pg.Client({ connectionString: DB_URL });

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

async function run() {
  await client.connect();

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

  let violations = 0;

  console.log('=== RESTRICTED MAINTENANCE PROCEDURES PRIVILEGE AUDIT ===');
  for (const row of rows) {
    const fullName = `${row.func_name}(${row.args})`;
    const hasInFunctionCheck = 
      row.body.includes('auth.uid()') ||
      row.body.includes('is_admin') ||
      row.body.includes('get_user_authorized_providers') ||
      row.body.includes('auth.role()');

    if (row.anon_exec) {
      console.log(`VIOLATION: ${fullName} -> EXECUTABLE_BY_ANON`);
      violations++;
    } else if (row.auth_exec && !hasInFunctionCheck) {
      console.log(`VIOLATION: ${fullName} -> EXECUTABLE_BY_AUTHENTICATED_WITHOUT_IN_FUNCTION_RBAC`);
      violations++;
    } else if (row.auth_exec && hasInFunctionCheck) {
      console.log(`COMPLIANT (AUTHENTICATED_WITH_RBAC): ${fullName} -> Authenticated execution gated by in-function RBAC check`);
    } else {
      console.log(`COMPLIANT (SERVICE_ROLE_ONLY): ${fullName} -> Revoked from anon/authenticated (service_role only)`);
    }
  }

  console.log(`\nSUMMARY: restricted_procedures=${rows.length} violations=${violations}`);
  await client.end();
  process.exit(violations > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Execution error:', err);
  process.exit(1);
});
