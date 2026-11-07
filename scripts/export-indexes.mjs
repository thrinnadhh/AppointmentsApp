import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

export async function exportIndexes(outputPath = 'docs/security/indexes-before.json') {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    idleTimeoutMillis: 2000,
  });

  try {
    const res = await pool.query(`
      WITH table_fks AS (
        SELECT
          con.conrelid,
          con.conname,
          array_agg(att.attname ORDER BY u.attseq) AS fk_columns,
          array_agg(att.attnum ORDER BY u.attseq) AS fk_attnums
        FROM pg_constraint con
        CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS u(attnum, attseq)
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum
        WHERE con.contype = 'f'
        GROUP BY con.conrelid, con.conname
      ),
      index_info AS (
        SELECT
          c.relname AS table_name,
          ic.relname AS index_name,
          i.indisunique AS is_unique,
          i.indisprimary AS is_primary,
          (
            SELECT array_agg(att.attname ORDER BY u.attseq)
            FROM unnest(i.indkey) WITH ORDINALITY AS u(attnum, attseq)
            LEFT JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum = u.attnum
          ) AS columns,
          (
            SELECT array_agg(opc.opcname ORDER BY u.attseq)
            FROM unnest(i.indclass) WITH ORDINALITY AS u(opcid, attseq)
            JOIN pg_opclass opc ON opc.oid = u.opcid
          ) AS opclasses,
          pg_get_expr(i.indpred, i.indrelid) AS partial_predicate,
          pg_get_indexdef(ic.oid) AS definition,
          EXISTS (
            SELECT 1 FROM pg_constraint con
            WHERE con.conindid = ic.oid
          ) AS is_constraint_backed,
          (
            SELECT con.conname FROM pg_constraint con
            WHERE con.conindid = ic.oid
            LIMIT 1
          ) AS constraint_name,
          (
            SELECT con.contype::text FROM pg_constraint con
            WHERE con.conindid = ic.oid
            LIMIT 1
          ) AS constraint_type,
          (
            SELECT coalesce(array_agg(fk.conname), ARRAY[]::text[])
            FROM table_fks fk
            WHERE fk.conrelid = c.oid
              AND (
                -- Check if FK columns are a leading prefix of the index keys
                (SELECT array_agg(u.attnum ORDER BY u.attseq) FROM unnest(i.indkey) WITH ORDINALITY AS u(attnum, attseq))[:cardinality(fk.fk_attnums)] = fk.fk_attnums
              )
          ) AS covered_foreign_keys
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_class ic ON ic.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY c.relname, ic.relname
      )
      SELECT * FROM index_info;
    `);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(res.rows, null, 2), 'utf8');
    console.log(`✅ Exported ${res.rows.length} indexes to ${outputPath}`);
    return res.rows;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('export-indexes.mjs')) {
  exportIndexes().catch((err) => {
    console.error('Error exporting indexes:', err);
    process.exit(1);
  });
}
