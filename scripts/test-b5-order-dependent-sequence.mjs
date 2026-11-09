import pg from 'pg';
import fs from 'fs';
import { execSync } from 'child_process';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function getFunctionAcls(pool) {
  const query = `
    SELECT 
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as args,
      p.prosecdef as security_definer,
      COALESCE(p.proacl::text, 'DEFAULT') as acl,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
    ORDER BY schema_name, function_name, args;
  `;
  const res = await pool.query(query);
  return res.rows;
}

async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL });

  console.log('=== B5 REOPEN VERIFICATION: FUNCTION PRIVILEGES & ACLs SNAPSHOT ===\n');
  const baselineAcls = await getFunctionAcls(pool);
  console.log(`Baseline snapshot captured: ${baselineAcls.length} public/private functions.`);

  // Write baseline to disk
  fs.writeFileSync('docs/evidence/b5-baseline-acls.json', JSON.stringify(baselineAcls, null, 2));

  console.log('\n--- Running Order-Dependent Sequence: Pass 1 ---');
  console.log('1. tests/unit/family-booking-qa-lead.test.mjs');
  execSync('node tests/unit/family-booking-qa-lead.test.mjs', { stdio: 'inherit' });

  console.log('\n2. tests/unit/cross-tenant-authorization-matrix.test.mjs');
  execSync('node tests/unit/cross-tenant-authorization-matrix.test.mjs', { stdio: 'inherit' });

  console.log('\n3. tests/unit/mantis-track1-database-hardening.test.mjs');
  execSync('node tests/unit/mantis-track1-database-hardening.test.mjs', { stdio: 'inherit' });

  console.log('\n--- Capturing Snapshot After Pass 1 ---');
  const pass1Acls = await getFunctionAcls(pool);
  fs.writeFileSync('docs/evidence/b5-pass1-acls.json', JSON.stringify(pass1Acls, null, 2));

  // Compute diff
  const diffPass1 = execSync('diff -u docs/evidence/b5-baseline-acls.json docs/evidence/b5-pass1-acls.json || true', { encoding: 'utf8' });
  if (diffPass1.trim() === '') {
    console.log('PASS 1 RESULT: ZERO DIFF! Function privileges, definitions, and ACLs are 100% identical before and after.');
  } else {
    console.log('PASS 1 RESULT: DIFF FOUND!\n', diffPass1);
  }

  console.log('\n--- Running Order-Dependent Sequence: Pass 2 ---');
  console.log('1. tests/unit/family-booking-qa-lead.test.mjs');
  execSync('node tests/unit/family-booking-qa-lead.test.mjs', { stdio: 'inherit' });

  console.log('\n2. tests/unit/cross-tenant-authorization-matrix.test.mjs');
  execSync('node tests/unit/cross-tenant-authorization-matrix.test.mjs', { stdio: 'inherit' });

  console.log('\n3. tests/unit/mantis-track1-database-hardening.test.mjs');
  execSync('node tests/unit/mantis-track1-database-hardening.test.mjs', { stdio: 'inherit' });

  console.log('\n--- Capturing Snapshot After Pass 2 ---');
  const pass2Acls = await getFunctionAcls(pool);
  fs.writeFileSync('docs/evidence/b5-pass2-acls.json', JSON.stringify(pass2Acls, null, 2));

  const diffPass2 = execSync('diff -u docs/evidence/b5-baseline-acls.json docs/evidence/b5-pass2-acls.json || true', { encoding: 'utf8' });
  if (diffPass2.trim() === '') {
    console.log('PASS 2 RESULT: ZERO DIFF! Function privileges, definitions, and ACLs remain 100% identical after second pass.');
  } else {
    console.log('PASS 2 RESULT: DIFF FOUND!\n', diffPass2);
  }

  // Cleanup temp json files
  fs.unlinkSync('docs/evidence/b5-baseline-acls.json');
  fs.unlinkSync('docs/evidence/b5-pass1-acls.json');
  fs.unlinkSync('docs/evidence/b5-pass2-acls.json');

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

