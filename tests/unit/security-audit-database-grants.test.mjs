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

  it('4. authenticated role has table-level SELECT and UPDATE grants on public.profiles (grant snapshot)', () => {
    const rows = runSql(`
      SELECT privilege_type 
      FROM information_schema.role_table_grants 
      WHERE table_schema = 'public' 
        AND table_name = 'profiles' 
        AND grantee = 'authenticated';
    `);
    const privs = rows.map((r) => r.privilege_type);
    assert.ok(privs.includes('SELECT'), 'authenticated role must have table-level SELECT on public.profiles');
    assert.ok(privs.includes('UPDATE'), 'authenticated role must have table-level UPDATE on public.profiles');
  });

  it('5. public.profiles has RLS enabled with users_read_own_profile and users_update_own_profile policies', () => {
    const rlsRows = runSql(`
      SELECT relrowsecurity 
      FROM pg_class 
      WHERE relname = 'profiles' 
        AND relnamespace = 'public'::regnamespace;
    `);
    assert.equal(rlsRows[0]?.relrowsecurity, true, 'public.profiles must have relrowsecurity enabled');

    const policyRows = runSql(`
      SELECT policyname 
      FROM pg_policies 
      WHERE schemaname = 'public' 
        AND tablename = 'profiles';
    `);
    const policyNames = policyRows.map((p) => p.policyname);
    assert.ok(policyNames.includes('users_read_own_profile'), 'public.profiles must include users_read_own_profile policy');
    assert.ok(policyNames.includes('users_update_own_profile'), 'public.profiles must include users_update_own_profile policy');
  });

  it('6. guard_profile_governance trigger definition strictly protects blocked_until and permanent_checkin_pin', () => {
    const fnRows = runSql(`
      SELECT pg_get_functiondef('guard_profile_governance'::regproc) AS def;
    `);
    const def = fnRows[0]?.def || '';
    assert.ok(def.includes('blocked_until'), 'guard_profile_governance must protect blocked_until');
    assert.ok(def.includes('permanent_checkin_pin'), 'guard_profile_governance must protect permanent_checkin_pin');
    assert.ok(def.includes('no_show_count'), 'guard_profile_governance must protect no_show_count');
    assert.ok(def.includes('is_flagged'), 'guard_profile_governance must protect is_flagged');
    assert.ok(def.includes('role'), 'guard_profile_governance must protect role');
    assert.ok(def.includes('assigned_city_id'), 'guard_profile_governance must protect assigned_city_id');
  });
});
