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

async function checkCols() {
  const res = await fetch(`${url}/rest/v1/?apikey=${serviceKey}`);
  // We can query bookings sample to see column keys
  const bRes = await fetch(`${url}/rest/v1/bookings?limit=1`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const b = await bRes.json();
  console.log('Bookings columns:', b.length > 0 ? Object.keys(b[0]) : 'empty table');

  const pRes = await fetch(`${url}/rest/v1/payments?limit=1`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const p = await pRes.json();
  console.log('Payments columns:', p.length > 0 ? Object.keys(p[0]) : 'empty or error', p);
}

checkCols().catch(console.error);
