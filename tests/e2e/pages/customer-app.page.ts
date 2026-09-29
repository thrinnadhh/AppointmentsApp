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

  // Profile & Auth Locators
  readonly profileBtn: Locator;
  readonly profileModalTitle: Locator;
  readonly authPhoneInput: Locator;
  readonly sendOtpBtn: Locator;
  readonly otpCodeInput: Locator;
  readonly verifyOtpBtn: Locator;
  readonly signOutBtn: Locator;
  readonly closeProfileBtn: Locator;

  // Waitlist Locators
  readonly waitlistSectionTitle: Locator;
  readonly waitlistPhoneInput: Locator;
  readonly waitlistSubmitBtn: Locator;
  readonly waitlistSuccessBadge: Locator;

  // Digital Pass Locators
  readonly passModalTitle: Locator;
  readonly passQrVerification: Locator;
  readonly passRefCode: Locator;
  readonly passDirectionsBtn: Locator;
  readonly passSaveBtn: Locator;
  readonly passCloseBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    // Header & Navigation
    this.locationBadge = page.getByRole('button', { name: 'Select Territory' }).or(page.getByLabel('Select Territory')).or(page.getByText('Tirupati, AP')).first();
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
    this.holdDepositBtn = page.getByText('Hold Slot & Pay Deposit →').or(page.getByText('Confirm & Pay Total Cash →'));
    this.selectTimeSlotBtn = page.getByText('Select a Time Slot');
    this.stickyFooterPrice = page.locator('text=Deposit to hold:').or(page.locator('text=Total fee:')).locator('..');

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
    this.confirmationToast = page.locator('text=/Booking Confirmed/i').first();

    // Profile & Auth
    this.profileBtn = page.getByRole('button', { name: 'Customer Profile' }).or(page.getByLabel('Customer Profile')).or(page.getByText('👤')).first();
    this.profileModalTitle = page.getByText(/Customer Profile & Sign In/i);
    this.authPhoneInput = page.getByTestId('input-phone-auth').or(page.locator('input[type="tel"]')).or(page.getByPlaceholder('+919999999991')).first();
    this.sendOtpBtn = page.getByTestId('btn-send-otp');
    this.otpCodeInput = page.getByTestId('input-otp-code');
    this.verifyOtpBtn = page.getByTestId('btn-verify-otp');
    this.signOutBtn = page.getByTestId('btn-sign-out');
    this.closeProfileBtn = page.getByLabel('Close profile modal').or(page.getByText('✕')).first();

    // Waitlist
    this.waitlistSectionTitle = page.getByText('Want appointments in another city?');
    this.waitlistPhoneInput = page.getByPlaceholder('e.g. 9876543210 or user@domain.com').or(page.locator('input[placeholder*="9876543210"]')).first();
    this.waitlistSubmitBtn = page.getByTestId('waitlist-submit-btn').or(page.getByText('Notify Me')).first();
    this.waitlistSuccessBadge = page.getByText('✓ Noted! You will receive early priority booking.');

    // Digital Pass
    this.passModalTitle = page.getByText('Digital Booking Pass');
    this.passQrVerification = page.getByText('Scan at reception desk for check-in');
    this.passRefCode = page.getByTestId('pass-reference-code');
    this.passDirectionsBtn = page.getByText('Directions');
    this.passSaveBtn = page.getByText('Save Pass');
    this.passCloseBtn = page.getByText('✕').first();
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
    // Wait for provider cards to load from Supabase after category selection
    // (async API call; must not assert on providers immediately after click)
    await this.page.waitForFunction(
      () => document.querySelectorAll('[data-testid="provider-card"]').length > 0,
      { timeout: 20000 }
    ).catch(() => {
      // Fallback: wait for any visible text that looks like a provider name
      // (some categories may not use testid)
    });
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
    // Re-select category to ensure data is loaded (guards against stale state)
    if (!(await this.page.getByText(name).first().isVisible({ timeout: 1000 }).catch(() => false))) {
      await this.selectCategory('Hospitals & Clinics');
    }
    // Wait for the specific provider card with an extended timeout to account for Supabase latency
    const card = this.page.getByText(name).first();
    await expect(card).toBeVisible({ timeout: 25000 });
    await card.click();
    await expect(this.staffSectionHeading).toBeVisible({ timeout: 15000 });
  }

  async expectProviderVisible(name: string, shouldBeVisible: boolean = true) {
    const card = this.page.getByText(name).first();
    if (shouldBeVisible) {
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await expect(card).toBeVisible({ timeout: 15000 });
    } else {
      await expect(card).not.toBeVisible({ timeout: 10000 });
    }
  }

  async selectDateOffset(label: 'Today' | 'Tomorrow') {
    const dateChip = this.page.getByText(label, { exact: true });
    await expect(dateChip).toBeVisible();
    await dateChip.click();
  }

  async selectFirstSlot() {
    await expect(this.slotSectionHeading).toBeVisible({ timeout: 15000 });

    const slotsLoading = this.page.getByTestId('customer-slots-loading');
    await expect(slotsLoading).toBeHidden({ timeout: 10000 }).catch(() => {});

    // Check if Today is closed, all slots have passed, or 0 enabled slots exist
    const closedNotice = this.page.getByTestId('customer-day-closed-notice');
    const pastNotice = this.page.getByTestId('customer-all-slots-past-notice');
    const currentEnabledSlotCount = await this.page
      .locator('[role="button"]:not([aria-disabled="true"]):not([disabled])')
      .filter({ hasText: /^[0-9]{2}:[0-9]{2} (am|pm)$/i })
      .count();

    const isTodayUnavailable =
      currentEnabledSlotCount === 0 ||
      (await closedNotice.isVisible().catch(() => false)) ||
      (await pastNotice.isVisible().catch(() => false));

    if (isTodayUnavailable) {
      // Switch to Tomorrow date card
      const tomorrowCard = this.page.getByTestId('customer-date-card-1');
      if (await tomorrowCard.isVisible().catch(() => false)) {
        await tomorrowCard.click();
      } else {
        await this.page.getByText('Tomorrow', { exact: true }).click();
      }
      await expect(slotsLoading).toBeHidden({ timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(400);
    }

    // Find the first slot button that is truly enabled (not disabled)
    const enabledSlot = this.page
      .locator('[role="button"]:not([aria-disabled="true"]):not([disabled])')
      .filter({ hasText: /^[0-9]{2}:[0-9]{2} (am|pm)$/i })
      .first();

    await expect(enabledSlot).toBeVisible({ timeout: 10000 });
    await enabledSlot.click();

    await expect(this.holdDepositBtn).toBeEnabled({ timeout: 5000 });
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
    if (await this.myBookingsTitle.isVisible().catch(() => false)) {
      return;
    }
    await expect(this.myBookingsBtn).toBeVisible();
    await this.myBookingsBtn.click();
    await expect(this.myBookingsTitle).toBeVisible({ timeout: 10000 });
  }

  async backToBrowse() {
    await expect(this.backToBrowseBtn).toBeVisible();
    await this.backToBrowseBtn.click();
    await expect(this.appTitle).toBeVisible({ timeout: 10000 });
  }

  getBookingCard(identifier?: string, status?: string): Locator {
    let loc = this.page.locator('[data-testid^="booking-card-"]');
    if (identifier) {
      loc = loc.filter({ hasText: identifier });
    }
    if (status) {
      loc = loc.filter({ hasText: status });
    }
    return loc.first();
  }

  async expectBookingInList(identifier?: string, expectedStatus: string = 'CONFIRMED') {
    if (['CONFIRMED', 'COMPLETED', 'CANCELLED', 'HELD', 'NO_SHOW'].includes(identifier || '')) {
      expectedStatus = identifier!;
      identifier = undefined;
    }
    const card = this.getBookingCard(identifier, expectedStatus);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByText(expectedStatus).first()).toBeVisible();
  }

  async openBookingPass(identifier?: string) {
    const card = this.getBookingCard(identifier, 'CONFIRMED');
    const passBtn = card.getByTestId(/^view-pass-/).or(card.getByText(/Pass/i)).first();
    await passBtn.scrollIntoViewIfNeeded();
    await expect(passBtn).toBeVisible({ timeout: 10000 });
    await passBtn.click();
    await expect(this.page.getByText('Digital Booking Pass')).toBeVisible({ timeout: 10000 });
  }

  async closeBookingPass() {
    const closeBtn = this.page.getByText('✕').first();
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(this.page.getByText('Digital Booking Pass')).not.toBeVisible({ timeout: 10000 });
  }

  async cancelBookingFromList(identifier?: string) {
    const card = this.getBookingCard(identifier, 'CONFIRMED');
    const cancelBtn = card.getByTestId(/^cancel-/).or(card.getByText('Cancel', { exact: true })).first();
    await expect(cancelBtn).toBeVisible({ timeout: 15000 });
    await cancelBtn.scrollIntoViewIfNeeded();

    this.page.once('dialog', (dialog) => {
      dialog.accept().catch(() => {});
    });
    await cancelBtn.click();
  }

  async rescheduleBookingFromList(identifier?: string, timeSlot: string = '11:30 AM') {
    const card = this.getBookingCard(identifier, 'CONFIRMED');
    const rescheduleBtn = card.getByTestId(/^reschedule-/).or(card.getByText(/Reschedule/i)).first();
    await expect(rescheduleBtn).toBeVisible({ timeout: 15000 });
    await rescheduleBtn.scrollIntoViewIfNeeded();
    await rescheduleBtn.click();

    // Select time slot chip
    const slotChip = this.page.getByText(timeSlot, { exact: true }).first();
    await slotChip.scrollIntoViewIfNeeded();
    await expect(slotChip).toBeVisible({ timeout: 10000 });
    await slotChip.click();

    // Intercept alert if fired
    this.page.once('dialog', (dialog) => {
      dialog.accept().catch(() => {});
    });

    // Confirm Reschedule
    const confirmBtn = this.page.getByTestId('confirm-reschedule-btn').or(this.page.getByText('Confirm Reschedule', { exact: true })).first();
    await confirmBtn.scrollIntoViewIfNeeded();
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();
  }

  async selectStaffMember(name: string) {
    const staffCard = this.page.getByText(name).first();
    await staffCard.scrollIntoViewIfNeeded();
    await expect(staffCard).toBeVisible({ timeout: 10000 });
    await staffCard.click();
  }

  async verifyPassDetails(expectedRefCode?: string) {
    await expect(this.passModalTitle).toBeVisible({ timeout: 10000 });
    await expect(this.passQrVerification).toBeVisible({ timeout: 10000 });
    if (expectedRefCode) {
      await expect(this.passRefCode).toHaveText(expectedRefCode, { timeout: 10000 });
    }
    await expect(this.passDirectionsBtn).toBeVisible();
    await expect(this.passSaveBtn).toBeVisible();
  }

  async getPassReferenceCode(): Promise<string> {
    await expect(this.passRefCode).toBeVisible({ timeout: 10000 });
    const text = await this.passRefCode.textContent();
    return text?.trim() || '';
  }

  async submitExpansionWaitlist(phone: string) {
    if (!(await this.page.getByText('Choose Territory').isVisible().catch(() => false))) {
      await this.locationBadge.click();
      await expect(this.page.getByText('Choose Territory')).toBeVisible({ timeout: 10000 });
    }
    await this.waitlistPhoneInput.scrollIntoViewIfNeeded();
    await expect(this.waitlistPhoneInput).toBeVisible({ timeout: 10000 });
    await this.waitlistPhoneInput.fill(phone);
    await expect(this.waitlistSubmitBtn).toBeVisible();
    await this.waitlistSubmitBtn.click();
    await expect(this.waitlistSuccessBadge).toBeVisible({ timeout: 10000 });
  }

  async openProfile() {
    await this.profileBtn.scrollIntoViewIfNeeded();
    await expect(this.profileBtn).toBeVisible({ timeout: 10000 });
    await this.profileBtn.click();
    await expect(this.profileModalTitle).toBeVisible({ timeout: 10000 });
  }

  async closeProfile() {
    await expect(this.closeProfileBtn).toBeVisible();
    await this.closeProfileBtn.click();
    await expect(this.profileModalTitle).not.toBeVisible({ timeout: 10000 });
  }

  async loginWithPhoneOtp(phone: string = '+919999999991', otp: string = '123456') {
    // If already signed in, check if sign out is visible
    if (await this.signOutBtn.isVisible().catch(() => false)) {
      await this.signOutBtn.click();
    }
    await expect(this.authPhoneInput).toBeVisible({ timeout: 10000 });
    await this.authPhoneInput.fill(phone);
    await expect(this.sendOtpBtn).toBeVisible();
    await this.sendOtpBtn.click();

    await expect(this.otpCodeInput).toBeVisible({ timeout: 10000 });
    await this.otpCodeInput.fill(otp);
    await expect(this.verifyOtpBtn).toBeVisible();
    await this.verifyOtpBtn.click();

    await expect(this.signOutBtn).toBeVisible({ timeout: 10000 });
  }

  async signOutCustomer() {
    if (await this.signOutBtn.isVisible().catch(() => false)) {
      await this.signOutBtn.click();
      await expect(this.authPhoneInput).toBeVisible({ timeout: 10000 });
    }
  }
}


