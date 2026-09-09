import { test, expect } from '@playwright/test';
import { CustomerAppPage } from './pages/customer-app.page';

test.describe('Customer Mobile App (Web Preview) E2E Suite', () => {
  let customerApp: CustomerAppPage;

  test.beforeEach(async ({ page }) => {
    customerApp = new CustomerAppPage(page);
    await customerApp.goto();
  });

  test('1. Should display Tirupati Hyperlocal branding and filter providers across categories', async ({ page }) => {
    // 1. Verify Header & Branding
    await expect(customerApp.locationBadge).toBeVisible();
    await expect(customerApp.appTitle).toBeVisible();
    await expect(customerApp.myBookingsBtn).toBeVisible();
    await expect(customerApp.trustBanner).toBeVisible();

    // 2. Initial state: All categories selected
    await expect(page.getByText('Nearby in Tirupati')).toBeVisible();
    await expect(page.getByText('Sri Venkateswara Dental & Implant Care')).toBeVisible();

    // 3. Filter by Restaurants & Dining
    await customerApp.selectCategory('Restaurants & Dining');
    await expect(page.getByText('Saptagiri Heritage Dining')).toBeVisible();
    await expect(page.getByText('Sri Venkateswara Dental & Implant Care')).not.toBeVisible();

    // 4. Filter by Gaming & Turf
    await customerApp.selectCategory('Gaming & Turf');
    await expect(page.getByText('Tirupati Premier Turf & Gaming Arena')).toBeVisible();
    await expect(page.getByText('Saptagiri Heritage Dining')).not.toBeVisible();

    // 5. Filter by Salons & Spas
    await customerApp.selectCategory('Salons & Spas');
    await expect(page.getByText('Elite Looks Luxury Salon')).toBeVisible();
    await expect(page.getByText('Tirupati Premier Turf & Gaming Arena')).not.toBeVisible();

    // 6. Reset to All Categories
    await customerApp.selectCategory('All Categories');
    await expect(page.getByText('Sri Venkateswara Dental & Implant Care')).toBeVisible();
  });

  test('2. Should navigate into Provider Detail and inspect Doctor / Staff hierarchy', async ({ page }) => {
    // 1. Click on Dental Clinic
    await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');

    // 2. Verify Provider Info Header
    await expect(page.getByText('📍 Shop 12, Bhavani Nagar, Near RTC Bus Stand')).toBeVisible();
    await expect(page.getByText(/🕒 Hours: 09:00 - 20:00/)).toBeVisible();
    await expect(customerApp.staffSectionHeading).toBeVisible();

    // 3. Verify Staff Roster (Doctors)
    const doctor1 = page.getByText('Dr. S. K. Murthy, MDS (Implantologist)');
    const doctor2 = page.getByText('Dr. Ananya Reddy (Orthodontist)');

    await expect(doctor1).toBeVisible();
    await expect(doctor2).toBeVisible();

    // 4. Switch between Staff members
    await doctor2.click();
    await expect(page.getByText('Braces & Aligners').or(doctor2)).toBeVisible();

    // 5. Verify Back navigation
    await customerApp.backButton.click();
    await expect(customerApp.appTitle).toBeVisible();
  });

  test('3. Should select date, pick real-time available time slot, and update deposit summary', async ({ page }) => {
    // 1. Open Provider Detail
    await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');

    // 2. Check Date Selector
    await expect(customerApp.dateSectionHeading).toBeVisible();
    await customerApp.selectDateOffset('Tomorrow');

    // 3. Verify Available Slots section
    await expect(customerApp.slotSectionHeading).toBeVisible();
    await expect(customerApp.selectTimeSlotBtn).toBeVisible();

    // 4. Select an available slot chip
    await customerApp.selectFirstSlot();

    // 5. Verify Sticky Footer summary updates to enabled state
    await expect(customerApp.holdDepositBtn).toBeVisible();
    await expect(customerApp.stickyFooterPrice).toContainText('₹100');
  });

  test('4. Should open 5-Minute Hold Checkout Modal and verify cancellation policies', async ({ page }) => {
    // 1. Navigate to slot selection
    await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
    await customerApp.selectFirstSlot();

    // 2. Open Checkout Modal
    await customerApp.openCheckout();

    // 3. Verify 5-minute countdown card
    await expect(customerApp.timerCard).toBeVisible();
    await expect(customerApp.timerCard).toContainText(/0[0-5]:[0-5][0-9]/);

    // 4. Verify Pricing & Breakdown
    await expect(customerApp.paymentDetailsCard).toBeVisible();
    await expect(page.getByText('Hold Deposit (Guarantees Slot)')).toBeVisible();
    await expect(page.getByText('Total Payable Now')).toBeVisible();

    // 5. Verify Cancellation Policy
    await expect(page.getByText('🛡️ Cancellation & Reschedule Policy')).toBeVisible();
    await expect(page.getByText(/Free cancellation or reschedule up to 1 hour before/)).toBeVisible();

    // 6. Test Cancel action restores detail screen
    await customerApp.cancelModalBtn.click();
    await expect(customerApp.checkoutTitle).not.toBeVisible();
    await expect(customerApp.staffSectionHeading).toBeVisible();
  });

  test('5. Should complete deposit payment, navigate to My Bookings, and support browse return', async ({ page }) => {
    // 1. Proceed to checkout
    await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
    await customerApp.selectFirstSlot();
    await customerApp.openCheckout();

    // 2. Submit Payment via Razorpay action
    await customerApp.submitPayment();

    // 3. Verify Confirmation Toast
    await expect(customerApp.confirmationToast).toBeVisible({ timeout: 10000 });

    // 4. Verify transition to My Bookings Screen
    await expect(customerApp.myBookingsTitle).toBeVisible();

    // 5. Verify Appointment card is rendered
    await expect(page.getByText('CONFIRMED').first()).toBeVisible();
    await expect(page.getByText(/Deposit Paid:/).first()).toBeVisible();

    // 6. Return back to Browse Home
    await customerApp.backToBrowseBtn.click();
    await expect(customerApp.appTitle).toBeVisible();
  });
});
