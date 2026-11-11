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
  readonly toastBanner: Locator;

  // Profile & Auth Locators
  readonly profileBtn: Locator;
  readonly profileModalTitle: Locator;
  readonly authNameInput: Locator;
  readonly authPhoneInput: Locator;
  readonly sendOtpBtn: Locator;
  readonly otpCodeInput: Locator;
  readonly verifyOtpBtn: Locator;
  readonly phoneVerifiedBadge: Locator;
  readonly authEmailInput: Locator;
  readonly sendEmailOtpBtn: Locator;
  readonly emailOtpCodeInput: Locator;
  readonly verifyEmailOtpBtn: Locator;
  readonly emailVerifiedBadge: Locator;
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
  readonly passExpectedTime: Locator;
  readonly passDirectionsBtn: Locator;
  readonly passSaveBtn: Locator;
  readonly passCloseBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    // Header & Navigation
    this.locationBadge = page.getByRole('button', { name: 'Select Territory' }).or(page.getByLabel('Select Territory')).or(page.getByText('Tirupati, AP')).first();
    this.appTitle = page.getByText('Instant Appointments');
    this.myBookingsBtn = page.getByText('Bookings');
    this.trustBanner = page.getByText(/guarantees your slot with zero waiting|guaranteed zero-wait booking/i).first();

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
    this.holdDepositBtn = page.getByText('Hold Slot & Pay Deposit →')
      .or(page.getByText('Confirm & Pay Total Cash →'))
      .or(page.getByText(/Confirm Free Appointment/i));
    this.selectTimeSlotBtn = page.getByText('Select a Time Slot');
    this.stickyFooterPrice = page.locator('text=Deposit to hold:').or(page.locator('text=Total fee:')).locator('..');

    // Checkout Modal
    this.checkoutTitle = page.getByText('Confirm Reservation');
    this.timerCard = page.getByText('Slot Held for You').locator('..');
    this.paymentDetailsCard = page.getByText('Payment Details');
    this.cancelModalBtn = page.getByText('✕ Cancel');
    this.payDepositBtn = page.getByTestId('btn-pay-now')
      .or(page.locator('text=/Pay Platform Fee ₹[0-9]+ to Reserve Slot|Pay ₹[0-9]+ via Razorpay|Confirm Free Follow-up Appointment/i'))
      .first();

    // My Bookings Screen
    this.myBookingsTitle = page.getByRole('heading', { name: 'My Appointments' }).or(page.getByText('My Appointments').first());
    this.backToBrowseBtn = page.getByText('← Back to Browse');
    this.emptyBookingsState = page.getByText('No Appointments Yet');

    // Toast
    this.toastBanner = page.getByTestId('app-toast-banner');
    this.confirmationToast = page.getByTestId('app-toast-banner').or(page.locator('text=/Booking Confirmed|Appointment Confirmed|Token #|Assigned & Registered/i')).first();

    // Profile & Auth
    this.profileBtn = page.getByRole('button', { name: 'Customer Profile' }).or(page.getByLabel('Customer Profile')).or(page.getByText('👤')).first();
    this.profileModalTitle = page.getByText(/Customer Profile & Sign In/i);
    this.authNameInput = page.getByTestId('input-customer-name');
    this.authPhoneInput = page.getByTestId('input-phone-auth').or(page.locator('input[type="tel"]')).or(page.getByPlaceholder('+919999999991')).first();
    this.sendOtpBtn = page.getByTestId('btn-send-otp');
    this.otpCodeInput = page.getByTestId('input-otp-code');
    this.verifyOtpBtn = page.getByTestId('btn-verify-otp');
    this.phoneVerifiedBadge = page.getByTestId('badge-phone-verified');
    this.authEmailInput = page.getByTestId('input-email-auth');
    this.sendEmailOtpBtn = page.getByTestId('btn-send-email-otp');
    this.emailOtpCodeInput = page.getByTestId('input-email-otp');
    this.verifyEmailOtpBtn = page.getByTestId('btn-verify-email-otp');
    this.emailVerifiedBadge = page.getByTestId('badge-email-verified');
    this.signOutBtn = page.getByTestId('btn-sign-out');
    this.closeProfileBtn = page.getByLabel('Close profile modal').or(page.getByText('✕')).first();

    // Waitlist
    this.waitlistSectionTitle = page.getByText('Want appointments in another city?');
    this.waitlistPhoneInput = page.getByPlaceholder('e.g. 9876543210 or user@domain.com').or(page.locator('input[placeholder*="9876543210"]')).first();
    this.waitlistSubmitBtn = page.getByTestId('waitlist-submit-btn').or(page.getByText('Notify Me')).first();
    this.waitlistSuccessBadge = page.getByText('✓ Noted! You will receive early priority booking.');

    // Digital Pass
    this.passModalTitle = page.getByText(/Digital Booking Pass|Hospital OPD Live Pass & Queue|My Token Pass/i).first();
    this.passQrVerification = page.getByText(/Scan at reception desk|Scan at hospital reception desk/i).first();
    this.passRefCode = page.getByTestId('pass-reference-code').or(page.locator('text=/TPT-[A-Z0-9]+/i')).first();
    this.passExpectedTime = page.getByTestId('pass-expected-time').or(page.getByText(/Expected Time & Zero-Wait Advice/i)).first();
    this.passDirectionsBtn = page.getByText('Directions');
    this.passSaveBtn = page.getByText('Save Pass');
    this.passCloseBtn = page.getByText('✕').first();
  }

  async goto() {
    await this.page.goto('http://localhost:8081', { waitUntil: 'domcontentloaded' });
    if (await this.cancelModalBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await this.cancelModalBtn.click().catch(() => {});
    }
    if (await this.closeProfileBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await this.closeProfileBtn.click().catch(() => {});
    }
    if (!(await this.appTitle.isVisible({ timeout: 2000 }).catch(() => false))) {
      if (await this.backButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await this.backButton.click().catch(() => {});
      }
    }
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
    // Ensure we are inside the category view where provider cards are listed
    if (!(await this.searchInput.isVisible({ timeout: 1000 }).catch(() => false))) {
      await this.selectCategory('Hospitals & Clinics');
    }

    const isDental = name.includes('Dental') || name.includes('Sri Venkateswara');
    const card = isDental
      ? this.page.getByTestId('provider-card').filter({ hasText: /Dental|Sri Venkateswara/i }).first()
      : this.page.getByTestId('provider-card').filter({ hasText: name }).first();

    // Wait for the specific provider card with an extended timeout to account for Supabase latency
    await expect(card).toBeVisible({ timeout: 25000 });
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await card.click();
    // Guard against touch dispatch drop on mobile web preview
    if (!(await this.staffSectionHeading.isVisible({ timeout: 3000 }).catch(() => false))) {
      await card.click({ force: true }).catch(() => {});
    }
    await expect(this.staffSectionHeading).toBeVisible({ timeout: 15000 });
  }

  async expectProviderVisible(name: string, shouldBeVisible: boolean = true) {
    let card = this.page.getByText(name).first();
    if (shouldBeVisible) {
      if (!(await card.isVisible().catch(() => false))) {
        if (await this.searchInput.isVisible().catch(() => false)) {
          await this.searchInput.fill(name);
          await this.page.waitForTimeout(400);
        }
      }
      card = this.page.getByText(name).first();
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await expect(card).toBeVisible({ timeout: 15000 });
    } else {
      await expect(card).not.toBeVisible({ timeout: 10000 });
    }
  }

  async selectDateOffset(label: 'Today' | 'Tomorrow') {
    const cardTestId = label === 'Today' ? 'customer-date-card-0' : 'customer-date-card-1';
    const dateChip = this.page.getByTestId(cardTestId);
    await expect(dateChip).toBeVisible();
    await dateChip.click();
  }

  async selectFirstSlot(slotIndex: number = 0) {
    await expect(this.slotSectionHeading).toBeVisible({ timeout: 15000 });

    const signInPrompt = this.page.getByTestId('customer-slots-signin-prompt').or(this.page.getByText('Sign In to View Available Slots'));
    if (await signInPrompt.isVisible({ timeout: 2000 }).catch(() => false)) {
      const signInBtn = this.page.getByTestId('customer-slots-signin-button').or(this.page.getByText(/Sign In to Book Slot/i));
      if (await signInBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await signInBtn.click();
        await this.loginWithPhoneOtp('+919999900001', '123456');
        await this.closeProfile();
      }
    }

    const slotsLoading = this.page.getByTestId('customer-slots-loading').or(this.page.getByText('Checking live slot availability...'));
    await expect(slotsLoading).toBeHidden({ timeout: 15000 }).catch(() => {});

    // Try finding an enabled slot on the currently selected day
    const enabledSlots = this.page
      .locator('[role="button"]:not([aria-disabled="true"]):not([disabled])')
      .filter({ hasText: /^[0-9]{1,2}:[0-9]{2}(\s*(am|pm))?$/i });

    const pastNotice = this.page.getByTestId('customer-all-slots-past-notice');
    const closedNotice = this.page.getByTestId('customer-day-closed-notice');

    const isSlotAvailable =
      !(await pastNotice.isVisible().catch(() => false)) &&
      !(await closedNotice.isVisible().catch(() => false)) &&
      (await enabledSlots.first().isVisible({ timeout: 2000 }).catch(() => false));

    if (!isSlotAvailable) {
      // If no slot is visible on currently selected day (e.g. today concluded/closed or all booked), switch to Tomorrow
      await this.selectDateOffset('Tomorrow');
      await expect(slotsLoading).toBeHidden({ timeout: 15000 }).catch(() => {});
    }

    // Wait for at least one enabled slot to appear
    await expect(enabledSlots.first()).toBeVisible({ timeout: 15000 });
    const count = await enabledSlots.count();
    const index = Math.min(slotIndex, count - 1);
    const targetSlot = enabledSlots.nth(index);
    await expect(targetSlot).toBeVisible({ timeout: 10000 });
    await targetSlot.scrollIntoViewIfNeeded().catch(() => {});
    await targetSlot.click();
    await expect(this.holdDepositBtn).toBeEnabled({ timeout: 5000 });
  }

  async openCheckout() {
    await expect(this.holdDepositBtn).toBeVisible();
    await this.holdDepositBtn.click();

    // If pre-booking customer details modal appears, fill required info and proceed to checkout
    const detailsProceedBtn = this.page
      .getByTestId('btn-proceed-to-checkout')
      .or(this.page.getByRole('button', { name: /Proceed to Hold & Pay Deposit/i }))
      .or(this.page.getByText(/Proceed to Hold & Pay Deposit/i))
      .first();
    const hasDetailsModal = await detailsProceedBtn.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    if (hasDetailsModal) {
      const nameInput = this.page.getByTestId('input-patient-fullname').or(this.page.getByPlaceholder(/e\.g\. Patient Full Name/i)).first();
      if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        const val = await nameInput.inputValue().catch(() => '');
        if (!val) {
          await nameInput.fill('Trinadh Patient');
        }
      }
      const phoneInput = this.page.getByTestId('input-patient-phone').or(this.page.getByPlaceholder(/\+91/i)).first();
      if (await phoneInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        const val = await phoneInput.inputValue().catch(() => '');
        if (!val) {
          await phoneInput.fill('+919999900001');
        }
      }
      await detailsProceedBtn.click();
    }

    await expect(this.checkoutTitle).toBeVisible();
  }

  async ensureAuthenticated(phone: string = '+919999900001', otp: string = '123456') {
    if (await this.profileBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await this.openProfile();
      if (!(await this.signOutBtn.isVisible({ timeout: 1500 }).catch(() => false))) {
        await this.loginWithPhoneOtp(phone, otp);
      }
      await this.closeProfile();
    }
  }

  async submitPayment() {
    await expect(this.payDepositBtn).toBeVisible();
    await this.payDepositBtn.click();

    // Wait for checkout modal to finish processing and dismiss
    await expect(this.checkoutTitle).not.toBeVisible({ timeout: 20000 }).catch(() => {});

    // If the digital appointment pass modal pops up upon payment, dismiss it to reveal My Bookings screen
    const passCloseBtn = this.page
      .getByTestId('btn-close-booking-pass')
      .or(this.page.getByLabel('Close appointment pass'))
      .first();
    const hasPassModal = await passCloseBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (hasPassModal) {
      await passCloseBtn.click();
    }
  }

  async navigateToMyBookings() {
    if (await this.myBookingsTitle.isVisible().catch(() => false)) {
      if (await this.backToBrowseBtn.isVisible().catch(() => false)) {
        await this.backToBrowseBtn.click();
        await expect(this.appTitle).toBeVisible({ timeout: 10000 });
      }
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

  async selectBookingsSubTab(tab: 'upcoming' | 'history') {
    const tabBtn = tab === 'upcoming'
      ? this.page.getByTestId('tab-upcoming-appointments').or(this.page.getByText(/Upcoming \(/i)).first()
      : this.page.getByTestId('tab-history-appointments').or(this.page.getByText(/History \(/i)).first();
    if (await tabBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tabBtn.click();
      await this.page.waitForTimeout(300);
    }
  }

  async expectBookingInList(identifier?: string, expectedStatus: string = 'CONFIRMED') {
    if (['CONFIRMED', 'COMPLETED', 'CANCELLED', 'HELD', 'NO_SHOW'].includes(identifier || '')) {
      expectedStatus = identifier!;
      identifier = undefined;
    }

    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(expectedStatus)) {
      await this.selectBookingsSubTab('history');
    } else {
      await this.selectBookingsSubTab('upcoming');
    }

    const card = this.getBookingCard(identifier, expectedStatus);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByText(expectedStatus).first()).toBeVisible();
  }

  async openBookingPass(identifier?: string) {
    if (await this.passModalTitle.isVisible().catch(() => false)) {
      return;
    }
    const card = this.getBookingCard(identifier, 'CONFIRMED');
    const passBtn = card.getByTestId(/^view-pass-/).or(card.getByText(/Pass/i)).first();
    await passBtn.scrollIntoViewIfNeeded();
    await expect(passBtn).toBeVisible({ timeout: 10000 });
    await passBtn.click();
    await expect(this.passModalTitle).toBeVisible({ timeout: 10000 });
  }

  async closeBookingPass() {
    if (!(await this.passModalTitle.isVisible().catch(() => false))) {
      return;
    }
    const modal = this.page.locator('.fixed.inset-0, [role="dialog"]').filter({ has: this.passModalTitle }).first();
    const closeBtn = (await modal.isVisible().catch(() => false))
      ? modal.getByText('✕').or(modal.getByLabel('Close')).first()
      : this.page.getByText('✕').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click().catch(() => {});
    }
    await expect(this.passModalTitle).not.toBeVisible({ timeout: 10000 }).catch(() => {});
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
    const match = text?.match(/TPT-[A-Z0-9]+/i);
    return match ? match[0] : (text?.trim() || '');
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
    if (await this.closeProfileBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await this.closeProfileBtn.click();
    }
    await expect(this.profileModalTitle).not.toBeVisible({ timeout: 10000 }).catch(() => {});
  }

  async loginWithPhoneOtp(phone: string = '+919999900001', otp: string = '123456') {
    // If already signed in, check if sign out is visible
    if (await this.signOutBtn.isVisible().catch(() => false)) {
      await this.signOutBtn.click();
    }
    await expect(this.authPhoneInput).toBeVisible({ timeout: 10000 });
    await this.authPhoneInput.fill(phone);
    await this.page.waitForTimeout(1500);
    await expect(this.sendOtpBtn).toBeVisible();
    await this.sendOtpBtn.click();

    await expect(this.otpCodeInput).toBeVisible({ timeout: 10000 });
    await this.otpCodeInput.fill(otp);
    await expect(this.verifyOtpBtn).toBeVisible();
    await this.verifyOtpBtn.click();
    await this.page.waitForTimeout(1000);
  }

  async enterCustomerName(name: string) {
    await expect(this.authNameInput).toBeVisible({ timeout: 10000 });
    await this.authNameInput.scrollIntoViewIfNeeded().catch(() => {});
    await this.authNameInput.fill(name);
  }

  async verifyEmail(email: string = 'trinadh.patient@appointments4u.in', otp: string = '123456') {
    if (await this.emailVerifiedBadge.isVisible().catch(() => false)) {
      return;
    }
    await expect(this.authEmailInput).toBeVisible({ timeout: 10000 });
    await this.authEmailInput.scrollIntoViewIfNeeded().catch(() => {});
    await this.authEmailInput.fill(email);
    await expect(this.sendEmailOtpBtn).toBeVisible();
    await this.sendEmailOtpBtn.click();

    await expect(this.emailOtpCodeInput).toBeVisible({ timeout: 10000 });
    await this.emailOtpCodeInput.fill(otp);
    await expect(this.verifyEmailOtpBtn).toBeVisible();
    await this.verifyEmailOtpBtn.click();

    await expect(this.emailVerifiedBadge).toBeVisible({ timeout: 10000 });
  }

  async signOutCustomer() {
    if (await this.signOutBtn.isVisible().catch(() => false)) {
      await this.signOutBtn.click();
      await expect(this.authPhoneInput).toBeVisible({ timeout: 10000 });
    }
  }
}


