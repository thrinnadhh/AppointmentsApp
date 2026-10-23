import { test, expect } from '@playwright/test';

test.describe.serial('Phase 5b: Hospital Consultant UI Screens & Workflows', () => {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

  test('1. Consultant Workspace (/consultation) renders session header, active card, up next, and queue tabs', async ({ page }) => {
    await page.goto(`${baseUrl}/consultation?demo=1`);

    // Verify main header
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Room 204 • Consultation Desk')).toBeVisible();

    // Verify session state controls
    await expect(page.getByRole('button', { name: 'In Session' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Break' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Emergency Departure' })).toBeVisible();

    // Verify assigned reception staff indicators
    await expect(page.getByText(/Assigned Front Desk Staff:/i)).toBeVisible();

    // Verify Queue tabs
    await expect(page.getByRole('button', { name: /Waiting Lounge/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Standby Queue/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Completed Today/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /All Slots Today/i })).toBeVisible();
  });

  test('2. Standby Queue tab renders late arrival callout and FIFO rules', async ({ page }) => {
    await page.goto(`${baseUrl}/consultation?demo=1`);

    // Click Standby Queue tab
    const standbyTab = page.getByRole('button', { name: /Standby Queue/i });
    await expect(standbyTab).toBeVisible({ timeout: 15000 });
    await standbyTab.click();

    // Verify SPEC explanation callout
    await expect(page.getByText('Standby Queue Specification (SPEC Priority 2)')).toBeVisible();
    await expect(page.getByText(/never pushed back/i)).toBeVisible();
  });

  test('3. Medical Urgency Override modal displays mandatory justification and target position', async ({ page }) => {
    await page.goto(`${baseUrl}/consultation?demo=1`);

    // If an override button is visible in waiting lounge
    const overrideBtn = page.getByRole('button', { name: /Medical Override/i }).first();
    if (await overrideBtn.isVisible()) {
      await overrideBtn.click();

      // Verify modal
      await expect(page.getByRole('heading', { name: /Medical Urgency Override/i })).toBeVisible();
      await expect(page.getByText('Target Queue Position')).toBeVisible();
      await expect(page.getByText(/Clinical Justification/i)).toBeVisible();
      await expect(page.getByPlaceholder(/Patient presents with acute/i)).toBeVisible();

      // Close modal
      await page.getByRole('button', { name: 'Cancel' }).click();
    }
  });
});
