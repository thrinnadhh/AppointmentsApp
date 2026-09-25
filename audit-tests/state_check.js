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
  console.log('Project URL Host:', new URL(url).host);

  // 1. Check profiles count & role distribution via PostgREST with service role
  const profRes = await fetch(`${url}/rest/v1/profiles?select=id,role,full_name,phone,created_at`, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`
    }
  });
  const profiles = await profRes.json();
  console.log(`Total profiles in DB: ${profiles.length}`);
  const rolesCount = {};
  profiles.forEach(p => {
    rolesCount[p.role] = (rolesCount[p.role] || 0) + 1;
  });
  console.log('Profiles by role:', JSON.stringify(rolesCount));
  console.log('Sample profiles (masked):');
  profiles.slice(0, 10).forEach(p => {
    const maskedPhone = p.phone ? p.phone.replace(/.(?=.{3})/g, '*') : 'none';
    console.log(`- [${p.role}] name="${p.full_name}", phone=${maskedPhone}, id=${p.id}`);
  });

  // 2. Check auth.users via Supabase Auth Admin REST API
  const authRes = await fetch(`${url}/auth/v1/admin/users?per_page=100`, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`
    }
  });
  const authData = await authRes.json();
  const users = authData.users || [];
  console.log(`Total auth.users: ${users.length}`);
  const domains = {};
  users.forEach(u => {
    const domain = u.email ? u.email.split('@')[1] : 'no-email';
    domains[domain] = (domains[domain] || 0) + 1;
  });
  console.log('Auth user email domains:', JSON.stringify(domains));
  console.log('Sample auth users (masked):');
  users.slice(0, 15).forEach(u => {
    if (u.email) {
      const [local, dom] = u.email.split('@');
      const maskedLocal = local.length > 2 ? local[0] + '***' + local[local.length - 1] : '***';
      console.log(`- ${maskedLocal}@${dom} (created: ${u.created_at})`);
    }
  });
}

main().catch(console.error);
