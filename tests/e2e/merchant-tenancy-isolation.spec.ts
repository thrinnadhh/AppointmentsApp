import { test, expect } from '@playwright/test';

/**
 * Merchant Multi-Tenant Isolation & Role Scoping Test Suite
 *
 * Validates:
 * 1. Salon Merchant (Naturals Salon):
 *    - Strictly isolated workspace with salon terminology ("Stylists & Services", "Stylist", "Styling Chair").
 *    - Can only see Naturals Salon bookings, resources, and venue.
 *    - Zero visibility into hospital/clinic/turf records.
 *    - No access to Super Admin platform controls (/admin).
 *
 * 2. Clinic/Doctor Merchant (SVIMS Clinic):
 *    - Strictly isolated workspace with healthcare terminology ("Doctors & Services", "Doctor", "OPD Chamber").
 *    - Medical prescription support enabled.
 *    - Can only see SVIMS clinic appointments and doctors.
 *    - Zero visibility into salons or turfs.
 *
 * 3. Platform Super Admin:
 *    - Omniscient cross-tenant governance at /admin.
 *    - Full access to all merchants, city velocity, and audit trail ledger.
 */
test.describe('Merchant Multi-Tenant Isolation & Scoping', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('TC-TENANT-01: Salon Merchant has strictly isolated salon space and controls', async ({ page }) => {
    // 1. Navigate to Merchant Login and wait for hydration
    await page.goto('http://localhost:3000/login');
    await expect(page.getByRole('heading', { name: /Merchant & Admin Access/i })).toBeVisible();
    await page.locator('[data-hydrated="true"]').waitFor({ timeout: 15000 });

    // 2. Sign In for Naturals Salon
    await page.getByTestId('login-email').fill(process.env.TEST_SALON_EMAIL || 'naturals.salon@tirupati-appointments.com');
    await page.getByTestId('login-password').fill(process.env.TEST_SALON_PASSWORD || '');
    await page.getByTestId('login-submit').click();

    // 3. Verify Redirection to Merchant Dashboard
    await expect(page).toHaveURL('http://localhost:3000/', { timeout: 15000 });

    // 4. Verify Salon Verticalized Navigation
    // Should display "Stylists" instead of "Doctors"
    const stylistNavLink = page.getByRole('link', { name: /Stylists/i }).first();
    await expect(stylistNavLink).toBeVisible();
    await expect(page.getByRole('link', { name: /Doctors/i })).toHaveCount(0);

    // Should NOT display Platform Admin link
    await expect(page.getByRole('link', { name: /Platform Admin/i })).toHaveCount(0);

    // 5. Verify Locked Tenant Badge
    await expect(page.getByText(/Naturals Luxury Salon/i).first()).toBeVisible();

    // 6. Navigate to Resources (Stylists)
    await stylistNavLink.click();
    await expect(page).toHaveURL(/.*\/resources.*/, { timeout: 15000 });

    // Verify Salon Resource Heading & Presets
    await expect(page.getByRole('heading', { name: /Stylists/i })).toBeVisible();
    await expect(page.getByText(/Priya Sharma|Stylist|Styling Chair/i).first()).toBeVisible();

    // Doctors like Dr. Sundararajan must NOT be visible
    await expect(page.getByText('Dr. A. Sundararajan')).toHaveCount(0);
    await expect(page.getByText('OPD Chamber')).toHaveCount(0);

    // 7. Navigate to Bookings
    const bookingsNavLink = page.getByRole('link', { name: /Bookings/i }).first();
    await bookingsNavLink.click();
    await expect(page).toHaveURL(/.*\/bookings.*/, { timeout: 15000 });

    // Verify Bookings Page Scoping
    await expect(page.getByRole('heading', { name: /Bookings & Queue/i })).toBeVisible();
    // Verify vertical label "Stylist:"
    await expect(page.getByText(/Stylist:/i).first()).toBeVisible();
    // Prescription / Medical Doc button should NOT appear for salon
    await expect(page.getByRole('button', { name: /Prescription \/ Doc/i })).toHaveCount(0);

    // 8. Navigate to Venues
    const venuesNavLink = page.getByRole('link', { name: /Venues|My Venue/i }).first();
    await venuesNavLink.click();
    await expect(page).toHaveURL(/.*\/venues.*/, { timeout: 15000 });

    // Verify Venues Page Scoping
    await expect(page.getByText(/Locked Merchant Space/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /My Business & Venue Controls/i })).toBeVisible();
    // Multi-business onboarding button should be hidden for standard merchant
    await expect(page.getByRole('button', { name: /Add New Business \/ Venue/i })).toHaveCount(0);
    // Card should show Naturals Luxury Salon
    await expect(page.getByText('Naturals Luxury Salon').first()).toBeVisible();
    // Dental Clinic must NOT be listed in salon space
    await expect(page.getByText(/SVIMS Dental|Sri Venkateswara Dental/i)).toHaveCount(0);

    // 9. Verify Security Gate: Attempt to access Super Admin /admin
    await page.goto('http://localhost:3000/admin');
    await expect(page.getByText(/403 Access Denied|Sign In with Administrator Credentials/i).first()).toBeVisible();
  });

  test('TC-TENANT-02: Doctor / Clinic Merchant has strictly isolated healthcare space and controls', async ({ page }) => {
    // 1. Navigate to Merchant Login and wait for hydration
    await page.goto('http://localhost:3000/login');
    await expect(page.getByRole('heading', { name: /Merchant & Admin Access/i })).toBeVisible();
    await page.locator('[data-hydrated="true"]').waitFor({ timeout: 15000 });

    // 2. Sign In for SVIMS Clinic
    await page.getByTestId('login-email').fill(process.env.TEST_MERCHANT_EMAIL || 'svims.clinic@tirupati-appointments.com');
    await page.getByTestId('login-password').fill(process.env.TEST_MERCHANT_PASSWORD || '');
    await page.getByTestId('login-submit').click();

    // 3. Verify Redirection to Merchant Dashboard
    await expect(page).toHaveURL('http://localhost:3000/', { timeout: 15000 });

    // 4. Verify Clinic Verticalized Navigation
    const doctorNavLink = page.getByRole('link', { name: /Doctors/i }).first();
    await expect(doctorNavLink).toBeVisible();
    await expect(page.getByRole('link', { name: /Stylists/i })).toHaveCount(0);

    // Should NOT display Platform Admin link
    await expect(page.getByRole('link', { name: /Platform Admin/i })).toHaveCount(0);

    // 5. Verify Locked Tenant Badge for Clinic
    await expect(page.getByText(/SVIMS Dental|Sri Venkateswara Dental/i).first()).toBeVisible();

    // 6. Navigate to Resources (Doctors)
    await doctorNavLink.click();
    await expect(page).toHaveURL(/.*\/resources.*/, { timeout: 15000 });

    // Verify Healthcare Resource Heading & Units
    await expect(page.getByRole('heading', { name: /Doctors/i })).toBeVisible();
    await expect(page.getByText(/Dr\. A\. Sundararajan|Doctor|OPD Chamber|Dr\. S\. K\. Murthy/i).first()).toBeVisible();

    // Salon stylists must NOT be visible
    await expect(page.getByText('Priya Sharma')).toHaveCount(0);
    await expect(page.getByText('Styling Chair')).toHaveCount(0);

    // 7. Navigate to Bookings
    const bookingsNavLink = page.getByRole('link', { name: /Bookings/i }).first();
    await bookingsNavLink.click();
    await expect(page).toHaveURL(/.*\/bookings.*/, { timeout: 15000 });

    // Verify Clinic Bookings Page Scoping
    await expect(page.getByRole('heading', { name: /Bookings & Queue/i })).toBeVisible();
    await expect(page.getByText(/Doctor:/i).first()).toBeVisible();

    // 8. Navigate to Venues
    const venuesNavLink = page.getByRole('link', { name: /Venues|My Venue/i }).first();
    await venuesNavLink.click();
    await expect(page).toHaveURL(/.*\/venues.*/, { timeout: 15000 });

    // Verify Venues Page Scoping
    await expect(page.getByText(/Locked Merchant Space/i).first()).toBeVisible();
    await expect(page.getByText(/SVIMS Dental|Sri Venkateswara Dental/i).first()).toBeVisible();
    // Naturals Salon must NOT be visible
    await expect(page.getByText('Naturals Luxury Salon')).toHaveCount(0);
  });

  test('TC-TENANT-03: Platform Super Admin retains omniscient cross-merchant governance', async ({ page }) => {
    // 1. Navigate to Merchant Login and wait for hydration
    await page.goto('http://localhost:3000/login');
    await expect(page.getByRole('heading', { name: /Merchant & Admin Access/i })).toBeVisible();
    await page.locator('[data-hydrated="true"]').waitFor({ timeout: 15000 });

    // 2. Sign In for Super Admin
    await page.getByTestId('login-email').fill(process.env.TEST_ADMIN_EMAIL || 'admin@appointments-tirupati.com');
    await page.getByTestId('login-password').fill(process.env.TEST_ADMIN_PASSWORD || '');
    await page.getByTestId('login-submit').click();

    // 3. Verify Redirection
    await expect(page).toHaveURL('http://localhost:3000/', { timeout: 15000 });

    // 4. Verify Super Admin has Platform Admin nav link
    const adminNavLink = page.getByRole('link', { name: /Platform Admin/i }).first();
    await expect(adminNavLink).toBeVisible();

    // 5. Navigate to /admin
    await adminNavLink.click();
    await expect(page).toHaveURL(/.*\/admin/, { timeout: 15000 });

    // 6. Verify Omniscient Multi-City Governance
    await expect(page.getByText(/Admin Security Clearance Active|Merchant Governance/i).first()).toBeVisible();
    await expect(page.getByText(/City Expansion & Territory Control Matrix/i).first()).toBeVisible();

    // 7. Verify Cross-Merchant Visibility in Merchant Table
    // Admin can see both Dental Clinic and other merchants
    await expect(page.getByText(/Sri Venkateswara Dental|SVIMS|Tirupati/i).first()).toBeVisible();
  });
});
