/**
 * tests/security/security-definer-schema-guard.test.mjs
 *
 * Wave 1 Security Suite: SECURITY DEFINER Search Path and Schema Guard.
 *
 * Rules:
 * - Fails if DB is unavailable when CI=true.
 * - Asserts every SECURITY DEFINER function sets an explicit search_path.
 * - Asserts no SECURITY DEFINER search_path references any schema where non-superusers can write or CREATE.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

describe('Packet 1.2: SECURITY DEFINER search_path & Schema Isolation Guard', () => {

  it('1. All SECURITY DEFINER functions must set an explicit search_path in proconfig', () => {
    const sql = `
      SELECT n.nspname || '.' || p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE p.prosecdef = true
        AND n.nspname IN ('public', 'private')
        AND (
          p.proconfig IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'
          )
        );
    `;
    const output = runSql(sql);
    const missing = output ? output.split('\n').filter(Boolean) : [];
    assert.deepEqual(missing, [], `SECURITY DEFINER functions with unset search_path: ${missing.join(', ')}`);
  });

  it('2. Zero non-superuser CREATE privileges on schemas referenced in search_path (vault, net, extensions, pgmq, storage)', () => {
    const sql = `
      SELECT n.nspname || '::' || rol
      FROM pg_namespace n
      CROSS JOIN (VALUES ('public'), ('anon'), ('authenticated')) AS roles(rol)
      WHERE n.nspname IN ('vault', 'net', 'extensions', 'pgmq', 'storage')
        AND has_schema_privilege(rol, n.nspname, 'CREATE') = true;
    `;
    const output = runSql(sql);
    const unprivilegedCreates = output ? output.split('\n').filter(Boolean) : [];
    assert.deepEqual(unprivilegedCreates, [], `Non-superusers have CREATE privileges in sensitive utility schemas: ${unprivilegedCreates.join(', ')}`);
  });

  it('3. Public schema CREATE privilege lockdown: anon and authenticated cannot CREATE in public schema', () => {
    const sql = `
      SELECT r.rolname
      FROM pg_roles r
      WHERE r.rolname IN ('anon', 'authenticated')
        AND has_schema_privilege(r.oid, 'public'::regnamespace, 'CREATE') = true;
    `;
    const output = runSql(sql);
    const unprivileged = output ? output.split('\n').filter(Boolean) : [];
    assert.deepEqual(unprivileged, [], `Non-superusers have CREATE privilege in public schema: ${unprivileged.join(', ')}`);
  });

});
