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

async function checkAuthUsers() {
  const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=50`, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`
    }
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Keys in data:', Object.keys(data));
  if (data.users) {
    console.log('Users length:', data.users.length);
    data.users.forEach(u => {
      const email = u.email || 'no-email';
      const [local, dom] = email.split('@');
      const masked = local ? (local[0] + '***' + (dom ? '@' + dom : '')) : 'none';
      console.log(`User: ${masked}, role: ${u.role}, confirmed: ${u.email_confirmed_at ? 'yes' : 'no'}`);
    });
  } else {
    console.log('Data:', data);
  }
}

checkAuthUsers().catch(console.error);
