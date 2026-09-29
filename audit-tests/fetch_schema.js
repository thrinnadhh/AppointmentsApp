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

async function main() {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`
    }
  });
  const data = await res.json();
  const paths = Object.keys(data.paths || {});
  console.log(`Total REST endpoints exposed: ${paths.length}`);
  
  const tablesAndViews = paths.filter(p => !p.startsWith('/rpc/')).map(p => p.replace(/^\//, ''));
  const rpcs = paths.filter(p => p.startsWith('/rpc/')).map(p => p.replace(/^\/rpc\//, ''));
  
  console.log('Tables/Views:', JSON.stringify(tablesAndViews, null, 2));
  console.log('RPCs:', JSON.stringify(rpcs, null, 2));
}

main().catch(console.error);
