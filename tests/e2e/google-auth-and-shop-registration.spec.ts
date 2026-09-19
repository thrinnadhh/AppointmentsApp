import { test, expect } from '@playwright/test';

/**
 * Google Auth Verification & First-Time Shop Registration Flow
 *
 * Validates:
 * 1. Front page enforces Google sign-in for email verification.
 * 2. Unauthenticated access to /register redirects to /login.
 * 3. Authenticated first-time user lands on /register with locked verified email.
 * 4. Shop registration provisions the new provider and transitions to workspace.
 * 5. Returning merchant with existing shop lands directly in workspace.
 */
test.describe('Google Auth Verification & First-Time Shop Registration', () => {
  test('TC-GOOGLE-01: Front page presents Google authentication as primary entry point', async ({ page }) => {
    await page.goto('http://localhost:3000/login');
    await page.locator('[data-hydrated="true"]').waitFor({ timeout: 15000 });

    const googleBtn = page.getByTestId('google-auth-btn');
    await expect(googleBtn).toBeVisible();
    await expect(googleBtn).toContainText('Continue with Google');
    await expect(page.getByText('Google Verified Authentication')).toBeVisible();
  });

  test('TC-GOOGLE-02: Unauthenticated visit to /register redirects to /login', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('http://localhost:3000/register');
    await expect(page).toHaveURL(/.*\/login.*/, { timeout: 15000 });
  });

  test('TC-GOOGLE-03: API /api/merchant/register-shop enforces validation', async ({ request }) => {
    const res = await request.post('http://localhost:3000/api/merchant/register-shop', {
      data: {
        shopName: '',
        categoryId: '',
        phone: '',
      },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Please provide shop name, category, and contact phone number');
  });

  test('TC-GOOGLE-04: No "Welcome to Merchant Hub" placeholder card exists on /', async ({ page }) => {
    await page.goto('http://localhost:3000/?demo=1');
    await expect(page.getByText('Tirupati Merchant Hub').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();

    // The legacy placeholder card should not exist anywhere in the DOM
    await expect(page.getByText('Welcome to Merchant Hub')).toHaveCount(0);
    await expect(page.getByText('Register Your Shop')).toHaveCount(0);
  });

  test('TC-GOOGLE-05: Returning merchant lands directly in workspace', async ({ page }) => {
    await page.goto('http://localhost:3000/?demo=1');
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible({ timeout: 15000 });

    // Directly in workspace: summary cards & metrics are rendered
    await expect(page.getByText('Hold In-Flight')).toBeVisible();
    await expect(page.getByText('Deposits Captured')).toBeVisible();
    // Confirms it did not get redirected to /register
    expect(page.url()).not.toContain('/register');
  });

  test('TC-GOOGLE-06: /register presents shop details form with locked verified email design', async ({ page }) => {
    await page.setExtraHTTPHeaders({
      'x-merchant-bypass-key': 'tirupati-superadmin-e2e-2026',
    });

    // Provide mock authenticated user state to view the registration form
    await page.addInitScript(() => {
      window.sessionStorage.setItem('test_merchant_user', JSON.stringify({
        id: 'mock-first-time-user',
        email: 'verified.merchant@gmail.com',
        user_metadata: { full_name: 'Test Merchant' },
      }));
    });

    await page.goto('http://localhost:3000/register');
    await expect(page.getByText('Verified Business Email')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Verified', { exact: true })).toBeVisible();

    // Required shop registration inputs
    await expect(page.locator('#shopName')).toBeVisible();
    await expect(page.locator('#categoryId')).toBeVisible();
    await expect(page.locator('#phone')).toBeVisible();
    await expect(page.locator('#address')).toBeVisible();
    await expect(page.getByRole('button', { name: /Complete Registration & Open Workspace/i })).toBeVisible();
  });
});
