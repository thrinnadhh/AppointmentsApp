import { defineConfig, devices } from '@playwright/test';

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
process.env.TEST_MERCHANT_EMAIL = process.env.TEST_MERCHANT_EMAIL || 'svims.clinic@tirupati-appointments.com';
process.env.TEST_MERCHANT_PASSWORD = process.env.TEST_MERCHANT_PASSWORD || 'SvimsClinic2026!';
process.env.TEST_SALON_EMAIL = process.env.TEST_SALON_EMAIL || 'naturals.salon@tirupati-appointments.com';
process.env.TEST_SALON_PASSWORD = process.env.TEST_SALON_PASSWORD || 'NaturalsSalon2026!';
// E2E secrets must be supplied via the environment; never fall back to a
// committed literal, which would activate the privileged bypass on any
// deployment using the default value.
if (!process.env.ADMIN_SECRET && !process.env.SUPERADMIN_E2E_TOKEN) {
  const dynamicTestToken = `ci-test-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  process.env.ADMIN_SECRET = dynamicTestToken;
  process.env.SUPERADMIN_E2E_TOKEN = dynamicTestToken;
} else {
  process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || '';
  process.env.SUPERADMIN_E2E_TOKEN = process.env.SUPERADMIN_E2E_TOKEN || '';
}
process.env.ALLOW_MOCK_PAYMENTS = 'true';
process.env.ENABLE_E2E_BYPASS = 'true';

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
        ADMIN_SECRET: process.env.ADMIN_SECRET || '',
        SUPERADMIN_E2E_TOKEN: process.env.SUPERADMIN_E2E_TOKEN || '',
        ALLOW_MOCK_PAYMENTS: 'true',
        ENABLE_E2E_BYPASS: 'true',
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || 'rzp_test_51MockAppPlatform',
        RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
      },
    },
    {
      command: 'pnpm dev:mobile',
      url: 'http://localhost:8081',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        ALLOW_MOCK_PAYMENTS: 'true',
        ADMIN_SECRET: process.env.ADMIN_SECRET || '',
        SUPERADMIN_E2E_TOKEN: process.env.SUPERADMIN_E2E_TOKEN || '',
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
