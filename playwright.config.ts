import { defineConfig, devices } from '@playwright/test';

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
    },
    {
      command: 'pnpm dev:mobile',
      url: 'http://localhost:8081',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],

  projects: [
    // ── Standard desktop chromium (all tests default to this) ──────────────
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/edge-integrations.spec.ts'], // run integration suite separately
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
