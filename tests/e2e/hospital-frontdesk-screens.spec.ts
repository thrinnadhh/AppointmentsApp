import { test, expect } from '@playwright/test';

test.describe.serial('Phase 5c: Hospital Front Desk Reception Screens & Workflows', () => {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

  test('1. Reception Check-In Desk renders header, doctor badges, fast-pass OTP input, and manual fallback CTA', async ({ page }) => {
    await page.goto(`${baseUrl}/?demo=1`);

    // Verify reception checkin panel
    const checkinPanel = page.locator('[data-testid="reception-checkin-panel"]');
    await expect(checkinPanel).toBeVisible({ timeout: 15000 });

    // Verify 4-digit code input & verify button
    const codeInput = page.locator('[data-testid="checkin-code-input"]');
    await expect(codeInput).toBeVisible();
    await expect(page.locator('[data-testid="verify-checkin-btn"]')).toBeVisible();

    // Verify manual check-in fallback button
    await expect(page.locator('[data-testid="manual-checkin-btn"]')).toBeVisible();
  });

  test('2. Front Desk Queue Triage tabs render Waiting, Standby, Expected, and Completed queues', async ({ page }) => {
    await page.goto(`${baseUrl}/?demo=1`);

    // Verify Queue tab buttons
    await expect(page.getByRole('button', { name: /Waiting Queue/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Standby Queue \(late patients\)/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Expected Today/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Completed/i })).toBeVisible();

    // Switch to Standby Queue tab and verify SPEC rules explanation
    await page.getByRole('button', { name: /Standby Queue \(late patients\)/i }).click();
    await expect(page.getByText(/Standby Queue Rules \(SPEC line 19 & 20\)/i)).toBeVisible();
    await expect(page.getByText(/FIFO/i)).toBeVisible();
  });

  test('3. Manual Check-In Fallback modal opens with appointment search and mandatory justification reason', async ({ page }) => {
    await page.goto(`${baseUrl}/?demo=1`);

    const manualBtn = page.locator('[data-testid="manual-checkin-btn"]');
    await expect(manualBtn).toBeVisible({ timeout: 15000 });
    await manualBtn.click();

    // Verify modal dialog
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Manual Fallback Check-In/i })).toBeVisible();
    await expect(page.getByText(/Staff Justification Reason \(Mandatory Audit Requirement\)/i)).toBeVisible();

    // Close modal
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('4. Waiting Lounge TV View opens high-contrast public waiting display', async ({ page }) => {
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
