import { test, expect } from '@playwright/test';

test.describe.serial('Merchant Multi-Tenant Onboarding & Department Hierarchy E2E', () => {
  const uniqueTimestamp = Date.now();
  const testClinicName = `Tirupati Care Hospital ${uniqueTimestamp.toString().slice(-4)}`;
  const testTurfName = `Apex Box Cricket Arena ${uniqueTimestamp.toString().slice(-4)}`;
  const testDoctorName = `Dr. S. K. Naidu, MD (Cardiology)`;

  test.beforeEach(async ({ page }) => {
    // Navigate with stable load
    await page.goto('/venues');
    await expect(page).toHaveTitle(/Merchant Dashboard/);
  });

  test('1. Should display existing businesses and filter by vertical category', async ({ page }) => {
    // Check main title
    await expect(page.getByRole('heading', { name: 'Venues, Clinics & Centers', level: 1 })).toBeVisible();

    // Verify initial businesses are loaded
    await expect(page.getByText(/Sri Venkateswara Dental/i).first()).toBeVisible({ timeout: 10000 });

    // Filter by Clinics
    const clinicFilter = page.getByRole('button', { name: /Clinics & Hospitals/i });
    await clinicFilter.click();
    await expect(page.getByText(/Sri Venkateswara Dental/i).first()).toBeVisible();

    // Filter by Gaming & Turfs
    const gamingFilter = page.getByRole('button', { name: /Gaming & Turfs/i });
    await gamingFilter.click();
    await expect(page.getByText(/Box Cricket/i).first()).toBeVisible();

    // Return to All Businesses
    const allFilter = page.getByRole('button', { name: /All Businesses/i });
    await allFilter.click();
    await expect(page.getByText(/Sri Venkateswara Dental/i).first()).toBeVisible();
  });

  test('2. Should successfully onboard a new Clinic / Hospital into the directory', async ({ page }) => {
    // Open Onboarding Modal
    const addVenueBtn = page.getByRole('button', { name: /Add New Business \/ Venue/i });
    await expect(addVenueBtn).toBeVisible();
    await addVenueBtn.click();

    // Modal Assertions
    await expect(page.locator('#venue-name')).toBeVisible();
    const modalHeading = page.getByRole('heading', { name: /Onboard New Business \/ Venue/i });
    await expect(modalHeading).toBeVisible();

    // Fill Onboarding Form
    await page.locator('#venue-name').fill(testClinicName);
    await page.locator('#venue-category').selectOption('clinic');
    await page.locator('#venue-address').fill('Renigunta Road, Opp. RTC Central, Tirupati');
    await page.locator('#venue-phone').fill('+91 877 2255667');
    await page.locator('#venue-email').fill(`care.${uniqueTimestamp}@tirupati.com`);
    await page.locator('#venue-opening-time').fill('08:00');
    await page.locator('#venue-closing-time').fill('22:00');
    await page.locator('#venue-description').fill('Advanced 24/7 emergency care, cardiology outpatient, and pharmacy services.');

    // Submit Form
    const submitBtn = page.getByRole('button', { name: /Onboard Business/i });
    await submitBtn.click();

    // Verify Success Banner
    await expect(
      page.getByText(new RegExp(`Venue "${testClinicName}" onboarded successfully`, 'i'))
    ).toBeVisible({ timeout: 15000 });

    // Verify New Venue Card Renders in Catalog
    const venueCard = page.locator('div').filter({ hasText: testClinicName }).first();
    await expect(venueCard).toBeVisible();
    await expect(venueCard.getByText(/clinic/i).first()).toBeVisible();
    await expect(venueCard.getByText(/Renigunta Road/i).first()).toBeVisible();
  });

  test('3. Should onboard a new Sports Turf / Gaming Arena', async ({ page }) => {
    // Open Onboarding Modal
    await page.getByRole('button', { name: /Add New Business \/ Venue/i }).click();
    await expect(page.locator('#venue-name')).toBeVisible();

    // Fill Form for Gaming / Turf
    await page.locator('#venue-name').fill(testTurfName);
    await page.locator('#venue-category').selectOption('gaming');
    await page.locator('#venue-address').fill('Air Bypass Road, Near Alipiri, Tirupati');
    await page.locator('#venue-phone').fill('+91 98480 33445');
    await page.locator('#venue-description').fill('Floodlit synthetic grass box cricket arena with high-definition replay screens.');

    // Submit
    await page.getByRole('button', { name: /Onboard Business/i }).click();

    // Verify Success Notification
    await expect(
      page.getByText(new RegExp(`Venue "${testTurfName}" onboarded successfully`, 'i'))
    ).toBeVisible({ timeout: 15000 });

    // Filter to Gaming & Verify Card
    await page.getByRole('button', { name: /Gaming & Turfs/i }).click();
    await expect(page.getByText(testTurfName).first()).toBeVisible();
  });

  test('4. Should link directly to Doctor & Resource Builder and configure Department and Pricing', async ({ page }) => {
    // Ensure all businesses are visible
    await page.getByRole('button', { name: /All Businesses/i }).click();

    // Find the newly created clinic card and click "Manage Staff"
    const manageStaffLink = page.getByRole('link', { name: `Manage Staff for ${testClinicName}` });
    await expect(manageStaffLink).toBeVisible({ timeout: 10000 });
    await manageStaffLink.click();

    // Verify redirected to /resources with provider query
    await expect(page).toHaveURL(/.*\/resources\?providerId=.*/);
    await expect(page.getByRole('heading', { name: /Doctors, Departments & Services/i })).toBeVisible();

    // Verify active venue banner displays the selected clinic
    await expect(page.getByRole('heading', { name: testClinicName, level: 2 })).toBeVisible({ timeout: 10000 });

    // Open "Add Doctor / Service" Modal
    await page.getByRole('button', { name: /Add Doctor \/ Service/i }).click();
    await expect(page.locator('#doctor-name')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Add Doctor \/ Service Unit/i })).toBeVisible();

    // Fill Doctor Details
    await page.locator('#doctor-name').fill(testDoctorName);
    await page.locator('#doctor-department').fill('Cardiology');
    await page.locator('#doctor-unit-type').selectOption('doctor');
    await page.locator('#doctor-price').fill('1000');
    await page.locator('#doctor-deposit').fill('150');
    await page.locator('#doctor-duration').fill('30');

    // Save Doctor
    await page.getByRole('button', { name: /Save Doctor \/ Unit/i }).click();

    // Verify Doctor Card appears with Cardiology department badge and pricing
    await expect(page.getByRole('heading', { name: testDoctorName, level: 3 })).toBeVisible({ timeout: 15000 });
    const doctorCard = page.locator('div.rounded-2xl', { has: page.getByRole('heading', { name: testDoctorName, level: 3 }) });
    await expect(doctorCard).toBeVisible();
    await expect(doctorCard.getByText('Cardiology').first()).toBeVisible();
    await expect(doctorCard.getByText('₹1000')).toBeVisible();
    await expect(doctorCard.getByText('₹150')).toBeVisible();
  });

  test('5. Should reflect newly added businesses and doctors on the Overview Dashboard', async ({ page }) => {
    await page.goto('/');

    // Check Overview Heading
    await expect(page.getByRole('heading', { name: /City-Wide Vertical Summary/i })).toBeVisible();

    // Check System Health Widget & Run Diagnostics
    const runDiagnosticsBtn = page.getByRole('button', { name: /Run Diagnostics/i });
    await expect(runDiagnosticsBtn).toBeVisible();
    await runDiagnosticsBtn.click();

    // Verify healthy diagnostic output
    await expect(page.getByText(/Healthy \(0 Failures\)/i)).toBeVisible({ timeout: 10000 });

    // Verify that the venue switcher contains the newly created clinic
    const venueSelect = page.locator('#provider-select');
    await expect(venueSelect).toBeVisible();
    await expect(venueSelect.locator(`option:has-text("${testClinicName}")`)).toBeAttached();
  });
});
