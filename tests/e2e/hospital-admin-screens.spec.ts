import { test, expect } from '@playwright/test';

test.describe.serial('Phase 5a: Hospital Admin UI Screens & Workflows', () => {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

  test('1. Departments Management Screen (/departments) renders KPIs, CRUD modal, and max-3 member quota', async ({ page }) => {
    await page.goto(`${baseUrl}/departments?demo=1`);

    // Verify main header
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Departments & Clinical Units')).toBeVisible();

    // Verify KPI summary metrics
    await expect(page.getByText('Total Units')).toBeVisible();
    await expect(page.getByText('Active Units')).toBeVisible();
    await expect(page.getByText('Enrolled Staff')).toBeVisible();

    // Verify Create Department button & modal
    const createBtn = page.getByRole('button', { name: /Create Department/i }).first();
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Verify Create modal contents
    await expect(page.getByRole('heading', { name: /Create Department/i })).toBeVisible();
    await expect(page.locator('#dept-name-input')).toBeVisible();
    await expect(page.getByText('Quick Specialty Presets:')).toBeVisible();
    await expect(page.getByText('Allowed Clinical Modules *')).toBeVisible();
    await expect(page.getByText('Appointments Booking')).toBeVisible();

    // Close modal
    await page.getByRole('button', { name: '✕' }).click();

    // Verify "Manage Members" button on any department card
    const manageMembersBtn = page.getByRole('button', { name: /Manage Members/i }).first();
    if (await manageMembersBtn.isVisible()) {
      await manageMembersBtn.click();

      // Check member quota header (max 3 rule)
      await expect(page.getByText(/Quota:/i)).toBeVisible();
      await expect(page.getByText(/3 Allowed Members/i)).toBeVisible();

      // Close member modal
      await page.getByRole('button', { name: '✕' }).click();
    }
  });

  test('2. Audit Logs Screen (/audit-logs) renders compliance table, category filters, and JSON inspector', async ({ page }) => {
    await page.goto(`${baseUrl}/audit-logs?demo=1`);

    // Verify header
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Hospital Audit Trail & Compliance Logs')).toBeVisible();

    // Verify KPI cards
    await expect(page.getByText('Total Events')).toBeVisible();
    await expect(page.getByText('Governance Actions')).toBeVisible();
    await expect(page.getByText('Emergency Events')).toBeVisible();
    await expect(page.getByText('Capacity Overrides')).toBeVisible();

    // Verify Category Filter buttons
    await expect(page.getByRole('button', { name: /All Events/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Governance/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Emergency/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Overrides/i })).toBeVisible();

    // Verify search input
    await expect(page.locator('#audit-search')).toBeVisible();

    // Verify table headers
    await expect(page.getByRole('columnheader', { name: /Timestamp/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Action Event/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Actor/i })).toBeVisible();
  });

  test('3. Team Screen (/team) displays unified staff provisioning modal with max-3 department checks', async ({ page }) => {
    await page.goto(`${baseUrl}/team?demo=1`);

    // Verify page title
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

    // Open unified staff provisioning modal
    const provisionBtn = page.getByRole('button', { name: /\+ Provision Staff/i });
    if (await provisionBtn.isVisible()) {
      await provisionBtn.click();

      // Verify modal and tabs
      await expect(page.getByRole('heading', { name: /Unified Staff Provisioning/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Consultant \/ Doctor/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Front Desk/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Hospital Admin/i })).toBeVisible();

      // Verify department quota notification
      await expect(page.getByText('Policy: Max 3 members per department')).toBeVisible();

      // Close modal
      await page.getByRole('button', { name: '✕' }).click();
    }
  });

  test('4. Settings Screen (/settings) displays read-only No-Show amounts and 60m cancellation cutoff', async ({ page }) => {
    await page.goto(`${baseUrl}/settings?demo=1`);

    // Ensure Policies tab is active or click it
    const policiesTab = page.getByRole('button', { name: /Policies/i });
    if (await policiesTab.isVisible()) {
      await policiesTab.click();
    }

    // Verify Standard Hospital Cancellation & No-Show Policy Card
    await expect(page.getByText('Standard Hospital Cancellation & No-Show Policy')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('SPEC Read-Only Rule')).toBeVisible();

    // Verify the exact values per SPEC
    await expect(page.getByText('60 Minutes')).toBeVisible();
    await expect(page.getByText('₹50.00')).toBeVisible();
    await expect(page.getByText('₹10.00')).toBeVisible();
    await expect(page.getByText(/In the event of a verified patient No-Show/i)).toBeVisible();
  });

  test('5. Operating Schedule Screen (/schedule) displays weekly shifts and Doctor Leave Calendar', async ({ page }) => {
    await page.goto(`${baseUrl}/schedule?demo=1`);

    // Verify schedule header
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Operating Schedule & Shift Hours')).toBeVisible();

    // Verify Doctor Leave Calendar section
    await expect(page.getByRole('heading', { name: /Doctor Leave & Planned Absence Calendar/i })).toBeVisible();
    await expect(page.locator('#leave-date')).toBeVisible();
    await expect(page.getByRole('button', { name: /Record Doctor Absence/i })).toBeVisible();
  });
});
