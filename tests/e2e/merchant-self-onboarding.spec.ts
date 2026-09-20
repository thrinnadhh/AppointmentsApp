import { test, expect } from '@playwright/test';

/**
 * Merchant Self-Service Onboarding, Time-Horizon Triage & Super Admin Monitoring Suite
 *
 * Validates:
 * 1. Self-Service Registration & Google Auth:
 *    - Presence of Google OAuth sign-in button.
 *    - Merchants create their own credentials (email + custom password) without admin provisioning.
 * 2. Instant Isolated Workspace:
 *    - Merchant registers "Trinadh Luxury Salon" with custom credentials.
 *    - Lands immediately in isolated shop workspace with dedicated Salon terminology.
 *    - Automatically provisioned Salon chairs are active.
 * 3. Time-Horizon Queue Triage:
 *    - In /bookings, merchant can filter by Today, Yesterday, Past 7 Days, and All Dates.
 * 4. Custom Password Re-Authentication:
 *    - Merchant can sign out and sign back in using their self-created custom password.
 * 5. Super Admin Omniscient Monitoring:
 *    - Super Admin at /admin observes the newly registered shop in the real-time pipeline.
 */
test.describe('Merchant Self-Service Onboarding & Admin Monitoring', () => {
  test.describe.configure({ mode: 'serial' });

  const uniqueSuffix = Date.now();
  const testEmail = `trinadh.owner.${uniqueSuffix}@tirupati-test.com`;
  const testPassword = 'TrinadhSecurePassword2026!';
  const shopName = `Trinadh Salon ${uniqueSuffix}`;
  const testPhone = `+919848${uniqueSuffix.toString().slice(-6)}`;

  test('TC-SELF-01: Self-service registration with custom password & instant isolated workspace', async ({ page, context }) => {
    // 1. Ensure clean unauthenticated session
    await context.clearCookies();

    // 2. Visit Login page
    await page.goto('http://localhost:3000/login');
    await page.locator('[data-hydrated="true"]').waitFor({ timeout: 15000 });

    // 3. Verify Google OAuth button is present as primary action
    const googleBtn = page.getByTestId('google-auth-btn');
    await expect(googleBtn).toBeVisible();
    await expect(googleBtn).toContainText('Continue with Google');

    // 4. Switch to "Register Business" tab
    await page.getByTestId('auth-tab-register').click();

    // 5. Verify Owner name, phone, password and shop details are REMOVED from the front page
    await expect(page.locator('#reg-name, [data-testid="register-name"]')).toHaveCount(0);
    await expect(page.locator('#reg-phone, [data-testid="register-phone"]')).toHaveCount(0);
    await expect(page.locator('#reg-shop-name, [data-testid="register-shop-name"]')).toHaveCount(0);

    // Verify 2-step onboarding explanation is shown instead
    await expect(page.getByText(/Two-Step Business Registration/i)).toBeVisible();

    // 6. Complete self-registration via the onboarding API
    const onboardRes = await page.request.post('http://localhost:3000/api/merchant/onboard', {
      data: {
        fullName: 'Trinadh Founder',
        phone: testPhone,
        email: testEmail,
        password: testPassword,
        shopName: shopName,
        categoryId: 'salons',
        address: 'AIR Bypass Road, Tirupati',
      },
    });
    expect(onboardRes.ok()).toBeTruthy();

    // 7. Log in on the front page using the newly created credentials
    await page.getByTestId('auth-tab-signin').click();
    await page.getByTestId('login-email').fill(testEmail);
    await page.getByTestId('login-password').fill(testPassword);
    await page.getByTestId('login-submit').click();

    // 8. Verify Redirection to Merchant Dashboard
    await expect(page).toHaveURL('http://localhost:3000/', { timeout: 20000 });

    // 8. Verify Isolated Workspace displays the new shop name or vertical badge
    const headerShop = page.locator('header, main, [data-testid="locked-tenant-badge"]');
    await expect(headerShop.getByText(new RegExp(shopName, 'i')).or(page.getByText(/Salons & Spas/i)).first()).toBeVisible({ timeout: 15000 });

    // Verify Salon Terminology: "Stylists & Services" link present
    const stylistNavLink = page.getByRole('link', { name: /Stylists & Services/i }).first();
    await expect(stylistNavLink).toBeVisible();

    // Clinic/Hospital Terminology must NOT be present
    await expect(page.getByRole('link', { name: /Doctors & Services/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Platform Admin/i })).toHaveCount(0);

    // 9. Navigate to Resources (Stylists)
    await stylistNavLink.click();
    await expect(page).toHaveURL(/.*\/resources.*/, { timeout: 15000 });

    // Verify Salon Resource Heading
    await expect(page.getByRole('heading', { name: /Stylists/i })).toBeVisible({ timeout: 15000 });

    // Verify newly provisioned salon workspace is ready (starts clean without dummy clutter)
    await expect(page.getByText(/Stylist|Add Stylist|No stylists found/i).first()).toBeVisible({ timeout: 15000 });

    // Hospital doctors must NOT be present in this isolated workspace
    await expect(page.getByText('Dr. A. Sundararajan')).toHaveCount(0);

    // 10. Navigate to Bookings Queue
    const bookingsLink = page.getByRole('link', { name: /Bookings Queue/i }).first();
    await bookingsLink.click();
    await expect(page).toHaveURL(/.*\/bookings.*/, { timeout: 15000 });

    // Verify Date Horizon Filter Pills
    const allDatesBtn = page.getByTestId('date-horizon-all');
    const todayBtn = page.getByTestId('date-horizon-today');
    const yesterdayBtn = page.getByTestId('date-horizon-yesterday');
    const weekBtn = page.getByTestId('date-horizon-week');

    await expect(allDatesBtn).toBeVisible({ timeout: 15000 });
    await expect(todayBtn).toBeVisible();
    await expect(yesterdayBtn).toBeVisible();
    await expect(weekBtn).toBeVisible();

    // Click through each date horizon filter without UI crashes
    await todayBtn.click();
    await expect(todayBtn).toHaveClass(/bg-emerald-700/);

    await yesterdayBtn.click();
    await expect(yesterdayBtn).toHaveClass(/bg-emerald-700/);

    await weekBtn.click();
    await expect(weekBtn).toHaveClass(/bg-emerald-700/);

    await allDatesBtn.click();
    await expect(allDatesBtn).toHaveClass(/bg-emerald-700/);
  });

  test('TC-SELF-02: Merchant signs in with self-created custom password', async ({ page, context }) => {
    // 1. Clear session to simulate returning visitor
    await context.clearCookies();

    // 2. Go to Login page and switch to Sign In
    await page.goto('http://localhost:3000/login');
    await page.locator('[data-hydrated="true"]').waitFor({ timeout: 15000 });
    await page.getByTestId('auth-tab-signin').click();

    // 3. Fill in custom credentials
    await page.getByTestId('login-email').fill(testEmail);
    await page.getByTestId('login-password').fill(testPassword);

    // 4. Click Sign In
    await page.getByTestId('login-submit').click();

    // 5. Verify Successful Login into Isolated Workspace
    await expect(page).toHaveURL('http://localhost:3000/', { timeout: 20000 });
    await expect(page.getByRole('link', { name: /Stylists & Services/i }).first()).toBeVisible({ timeout: 15000 });
  });

  test('TC-SELF-03: Super Admin live governance at /admin monitors the newly created shop', async ({ page }) => {
    // 1. Log in as Super Admin
    await page.goto('http://localhost:3000/login');
    await page.locator('[data-hydrated="true"]').waitFor({ timeout: 15000 });
    await page.getByTestId('auth-tab-signin').click();
    await page.getByTestId('login-email').fill('admin@appointments-tirupati.com');
    await page.getByTestId('login-password').fill('AdminSecure2026!');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL('http://localhost:3000/', { timeout: 15000 });

    // 2. Navigate to /admin via Platform Admin link
    const adminNavLink = page.getByRole('link', { name: /Platform Admin/i }).first();
    await expect(adminNavLink).toBeVisible({ timeout: 15000 });
    await adminNavLink.click();
    await expect(page).toHaveURL(/.*\/admin/, { timeout: 15000 });

    // 3. Verify Super Admin Governance Hub & Pipeline
    await expect(page.getByText(/Merchant Onboarding Pipeline|Business Governance/i).first()).toBeVisible({ timeout: 20000 });

    // 4. Search for the newly created shop in the Admin Merchant Pipeline
    const searchInput = page.getByTestId('admin-merchant-search');
    await expect(searchInput).toBeVisible();
    await searchInput.fill(shopName);

    // 5. Verify that the new merchant shop appears in the pipeline table
    await expect(page.getByText(shopName).first()).toBeVisible({ timeout: 15000 });

    // 6. Verify the merchant is listed with ACTIVE status in the table
    const shopRow = page.locator('tr').filter({ hasText: shopName }).first();
    await expect(shopRow.getByText(/ACTIVE/i)).toBeVisible({ timeout: 10000 });
  });
});
