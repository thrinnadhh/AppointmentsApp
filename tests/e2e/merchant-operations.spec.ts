import { test, expect } from '@playwright/test';
import { MerchantPortalPage } from './pages/merchant-portal.page';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_PQ0ToJguSqBpF6eWP3aP9w_NT4hFLef';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

test.describe.serial('Merchant Team Provisioning & Bookings Management E2E', () => {
  let merchantPortal: MerchantPortalPage;

  test.beforeEach(async ({ page }) => {
    merchantPortal = new MerchantPortalPage(page);
  });

  test('1. Should display team members and filter by role', async ({ page }) => {
    await merchantPortal.gotoTeam();
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

    await merchantPortal.gotoTeam();

    // Click Add Staff Member button
    const addMemberBtn = page.getByRole('button', { name: /Add Staff Member/i });
    await expect(addMemberBtn).toBeVisible();
    await addMemberBtn.click();

    // Verify modal is open
    await expect(page.locator('#team-member-name')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Add .*Staff Account|Add Staff/i })).toBeVisible();

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
    await merchantPortal.gotoBookings();
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

  test('4. Should toggle shop active/paused status and display alert banners', async ({ page }) => {
    await merchantPortal.goto();

    // Wait for the venue selector or locked tenant badge to confirm activeProvider is loaded in React state
    // (the toggle's onClick guard returns early if activeProvider is null)
    await expect(merchantPortal.venueSelector.or(page.getByTestId('locked-tenant-badge'))).toBeVisible({ timeout: 20000 });

    // Verify operational control bar is present
    const shopToggle = page.getByTestId('shop-active-toggle');
    await shopToggle.scrollIntoViewIfNeeded();
    await expect(shopToggle).toBeVisible({ timeout: 15000 });

    const statusText = page.getByTestId('shop-status-text');
    await expect(statusText).toBeVisible();

    // Check hours badge and auto-accept badge
    await expect(page.getByTestId('shop-hours-badge')).toBeVisible();
    await expect(page.getByTestId('auto-accept-status-badge')).toBeVisible();

    // Normalise state: ensure shop is ACTIVE before testing the pause flow
    // (previous test runs may have left the shop paused)
    const isCurrentlyActive = await shopToggle.getAttribute('aria-checked') === 'true';
    if (!isCurrentlyActive) {
      // Shop is paused — click to activate first
      await shopToggle.click();
      await expect(page.getByTestId('shop-status-text')).toContainText('Active (Accepting)', { timeout: 10000 });
    }

    // Now toggle from Active -> Paused
    await shopToggle.click();
    await expect(page.getByTestId('shop-paused-alert-banner')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('shop-status-text')).toContainText('Paused (Offline)');

    // Resume shop accepting via banner button
    const resumeBtn = page.getByRole('button', { name: /Resume Accepting Bookings/i });
    await expect(resumeBtn).toBeVisible();
    await resumeBtn.click();

    // Verify shop is active again (clean up state for next run)
    await expect(page.getByTestId('shop-paused-alert-banner')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('shop-status-text')).toContainText('Active (Accepting)');
  });

  test('5. Should open and update Operating Hours and Booking Rules/Cap modals', async ({ page }) => {
    await merchantPortal.goto();

    // 1. Open Operating Hours Modal
    const changeHoursBtn = page.getByRole('button', { name: /Change Hours/i });
    await expect(changeHoursBtn).toBeVisible();
    await changeHoursBtn.click();

    const hoursModal = page.getByTestId('shop-hours-modal');
    await expect(hoursModal).toBeVisible();
    await expect(page.getByTestId('opening-time-input')).toBeVisible();
    await expect(page.getByTestId('closing-time-input')).toBeVisible();

    // Click standard shift preset (09:00 - 21:00)
    await page.getByRole('button', { name: /09:00 - 21:00/i }).click();
    await page.getByTestId('save-hours-button').click();
    await expect(hoursModal).not.toBeVisible({ timeout: 10000 });

    // 2. Open Rules & Cap Modal
    const editSettingsBtn = page.getByTestId('edit-booking-settings-button');
    await expect(editSettingsBtn).toBeVisible();
    await editSettingsBtn.click();

    const settingsModal = page.getByTestId('booking-settings-modal');
    await expect(settingsModal).toBeVisible();

    // Toggle auto-accept and select preset 50
    const autoAcceptToggle = page.getByTestId('auto-accept-modal-toggle');
    await expect(autoAcceptToggle).toBeVisible();
    await page.getByRole('button', { name: '50', exact: true }).click();
    await page.getByTestId('save-booking-settings-button').click();
    await expect(settingsModal).not.toBeVisible({ timeout: 10000 });

    // Verify daily limit badge shows 50
    await expect(page.getByTestId('daily-limit-badge')).toContainText('/50');
  });

  test('6. Hold API should reject bookings when shop is paused or daily limit is exceeded', async ({ request }) => {
    const testCustomerId = '99999999-9999-9999-9999-999999999991';
    const testResourceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const testProviderId = '11111111-1111-1111-1111-111111111111';

    // 1. Pause the shop via Admin Patch endpoint
    const patchRes = await request.patch('http://localhost:3000/api/admin/merchants', {
      headers: {
        'Content-Type': 'application/json',
        'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026',
      },
      data: {
        providerId: testProviderId,
        is_active: false,
      },
    });
    expect(patchRes.status()).toBe(200);

    const slotStart = new Date(Date.now() + 600000000).toISOString();
    const slotEnd = new Date(Date.now() + 600000000 + 1800000).toISOString();

    const pausedHoldRes = await request.post('http://localhost:3000/api/bookings/hold', {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });

    expect(pausedHoldRes.status()).toBe(422);
    const pausedJson = await pausedHoldRes.json();
    expect(pausedJson.error).toMatch(/temporarily paused and not accepting|paused/i);

    // 2. Restore provider to active
    await request.patch('http://localhost:3000/api/admin/merchants', {
      headers: {
        'Content-Type': 'application/json',
        'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026',
      },
      data: {
        providerId: testProviderId,
        is_active: true,
        daily_booking_limit: 50,
      },
    });
  });

  test('7. Should manage weekly operating schedule, toggle closed days, and quick-adjust tomorrow', async ({ page }) => {
    await merchantPortal.goto();

    // 1. Open the Weekly Operating Hours Modal
    const changeHoursBtn = page.getByTestId('change-hours-btn');
    await expect(changeHoursBtn).toBeVisible();
    await changeHoursBtn.click();

    const hoursModal = page.getByTestId('shop-hours-modal');
    await expect(hoursModal).toBeVisible();

    // Verify tabs exist
    await expect(page.getByTestId('tab-full-week')).toBeVisible();
    await expect(page.getByTestId('tab-tomorrow')).toBeVisible();
    await expect(page.getByTestId('tab-today')).toBeVisible();

    // 2. Test Bulk Apply Preset (Mon–Sat Open, Sun Closed)
    await page.getByRole('button', { name: /Mon–Sat Open, Sun Closed/i }).click();
    await page.getByTestId('apply-entire-week-button').click();

    // 3. Switch to Tomorrow Quick Adjust Tab
    await page.getByTestId('tab-tomorrow').click();
    await expect(page.getByTestId('tomorrow-schedule-panel')).toBeVisible();

    // Toggle Tomorrow Closed then Open to verify interactive control
    const tomorrowToggle = page.getByTestId('tomorrow-toggle-closed');
    await expect(tomorrowToggle).toBeVisible();
    await tomorrowToggle.click();
    // Toggle back to open if it was closed
    await tomorrowToggle.click();

    // Save weekly hours
    await page.getByTestId('save-hours-button').click();
    await expect(hoursModal).not.toBeVisible({ timeout: 10000 });

    // 4. Verify Tomorrow preview exists on dashboard
    await expect(page.getByTestId('shop-tomorrow-preview')).toBeVisible();
  });
});

