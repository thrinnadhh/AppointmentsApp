import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';

describe('Security Audit: Database Grants & Function Overload Resolution', () => {
  function runSql(query) {
    const raw = execSync(
      `supabase db query --output json "${query.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(raw);
    return parsed.rows || [];
  }

  it('1. service_role has SELECT, INSERT, UPDATE grants on public.payments', () => {
    const rows = runSql(`
      SELECT privilege_type 
      FROM information_schema.role_table_grants 
      WHERE table_schema = 'public' 
        AND table_name = 'payments' 
        AND grantee = 'service_role';
    `);
    const privs = rows.map((r) => r.privilege_type);
    assert.ok(privs.includes('SELECT'), 'service_role must have SELECT on public.payments');
    assert.ok(privs.includes('INSERT'), 'service_role must have INSERT on public.payments');
    assert.ok(privs.includes('UPDATE'), 'service_role must have UPDATE on public.payments');
  });

  it('2. authenticated has SELECT grant on public.payments', () => {
    const rows = runSql(`
      SELECT privilege_type 
      FROM information_schema.role_table_grants 
      WHERE table_schema = 'public' 
        AND table_name = 'payments' 
        AND grantee = 'authenticated';
    `);
    const privs = rows.map((r) => r.privilege_type);
    assert.ok(privs.includes('SELECT'), 'authenticated must have SELECT on public.payments');
  });

  it('3. zero ambiguous custom function overloads exist in public schema (including hospital_role & hospital_accessible_resource_ids)', () => {
    const rows = runSql(`
      SELECT proname, count(*) 
      FROM pg_proc 
      WHERE pronamespace = 'public'::regnamespace 
        AND proname NOT IN ('citext', 'texticregexne', 'regexp_matches', 'regexp_split_to_array', 'regexp_split_to_table', 'regexp_replace', 'texticregexeq', 'texticnlike', 'regexp_match', 'texticlike')
      GROUP BY proname HAVING count(*) > 1;
    `);
    assert.equal(rows.length, 0, `Must have zero ambiguous overloaded functions. Found: ${JSON.stringify(rows)}`);
  });
});
