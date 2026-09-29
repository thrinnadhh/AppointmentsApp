const fs = require('fs');

function loadEnv() {
  const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  });
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

async function checkRoutineGrants() {
  // We can query pg_proc via a query or RPC, or check routine_privileges
  const q = `
    SELECT specific_name, routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE specific_schema = 'public'
      AND grantee IN ('PUBLIC', 'anon')
    ORDER BY routine_name, grantee;
  `;
  // Call via Postgres or examine routine_privileges
  // PostgREST doesn't expose information_schema directly unless exposed in schema.
  // But let's check if we can call an admin RPC or use supabase-cli or psql if available.
  console.log("Checking if we have psql or direct db connection...");
}

checkRoutineGrants().catch(console.error);
