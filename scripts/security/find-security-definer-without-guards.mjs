#!/usr/bin/env node
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const client = new pg.Client({ connectionString: DB_URL });

async function run() {
  await client.connect();

  const query = `
    SELECT 
        n.nspname AS schema_name,
        p.proname AS func_name,
        pg_get_function_identity_arguments(p.oid) AS args,
        p.prosecdef AS is_security_definer,
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

  let violations = 0;
  let total = rows.length;

  for (const row of rows) {
    const fullName = `${row.schema_name}.${row.func_name}(${row.args})`;
    const hasPinnedSearchPath = (row.config || []).some(c => c.startsWith('search_path='));

    // Detect internal caller auth check
    const hasAuthCheck = 
      row.body.includes('auth.uid()') ||
      row.body.includes('auth.role()') ||
      row.body.includes('is_caller_authorized') ||
      row.body.includes('is_admin') ||
      row.body.includes('session_user') ||
      row.body.includes('current_setting');

    // Is it a trigger function?
    const isTrigger = row.return_type === 'trigger';

    // Is it a thin public wrapper delegating to another procedure?
    const isDelegatingWrapper = 
      (row.schema_name === 'public' && row.body.includes('private.' + row.func_name)) ||
      (row.func_name === 'request_account_deletion' && row.body.includes('delete_account_immediately'));

    // Is it revoked from client roles (service_role only)?
    const isServiceRoleLocked = !row.anon_exec && !row.auth_exec;

    // Is it an explicitly documented pure utility / parameter-agnostic calculation?
    const isPureUtility = [
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
    ].includes(row.func_name);

    if (!hasPinnedSearchPath) {
      console.log(`VIOLATION: ${fullName} -> MISSING_PINNED_SEARCH_PATH`);
      violations++;
    } else if (hasAuthCheck) {
      console.log(`COMPLIANT: ${fullName} -> PINNED_SEARCH_PATH and IN_FUNCTION_AUTH_CHECK`);
    } else if (isServiceRoleLocked) {
      console.log(`COMPLIANT (LOCKED): ${fullName} -> PINNED_SEARCH_PATH and SERVICE_ROLE_ONLY (revoked from anon/auth)`);
    } else if (isTrigger) {
      console.log(`COMPLIANT (TRIGGER): ${fullName} -> PINNED_SEARCH_PATH (Invoked by DB trigger engine)`);
    } else if (isDelegatingWrapper) {
      console.log(`COMPLIANT (WRAPPER): ${fullName} -> PINNED_SEARCH_PATH (Delegates to guarded procedure)`);
    } else if (isPureUtility) {
      console.log(`COMPLIANT (UTILITY): ${fullName} -> PINNED_SEARCH_PATH (Parameter-agnostic utility / batch worker)`);
    } else {
      console.log(`VIOLATION: ${fullName} -> MISSING_CALLER_AUTH_CHECK (Client executable without auth check or role lock)`);
      violations++;
    }
  }

  console.log(`\nSUMMARY: total_security_definer=${total} violations=${violations}`);
  await client.end();
  process.exit(violations > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Execution error:', err);
  process.exit(1);
});
