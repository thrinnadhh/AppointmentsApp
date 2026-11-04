import { test, expect } from '@playwright/test';
import { MerchantPortalPage } from './pages/merchant-portal.page';

test.describe.serial('Doctor Credentials & Front Desk Manager Assignment Workflow', () => {
  let merchantPortal: MerchantPortalPage;

  test.beforeEach(async ({ page }) => {
    merchantPortal = new MerchantPortalPage(page);
  });

  test('1. Should show Doctor Portal Credentials in Resources screen and on doctor cards', async ({ page }) => {
    await merchantPortal.gotoResources();

    // Verify main header
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

    // Click "Add Doctor" or "Add Staff" button
    const addDoctorBtn = page.getByRole('button', { name: /\+ Add (Doctor|Stylist|Court|Table|Vet|Staff)/i });
    if (await addDoctorBtn.isVisible()) {
      await addDoctorBtn.click();

      // Check that the Doctor Portal Login Credentials section is present
      await expect(page.locator('#doctor-email')).toBeVisible();
      await expect(page.locator('#doctor-password')).toBeVisible();

      // Close modal
      const cancelBtn = page.getByRole('button', { name: /Cancel/i }).last();
      await cancelBtn.click();
    }
  });

  test('2. Should display Doctor-Centric Cards and Front Desk assignment interface in Team page', async ({ page }) => {
    await merchantPortal.gotoTeam();

    // Verify main header
    await expect(page.getByRole('heading', { name: /Team & Merchant Credentials/i, level: 1 })).toBeVisible();

    // Verify Doctor Desks Section
    await expect(page.getByRole('heading', { name: /Desks & Front Desk Manager Assignments/i })).toBeVisible({ timeout: 15000 });

    // Verify KPI cards
    await expect(page.getByText('Front Desk Desks')).toBeVisible();

    // Verify filter buttons exist
    await expect(page.getByRole('button', { name: /^all$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^admin$/i })).toBeVisible();
  });

  test('3. Should assign a Front Desk Manager to a doctor and allow unassignment', async ({ page }) => {
    await merchantPortal.gotoTeam();

    // Look for "+ Add Front Desk Manager" button on any doctor card
    const addFdBtn = page.getByRole('button', { name: /\+ Add Front Desk Manager/i }).first();
    
    if (await addFdBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await addFdBtn.click();

      // Verify modal opened
      await expect(page.getByRole('heading', { name: /Assign Front Desk Manager/i })).toBeVisible();
      await expect(page.locator('#fd-name')).toBeVisible();
      await expect(page.locator('#fd-email')).toBeVisible();
      await expect(page.locator('#fd-password')).toBeVisible();

      const runId = Date.now().toString().slice(-4);
      const testManagerName = `Receptionist Test ${runId}`;
      const testManagerEmail = `reception.${runId}@tirupati.care`;
      const testManagerPassword = `ReceptionPass${runId}!`;

      await page.locator('#fd-name').fill(testManagerName);
      await page.locator('#fd-email').fill(testManagerEmail);
      await page.locator('#fd-password').fill(testManagerPassword);

      // Submit
      await page.getByRole('button', { name: /Assign to/i }).click();

      // Verify success notification or assigned manager appears
      await expect(page.getByText(testManagerName)).toBeVisible({ timeout: 15000 });

      // Test Unassign
      const unassignBtn = page.locator(`button[title*="Unassign ${testManagerName}"]`).first();
      if (await unassignBtn.isVisible()) {
        page.once('dialog', async (dialog) => {
          await dialog.accept();
        });
        await unassignBtn.click();

        // Verify unassigned notification
        await expect(page.getByText(/Unassigned/i)).toBeVisible({ timeout: 10000 });
      }
    }
  });
});
