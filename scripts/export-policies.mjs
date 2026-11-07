import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

export async function exportPolicies(outputPath = 'docs/security/policies-before.json') {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    idleTimeoutMillis: 2000,
  });

  try {
    const res = await pool.query(`
      SELECT
        c.relname AS table,
        p.polname AS name,
        CASE p.polpermissive WHEN true THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS permissive,
        CASE
          WHEN p.polroles = '{0}' THEN ARRAY['public']
          ELSE ARRAY(
            SELECT r.rolname FROM pg_roles r WHERE r.oid = ANY(p.polroles) ORDER BY r.rolname
          )
        END AS roles,
        CASE p.polcmd
          WHEN 'r' THEN 'SELECT'
          WHEN 'a' THEN 'INSERT'
          WHEN 'w' THEN 'UPDATE'
          WHEN 'd' THEN 'DELETE'
          WHEN '*' THEN 'ALL'
        END AS cmd,
        pg_get_expr(p.polqual, p.polrelid) AS qual,
        pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY c.relname, p.polname;
    `);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(res.rows, null, 2), 'utf8');
    console.log(`✅ Exported ${res.rows.length} policies to ${outputPath}`);
    return res.rows;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('export-policies.mjs')) {
  exportPolicies().catch((err) => {
    console.error('Error exporting policies:', err);
    process.exit(1);
  });
}
