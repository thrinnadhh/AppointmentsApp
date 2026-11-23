/**
 * tests/security/database-grants-allowlist.test.mjs
 *
 * Wave 1 Security Suite: Database Grants Allowlist, Default Privileges,
 * Anon EXECUTE Allowlist, and RLS WITH CHECK Completeness.
 *
 * Rules:
 * - Fails if DB is unavailable when CI=true (no silent skips).
 * - Asserts explicit table->privilege allowlists for anon and authenticated.
 * - Asserts all UPDATE / ALL RLS policies specify an explicit WITH CHECK clause.
 * - Asserts exactly the 4 approved public functions are EXECUTE-callable by anon.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const isCI = process.env.CI === 'true';

function runSql(query) {
  try {
    const cmd = `docker exec -i supabase_db_Appointments psql -U postgres -d postgres -t -A -c "${query.replace(/"/g, '\\"')}"`;
    return execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim();
  } catch (err) {
    if (isCI) {
      assert.fail(`Database query failed in CI environment: ${err.message}`);
    }
    throw err;
  }
}

describe('Packet 1.1: Database Grants, Privileges, and RLS WITH CHECK Compliance', () => {

  it('1. RLS WITH CHECK clause completeness: all UPDATE and ALL policies must specify WITH CHECK', () => {
    const sql = `
      SELECT tablename || '::' || policyname || '::' || cmd
      FROM pg_policies 
      WHERE schemaname = 'public' 
        AND cmd IN ('UPDATE', 'ALL') 
        AND with_check IS NULL;
    `;
    const output = runSql(sql);
    const missing = output ? output.split('\n').filter(Boolean) : [];
    assert.deepEqual(missing, [], `Found policies with NULL with_check clause: ${missing.join(', ')}`);
  });

  it('2. Anon EXECUTE privilege allowlist: exactly the 4 approved functions callable by anon', () => {
    const sql = `
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND has_function_privilege('anon', p.oid, 'EXECUTE') = true
      ORDER BY p.proname;
    `;
    const output = runSql(sql);
    const anonFuncs = output ? output.split('\n').filter(Boolean) : [];
    const expected = [
      'get_active_cities',
      'get_nearby_providers',
      'log_client_event',
      'submit_city_waitlist'
    ];
    assert.deepEqual(anonFuncs.sort(), expected.sort(), `Anon execute allowlist mismatch: found ${anonFuncs.join(', ')}`);
  });

  it('3. Anon Table Grant Allowlist: anon must only have SELECT on approved catalog tables', () => {
    const sql = `
      SELECT DISTINCT table_name || '::' || privilege_type
      FROM information_schema.table_privileges
      WHERE table_schema = 'public' AND grantee = 'anon'
      ORDER BY 1;
    `;
    const output = runSql(sql);
    const grants = output ? output.split('\n').filter(Boolean) : [];
    
    // Anon must never have INSERT, UPDATE, DELETE, TRUNCATE on any table
    const illegalGrants = grants.filter(g => !g.endsWith('::SELECT'));
    assert.deepEqual(illegalGrants, [], `Anon has non-SELECT write privileges: ${illegalGrants.join(', ')}`);
    
    // All granted tables must be in public catalog allowlist
    const allowedCatalogTables = new Set([
      'categories::SELECT',
      'cities::SELECT',
      'sub_categories::SELECT',
      'resources::SELECT',
      'resource_availability::SELECT',
      'providers::SELECT'
    ]);
    
    for (const g of grants) {
      assert.ok(allowedCatalogTables.has(g), `Unexpected anon table grant: ${g}`);
    }
  });

  it('4. Authenticated Table Grant Lockdown: authenticated must have ZERO write privileges on server-managed financial tables', () => {
    const sql = `
      SELECT DISTINCT table_name || '::' || privilege_type
      FROM information_schema.table_privileges
      WHERE table_schema = 'public' 
        AND grantee = 'authenticated'
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
        AND table_name IN ('payments', 'city_settlements', 'merchant_vendor_splits', 'platform_config', 'admin_audit_logs', 'audit_logs', 'appointment_checkin_codes', 'resource_availability')
      ORDER BY 1;
    `;
    const output = runSql(sql);
    const illegal = output ? output.split('\n').filter(Boolean) : [];
    assert.deepEqual(illegal, [], `Authenticated role has direct write grants on server-managed tables: ${illegal.join(', ')}`);
  });

  it('5. Default Privileges Hygiene: assert postgres default privileges do not grant unmanaged write access to anon in public schema', () => {
    const sql = `
      SELECT defaclrole::regrole::text || '::' || defaclnamespace::regnamespace::text || '::' || defaclobjtype::text
      FROM pg_default_acl
      WHERE defaclrole = 'postgres'::regrole 
        AND defaclnamespace = 'public'::regnamespace
        AND (defaclacl::text LIKE '%anon=w%' OR defaclacl::text LIKE '%anon=a%' OR defaclacl::text LIKE '%anon=d%');
    `;
    const output = runSql(sql);
    const dangerous = output ? output.split('\n').filter(Boolean) : [];
    assert.deepEqual(dangerous, [], `Dangerous default write ACL found for anon under postgres: ${dangerous.join(', ')}`);
  });

  it('6. Maintenance and queue RPCs EXECUTE lockdown (SEC-WIN-020)', () => {
    const migrationPath = 'supabase/migrations/20261120000006_lockdown_maintenance_and_queue_rpcs.sql';
    assert.ok(existsSync(migrationPath), `Migration ${migrationPath} must exist`);

    const migrationSql = readFileSync(migrationPath, 'utf-8');

    const script = `
      BEGIN;
      ${migrationSql}

      SELECT p.proname || '::authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE') || '::service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname IN ('purge_old_app_logs', 'expire_stale_standby_queue', 'mask_old_notification_logs', 'enqueue_refund_request', 'dispatch_booking_notification')
      ORDER BY p.proname;

      ROLLBACK;
    `;
    const cmd = 'docker exec -i supabase_db_Appointments psql -U postgres -d postgres -t -A';
    const output = execSync(cmd, { input: script, encoding: 'utf-8', timeout: 10000 }).trim();

    const lines = output.split('\n').filter(Boolean);
    
    assert.ok(lines.some(l => l === 'purge_old_app_logs::authenticated=false::service_role=true'), `purge_old_app_logs must be service_role only: ${output}`);
    assert.ok(lines.some(l => l === 'expire_stale_standby_queue::authenticated=false::service_role=true'), `expire_stale_standby_queue must be service_role only: ${output}`);
    assert.ok(lines.some(l => l === 'mask_old_notification_logs::authenticated=false::service_role=true'), `mask_old_notification_logs must be service_role only: ${output}`);
    assert.ok(lines.some(l => l === 'enqueue_refund_request::authenticated=false::service_role=true'), `enqueue_refund_request must be service_role only: ${output}`);
    assert.ok(lines.some(l => l === 'dispatch_booking_notification::authenticated=true::service_role=true'), `dispatch_booking_notification must remain callable by authenticated: ${output}`);
  });

});
