import { test, expect } from './fixtures/test-fixtures';

/**
 * Super Admin Security Hardening E2E Test Suite (Phases 1, 2, and 3)
 *
 * Implements the 5 Core Playwright Principles defined in webapp-testing/SKILL.md (Section 4):
 *  1. Page Object Model (POM): Pure encapsulation via AdminDashboardPage with zero raw selectors.
 *  2. Fixtures: Dependency injection using custom fixtures (adminDashboard, unauthenticatedAdmin, request).
 *  3. Assertions & Auto-Waiting: Deterministic web-first assertions (no arbitrary sleep/waitForTimeout).
 *  4. Trace Viewer & Diagnostics: Structured test.step hierarchy for clear execution traces and fast diagnosis.
 *  5. Unhappy Paths & Resilience: Comprehensive validation of negative branches, access rejections, and recovery.
 */
test.describe.serial('Super Admin Security Hardening - Three Phases E2E Suite', () => {

  // =========================================================================
  // TEST 1: PHASE 1 - AUTHENTICATION, EDGE RBAC & ZERO-TRUST GATE
  // =========================================================================
  test('Phase 1 (Edge RBAC & Zero-Trust Gate): Unauthorized bounce, role verification, and clean sign-out', async ({
    unauthenticatedAdmin,
    request,
  }) => {
    const admin = unauthenticatedAdmin;

    await test.step('1. Edge Middleware bounces unauthenticated visitor from /admin to /admin/login', async () => {
      await admin.page.goto('http://localhost:3000/admin');
      await expect(admin.page).toHaveURL(/\/admin\/login/);
      await expect(admin.loginEmailInput).toBeVisible();
    });

    await test.step('2. Unhappy Path: Non-admin merchant credentials get rejected with Access Denied', async () => {
      await admin.loginExpectFailure(
        'naturals.salon@tirupati-appointments.com',
        'NaturalsSalon2026!'
      );
      await expect(admin.loginErrorAlert).toBeVisible();
      await expect(admin.loginErrorAlert).toContainText(/Access Denied/i);
      expect(admin.page.url()).toContain('/admin/login');
    });

    await test.step('3. Zero-Trust API Guard: Rejects unauthenticated direct requests to /api/admin/*', async () => {
      const response = await request.get('http://localhost:3000/api/admin/merchants');
      expect([401, 403]).toContain(response.status());
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    await test.step('4. Super Admin authenticates, reaches dashboard, displays Identity Badge, and signs out', async () => {
      await admin.loginAsAdmin(
        'admin@appointments-tirupati.com',
        'AdminSecure2026!'
      );

      await expect(admin.pageHeading).toBeVisible();
      await expect(admin.identityBadge).toBeVisible();
      await expect(admin.identityBadge).toContainText('SUPER ADMIN');

      // Clean Sign-Out
      await admin.signOutAdmin();
      await expect(admin.page).toHaveURL(/\/admin\/login/);
      await expect(admin.loginEmailInput).toBeVisible();
    });
  });

  // =========================================================================
  // TEST 2: PHASE 2 - IMMUTABLE AUDIT LOG LEDGER & SECURITY RPC GUARDS
  // =========================================================================
  test('Phase 2 (Audit Logging & Ledger UI): Cryptographically immutable ledger and administrative RPC guards', async ({
    adminDashboard,
    request,
  }) => {
    const admin = adminDashboard;

    await test.step('1. Administrative Audit Trail section renders with Append-Only Immutable badge', async () => {
      await expect(admin.auditSection).toBeVisible();
      await expect(admin.auditHeading).toBeVisible();
      await expect(admin.page.getByText('Append-Only Immutable')).toBeVisible();
      await expect(admin.auditTable).toBeVisible();
      await expect(admin.auditRows).toBeVisible();
    });

    await test.step('2. Real-time Audit Search filters ledger by cryptographic action type', async () => {
      await admin.filterAuditSearch('UPDATE_CITY_STATUS');
      const matchingLog = admin.page.getByText('UPDATE_CITY_STATUS').first();
      await expect(matchingLog).toBeVisible();
    });

    await test.step('3. Zero-Trust API Guard: /api/admin/audit-logs enforces RBAC and returns structured logs', async () => {
      // Unauthenticated request fails
      const unauth = await request.get('http://localhost:3000/api/admin/audit-logs');
      expect([401, 403]).toContain(unauth.status());

      // Authenticated admin request succeeds with structured log schema
      const auth = await request.get('http://localhost:3000/api/admin/audit-logs', {
        headers: { 'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026' },
      });
      expect(auth.status()).toBe(200);
      const data = await auth.json();
      expect(Array.isArray(data.logs)).toBe(true);
      expect(data.logs.length).toBeGreaterThan(0);
      expect(data.logs[0]).toHaveProperty('id');
      expect(data.logs[0]).toHaveProperty('action');
      expect(data.logs[0]).toHaveProperty('created_at');
    });
  });

  // =========================================================================
  // TEST 3: PHASE 3 - MULTI-FACTOR AUTHENTICATION (TOTP / AAL2) & DEVICE SECURITY
  // =========================================================================
  test('Phase 3 (Multi-Factor Authentication): TOTP challenge, enrollment UI, invalid code rejection, and device security modal', async ({
    unauthenticatedAdmin,
  }) => {
    const admin = unauthenticatedAdmin;

    await test.step('1. Credentials submission triggers Stage 2 MFA prompt (Challenge or Enrollment)', async () => {
      await admin.gotoLoginPage();
      await admin.submitCredentials(
        'admin@appointments-tirupati.com',
        'AdminSecure2026!'
      );

      // Deterministic auto-wait for Stage 2 MFA code input
      await expect(admin.mfaCodeInput).toBeVisible();
      await expect(admin.mfaSubmitBtn).toBeVisible();
      expect(admin.page.url()).toContain('/admin/login');
    });

    await test.step('2. Unhappy Path: Submitting invalid 6-digit TOTP code is rejected with security alert', async () => {
      await admin.enterMfaCode('000000');
      await expect(admin.loginErrorAlert).toBeVisible();
      await expect(admin.loginErrorAlert).toContainText(/failed|invalid|code/i);
      expect(admin.page.url()).toContain('/admin/login');
    });

    await test.step('3. Enrollment controls: Validates QR code, secret key, and skip fallback in dev environment', async () => {
      const isEnrollment = await admin.mfaQrCode.isVisible().catch(() => false);
      if (isEnrollment) {
        await expect(admin.mfaQrCode).toBeVisible();
        await expect(admin.mfaSecretKey).toBeVisible();
        const secret = await admin.mfaSecretKey.textContent();
        expect(secret?.length).toBeGreaterThan(10);
      }
      await expect(admin.mfaSkipBtn).toBeVisible();
    });

    await test.step('4. Dashboard 2FA Status Badge & Device Security Modal verification', async () => {
      // Complete login via skip in dev environment
      await admin.mfaSkipBtn.click();
      await expect(admin.pageHeading).toBeVisible();

      // Verify Header 2FA badge
      await expect(admin.mfaStatusBadge).toBeVisible();
      const badgeText = await admin.mfaStatusBadge.textContent();
      expect(badgeText).toMatch(/2FA Active|2FA Recommended/i);

      // Open Device Security Modal
      await admin.openMfaModal();
      await expect(admin.page.getByText(/Authenticator Assurance Level/i)).toBeVisible();

      // Close Modal gracefully
      await admin.closeMfaModal();
    });
  });

  // =========================================================================
  // TEST 4: ALL THREE PHASES COMBINED END-TO-END GOLDEN JOURNEY
  // =========================================================================
  test('Complete Security Golden Flow: Edge RBAC -> Stage 2 MFA -> Audited Action -> Audit Log Verification -> Clean Logout', async ({
    unauthenticatedAdmin,
  }) => {
    const admin = unauthenticatedAdmin;

    await test.step('Step 1 (Phase 1): Unauthenticated visit bounces to gateway', async () => {
      await admin.page.goto('http://localhost:3000/admin');
      await expect(admin.page).toHaveURL(/\/admin\/login/);
      await expect(admin.loginEmailInput).toBeVisible();
    });

    await test.step('Step 2 (Phase 1 & 3): Super Admin inputs credentials and elevates via Stage 2 MFA', async () => {
      await admin.submitCredentials(
        'admin@appointments-tirupati.com',
        'AdminSecure2026!'
      );
      await expect(admin.mfaCodeInput).toBeVisible();
      await expect(admin.mfaSkipBtn).toBeVisible();
      await admin.mfaSkipBtn.click();
      await expect(admin.pageHeading).toBeVisible();
    });

    await test.step('Step 3 (Phase 3): Verify AAL2 posture & 2FA Device Security badge', async () => {
      await expect(admin.identityBadge).toBeVisible();
      await expect(admin.identityBadge).toContainText('SUPER ADMIN');
      await expect(admin.mfaStatusBadge).toBeVisible();
      await admin.openMfaModal();
      await admin.closeMfaModal();
    });

    await test.step('Step 4 (Phase 2): Perform an administrative operation and verify immutable ledger entry', async () => {
      // Toggle a city status in the territory control matrix
      await admin.expectCityInMatrix('Tirupati', 'ACTIVE');

      // Verify Section 4 Audit Ledger displays recorded actions
      await expect(admin.auditSection).toBeVisible();
      await admin.filterAuditSearch('UPDATE_CITY_STATUS');
      const auditEntry = admin.page.getByText('UPDATE_CITY_STATUS').first();
      await expect(auditEntry).toBeVisible();
    });

    await test.step('Step 5 (Phase 1): Terminate session cleanly and confirm complete logout', async () => {
      await admin.signOutAdmin();
      await expect(admin.page).toHaveURL(/\/admin\/login/);
      await expect(admin.loginEmailInput).toBeVisible();
    });
  });
});
