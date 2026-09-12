import { test, expect } from './fixtures/test-fixtures';

/**
 * Super Admin Multi-City Rollout & Merchant Pipeline Funnel E2E Test Suite
 * Adheres strictly to Section 4 Playwright Principles:
 *  1. Page Object Model (POM) encapsulation.
 *  2. Custom fixtures & multi-role browser contexts.
 *  3. Web-first assertions with deterministic auto-waiting (no arbitrary sleep).
 *  4. Structured test.step hierarchy with structured trace logging.
 */
test.describe.serial('Super Admin Multi-City Rollout & Expansion Hub', () => {

  test.beforeEach(async ({ request }) => {
    // Reset test territory baseline state for idempotent repeatability
    await request.patch('http://localhost:3000/api/admin/cities', {
      data: { cityId: 'nellore', status: 'EXPANDING' },
    });
  });

  test('Feature 1: Executive KPI Cards & Dynamic Time-Window Velocity Switcher', async ({
    adminDashboard,
  }) => {
    await test.step('1. Verify core executive dashboard header and status badge', async () => {
      await expect(adminDashboard.pageHeading).toBeVisible();
      await expect(adminDashboard.page.getByText('Live Ops')).toBeVisible();
    });

    await test.step('2. Verify all 5 executive KPI cards exist with metrics', async () => {
      await expect(adminDashboard.kpiCompletedBookings).toBeVisible();
      await expect(adminDashboard.kpiMerchantFunnel).toBeVisible();
      await expect(adminDashboard.kpiRolloutCoverage).toBeVisible();
      await expect(adminDashboard.kpiDepositVolume).toBeVisible();
      await expect(adminDashboard.kpiWaitlist).toBeVisible();
    });

    await test.step('3. Cycle through dynamic time horizons: Today, Last 3 Days, Last Week, Last 30 Days, All Time', async () => {
      // Switch to Today
      await adminDashboard.selectTimeHorizon('today');
      await expect(adminDashboard.page.getByText(/Across confirmed slots \(today\)/i)).toBeVisible();

      // Switch to Last 3 Days
      await adminDashboard.selectTimeHorizon('3days');
      await expect(adminDashboard.page.getByText(/Across confirmed slots \(3days\)/i)).toBeVisible();

      // Switch to Last Week (7 Days)
      await adminDashboard.selectTimeHorizon('7days');
      await expect(adminDashboard.page.getByText(/Across confirmed slots \(7days\)/i)).toBeVisible();

      // Switch to Last 30 Days
      await adminDashboard.selectTimeHorizon('30days');
      await expect(adminDashboard.page.getByText(/Across confirmed slots \(30days\)/i)).toBeVisible();

      // Switch to All Time
      await adminDashboard.selectTimeHorizon('all');
      await expect(adminDashboard.page.getByText(/Across confirmed slots \(all\)/i)).toBeVisible();
    });
  });

  test('Feature 2: City Expansion Territory Matrix & Launch Status Transition', async ({
    adminDashboard,
  }) => {
    await test.step('1. Verify seeded territories appear in the control matrix', async () => {
      await expect(adminDashboard.territoryMatrixHeading).toBeVisible();
      await adminDashboard.expectCityInMatrix('Tirupati', 'ACTIVE');
      await adminDashboard.expectCityInMatrix('Nellore', 'EXPANDING');
      await adminDashboard.expectCityInMatrix('Chennai', 'PLANNED');
    });

    await test.step('2. Filter territories using the search input', async () => {
      await adminDashboard.filterTerritorySearch('Nellore');
      await adminDashboard.expectCityInMatrix('Nellore');
      // Tirupati should now be filtered out
      await expect(adminDashboard.territoryTable.getByText('Tirupati')).not.toBeVisible();

      // Clear search filter
      await adminDashboard.filterTerritorySearch('');
      await adminDashboard.expectCityInMatrix('Tirupati');
    });

    await test.step('3. Transition an expanding city to active via status toggle', async () => {
      // Find Nellore row action button
      await adminDashboard.clickCityAction('Nellore', 'Launch Active');
      // Verify toast notification appears
      await expect(adminDashboard.page.getByText(/✓ City NELLORE transitioned to ACTIVE/i)).toBeVisible();
      // Verify Nellore is now ACTIVE
      await adminDashboard.expectCityInMatrix('Nellore', 'ACTIVE');
    });
  });

  test('Feature 3: Merchant Pipeline Funnel & Onboarding Triage', async ({
    adminDashboard,
  }) => {
    await test.step('1. Verify merchant pipeline funnel table and tabs', async () => {
      await expect(adminDashboard.merchantFunnelHeading).toBeVisible();
      await expect(adminDashboard.merchantTabAll).toBeVisible();
      await expect(adminDashboard.merchantTabPending).toBeVisible();
      await expect(adminDashboard.merchantTabActive).toBeVisible();
    });

    await test.step('2. Switch to In Progress / Pending tab and inspect providers', async () => {
      await adminDashboard.filterMerchantTab('pending');
      await expect(adminDashboard.merchantTable).toBeVisible();

      // Switch to Active tab
      await adminDashboard.filterMerchantTab('active');
      await expect(adminDashboard.merchantTable).toBeVisible();

      // Back to All tab
      await adminDashboard.filterMerchantTab('all');
    });
  });

  test('Feature 4: Expansion Demand Signals & Pre-Launch Waitlist Leaderboard', async ({
    adminDashboard,
  }) => {
    await test.step('1. Inspect demand waitlist table for customer/merchant interest', async () => {
      await expect(adminDashboard.waitlistHeading).toBeVisible();
      await expect(adminDashboard.waitlistTable).toBeVisible();
      // Verify table headers exist
      await expect(adminDashboard.waitlistTable.getByText('City Territory')).toBeVisible();
      await expect(adminDashboard.waitlistTable.getByText('Role Interest')).toBeVisible();
      await expect(adminDashboard.waitlistTable.getByText('Contact Details')).toBeVisible();
    });
  });

  test('Feature 5: Customer Mobile Geofenced Territory Switcher & Inbound Waitlist Registration', async ({
    customerApp,
  }) => {
    await test.step('1. Customer sees geofenced location badge in header', async () => {
      const locationButton = customerApp.page.getByRole('button', { name: /Select Territory/i });
      await expect(locationButton).toBeVisible();
      await expect(locationButton.getByText(/Tirupati/i)).toBeVisible();
    });

    await test.step('2. Customer clicks location badge to open Territory Switcher modal', async () => {
      const locationButton = customerApp.page.getByRole('button', { name: /Select Territory/i });
      await locationButton.click();

      // Verify modal appears
      await expect(customerApp.page.getByText('Choose Territory')).toBeVisible();
      await expect(customerApp.page.getByText('Live booking cities & pre-launch expansion')).toBeVisible();
      // Verify Tirupati shows LIVE NOW
      await expect(customerApp.page.getByText('LIVE NOW').first()).toBeVisible();
    });

    await test.step('3. Customer registers interest for expanding city via waitlist input', async () => {
      const waitlistInput = customerApp.page.getByPlaceholder(/e\.g\. 9876543210 or user@domain.com/i);
      await expect(waitlistInput).toBeVisible();

      await waitlistInput.fill('+91 99887 76655');
      const notifyBtn = customerApp.page.getByTestId('waitlist-submit-btn');
      await notifyBtn.click();

      // Verify immediate confirmation acknowledgment
      await expect(customerApp.page.getByText(/✓ Noted! You will receive early priority booking/i)).toBeVisible();

      // Close modal
      const closeBtn = customerApp.page.getByTestId('close-city-modal-btn');
      await closeBtn.click();
      await expect(customerApp.page.getByText('Choose Territory')).not.toBeVisible();
    });
  });
});
