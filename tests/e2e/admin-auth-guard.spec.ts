import { test, expect } from '@playwright/test';
import { AdminDashboardPage } from './pages/admin-dashboard.page';

test.describe('Admin Authentication & RBAC Gate (Phase 1)', () => {
  test('TC-ADMIN-AUTH-01: Unauthenticated request to /admin redirects to /admin/login', async ({ page }) => {
    // Clear cookies and storage state to ensure unauthenticated request
    await page.context().clearCookies();

    // Directly attempt navigating to /admin
    await page.goto('http://localhost:3000/admin');

    // Edge middleware should immediately bounce to /admin/login with redirect param
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByTestId('admin-login-email')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Super Admin Portal/i })).toBeVisible();
  });

  test('TC-ADMIN-AUTH-02: Non-admin merchant credentials get rejected on /admin/login', async ({ page }) => {
    await page.context().clearCookies();
    const adminPage = new AdminDashboardPage(page);

    await adminPage.gotoLoginPage();

    // Attempt login with valid merchant credentials (Naturals Salon)
    await adminPage.loginExpectFailure(
      'naturals.salon@tirupati-appointments.com',
      'NaturalsSalon2026!'
    );

    // Verify rejection alert
    const errorAlert = page.getByTestId('admin-login-error');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/Access Denied/i);

    // Verify user remained on login page and did not enter /admin
    expect(page.url()).toContain('/admin/login');
  });

  test('TC-ADMIN-AUTH-03: Super Admin authenticates successfully, reaches dashboard, and signs out', async ({ page }) => {
    await page.context().clearCookies();
    const adminPage = new AdminDashboardPage(page);

    await adminPage.gotoLoginPage();

    // Sign in with Super Admin credentials
    await adminPage.loginAsAdmin(
      'admin@appointments-tirupati.com',
      'AdminSecure2026!'
    );

    // Verified on Admin Dashboard
    await expect(page).toHaveURL('http://localhost:3000/admin');
    await expect(adminPage.pageHeading).toBeVisible();

    // Verify Super Admin Identity Badge in Header
    const identityBadge = page.getByTestId('admin-identity-badge');
    await expect(identityBadge).toBeVisible();
    await expect(identityBadge).toContainText('SUPER ADMIN');


    // Verify Sign Out flow
    const logoutBtn = page.getByTestId('admin-logout-btn');
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // Should redirect back to admin login
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByTestId('admin-login-email')).toBeVisible();
  });

  test('TC-ADMIN-AUTH-04: Zero-Trust API Gate blocks unauthenticated requests to /api/admin/*', async ({ request }) => {
    // Unauthenticated GET request to /api/admin/merchants without tokens
    const response = await request.get('http://localhost:3000/api/admin/merchants');

    // Must be rejected with 401 Unauthorized or 403 Forbidden
    expect([401, 403]).toContain(response.status());
    const data = await response.json();
    expect(data.error).toBeDefined();
  });
});
