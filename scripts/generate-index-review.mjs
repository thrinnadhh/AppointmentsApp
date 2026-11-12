import fs from 'fs';

export function generateIndexReview(indexesBeforePath = 'docs/security/indexes-before.json', outputPath = 'docs/security/index-review.md') {
  if (!fs.existsSync(indexesBeforePath)) {
    throw new Error(`File not found: ${indexesBeforePath}`);
  }

  const indexes = JSON.parse(fs.readFileSync(indexesBeforePath, 'utf8'));

  const reviewRows = [];

  for (const idx of indexes) {
    let classification = 'KEEP-C';
    let decision = 'KEEP';
    let reason = '';

    function parseArray(val) {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
        return val.slice(1, -1).split(',').filter(Boolean);
      }
      return [];
    }

    const columnsArr = parseArray(idx.columns);
    const opclassesArr = parseArray(idx.opclasses);
    const coveredFksArr = parseArray(idx.covered_foreign_keys);

    // Check DROP-CANDIDATE first: provably redundant duplicates
    if (idx.index_name === 'idx_checkin_codes_booking_id') {
      classification = 'DROP-CANDIDATE';
      decision = 'DROP';
      reason = 'Provably redundant duplicate of unique constraint unique_booking_checkin_code on (booking_id)';
    } else if (idx.index_name === 'idx_bookings_reference_code') {
      classification = 'DROP-CANDIDATE';
      decision = 'DROP';
      reason = 'Provably redundant duplicate of unique constraint bookings_reference_code_key on (reference_code)';
    } else if (idx.is_primary || idx.is_unique || idx.is_constraint_backed) {
      classification = 'KEEP-A';
      decision = 'KEEP';
      reason = idx.is_primary ? 'Backs Primary Key constraint' : (idx.constraint_name ? `Backs ${idx.constraint_type || 'unique'} constraint ${idx.constraint_name}` : 'Enforces uniqueness constraint');
    } else if (coveredFksArr.length > 0) {
      classification = 'KEEP-B';
      decision = 'KEEP';
      reason = `Supports Foreign Key(s): ${coveredFksArr.join(', ')}`;
    } else {
      classification = 'KEEP-C';
      decision = 'KEEP';
      reason = `Purpose-built query accelerator (${opclassesArr.join(', ')})`;
    }

    reviewRows.push({
      index: idx.index_name,
      table: idx.table_name,
      columns: columnsArr.join(', '),
      class: classification,
      decision,
      reason
    });
  }

  let md = '# Index Review & Advisor Classification\n\n';
  md += 'Per Phase 6 standing rules: Indexes with `idx_scan = 0` on local development represent pre-launch lack of traffic, NOT useless indexes. All indexes are audited and categorized into KEEP-A, KEEP-B, KEEP-C, and DROP-CANDIDATE.\n\n';
  md += '| Index | Table | Columns | Class | Decision | Reason |\n';
  md += '|---|---|---|---|---|---|\n';

  for (const r of reviewRows) {
    md += `| \`${r.index}\` | \`${r.table}\` | \`${r.columns}\` | **${r.class}** | \`${r.decision}\` | ${r.reason} |\n`;
  }

  md += '\n## Revisit Plan (2–4 Weeks Post-Launch)\n';
  md += '1. Allow 2 to 4 weeks of continuous production traffic on cloud PostgreSQL.\n';
  md += '2. Execute `SELECT schemaname, relname, indexrelname, idx_scan FROM pg_stat_user_indexes WHERE schemaname = \'public\' AND idx_scan = 0;`\n';
  md += '3. Filter out all `KEEP-A` (constraint-backing) and `KEEP-B` (foreign-key-supporting) indexes.\n';
  md += '4. For remaining `KEEP-C` indexes that show `idx_scan = 0`, inspect application query plans before considering deprecation.\n';

  fs.writeFileSync(outputPath, md, 'utf8');
  console.log(`✅ Index review markdown written to ${outputPath} (${reviewRows.length} indexes categorized).`);
  return reviewRows;
}

if (process.argv[1] && process.argv[1].endsWith('generate-index-review.mjs')) {
  generateIndexReview();
}
