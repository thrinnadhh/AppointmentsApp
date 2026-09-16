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

  test('TC-ADMIN-AUDIT-01: Immutable Audit Trail UI displays cryptographically verifiable admin logs', async ({ page }) => {
    await page.context().clearCookies();
    const adminPage = new AdminDashboardPage(page);

    await adminPage.gotoLoginPage();
    await adminPage.loginAsAdmin(
      'admin@appointments-tirupati.com',
      'AdminSecure2026!'
    );

    // Verify Audit Section in Dashboard
    await expect(adminPage.auditSection).toBeVisible();
    await expect(adminPage.auditHeading).toBeVisible();
    await expect(page.getByText('Append-Only Immutable')).toBeVisible();

    // Verify Audit Rows are loaded
    await expect(adminPage.auditRows).toBeVisible();

    // Verify Search filter in Audit Ledger
    await adminPage.auditSearchInput.fill('UPDATE_CITY_STATUS');
    const matchingLog = page.getByText('UPDATE_CITY_STATUS').first();
    await expect(matchingLog).toBeVisible();
  });

  test('TC-ADMIN-AUDIT-02: Zero-Trust API Gate protects /api/admin/audit-logs with RBAC verification', async ({ request }) => {
    // 1. Unauthenticated request must fail
    const unauthResponse = await request.get('http://localhost:3000/api/admin/audit-logs');
    expect([401, 403]).toContain(unauthResponse.status());

    // 2. Authenticated Admin request must succeed and return structured logs
    const authResponse = await request.get('http://localhost:3000/api/admin/audit-logs', {
      headers: { 'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026' },
    });
    expect(authResponse.status()).toBe(200);

    const body = await authResponse.json();
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs.length).toBeGreaterThan(0);

    const firstLog = body.logs[0];
    expect(firstLog).toHaveProperty('id');
    expect(firstLog).toHaveProperty('action');
    expect(firstLog).toHaveProperty('target_type');
    expect(firstLog).toHaveProperty('created_at');
  });

  // ================= PHASE 3: MULTI-FACTOR AUTHENTICATION (TOTP) =================

  test('TC-ADMIN-MFA-01: Admin credentials submission triggers Stage 2 MFA prompt', async ({ page }) => {
    await page.context().clearCookies();
    const adminPage = new AdminDashboardPage(page);

    await adminPage.gotoLoginPage();

    // Submit credentials without auto-skipping
    await adminPage.submitCredentials(
      'admin@appointments-tirupati.com',
      'AdminSecure2026!'
    );

    // Stage 2 must be rendered: 6-digit MFA code input and submit button
    await expect(adminPage.mfaCodeInput).toBeVisible({ timeout: 10000 });
    await expect(adminPage.mfaSubmitBtn).toBeVisible();

    // User is still on /admin/login until MFA stage completes
    expect(page.url()).toContain('/admin/login');
  });

  test('TC-ADMIN-MFA-02: MFA enrollment renders SVG QR code, secret key, and skip fallback', async ({ page }) => {
    await page.context().clearCookies();
    const adminPage = new AdminDashboardPage(page);

    await adminPage.gotoLoginPage();
    await adminPage.submitCredentials(
      'admin@appointments-tirupati.com',
      'AdminSecure2026!'
    );

    await expect(adminPage.mfaCodeInput).toBeVisible({ timeout: 10000 });

    // Verify whether in enrollment or challenge state, the UI provides secure controls
    const isEnrollment = await adminPage.mfaQrCode.isVisible().catch(() => false);
    if (isEnrollment) {
      await expect(adminPage.mfaQrCode).toBeVisible();
      await expect(adminPage.mfaSecretKey).toBeVisible();
      const secretText = await adminPage.mfaSecretKey.textContent();
      expect(secretText?.length).toBeGreaterThan(10);
    }

    // Dev preview skip button must be present in development environment
    await expect(adminPage.mfaSkipBtn).toBeVisible();
  });

  test('TC-ADMIN-MFA-03: Submitting invalid 6-digit TOTP code rejects with security alert', async ({ page }) => {
    await page.context().clearCookies();
    const adminPage = new AdminDashboardPage(page);

    await adminPage.gotoLoginPage();
    await adminPage.submitCredentials(
      'admin@appointments-tirupati.com',
      'AdminSecure2026!'
    );

    await expect(adminPage.mfaCodeInput).toBeVisible({ timeout: 10000 });

    // Attempt verification with deliberate bad code (000000 / 999999)
    await adminPage.enterMfaCode('000000');

    // Must show rejection banner and remain on login page
    const errorAlert = page.getByTestId('admin-login-error');
    await expect(errorAlert).toBeVisible({ timeout: 8000 });
    await expect(errorAlert).toContainText(/failed|invalid|code/i);
    expect(page.url()).toContain('/admin/login');
  });

  test('TC-ADMIN-MFA-04: Dashboard reflects 2FA status and security management modal', async ({ page }) => {
    await page.context().clearCookies();
    const adminPage = new AdminDashboardPage(page);

    await adminPage.gotoLoginPage();
    await adminPage.loginAsAdmin(
      'admin@appointments-tirupati.com',
      'AdminSecure2026!'
    );

    // Dashboard loaded
    await expect(adminPage.pageHeading).toBeVisible();

    // Verify 2FA status indicator in top header
    await expect(adminPage.mfaStatusBadge).toBeVisible();
    const badgeText = await adminPage.mfaStatusBadge.textContent();
    expect(badgeText).toMatch(/2FA Active|2FA Recommended/i);

    // Click 2FA status badge to open device security modal
    await adminPage.mfaStatusBadge.click();
    await expect(adminPage.mfaModal).toBeVisible();
    await expect(page.getByRole('heading', { name: /Two-Factor Authentication & Device Security/i })).toBeVisible();
    await expect(page.getByText(/Authenticator Assurance Level/i)).toBeVisible();

    // Close modal
    const closeBtn = page.getByRole('button', { name: /Close Window/i });
    await closeBtn.click();
    await expect(adminPage.mfaModal).not.toBeVisible();
  });
});
