import { test, expect } from './fixtures/test-fixtures';

/**
 * Admin Merchant Governance & Cross-App Integration Test Suite
 *
 * Validates:
 * 1. Admin search by merchant shop name, owner, and multi-criteria filters (type, city, status).
 * 2. Admin blocking an active merchant shop -> Merchant web app displays suspended banner with bookings paused.
 * 3. Cross-app synchronization: Blocking merchant removes shop from Customer Mobile search and browse.
 * 4. Admin unblocking merchant -> Restores active status and makes shop bookable again in Customer Mobile.
 *
 * Conforms strictly to Playwright POM principles in Section 4 of webapp-testing/SKILL.md.
 */
test.describe('Admin Merchant Governance & Cross-App Integration', () => {
  test.describe.configure({ mode: 'serial' });

  test('TC-ADMIN-MERCHANT-01: Admin can search merchant shop and filter by type, city, and status tabs', async ({
    adminDashboard,
  }) => {
    await adminDashboard.goto();

    // Verify Merchant Governance section is loaded
    await expect(adminDashboard.merchantFunnelHeading).toBeVisible();
    await expect(adminDashboard.merchantSearchInput).toBeVisible();
    await expect(adminDashboard.merchantTypeFilterSelect).toBeVisible();
    await expect(adminDashboard.merchantCityFilterSelect).toBeVisible();

    // 1. Search by Merchant Shop Name
    await adminDashboard.searchMerchantShop('Sri Venkateswara Dental');
    await adminDashboard.expectMerchantVisible('Sri Venkateswara Dental & Implant Care', true);
    // Non-matching merchants should be filtered out
    await adminDashboard.expectMerchantVisible('Tirupati Smashers Badminton Arena', false);

    // 2. Clear search
    await adminDashboard.searchMerchantShop('');

    // 3. Filter by Vertical Type (Category)
    await adminDashboard.filterMerchantType('Hospitals & Clinics');
    await adminDashboard.expectMerchantVisible('Sri Venkateswara Dental & Implant Care', true);
    await adminDashboard.expectMerchantVisible('Tirupati Velvet Glow Unisex Spa', false);

    // Reset type filter
    await adminDashboard.filterMerchantType('all');

    // 4. Filter by City Territory
    await adminDashboard.filterMerchantCity('Tirupati');
    await adminDashboard.expectMerchantVisible('Sri Venkateswara Dental & Implant Care', true);

    // Reset city filter
    await adminDashboard.filterMerchantCity('all');

    // 5. Test Status Tabs (All, Active, In Progress, Blocked)
    await adminDashboard.filterMerchantTab('active');
    await adminDashboard.expectMerchantVisible('Sri Venkateswara Dental & Implant Care', true);

    await adminDashboard.filterMerchantTab('pending');
    // Active merchant shouldn't show in pending
    await adminDashboard.expectMerchantVisible('Sri Venkateswara Dental & Implant Care', false);

    await adminDashboard.filterMerchantTab('all');
    await adminDashboard.expectMerchantVisible('Sri Venkateswara Dental & Implant Care', true);
  });

  test('TC-ADMIN-MERCHANT-02: Admin blocks active merchant -> Merchant app displays suspended banner and pauses bookings', async ({
    browser,
  }) => {
    // 1. Set up separate contexts for Admin and Merchant
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();

    const { AdminDashboardPage } = await import('./pages/admin-dashboard.page');
    const { MerchantPortalPage } = await import('./pages/merchant-portal.page');

    const admin = new AdminDashboardPage(adminPage);
    const merchant = new MerchantPortalPage(merchantPage);

    try {
      // 2. Load Merchant Portal first - verify initial active state (no suspended banner)
      await merchant.goto();
      await merchant.expectSuspendedBanner(false);

      // 3. Admin navigates and searches for the target merchant shop
      await admin.goto();
      await admin.searchMerchantShop('Sri Venkateswara Dental');
      await admin.expectMerchantVisible('Sri Venkateswara Dental & Implant Care', true);

      // 4. Admin blocks the merchant shop
      await admin.blockMerchant('Sri Venkateswara Dental & Implant Care');
      await admin.expectMerchantStatus('Sri Venkateswara Dental & Implant Care', 'BLOCKED / SUSPENDED');

      // 5. Merchant Portal updates - verify prominent suspended banner is displayed
      await merchant.goto();
      await merchant.expectSuspendedBanner(true);
      await expect(merchantPage.getByText(/Account Suspended & Blocked by Platform Administration/i)).toBeVisible();
      await expect(merchantPage.getByText(/Bookings Paused/i)).toBeVisible();

      // 6. Admin unblocks the merchant shop
      await admin.unblockMerchant('Sri Venkateswara Dental & Implant Care');
      await admin.expectMerchantStatus('Sri Venkateswara Dental & Implant Care', 'ONBOARDED (ACTIVE)');

      // 7. Merchant Portal updates - verify suspended banner is cleared
      await merchant.goto();
      await merchant.expectSuspendedBanner(false);
    } finally {
      await adminContext.close();
      await merchantContext.close();
    }
  });

  test('TC-ADMIN-MERCHANT-03: Cross-App Integration: Blocking merchant excludes shop from Customer Mobile, unblocking restores visibility', async ({
    browser,
  }) => {
    // 1. Multi-context setup: Admin + Customer Mobile
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();

    const { AdminDashboardPage } = await import('./pages/admin-dashboard.page');
    const { CustomerAppPage } = await import('./pages/customer-app.page');

    const admin = new AdminDashboardPage(adminPage);
    const customer = new CustomerAppPage(customerPage);

    try {
      // 2. Customer opens Customer Mobile and searches for the merchant shop
      await customer.goto();
      await customer.selectCategory('Hospitals & Clinics');
      await customer.expectProviderVisible('Sri Venkateswara Dental & Implant Care', true);

      // 3. Admin searches and blocks the merchant shop
      await admin.goto();
      await admin.searchMerchantShop('Sri Venkateswara Dental');
      await admin.blockMerchant('Sri Venkateswara Dental & Implant Care');
      await admin.expectMerchantStatus('Sri Venkateswara Dental & Implant Care', 'BLOCKED / SUSPENDED');

      // 4. Customer Mobile re-fetches - suspended merchant is hidden from customer browse
      await customer.goto();
      await customer.selectCategory('Hospitals & Clinics');
      await customer.expectProviderVisible('Sri Venkateswara Dental & Implant Care', false);

      // 5. Admin unblocks the merchant shop
      await admin.unblockMerchant('Sri Venkateswara Dental & Implant Care');
      await admin.expectMerchantStatus('Sri Venkateswara Dental & Implant Care', 'ONBOARDED (ACTIVE)');

      // 6. Customer Mobile re-fetches - merchant is restored and bookable
      await customer.goto();
      await customer.selectCategory('Hospitals & Clinics');
      await customer.expectProviderVisible('Sri Venkateswara Dental & Implant Care', true);
    } finally {
      await adminContext.close();
      await customerContext.close();
    }
  });
});
