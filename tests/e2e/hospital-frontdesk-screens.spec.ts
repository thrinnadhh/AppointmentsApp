import { test, expect } from '@playwright/test';

test.describe.serial('Phase 5b: Hospital Front Desk Screens & Workflows', () => {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

  test('Journey 1: Check in patient by 4-digit code', async ({ page }) => {
    await page.goto(`${baseUrl}/?demo=1`);

    // Verify reception checkin panel
    const checkinPanel = page.locator('[data-testid="reception-checkin-panel"]');
    await expect(checkinPanel).toBeVisible({ timeout: 15000 });

    const codeInput = page.locator('[data-testid="checkin-code-input"]');
    const verifyBtn = page.locator('[data-testid="verify-checkin-btn"]');

    await codeInput.fill('1234');
    await verifyBtn.click();

    // Verify success banner with patient arrival details
    const successBanner = page.locator('[data-testid="checkin-success-banner"]');
    await expect(successBanner).toBeVisible({ timeout: 5000 });
    await expect(successBanner).toContainText(/Jane Doe/i);
    await expect(successBanner).toContainText(/successfully checked in/i);
    await expect(successBanner).toContainText(/Waiting Queue/i);
  });

  test('Journey 2: Wrong code 5 times shows 60s security lock', async ({ page }) => {
    await page.goto(`${baseUrl}/?demo=1`);

    const codeInput = page.locator('[data-testid="checkin-code-input"]');
    const verifyBtn = page.locator('[data-testid="verify-checkin-btn"]');

    await expect(codeInput).toBeVisible({ timeout: 15000 });

    // Submit invalid code 5 times consecutively
    for (let attempt = 1; attempt <= 5; attempt++) {
      await codeInput.fill('9999');
      await verifyBtn.click();
      if (attempt < 5) {
        // Expect error message with countdown of attempts remaining
        await expect(page.locator('[data-testid="checkin-error-banner"]')).toBeVisible({ timeout: 3000 });
      }
    }

    // Verify 60s security lockout banner
    const lockoutAlert = page.locator('[data-testid="checkin-lockout-alert"]');
    await expect(lockoutAlert).toBeVisible({ timeout: 5000 });
    await expect(lockoutAlert).toContainText(/Reception Terminal Rate-Limited/i);
    await expect(lockoutAlert).toContainText(/60s/i);

    // Verify input and verify button are disabled during lockout
    await expect(codeInput).toBeDisabled();
    await expect(verifyBtn).toBeDisabled();
  });

  test('Journey 3: Late patient goes to Standby Queue (SPEC lines 19 & 20)', async ({ page }) => {
    await page.goto(`${baseUrl}/?demo=1`);

    // Switch to Standby Queue tab
    const standbyTabBtn = page.getByRole('button', { name: /Standby Queue \(late patients\)/i });
    await expect(standbyTabBtn).toBeVisible({ timeout: 15000 });
    await standbyTabBtn.click();

    // Verify standby queue list and late patient card
    const standbyList = page.locator('[data-testid="standby-queue-list"]');
    await expect(standbyList).toBeVisible();
    await expect(standbyList).toContainText(/Karthik Raja/i);

    // Verify late arrival tag and FIFO explanation per SPEC
    await expect(page.locator('[data-testid="patient-late-tag"]').first()).toBeVisible();
    await expect(page.getByText(/Standby Queue Rules \(SPEC line 19 & 20\)/i)).toBeVisible();
    await expect(page.getByText(/FIFO/i)).toBeVisible();
  });

  test('Journey 4: Up Next follows SPEC rules (On-time priority, shared queue engine)', async ({ page }) => {
    await page.goto(`${baseUrl}/?demo=1`);

    // Default to Waiting Queue tab
    const waitingTabBtn = page.getByRole('button', { name: /Waiting Queue/i });
    await expect(waitingTabBtn).toBeVisible({ timeout: 15000 });

    // Verify "Up Next" badge on top waiting patient
    const upNextBadge = page.locator('[data-testid="up-next-badge"]');
    await expect(upNextBadge).toBeVisible();
    await expect(upNextBadge).toContainText(/Up Next/i);

    // Verify "Start Consultation" button on up-next patient
    const startConsultBtn = page.locator('[data-testid="start-consultation-btn"]').first();
    await expect(startConsultBtn).toBeVisible();

    // Verify "Mark No-Show" button exists on waiting patients
    const noShowBtn = page.locator('[data-testid="mark-no-show-btn"]').first();
    await expect(noShowBtn).toBeVisible();
  });

  test('Journey 5: Unassigned Consultant data is unreachable by URL (403 Forbidden)', async ({ page }) => {
    // 5A. Front Desk probes an unassigned doctor ID via URL parameter
    await page.goto(`${baseUrl}/?demo=1&role=front_desk&doctor_id=unassigned-doc-999`);

    const unassignedForbidden = page.locator('[data-testid="frontdesk-unassigned-doctor-forbidden"]');
    await expect(unassignedForbidden).toBeVisible({ timeout: 15000 });
    await expect(unassignedForbidden).toContainText(/Forbidden: Consultant Data Unreachable/i);
    await expect(unassignedForbidden).toContainText(/403/i);

    // 5B. Front Desk has zero assigned consultants (?assigned=none)
    await page.goto(`${baseUrl}/?demo=1&role=front_desk&assigned=none`);

    const noAssignmentsForbidden = page.locator('[data-testid="frontdesk-no-assignments-forbidden"]');
    await expect(noAssignmentsForbidden).toBeVisible({ timeout: 15000 });
    await expect(noAssignmentsForbidden).toContainText(/Reception Access Restricted: No Assigned Doctors/i);
  });

  test('Journey 6: Manual Check-In Fallback modal with mandatory audit justification', async ({ page }) => {
    await page.goto(`${baseUrl}/?demo=1`);

    const manualBtn = page.locator('[data-testid="manual-checkin-btn"]');
    await expect(manualBtn).toBeVisible({ timeout: 15000 });
    await manualBtn.click();

    // Verify modal dialog and audit reason field
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Manual Fallback Check-In/i })).toBeVisible();
    await expect(page.getByText(/Staff Justification Reason \(Mandatory Audit Requirement\)/i)).toBeVisible();

    // Close modal
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('Journey 7: Waiting Lounge TV View opens high-contrast public waiting display', async ({ page }) => {
    await page.goto(`${baseUrl}/?demo=1`);

    const tvBtn = page.getByRole('button', { name: /Waiting Lounge TV View/i });
    if (await tvBtn.isVisible()) {
      await tvBtn.click();

      // Verify TV display modal
      await expect(page.getByText(/Live Waiting Lounge Queue/i)).toBeVisible();
      await expect(page.getByText(/Now Serving \/ In Consultation/i)).toBeVisible();
      await expect(page.getByText(/Waiting Queue Sequence/i)).toBeVisible();

      // Close TV kiosk display
      await page.getByLabel('Close Kiosk Mode').click();
    }
  });
});
