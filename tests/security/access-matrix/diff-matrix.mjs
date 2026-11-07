import fs from 'fs';
import pg from 'pg';
import { runAccessMatrix } from './runner.mjs';

const { Pool } = pg;

export async function compareMatrixWithSnapshot(
  snapshotPath = 'tests/security/access-matrix/snapshot-before.json',
  filterTable = null
) {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file not found: ${snapshotPath}`);
  }

  const baseline = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    idleTimeoutMillis: 2000,
  });

  try {
    const current = await runAccessMatrix(pool);
    const diffs = [];

    const actors = Object.keys(baseline);
    for (const actor of actors) {
      const tables = Object.keys(baseline[actor]);
      for (const table of tables) {
        if (filterTable && table !== filterTable) continue;

        const baseVal = baseline[actor]?.[table];
        const currVal = current[actor]?.[table];

        if (!currVal) {
          diffs.push({
            actor,
            table,
            field: 'table_result',
            expected: baseVal,
            actual: 'MISSING'
          });
          continue;
        }

        // Compare select
        const baseSel = baseVal.select || {};
        const currSel = currVal.select || {};
        if (baseSel.count !== currSel.count || JSON.stringify(baseSel.visible_ids) !== JSON.stringify(currSel.visible_ids)) {
          diffs.push({
            actor,
            table,
            operation: 'SELECT',
            expected: { count: baseSel.count, visible_ids: baseSel.visible_ids },
            actual: { count: currSel.count, visible_ids: currSel.visible_ids }
          });
        }

        // Compare mutation operations
        const ops = ['insert_own', 'insert_other', 'update_own', 'update_other', 'delete_own', 'delete_other'];
        for (const op of ops) {
          const bOp = baseVal[op] || {};
          const cOp = currVal[op] || {};

          if (bOp.allowed !== cOp.allowed || bOp.rowCount !== cOp.rowCount) {
            diffs.push({
              actor,
              table,
              operation: op,
              expected: { allowed: bOp.allowed, rowCount: bOp.rowCount, error: bOp.error },
              actual: { allowed: cOp.allowed, rowCount: cOp.rowCount, error: cOp.error }
            });
          }
        }
      }
    }

    return {
      table: filterTable || 'ALL',
      diffCount: diffs.length,
      diffs
    };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('diff-matrix.mjs')) {
  const tableArg = process.argv[2] || null;
  compareMatrixWithSnapshot('tests/security/access-matrix/snapshot-before.json', tableArg)
    .then((res) => {
      if (res.diffCount === 0) {
        console.log(`✅ [ACCESS MATRIX DIFF: ${res.table}] 0 differences. Access is 100% behavior-neutral.`);
        process.exit(0);
      } else {
        console.error(`❌ [ACCESS MATRIX DIFF: ${res.table}] Found ${res.diffCount} differences:`);
        console.error(JSON.stringify(res.diffs, null, 2));
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Error running access matrix diff:', err);
      process.exit(1);
    });
}
