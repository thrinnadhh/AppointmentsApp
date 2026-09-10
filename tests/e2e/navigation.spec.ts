import { test, expect } from '@playwright/test';

test.describe('Customer Mobile App Comprehensive Forward & Backward Navigation Suite', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8081', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Instant Appointments')).toBeVisible({ timeout: 20000 });
  });

  test('1. Should navigate between 5-Category Hub and every individual category view forward and back', async ({ page }) => {
    // 1. Verify 5-Category Hub cards
    const clinicsCard = page.getByText('Hospitals & Clinics', { exact: true }).first();
    const salonsCard = page.getByText('Salons & Spas', { exact: true }).first();
    const restaurantsCard = page.getByText('Restaurants & Dining', { exact: true }).first();
    const gamingCard = page.getByText('Gaming & Turf', { exact: true }).first();
    const petsCard = page.getByText('Pet Care & Clinic', { exact: true }).first();

    await expect(clinicsCard).toBeVisible();
    await expect(salonsCard).toBeVisible();
    await expect(restaurantsCard).toBeVisible();
    await expect(gamingCard).toBeVisible();
    await expect(petsCard).toBeVisible();

    // 2. Clinics forward -> back
    await clinicsCard.click();
    await expect(page.getByText('Hospitals & Clinics in Tirupati')).toBeVisible();
    await expect(page.getByText('Sri Venkateswara Dental & Implant Care')).toBeVisible();
    await page.getByText('← All Categories').click();
    await expect(clinicsCard).toBeVisible();

    // 3. Salons forward -> back
    await salonsCard.click();
    await expect(page.getByText('Salons & Spas in Tirupati')).toBeVisible();
    await expect(page.getByText('Elite Looks Luxury Salon')).toBeVisible();
    await page.getByText('← All Categories').click();
    await expect(salonsCard).toBeVisible();

    // 4. Restaurants forward -> back
    await restaurantsCard.click();
    await expect(page.getByText('Restaurants & Dining in Tirupati')).toBeVisible();
    await expect(page.getByText('Saptagiri Heritage Dining')).toBeVisible();
    await page.getByText('← All Categories').click();
    await expect(restaurantsCard).toBeVisible();

    // 5. Gaming forward -> back
    await gamingCard.click();
    await expect(page.getByText('Gaming & Turf in Tirupati')).toBeVisible();
    await expect(page.getByText('Tirupati Premier Turf & Gaming Arena')).toBeVisible();
    await page.getByText('← All Categories').click();
    await expect(gamingCard).toBeVisible();

    // 6. Pets forward -> back
    await petsCard.click();
    await expect(page.getByText('Pet Care & Clinic in Tirupati')).toBeVisible();
    await expect(page.getByText('Tirumala Pet Clinic & Grooming Spa')).toBeVisible();
    await page.getByText('← All Categories').click();
    await expect(petsCard).toBeVisible();
  });

  test('2. Should use in-category horizontal switcher to toggle categories smoothly', async ({ page }) => {
    // Open Clinics
    await page.getByText('Hospitals & Clinics', { exact: true }).first().click();
    await expect(page.getByText('Sri Venkateswara Dental & Implant Care')).toBeVisible();

    // Switch to Salons
    await page.getByText('Salons & Spas', { exact: true }).first().click();
    await expect(page.getByText('Elite Looks Luxury Salon')).toBeVisible();
    await expect(page.getByText('Sri Venkateswara Dental & Implant Care')).not.toBeVisible();

    // Switch to Restaurants
    await page.getByText('Restaurants & Dining', { exact: true }).first().click();
    await expect(page.getByText('Saptagiri Heritage Dining')).toBeVisible();
    await expect(page.getByText('Elite Looks Luxury Salon')).not.toBeVisible();

    // Switch to Gaming
    await page.getByText('Gaming & Turf', { exact: true }).first().click();
    await expect(page.getByText('Tirupati Premier Turf & Gaming Arena')).toBeVisible();

    // Back to Hub
    await page.getByText('← All Categories').click();
    await expect(page.getByText('Choose a Service')).toBeVisible();
  });

  test('3. Should preserve category context when navigating into Provider Detail and pressing Back', async ({ page }) => {
    // Open Hospitals & Clinics
    await page.getByText('Hospitals & Clinics', { exact: true }).first().click();
    await expect(page.getByText('Sri Venkateswara Dental & Implant Care')).toBeVisible();

    // Navigate to Provider Detail
    await page.getByText('Sri Venkateswara Dental & Implant Care').first().click();
    await expect(page.getByText('1. Select Staff / Unit')).toBeVisible();

    // Press Back
    await page.getByText('← Back').click();

    // Must return to Hospitals & Clinics list (NOT root hub)
    await expect(page.getByText('Hospitals & Clinics in Tirupati')).toBeVisible();
    await expect(page.getByText('Sri Venkateswara Dental & Implant Care')).toBeVisible();

    // Now press All Categories to return to Hub
    await page.getByText('← All Categories').click();
    await expect(page.getByText('Choose a Service')).toBeVisible();
  });

  test('4. Should open Checkout Modal, cancel it, and restore Provider Detail state', async ({ page }) => {
    // Open Clinics -> Dental
    await page.getByText('Hospitals & Clinics', { exact: true }).first().click();
    await page.getByText('Sri Venkateswara Dental & Implant Care').first().click();

    // Select time slot
    const slotBtn = page.locator('div').filter({ hasText: /^(10|11|12|01|02|03|04|05):[0-9]{2} (AM|PM)$/ }).first();
    await slotBtn.click();

    // Open Checkout
    await page.getByText('Hold Slot & Pay Deposit →').click();
    await expect(page.getByText('Confirm Reservation')).toBeVisible();

    // Cancel modal
    await page.getByText('✕ Cancel').click();
    await expect(page.getByText('Confirm Reservation')).not.toBeVisible();

    // User is still on Provider Detail screen
    await expect(page.getByText('1. Select Staff / Unit')).toBeVisible();

    // Back to Clinics list
    await page.getByText('← Back').click();
    await expect(page.getByText('Hospitals & Clinics in Tirupati')).toBeVisible();
  });

  test('5. Should navigate to My Bookings from Hub and return back to Browse', async ({ page }) => {
    // Click Bookings from top header
    await page.getByText('Bookings').click();
    await expect(page.getByText('My Appointments')).toBeVisible();

    // Click Back to Browse
    await page.getByText('← Back to Browse').click();
    await expect(page.getByText('Choose a Service')).toBeVisible();
    await expect(page.getByText('Hospitals & Clinics', { exact: true }).first()).toBeVisible();
  });

  test('6. Should navigate to Customer Profile, close it, or open My Appointments from it', async ({ page }) => {
    // Open Profile
    const profileBtn = page.getByLabel('Customer Profile');
    await profileBtn.click();
    await expect(page.getByText('Customer Profile')).toBeVisible();
    await expect(page.getByText('Ravi Teja')).toBeVisible();

    // Close via ✕
    await page.getByText('✕').click();
    await expect(page.getByText('Customer Profile')).not.toBeVisible();

    // Open Profile again -> click View Appointments
    await profileBtn.click();
    await page.getByText(/View Appointments/i).click();
    await expect(page.getByText('My Appointments')).toBeVisible();

    // Return to Browse
    await page.getByText('← Back to Browse').click();
    await expect(page.getByText('Choose a Service')).toBeVisible();
  });

  test('7. Should navigate to My Bookings from within a Category and return back to that Category (not Hub)', async ({ page }) => {
    // Navigate into Salons & Spas
    await page.getByText('Salons & Spas', { exact: true }).first().click();
    await expect(page.getByText('Salons & Spas in Tirupati')).toBeVisible();
    await expect(page.getByText('Elite Looks Luxury Salon')).toBeVisible();

    // Click Bookings from top header while in Salons
    await page.getByText('Bookings').click();
    await expect(page.getByText('My Appointments')).toBeVisible();

    // Return to Browse - must return to Salons & Spas (where user left off), NOT the root Hub
    await page.getByText('← Back to Browse').click();
    await expect(page.getByText('Salons & Spas in Tirupati')).toBeVisible();
    await expect(page.getByText('Elite Looks Luxury Salon')).toBeVisible();
    await expect(page.getByText('Choose a Service')).not.toBeVisible();

    // Now clicking ← All Categories returns to the Hub
    await page.getByText('← All Categories').click();
    await expect(page.getByText('Choose a Service')).toBeVisible();
  });

  test('8. Should complete booking, land on My Appointments, and return to Category Browse without resetting to first Hub page', async ({ page }) => {
    // Navigate into Hospitals & Clinics -> Sri Venkateswara Dental
    await page.getByText('Hospitals & Clinics', { exact: true }).first().click();
    await expect(page.getByText('Hospitals & Clinics in Tirupati')).toBeVisible();
    await page.getByText('Sri Venkateswara Dental & Implant Care').first().click();

    // Select time slot
    const slotBtn = page.locator('div').filter({ hasText: /^(10|11|12|01|02|03|04|05):[0-9]{2} (AM|PM)$/ }).first();
    await slotBtn.click();

    // Open Checkout
    await page.getByText('Hold Slot & Pay Deposit →').click();
    await expect(page.getByText('Confirm Reservation')).toBeVisible();

    // Pay Deposit
    await page.getByText(/Pay ₹[0-9]+ via Razorpay/i).click();

    // Land on My Appointments
    await expect(page.getByText('My Appointments')).toBeVisible();
    await expect(page.getByText('CONFIRMED').first()).toBeVisible();

    // Click Back to Browse -> Must return to Hospitals & Clinics in Tirupati, NOT the root Hub
    await page.getByText('← Back to Browse').click();
    await expect(page.getByText('Hospitals & Clinics in Tirupati')).toBeVisible();
    await expect(page.getByText('Sri Venkateswara Dental & Implant Care')).toBeVisible();
    await expect(page.getByText('Choose a Service')).not.toBeVisible();

    // Clicking All Categories returns to the 5-category hub
    await page.getByText('← All Categories').click();
    await expect(page.getByText('Choose a Service')).toBeVisible();
  });
});
