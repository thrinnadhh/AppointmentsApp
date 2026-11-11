import fs from 'fs';
import path from 'path';

export function generateCiEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.API_URL || 'http://127.0.0.1:54321';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
  const superadminToken = process.env.SUPERADMIN_E2E_TOKEN || 'tirupati_e2e_secure_bypass_key_2026_x9k2';
  const adminSecret = process.env.ADMIN_SECRET || 'tirupati_e2e_secure_bypass_key_2026_x9k2';
  const cronSecret = process.env.CRON_SECRET || 'test_cron_secret_2026';
  const deletionSecret = process.env.DELETION_TOKEN_SECRET || 'd24831bb6c322697ea855e7464e8e9767191d1f4d340548e400bab603f927cfe';
  const allowMock = process.env.ALLOW_MOCK_PAYMENTS || 'false';

  const cashfreeAppId = process.env.CASHFREE_APP_ID || 'TEST11062255875752ad70efb077e7e355226011';
  const cashfreeSecret = process.env.CASHFREE_SECRET_KEY || 'cfsk_test_MockCashfreeSecretKeyForE2e9999';
  const cashfreeEnv = process.env.CASHFREE_ENV || 'SANDBOX';

  const envLines = [
    `NEXT_PUBLIC_SUPABASE_URL="${supabaseUrl}"`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY="${anonKey}"`,
    `SUPABASE_SERVICE_ROLE_KEY="${serviceKey}"`,
    `SUPERADMIN_E2E_TOKEN="${superadminToken}"`,
    `ADMIN_SECRET="${adminSecret}"`,
    `CRON_SECRET="${cronSecret}"`,
    `DELETION_TOKEN_SECRET="${deletionSecret}"`,
    `ALLOW_MOCK_PAYMENTS="${allowMock}"`,
    `ENABLE_E2E_BYPASS="true"`,
    `RAZORPAY_KEY_ID="rzp_test_51MockAppPlatform"`,
    `RAZORPAY_KEY_SECRET="mock_secret_key_1234567890"`,
    `RAZORPAY_WEBHOOK_SECRET="mock_webhook_secret"`,
    `PAYMENT_GATEWAY_PROVIDER="cashfree"`,
    `CASHFREE_APP_ID="${cashfreeAppId}"`,
    `CASHFREE_SECRET_KEY="${cashfreeSecret}"`,
    `CASHFREE_ENV="${cashfreeEnv}"`,
    `NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME="Dr. K. S. Rao"`,
    `NEXT_PUBLIC_GRIEVANCE_OFFICER_EMAIL="grievance-officer@tirupati-appointments.org"`,
    `NEXT_PUBLIC_GRIEVANCE_OFFICER_PHONE="+91-877-2244888"`,
    `NEXT_PUBLIC_GRIEVANCE_OFFICER_ADDRESS="Balaji Colony, Tirupati, AP 517502"`,
    `EXPO_PUBLIC_SUPABASE_URL="${supabaseUrl}"`,
    `EXPO_PUBLIC_SUPABASE_ANON_KEY="${anonKey}"`,
  ].join('\n') + '\n';

  const targetPaths = [
    path.resolve('apps/merchant-web/.env.local'),
    path.resolve('.env.local'),
    path.resolve('apps/customer-mobile/.env.local'),
  ];

  for (const targetPath of targetPaths) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, envLines, 'utf8');
    console.log(`[CI-ENV] Provisioned: ${path.relative(process.cwd(), targetPath)}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('generate-ci-env.mjs')) {
  generateCiEnv();
}
