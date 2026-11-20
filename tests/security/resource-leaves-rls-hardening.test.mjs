import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const anonClient = createClient(supabaseUrl, anonKey);
const adminClient = createClient(supabaseUrl, serviceRoleKey);

function runSql(query) {
  const cmd = `docker exec -i supabase_db_Appointments psql -U postgres -d postgres -t -A -c "${query.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim();
}

describe('SEC-WIN-015: resource_leaves RLS & Privilege Hardening', () => {
  it('1. Anon cannot read doctor leave reasons from public.resource_leaves', async () => {
    // Check if anon has SELECT grant on resource_leaves
    const grantCheck = runSql(`
      SELECT COUNT(*)
      FROM information_schema.table_privileges
      WHERE table_schema = 'public' 
        AND table_name = 'resource_leaves' 
        AND grantee = 'anon' 
        AND privilege_type = 'SELECT';
    `);
    assert.equal(grantCheck, '0', 'Anon must NOT have SELECT grant on resource_leaves');

    const { data, error } = await anonClient.from('resource_leaves').select('id, reason, doctor_name');
    assert.ok(error || !data || data.length === 0, 'Anon query must fail or return 0 rows');
  });

  it('2. resource_leaves_select_policy must NOT be qual: true', () => {
    const policyQual = runSql(`
      SELECT pg_get_expr(polqual, polrelid)
      FROM pg_policy
      WHERE polrelid = 'public.resource_leaves'::regclass
        AND polname = 'resource_leaves_select_policy';
    `);
    assert.ok(policyQual !== 'true', `Policy qual must not be true: got ${policyQual}`);
  });

  it('3. Cross-Tenant Isolation: Tenant B cannot SELECT Tenant A resource_leaves', async () => {
    // Seed a test leave under provider A
    const { data: provA } = await adminClient.from('providers').select('id').limit(1).single();
    assert.ok(provA?.id, 'Must have at least 1 provider');

    const { data: inserted, error: insertErr } = await adminClient
      .from('resource_leaves')
      .insert({
        provider_id: provA.id,
        resource_id: 'res-test-1',
        doctor_name: 'Dr. Test A',
        leave_date: '2026-12-01',
        reason: 'CONFIDENTIAL_MEDICAL_REASON_A'
      })
      .select()
      .single();
    assert.ok(inserted?.id, `Insert failed: ${insertErr?.message}`);

    try {
      // Create authenticated client for Tenant B (balaji admin)
      const bClient = createClient(supabaseUrl, anonKey);
      const { data: authB, error: authErr } = await bClient.auth.signInWithPassword({
        email: 'admin.balaji@test-tirupati.local',
        password: 'HospitalTest2026!'
      });
      assert.ok(authB?.session, `Auth failed: ${authErr?.message}`);

      // Tenant B tries to query provider A's leaves
      const { data: leakedData } = await bClient
        .from('resource_leaves')
        .select('*')
        .eq('provider_id', provA.id);

      assert.equal(leakedData?.length || 0, 0, 'Tenant B must NOT read Tenant A resource leaves');
    } finally {
      // Cleanup
      await adminClient.from('resource_leaves').delete().eq('id', inserted.id);
    }
  });
});
