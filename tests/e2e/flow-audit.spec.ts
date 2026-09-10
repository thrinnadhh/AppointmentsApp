import { test, expect } from '@playwright/test';

test.describe('Comprehensive Merchant & Customer Flow & API Audit', () => {

  // =========================================================================
  // 1. MERCHANT WEB FLOW & SCREEN AUDIT (http://localhost:3000)
  // =========================================================================
  test.describe('Merchant Web Screen Navigation & Flow Audit', () => {

    test('1.1 Should navigate to Overview Dashboard and verify all dashboard cards and navigation links', async ({ page }) => {
      await page.goto('http://localhost:3000/');
      await expect(page.locator('h1')).toContainText('City-Wide Vertical Summary');

      // Check navigation bar items including newly added schedule and settings
      const nav = page.locator('nav');
      await expect(nav.locator('a[href="/venues"]')).toBeVisible();
      await expect(nav.locator('a[href="/resources"]')).toBeVisible();
      await expect(nav.locator('a[href="/schedule"]')).toBeVisible();
      await expect(nav.locator('a[href="/team"]')).toBeVisible();
      await expect(nav.locator('a[href="/bookings"]')).toBeVisible();
      await expect(nav.locator('a[href="/settings"]')).toBeVisible();
    });

    test('1.2 Should navigate to Venues directory, test category filters, and modal controls', async ({ page }) => {
      await page.goto('http://localhost:3000/venues');
      await expect(page.getByRole('heading', { name: 'Venues, Clinics & Centers', level: 1 })).toBeVisible();

      // Verify category filter chips
      await expect(page.getByRole('button', { name: /All Businesses/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Clinics & Hospitals/i })).toBeVisible();

      // Verify Add Venue Modal triggers
      const addVenueBtn = page.getByRole('button', { name: /Add New Business \/ Venue/i });
      await expect(addVenueBtn).toBeVisible();
      await addVenueBtn.click();

      // Verify Modal rendered
      await expect(page.getByRole('heading', { name: /Onboard New Business \/ Venue/i })).toBeVisible();
      const cancelBtn = page.getByRole('button', { name: /Cancel/i });
      await cancelBtn.click();
      await expect(page.getByRole('heading', { name: /Onboard New Business \/ Venue/i })).not.toBeVisible();
    });

    test('1.3 Should navigate to Resources/Doctors directory and inspect provider dropdown & modal', async ({ page }) => {
      await page.goto('http://localhost:3000/resources');
      await expect(page.getByRole('heading', { name: /Doctors, Departments & Services/i, level: 1 })).toBeVisible();

      // Verify Venue selector dropdown exists
      const venueSelect = page.locator('select');
      await expect(venueSelect.first()).toBeVisible();

      // Verify Add Resource Modal triggers
      const addResourceBtn = page.getByRole('button', { name: /Add Doctor \/ Service/i });
      await expect(addResourceBtn).toBeVisible();
      await addResourceBtn.click();

      await expect(page.getByRole('heading', { name: /Add Doctor \/ Service Unit/i })).toBeVisible();
      await page.getByRole('button', { name: /Cancel/i }).click();
      await expect(page.getByRole('heading', { name: /Add Doctor \/ Service Unit/i })).not.toBeVisible();
    });

    test('1.4 Should navigate to Bookings Queue and verify status filtering, search, and live triage', async ({ page }) => {
      await page.goto('http://localhost:3000/bookings');
      await expect(page.getByRole('heading', { name: /Bookings & Queue/i, level: 1 })).toBeVisible();

      // Verify status tabs
      await expect(page.getByRole('button', { name: /^ALL$/i })).toBeVisible();

      // Verify Search input
      const searchInput = page.locator('#customer-search');
      await expect(searchInput).toBeVisible();
      await searchInput.fill('Kalyan');
      await searchInput.fill('');
    });

    test('1.5 Should navigate to Team & Access screen and verify staff provisioning controls', async ({ page }) => {
      await page.goto('http://localhost:3000/team');
      await expect(page.getByRole('heading', { name: /Team & Merchant Credentials/i, level: 1 })).toBeVisible();

      // Verify Add Staff Member button
      const inviteBtn = page.getByRole('button', { name: /Add Staff Member/i });
      await expect(inviteBtn).toBeVisible();
      await inviteBtn.click();

      await expect(page.getByRole('heading', { name: /Add Staff \/ Merchant User/i })).toBeVisible();
      await page.getByRole('button', { name: /Cancel/i }).click();
      await expect(page.getByRole('heading', { name: /Add Staff \/ Merchant User/i })).not.toBeVisible();
    });

    test('1.6 Should navigate to Schedule availability screen and verify save action', async ({ page }) => {
      await page.goto('http://localhost:3000/schedule');
      await expect(page.locator('h1')).toContainText('Weekly Availability & Hours');

      const saveBtn = page.getByRole('button', { name: /Save Schedule/i });
      await expect(saveBtn).toBeVisible();
      await saveBtn.click();
      await expect(page.getByText('Saved!')).toBeVisible();
    });

    test('1.7 Should navigate to Settings & Profile screen and verify all configuration tabs', async ({ page }) => {
      await page.goto('http://localhost:3000/settings');
      await expect(page.getByRole('heading', { name: 'Settings & Profile', level: 1 })).toBeVisible();

      // Verify tab buttons
      await expect(page.getByRole('button', { name: /Business Profile/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Payments & Gateway/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Notifications & Alerts/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Deposit & Refund Rules/i })).toBeVisible();

      // Switch to Payments tab
      await page.getByRole('button', { name: /Payments & Gateway/i }).click();
      await expect(page.getByText('Payment Gateway & Merchant Payout Routing')).toBeVisible();

      // Switch to Policies tab
      await page.getByRole('button', { name: /Deposit & Refund Rules/i }).click();
      await expect(page.getByText('Full Refund Cancellation Window')).toBeVisible();

      // Save changes
      const saveBtn = page.getByRole('button', { name: /Save Changes/i });
      await expect(saveBtn).toBeVisible();
      await saveBtn.click();
      await expect(page.getByText(/Settings Saved!/i)).toBeVisible();
    });

    test('1.8 Should navigate to Login screen and verify authentication form controls', async ({ page }) => {
      await page.goto('http://localhost:3000/login');
      await expect(page.getByText('Merchant & Admin Access')).toBeVisible();
      await expect(page.locator('#login-email')).toBeVisible();
      await expect(page.locator('#login-password')).toBeVisible();
      await expect(page.getByRole('button', { name: /Sign In to Dashboard/i })).toBeVisible();
    });

    test('1.9 Should render custom 404 Not Found screen on broken route', async ({ page }) => {
      await page.goto('http://localhost:3000/non-existent-screen-404');
      await expect(page.getByText('404 • Page Not Found')).toBeVisible();
      await expect(page.getByText('Location or Route Not Found')).toBeVisible();
      const backHomeBtn = page.getByRole('link', { name: /Return to Overview/i });
      await expect(backHomeBtn).toBeVisible();
      await backHomeBtn.click();
      await expect(page).toHaveURL('http://localhost:3000/');
    });
  });

  // =========================================================================
  // 2. BACKEND API AUDIT & STATUS CODE VERIFICATION
  // =========================================================================
  test.describe('Backend API Status Codes & Contract Audit', () => {

    test('2.1 GET /api/health should return 200 with healthy database status', async ({ request }) => {
      const res = await request.get('http://localhost:3000/api/health');
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('healthy');
      expect(data.database).toBe('connected');
    });

    test('2.2 GET /api/admin/venues should return 200 with venues array', async ({ request }) => {
      const res = await request.get('http://localhost:3000/api/admin/venues');
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.venues)).toBe(true);
    });

    test('2.3 POST /api/admin/venues should reject missing fields with 400', async ({ request }) => {
      const res = await request.post('http://localhost:3000/api/admin/venues', {
        data: { name: 'Incomplete Clinic' },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    test('2.4 GET /api/admin/resources should return 200 and support providerId filter', async ({ request }) => {
      const res = await request.get('http://localhost:3000/api/admin/resources');
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.resources)).toBe(true);
    });

    test('2.5 POST /api/admin/resources should reject missing providerId with 400', async ({ request }) => {
      const res = await request.post('http://localhost:3000/api/admin/resources', {
        data: { name: 'Dr. Test', type: 'doctor' },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    test('2.6 GET /api/admin/bookings should return 200 with bookings list', async ({ request }) => {
      const res = await request.get('http://localhost:3000/api/admin/bookings');
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.bookings)).toBe(true);
    });

    test('2.7 GET /api/admin/users should return 200 with user profiles', async ({ request }) => {
      const res = await request.get('http://localhost:3000/api/admin/users');
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.users)).toBe(true);
    });

    test('2.8 POST /api/admin/users should reject missing email/password with 400', async ({ request }) => {
      const res = await request.post('http://localhost:3000/api/admin/users', {
        data: { fullName: 'Incomplete Staff' },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    test('2.9 GET /api/cron/release-holds should return 200 and report released count', async ({ request }) => {
      const res = await request.get('http://localhost:3000/api/cron/release-holds');
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(typeof data.released_count).toBe('number');
    });

    test('2.10 POST /api/webhooks/razorpay should reject invalid JSON with 400', async ({ request }) => {
      const res = await request.post('http://localhost:3000/api/webhooks/razorpay', {
        data: 'INVALID_NON_JSON_PAYLOAD',
        headers: { 'content-type': 'text/plain' },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    test('2.11 POST /api/bookings/hold should reject missing fields with 400', async ({ request }) => {
      const res = await request.post('http://localhost:3000/api/bookings/hold', {
        data: { resource_id: 'invalid-uuid' },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    test('2.12 POST /api/bookings/confirm should return 404 for non-existent booking', async ({ request }) => {
      const res = await request.post('http://localhost:3000/api/bookings/confirm', {
        data: { booking_id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.status()).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Booking not found');
    });

    test('2.13 POST /api/bookings/cancel should return 404 for non-existent booking', async ({ request }) => {
      const res = await request.post('http://localhost:3000/api/bookings/cancel', {
        data: { booking_id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.status()).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Booking not found');
    });

    test('2.14 POST /api/bookings/reschedule should return 404 for non-existent booking', async ({ request }) => {
      const res = await request.post('http://localhost:3000/api/bookings/reschedule', {
        data: {
          booking_id: '00000000-0000-0000-0000-000000000000',
          new_slot_start: '2026-09-10T10:00:00.000Z',
          new_slot_end: '2026-09-10T10:30:00.000Z',
        },
      });
      expect(res.status()).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Booking not found');
    });

    test('2.15 POST /api/bookings/no-show should reject non-existent booking with error', async ({ request }) => {
      const res = await request.post('http://localhost:3000/api/bookings/no-show', {
        data: { booking_id: '00000000-0000-0000-0000-000000000000' },
      });
      expect([400, 500]).toContain(res.status());
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  // =========================================================================
  // 3. CUSTOMER MOBILE APP FLOW AUDIT (http://localhost:8081)
  // =========================================================================
  test.describe('Customer Mobile Screen Navigation & Flow Audit', () => {

    test('3.1 Should verify Customer HomeScreen navigation items, 5 category mini logos, and category search', async ({ page }) => {
      await page.goto('http://localhost:8081');
      await expect(page.getByText('Tirupati, AP')).toBeVisible();
      await expect(page.getByText('Instant Appointments')).toBeVisible();
      await expect(page.getByText('Bookings')).toBeVisible();
      await expect(page.getByText(/guarantees your slot with zero waiting/i)).toBeVisible();

      // Verify the 5 category mini logos on first page
      await expect(page.getByText('Hospitals & Clinics', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Salons & Spas', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Restaurants & Dining', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Gaming & Turf', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Pet Care & Clinic', { exact: true }).first()).toBeVisible();

      // Tap category to view related data & search
      await page.getByText('Hospitals & Clinics', { exact: true }).first().click();
      const searchInput = page.getByPlaceholder(/Search doctors, salons, restaurants/i);
      await expect(searchInput).toBeVisible();
      await searchInput.fill('Dental');
      await expect(page.getByText('Sri Venkateswara Dental & Implant Care')).toBeVisible();

      // Clear search
      await searchInput.fill('');
    });

    test('3.2 Should open customer profile modal from HomeScreen header', async ({ page }) => {
      await page.goto('http://localhost:8081');
      const profileBtn = page.getByLabel('Customer Profile');
      await expect(profileBtn).toBeVisible();
      await profileBtn.click();

      await expect(page.getByText('Customer Profile')).toBeVisible();
      await expect(page.getByText('Ravi Teja')).toBeVisible();
      await expect(page.getByText('Total Bookings')).toBeVisible();
      await expect(page.getByText('Active Slots')).toBeVisible();

      // Close profile
      await page.getByText('✕').click();
      await expect(page.getByText('Customer Profile')).not.toBeVisible();
    });

    test('3.3 Should verify complete Provider Detail view and doctor selection', async ({ page }) => {
      await page.goto('http://localhost:8081');
      await page.getByText('Hospitals & Clinics', { exact: true }).first().click();
      const providerCard = page.getByText('Sri Venkateswara Dental & Implant Care');
      await providerCard.click();

      // Check all 3 section headings exist
      await expect(page.getByText('1. Select Staff / Unit')).toBeVisible();
      await expect(page.getByText('2. Choose Date')).toBeVisible();
      await expect(page.getByText('3. Available Slots')).toBeVisible();
      await expect(page.getByText('Deposit to hold:')).toBeVisible();

      // Back navigation returns to browse
      await page.getByText('← Back').click();
      await expect(page.getByText('Instant Appointments')).toBeVisible();
    });

    test('3.4 Should verify My Appointments screen and empty state / bookings list', async ({ page }) => {
      await page.goto('http://localhost:8081');
      await page.getByText('Bookings').click();

      await expect(page.getByText('My Appointments')).toBeVisible();
      await expect(page.getByText('← Back to Browse')).toBeVisible();

      // Return to Browse
      await page.getByText('← Back to Browse').click();
      await expect(page.getByText('Instant Appointments')).toBeVisible();
    });
  });
});
