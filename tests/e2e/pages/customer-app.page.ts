import { Page, Locator, expect } from '@playwright/test';

/**
 * CustomerAppPage - Page Object Model encapsulating the React Native Customer App
 * rendered via Expo Web on port 8081.
 * Conforms to Playwright POM principles in webapp-testing/SKILL.md (Section 4).
 */
export class CustomerAppPage {
  readonly page: Page;

  // Header & Brand Locators
  readonly locationBadge: Locator;
  readonly appTitle: Locator;
  readonly myBookingsBtn: Locator;
  readonly trustBanner: Locator;

  // Category Filter Locators
  readonly allCategoriesChip: Locator;
  readonly clinicsChip: Locator;
  readonly restaurantsChip: Locator;
  readonly gamingChip: Locator;
  readonly salonsChip: Locator;
  readonly petsChip: Locator;

  // Detail Screen Locators
  readonly backButton: Locator;
  readonly staffSectionHeading: Locator;
  readonly dateSectionHeading: Locator;
  readonly slotSectionHeading: Locator;
  readonly holdDepositBtn: Locator;
  readonly selectTimeSlotBtn: Locator;
  readonly stickyFooterPrice: Locator;

  // Checkout Modal Locators
  readonly checkoutTitle: Locator;
  readonly timerCard: Locator;
  readonly paymentDetailsCard: Locator;
  readonly cancelModalBtn: Locator;
  readonly payDepositBtn: Locator;

  // My Bookings Screen Locators
  readonly myBookingsTitle: Locator;
  readonly backToBrowseBtn: Locator;
  readonly emptyBookingsState: Locator;

  // Confirmation Toast
  readonly confirmationToast: Locator;

  constructor(page: Page) {
    this.page = page;

    // Header & Navigation
    this.locationBadge = page.getByText('Tirupati, AP');
    this.appTitle = page.getByText('Instant Appointments');
    this.myBookingsBtn = page.getByText('Bookings');
    this.trustBanner = page.getByText(/guarantees your slot with zero waiting/i);

    // Categories (matching VERTICALS constant names)
    this.allCategoriesChip = page.getByText('All Categories');
    this.clinicsChip = page.getByText('Hospitals & Clinics', { exact: true });
    this.restaurantsChip = page.getByText('Restaurants & Dining', { exact: true });
    this.gamingChip = page.getByText('Gaming & Turf', { exact: true });
    this.salonsChip = page.getByText('Salons & Spas', { exact: true });
    this.petsChip = page.getByText('Pet Care & Clinic', { exact: true });

    // Detail Screen
    this.backButton = page.getByText('← Back');
    this.staffSectionHeading = page.getByText('1. Select Staff / Unit');
    this.dateSectionHeading = page.getByText('2. Choose Date');
    this.slotSectionHeading = page.getByText('3. Available Slots');
    this.holdDepositBtn = page.getByText('Hold Slot & Pay Deposit →');
    this.selectTimeSlotBtn = page.getByText('Select a Time Slot');
    this.stickyFooterPrice = page.locator('text=Deposit to hold:').locator('..');

    // Checkout Modal
    this.checkoutTitle = page.getByText('Confirm Reservation');
    this.timerCard = page.getByText('Slot Held for You').locator('..');
    this.paymentDetailsCard = page.getByText('Payment Details');
    this.cancelModalBtn = page.getByText('✕ Cancel');
    this.payDepositBtn = page.locator('text=/Pay ₹[0-9]+ via Razorpay/i');

    // My Bookings Screen
    this.myBookingsTitle = page.getByText('My Appointments');
    this.backToBrowseBtn = page.getByText('← Back to Browse');
    this.emptyBookingsState = page.getByText('No Appointments Yet');

    // Toast
    this.confirmationToast = page.locator('text=/Booking Confirmed/i');
  }

  async goto() {
    await this.page.goto('http://localhost:8081', { waitUntil: 'domcontentloaded' });
    await expect(this.appTitle).toBeVisible({ timeout: 20000 });
  }

  async selectCategory(categoryName: string) {
    const chip = this.page.getByText(categoryName, { exact: true });
    await chip.scrollIntoViewIfNeeded();
    await expect(chip).toBeVisible();
    await chip.click();
    await this.page.waitForTimeout(300);
  }

  async selectProviderByName(name: string) {
    const card = this.page.getByText(name).first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(this.staffSectionHeading).toBeVisible();
  }

  async selectDateOffset(label: 'Today' | 'Tomorrow') {
    const dateChip = this.page.getByText(label, { exact: true });
    await expect(dateChip).toBeVisible();
    await dateChip.click();
  }

  async selectFirstSlot() {
    const slotChips = this.page.locator('div').filter({ hasText: /^(10|11|12|01|02|03|04|05):[0-9]{2} (AM|PM)$/ });
    const firstSlot = slotChips.first();
    await expect(firstSlot).toBeVisible();
    await firstSlot.click();
  }

  async openCheckout() {
    await expect(this.holdDepositBtn).toBeVisible();
    await this.holdDepositBtn.click();
    await expect(this.checkoutTitle).toBeVisible();
  }

  async submitPayment() {
    await expect(this.payDepositBtn).toBeVisible();
    await this.payDepositBtn.click();
  }
}
