const fs = require('fs');
const path = require('path');

function checkEnv() {
  const envFiles = [
    'apps/merchant-web/.env.local',
    'apps/customer-mobile/.env',
    '.env'
  ];

  const loadedKeys = new Set(Object.keys(process.env));

  for (const file of envFiles) {
    const full = path.join(process.cwd(), file);
    if (fs.existsSync(full)) {
      const content = fs.readFileSync(full, 'utf8');
      content.split('\n').forEach(line => {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (m) loadedKeys.add(m[1]);
      });
    }
  }

  const required = [
    'STAGING_PROJECT_REF',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CUSTOMER_A_EMAIL',
    'CUSTOMER_A_PASSWORD',
    'CUSTOMER_B_EMAIL',
    'CUSTOMER_B_PASSWORD',
    'MERCHANT_A_EMAIL',
    'MERCHANT_A_PASSWORD',
    'MERCHANT_B_EMAIL',
    'MERCHANT_B_PASSWORD',
    'ADMIN_EMAIL',
    'ADMIN_PASSWORD',
    'TEST_CUSTOMER_EMAIL',
    'TEST_CUSTOMER_PASSWORD',
    'TEST_MERCHANT_EMAIL',
    'TEST_MERCHANT_PASSWORD',
    'TEST_SALON_EMAIL',
    'TEST_SALON_PASSWORD',
    'TEST_ADMIN_EMAIL',
    'TEST_ADMIN_PASSWORD',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET'
  ];

  console.log("=== Environment Variables Check (Keys Only, No Values) ===");
  for (const k of required) {
    console.log(`${k}: ${loadedKeys.has(k) ? 'PRESENT' : 'MISSING'}`);
  }
}

checkEnv();
