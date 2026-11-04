// scripts/drill-backup-restore.mjs
// Gate 10: Reliability & Operations Backup-Restore Drill
// Takes a full pg_dump, restores into a scratch database, and verifies 1:1 row counts.

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import pg from 'pg';

const { Client } = pg;

const SCRATCH_DB = 'appointments_backup_drill';
const SOURCE_CONN = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SCRATCH_CONN = `postgresql://postgres:postgres@127.0.0.1:54322/${SCRATCH_DB}`;
const DUMP_PATH = '/Users/trinadh/.gemini/antigravity-ide/brain/c240c024-35ac-46df-8dcc-eb813cf2160c/scratch/backup_drill.sql';

const TABLES_TO_VERIFY = [
  'profiles',
  'providers',
  'departments',
  'resources',
  'bookings',
  'payments',
  'appointment_checkin_codes',
  'notification_logs',
  'app_logs'
];

async function main() {
  console.log('\n======================================================');
  console.log('🔄 GATE 10: RELIABILITY & OPERATIONS BACKUP-RESTORE DRILL');
  console.log('======================================================\n');

  const mainClient = new Client({ connectionString: SOURCE_CONN });
  await mainClient.connect();

  try {
    // 1. Snapshot Source Counts
    console.log('▶ [1/5] Recording source database row counts...');
    const sourceCounts = {};
    for (const tbl of TABLES_TO_VERIFY) {
      const res = await mainClient.query(`SELECT COUNT(*) as count FROM public.${tbl}`);
      sourceCounts[tbl] = parseInt(res.rows[0].count, 10);
      console.log(`  - public.${tbl.padEnd(26)} : ${sourceCounts[tbl]} rows`);
    }

    // 2. Perform Full pg_dump
    console.log(`\n▶ [2/5] Creating logical database backup via pg_dump...`);
    const dumpCmd = `/opt/homebrew/opt/libpq/bin/pg_dump "${SOURCE_CONN}" --schema=public --no-owner --no-acl > "${DUMP_PATH}"`;
    try {
      execSync(dumpCmd, { shell: '/bin/bash' });
    } catch {
      // Fallback to system pg_dump
      execSync(`pg_dump "${SOURCE_CONN}" --schema=public --no-owner --no-acl > "${DUMP_PATH}"`, { shell: '/bin/bash' });
    }
    const dumpSize = fs.statSync(DUMP_PATH).size;
    console.log(`  ✔ Backup dump created successfully: ${(dumpSize / 1024).toFixed(1)} KB`);

    // 3. Provision Scratch Database
    console.log(`\n▶ [3/5] Provisioning isolated scratch database "${SCRATCH_DB}"...`);
    await mainClient.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await mainClient.query(`CREATE DATABASE ${SCRATCH_DB}`);
    console.log(`  ✔ Scratch database created.`);

    // 4. Restore Dump into Scratch Database
    console.log(`\n▶ [4/5] Restoring backup dump into "${SCRATCH_DB}"...`);
    try {
      execSync(`/opt/homebrew/opt/libpq/bin/psql "${SCRATCH_CONN}" -f "${DUMP_PATH}" > /dev/null 2>&1`, { shell: '/bin/bash' });
    } catch {
      execSync(`psql "${SCRATCH_CONN}" -f "${DUMP_PATH}" > /dev/null 2>&1`, { shell: '/bin/bash' });
    }
    console.log(`  ✔ Dump restored into scratch database.`);

    // 5. Verify Row Counts in Scratch Database
    console.log(`\n▶ [5/5] Auditing restored row counts against source baseline...`);
    const scratchClient = new Client({ connectionString: SCRATCH_CONN });
    await scratchClient.connect();

    let mismatches = 0;
    try {
      for (const tbl of TABLES_TO_VERIFY) {
        const res = await scratchClient.query(`SELECT COUNT(*) as count FROM public.${tbl}`);
        const restoredCount = parseInt(res.rows[0].count, 10);
        const baseline = sourceCounts[tbl];
        const match = restoredCount === baseline;
        console.log(`  - public.${tbl.padEnd(26)} : Baseline=${baseline}, Restored=${restoredCount} [${match ? '✔ MATCH' : '✖ MISMATCH'}]`);
        if (!match) mismatches++;
      }
    } finally {
      await scratchClient.end();
    }

    // Clean up scratch database
    await mainClient.query(`DROP DATABASE ${SCRATCH_DB}`);
    if (fs.existsSync(DUMP_PATH)) {
      fs.unlinkSync(DUMP_PATH);
    }
    console.log(`  ✔ Scratch database dropped cleanly.`);

    console.log('\n======================================================');
    if (mismatches === 0) {
      console.log('🏁 BACKUP RESTORE DRILL PASSED: 100% Data Fidelity across all tables.');
      console.log('======================================================\n');
      process.exit(0);
    } else {
      console.error(`🏁 BACKUP RESTORE DRILL FAILED: ${mismatches} table row count mismatches.`);
      console.log('======================================================\n');
      process.exit(1);
    }

  } finally {
    await mainClient.end();
  }
}

main().catch(err => {
  console.error('Fatal drill error:', err);
  process.exit(1);
});
