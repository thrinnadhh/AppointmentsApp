import { test } from 'node:test';
import assert from 'node:assert';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

test('Invariant: Every public database table must enable RLS and include USING and WITH CHECK clauses', async () => {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  try {
    // 1. Table RLS check
    const tablesQuery = `
      SELECT 
          c.relname AS table_name,
          c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY c.relname;
    `;
    const { rows: tables } = await client.query(tablesQuery);
    assert.ok(tables.length > 0, 'Database catalog must return tables in public schema');

    const tableViolations = tables.filter(t => !t.rls_enabled);
    assert.deepStrictEqual(tableViolations, [], `All public tables must have RLS enabled: ${JSON.stringify(tableViolations)}`);

    // 2. Policy clauses check
    const policiesQuery = `
      SELECT 
          tablename,
          policyname,
          cmd,
          qual IS NOT NULL AS has_using,
          with_check IS NOT NULL AS has_with_check
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname;
    `;
    const { rows: policies } = await client.query(policiesQuery);
    assert.ok(policies.length > 0, 'Database catalog must return policies for public tables');

    const policyViolations = [];
    for (const pol of policies) {
      if (['SELECT', 'DELETE', 'UPDATE', 'ALL'].includes(pol.cmd) && !pol.has_using) {
        policyViolations.push({ policy: `${pol.tablename}.${pol.policyname}`, error: 'MISSING_USING' });
      }
      if (['INSERT', 'UPDATE', 'ALL'].includes(pol.cmd) && !pol.has_with_check) {
        policyViolations.push({ policy: `${pol.tablename}.${pol.policyname}`, error: 'MISSING_WITH_CHECK' });
      }
    }

    assert.deepStrictEqual(policyViolations, [], `All policies must have required USING/WITH CHECK expressions: ${JSON.stringify(policyViolations)}`);
  } finally {
    await client.end();
  }
});
