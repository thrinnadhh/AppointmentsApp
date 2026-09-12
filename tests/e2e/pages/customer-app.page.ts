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

  // Category Filter Locators (The 5 core service mini-logos)
  readonly allCategoriesChip: Locator;
  readonly clinicsChip: Locator;
  readonly restaurantsChip: Locator;
  readonly gamingChip: Locator;
  readonly salonsChip: Locator;
  readonly petsChip: Locator;

  // Search Bar Locators
  readonly searchInput: Locator;
  readonly clearSearchBtn: Locator;
  readonly searchResultsHeading: Locator;
  readonly emptySearchResults: Locator;
  readonly resetSearchBtn: Locator;
  readonly providerCards: Locator;

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
    this.trustBanner = page.getByText(/guarantees your slot with zero waiting/i).first();

    // The 5 Category Mini-Logos
    this.allCategoriesChip = page.getByText('← All Categories');
    this.clinicsChip = page.getByText('Hospitals & Clinics', { exact: true }).first();
    this.restaurantsChip = page.getByText('Restaurants & Dining', { exact: true }).first();
    this.gamingChip = page.getByText('Gaming & Turf', { exact: true }).first();
    this.salonsChip = page.getByText('Salons & Spas', { exact: true }).first();
    this.petsChip = page.getByText('Pet Care & Clinic', { exact: true }).first();

    // Search Bar & Filters
    this.searchInput = page.getByTestId('customer-search-input');
    this.clearSearchBtn = page.getByTestId('clear-search-button');
    this.searchResultsHeading = page.locator('text=/Search Results \\([0-9]+\\)/');
    this.emptySearchResults = page.getByText(/No venues found in/i);
    this.resetSearchBtn = page.getByTestId('reset-search-button');
    this.providerCards = page.getByTestId('provider-card');

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
    const chip = this.page.getByText(categoryName, { exact: true }).first();
    await chip.scrollIntoViewIfNeeded();
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(this.searchInput).toBeVisible();
  }

  async search(query: string) {
    await expect(this.searchInput).toBeVisible();
    await this.searchInput.fill(query);
  }

  async clearSearch() {
    await expect(this.clearSearchBtn).toBeVisible();
    await this.clearSearchBtn.click();
    await expect(this.clearSearchBtn).not.toBeVisible();
  }

  async resetSearchFromEmptyState() {
    await expect(this.resetSearchBtn).toBeVisible();
    await this.resetSearchBtn.click();
    await expect(this.emptySearchResults).not.toBeVisible();
  }

  async selectProviderByName(name: string) {
    const card = this.page.getByText(name).first();
    if (!(await card.isVisible().catch(() => false))) {
      await this.selectCategory('Hospitals & Clinics');
    }
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

  async navigateToMyBookings() {
    await expect(this.myBookingsBtn).toBeVisible();
    await this.myBookingsBtn.click();
    await expect(this.myBookingsTitle).toBeVisible({ timeout: 10000 });
  }

  async backToBrowse() {
    await expect(this.backToBrowseBtn).toBeVisible();
    await this.backToBrowseBtn.click();
    await expect(this.appTitle).toBeVisible({ timeout: 10000 });
  }

  async expectBookingInList(identifier: string, expectedStatus: string = 'CONFIRMED') {
    const card = this.page.locator('div', { hasText: identifier }).first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(this.page.getByText(expectedStatus).first()).toBeVisible();
  }
}

