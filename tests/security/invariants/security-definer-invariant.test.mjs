import { test } from 'node:test';
import assert from 'node:assert';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

test('Invariant: Every SECURITY DEFINER function must have a pinned search_path and an auth or role check', async () => {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  try {
    const query = `
      SELECT 
          n.nspname AS schema_name,
          p.proname AS func_name,
          pg_get_function_identity_arguments(p.oid) AS args,
          p.proconfig AS config,
          p.prorettype::regtype::text AS return_type,
          p.prosrc AS body,
          has_function_privilege('anon', p.oid, 'execute') AS anon_exec,
          has_function_privilege('authenticated', p.oid, 'execute') AS auth_exec
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname IN ('public', 'private')
        AND p.prosecdef = true
      ORDER BY n.nspname, p.proname;
    `;

    const { rows } = await client.query(query);
    assert.ok(rows.length > 0, 'Database catalog must return security definer functions');

    const violations = [];

    const ALLOWLIST_UTILITIES = new Set([
      'build_template_params',
      'compute_gst_for_booking',
      'check_rate_limit',
      'read_queue_with_dlq',
      'get_test_clock',
      'get_test_clock_for_prefix',
      'set_booking_slot_for_reminder',
      'set_booking_reference_code',
      'sync_resource_user_id',
      'remove_stale_push_token',
      'cron_daily_cleanup',
      'cron_expire_no_shows',
      'cron_trigger_queue_consumers',
      'release_expired_holds',
      'cancel_unpaid_pending_bookings',
      'enqueue_booking_reminders',
      'purge_expired_waitlist_entries',
      'trigger_whatsapp_sender_cron',
      'is_city_director_for_city',
      'is_hospital_provider',
      'search_directory_public',
      'submit_city_waitlist',
      'get_active_cities'
    ]);

    for (const row of rows) {
      const fullName = `${row.schema_name}.${row.func_name}(${row.args})`;
      const hasPinnedSearchPath = (row.config || []).some(c => c.startsWith('search_path='));

      const hasAuthCheck = 
        row.body.includes('auth.uid()') ||
        row.body.includes('auth.role()') ||
        row.body.includes('is_caller_authorized') ||
        row.body.includes('is_admin') ||
        row.body.includes('session_user') ||
        row.body.includes('current_setting');

      const isTrigger = row.return_type === 'trigger';
      const isDelegatingWrapper = 
        (row.schema_name === 'public' && row.body.includes('private.' + row.func_name)) ||
        (row.func_name === 'request_account_deletion' && row.body.includes('delete_account_immediately'));

      const isServiceRoleLocked = !row.anon_exec && !row.auth_exec;
      const isPureUtility = ALLOWLIST_UTILITIES.has(row.func_name);

      if (!hasPinnedSearchPath) {
        violations.push({ function: fullName, reason: 'MISSING_PINNED_SEARCH_PATH' });
      } else if (!hasAuthCheck && !isServiceRoleLocked && !isTrigger && !isDelegatingWrapper && !isPureUtility) {
        violations.push({ function: fullName, reason: 'UNGUARDED_CLIENT_EXECUTION' });
      }
    }

    assert.deepStrictEqual(violations, [], `Discovered invalid SECURITY DEFINER procedures: ${JSON.stringify(violations)}`);
  } finally {
    await client.end();
  }
});
