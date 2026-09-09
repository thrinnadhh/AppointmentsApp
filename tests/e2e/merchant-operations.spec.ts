import { test, expect } from '@playwright/test';

test.describe.serial('Merchant Team Provisioning & Bookings Management E2E', () => {
  test('1. Should display team members and filter by role', async ({ page }) => {
    await page.goto('/team');
    await expect(page).toHaveTitle(/Merchant Dashboard/);

    // Verify main header
    await expect(page.getByRole('heading', { name: /Team & Merchant Credentials/i, level: 1 })).toBeVisible();

    // Verify filter buttons
    const adminFilter = page.getByRole('button', { name: /^admin$/i });
    await expect(adminFilter).toBeVisible();
    await adminFilter.click();

    // Return to All filter
    const allFilter = page.getByRole('button', { name: /^all$/i });
    await allFilter.click();
  });

  test('2. Should invite and provision a new Merchant Staff account', async ({ page }) => {
    const runId = Date.now();
    const uniqueStaffName = `Dr. Ananya Reddy ${runId.toString().slice(-4)}`;
    const uniqueStaffEmail = `staff.${runId}@tirupati.care`;
    const uniquePhone = `+91 9${runId.toString().slice(-9)}`;

    await page.goto('/team');

    // Click Add Staff Member button
    const addMemberBtn = page.getByRole('button', { name: /Add Staff Member/i });
    await expect(addMemberBtn).toBeVisible();
    await addMemberBtn.click();

    // Verify modal is open
    await expect(page.locator('#team-member-name')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Add Staff \/ Merchant User/i })).toBeVisible();

    // Fill form
    await page.locator('#team-member-name').fill(uniqueStaffName);
    await page.locator('#team-member-email').fill(uniqueStaffEmail);
    await page.locator('#team-member-password').fill('SecureStaffPass123!');
    await page.locator('#team-member-role').selectOption('merchant');
    await page.locator('#team-member-phone').fill(uniquePhone);

    // Submit form
    await page.getByRole('button', { name: /Save & Provision User/i }).click();

    // Verify success banner appears
    await expect(
      page.getByText(new RegExp(`Staff account created for ${uniqueStaffName}`, 'i'))
    ).toBeVisible({ timeout: 15000 });

    // Verify new member card in list
    await expect(page.getByText(uniqueStaffName).first()).toBeVisible();
    await expect(page.getByText(uniqueStaffEmail).first()).toBeVisible();
  });

  test('3. Should display Bookings Queue and filter by status tabs and search', async ({ page }) => {
    await page.goto('/bookings');
    await expect(page).toHaveTitle(/Merchant Dashboard/);

    // Check header
    await expect(page.getByRole('heading', { name: /Bookings & Queue/i, level: 1 })).toBeVisible();

    // Test filter tabs
    const heldTab = page.getByRole('button', { name: /^HELD$/i });
    if (await heldTab.isVisible()) {
      await heldTab.click();
    }

    const confirmedTab = page.getByRole('button', { name: /^CONFIRMED$/i });
    if (await confirmedTab.isVisible()) {
      await confirmedTab.click();
    }

    const allTab = page.getByRole('button', { name: /^ALL$/i });
    await allTab.click();

    // Verify search input operates without throwing
    const searchInput = page.locator('#customer-search');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Kalyan');
    await searchInput.fill('');
  });
});
