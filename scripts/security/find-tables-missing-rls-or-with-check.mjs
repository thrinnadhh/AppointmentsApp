#!/usr/bin/env node
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const client = new pg.Client({ connectionString: DB_URL });

async function run() {
  await client.connect();

  // 1. Check all public tables for RLS enabled
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

  let violations = 0;

  console.log('=== 1. PUBLIC TABLES RLS CHECK ===');
  for (const t of tables) {
    if (!t.rls_enabled) {
      console.log(`VIOLATION: public.${t.table_name} -> RLS_DISABLED`);
      violations++;
    } else {
      console.log(`COMPLIANT: public.${t.table_name} -> RLS_ENABLED`);
    }
  }

  // 2. Check all policies for USING and WITH CHECK
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

  console.log('\n=== 2. POLICIES USING & WITH CHECK AUDIT ===');
  for (const pol of policies) {
    const fullPolicy = `public.${pol.tablename}.${pol.policyname} [${pol.cmd}]`;

    if (['SELECT', 'DELETE', 'UPDATE', 'ALL'].includes(pol.cmd) && !pol.has_using) {
      console.log(`VIOLATION: ${fullPolicy} -> MISSING_USING_CLAUSE`);
      violations++;
    } else if (['INSERT', 'UPDATE', 'ALL'].includes(pol.cmd) && !pol.has_with_check) {
      console.log(`VIOLATION: ${fullPolicy} -> MISSING_WITH_CHECK_CLAUSE`);
      violations++;
    } else {
      console.log(`COMPLIANT: ${fullPolicy} -> (has_using=${pol.has_using}, has_with_check=${pol.has_with_check})`);
    }
  }

  console.log(`\nSUMMARY: tables=${tables.length} policies=${policies.length} violations=${violations}`);
  await client.end();
  process.exit(violations > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Execution error:', err);
  process.exit(1);
});
