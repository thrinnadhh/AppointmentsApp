import { defineConfig, devices } from '@playwright/test';
import crypto from 'crypto';

// Load environment variables for E2E tests without hardcoding secrets in spec files
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('apps/merchant-web/.env.local');
  } catch {
    // Fall back gracefully if file is absent in CI
  }
}

// Invariant E2E test credentials and configuration defaults
process.env.TEST_ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@appointments-tirupati.com';
process.env.TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'AdminSecure2026!';
process.env.TEST_MERCHANT_EMAIL = process.env.TEST_MERCHANT_EMAIL || 'admin.apex@test-tirupati.local';
process.env.TEST_MERCHANT_PASSWORD = process.env.TEST_MERCHANT_PASSWORD || 'HospitalTest2026!';
process.env.TEST_SALON_EMAIL = process.env.TEST_SALON_EMAIL || 'naturals.salon@tirupati-appointments.com';
process.env.TEST_SALON_PASSWORD = process.env.TEST_SALON_PASSWORD || 'NaturalsSalon2026!';
// E2E secrets: use environment or standard non-production local test bypass key
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'tirupati_e2e_secure_bypass_key_2026_x9k2';
process.env.SUPERADMIN_E2E_TOKEN = process.env.SUPERADMIN_E2E_TOKEN || 'tirupati_e2e_secure_bypass_key_2026_x9k2';
process.env.ALLOW_MOCK_PAYMENTS = 'true';
process.env.ENABLE_E2E_BYPASS = 'true';

// Safe tracked fallback environment configuration when .env.local is omitted or contains placeholders
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.includes('placeholder')) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY.includes('placeholder')) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
}
if (!process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL.includes('placeholder')) {
  process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
}
if (!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY.includes('placeholder')) {
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}
process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME = process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME || 'P. Ramachandra Murthy, Advocate';
process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_EMAIL = process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_EMAIL || 'grievance@appointments4u.in';
process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_PHONE = process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_PHONE || '+91 94401 23456';
process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_ADDRESS = process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_ADDRESS || 'Door No. 12-3-456, Gandhi Road, Tirupati, Andhra Pradesh 517501';
process.env.EXPO_PUBLIC_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',

  // Edge + stress tests may take longer — give them room
  timeout: 60000,
  expect: { timeout: 8000 },

  // Serial by default (most suites use test.describe.configure serial themselves)
  fullyParallel: false,
  workers: 1,

  // 2 retries in CI; 0 locally so failures are obvious immediately
  retries: process.env.CI ? 2 : 0,

  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3000',
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  webServer: [
    {
      command: 'pnpm dev:merchant',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        ADMIN_SECRET: process.env.ADMIN_SECRET || 'tirupati_e2e_secure_bypass_key_2026_x9k2',
        SUPERADMIN_E2E_TOKEN: process.env.SUPERADMIN_E2E_TOKEN || 'tirupati_e2e_secure_bypass_key_2026_x9k2',
        ALLOW_MOCK_PAYMENTS: 'true',
        ENABLE_E2E_BYPASS: 'true',
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || 'rzp_test_51MockAppPlatform',
        RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || 'mock_secret_key_1234567890',
      },
    },
    {
      command: 'pnpm dev:mobile',
      url: 'http://localhost:8081',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        ALLOW_MOCK_PAYMENTS: 'true',
        ADMIN_SECRET: process.env.ADMIN_SECRET || 'tirupati_e2e_secure_bypass_key_2026_x9k2',
        SUPERADMIN_E2E_TOKEN: process.env.SUPERADMIN_E2E_TOKEN || 'tirupati_e2e_secure_bypass_key_2026_x9k2',
        EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
      },
    },
  ],

  projects: [
    // ── Standard desktop chromium (all tests default to this) ──────────────
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [
        '**/customer-merchant-integration.spec.ts',
        '**/admin-merchant-integration.spec.ts',
        '**/edge-integrations.spec.ts',
        '**/flow-audit.spec.ts',
        '**/customer-app.spec.ts',
        '**/customer-reflection.spec.ts',
        '**/edge-customer.spec.ts',
        '**/customer-hospital-full-lifecycle.spec.ts',
      ],
    },

    // ── Integration & cross-system suite (needs extra timeout) ────────────
    {
      name: 'integration',
      use: { ...devices['Desktop Chrome'] },
      testMatch: [
        '**/customer-merchant-integration.spec.ts',
        '**/admin-merchant-integration.spec.ts',
        '**/edge-integrations.spec.ts',
        '**/flow-audit.spec.ts',
        '**/customer-hospital-full-lifecycle.spec.ts',
      ],
      // Allow up to 2 min per test for concurrency stress cases
      timeout: 120000,
    },

    // ── Mobile viewport for customer-app tests ────────────────────────────
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      testMatch: [
        '**/customer-app.spec.ts',
        '**/customer-reflection.spec.ts',
        '**/edge-customer.spec.ts',
      ],
    },
  ],
});
