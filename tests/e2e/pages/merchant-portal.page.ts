import { Page, Locator, expect } from '@playwright/test';

/**
 * MerchantPortalPage - Page Object Model encapsulating the Next.js 15 Merchant Web Portal
 * rendered on port 3000.
 * Conforms strictly to Playwright POM principles in webapp-testing/SKILL.md (Section 4).
 */
export class MerchantPortalPage {
  readonly page: Page;

  // Global Header & Navigation Locators
  readonly brandLogo: Locator;
  readonly platformTitle: Locator;
  readonly verifiedBadge: Locator;
  readonly navOverview: Locator;
  readonly navVenues: Locator;
  readonly navResources: Locator;
  readonly navBookings: Locator;
  readonly navSchedule: Locator;
  readonly navTeam: Locator;
  readonly navSettings: Locator;
  readonly userMenuButton: Locator;
  readonly realtimeSyncToast: Locator;

  // Overview Page Locators
  readonly overviewHeading: Locator;
  readonly liveSyncBadge: Locator;
  readonly totalBookingsCard: Locator;
  readonly confirmedBookingsCard: Locator;
  readonly diagnosticButton: Locator;
  readonly diagnosticResultBanner: Locator;

  // Bookings & Queue Management Locators
  readonly bookingsHeading: Locator;
  readonly customerSearchInput: Locator;
  readonly filterAllPill: Locator;
  readonly filterHeldPill: Locator;
  readonly filterConfirmedPill: Locator;
  readonly filterCompletedPill: Locator;
  readonly filterCancelledPill: Locator;
  readonly venueSelector: Locator;
  readonly bookingCards: Locator;

  // Reschedule Modal Locators
  readonly rescheduleModalHeading: Locator;
  readonly newSlotTimeInput: Locator;
  readonly confirmRescheduleButton: Locator;
  readonly cancelRescheduleButton: Locator;

  // Notification Audit Modal Locators
  readonly notificationModalHeading: Locator;
  readonly notificationModalCloseBtn: Locator;
  readonly notificationAuditTable: Locator;
  readonly notificationChannelBadges: Locator;

  // Team & Staff Management Locators
  readonly teamHeading: Locator;
  readonly addStaffMemberBtn: Locator;
  readonly staffNameInput: Locator;
  readonly staffEmailInput: Locator;
  readonly staffPasswordInput: Locator;
  readonly staffRoleSelect: Locator;
  readonly staffPhoneInput: Locator;
  readonly saveStaffBtn: Locator;
  readonly cancelStaffBtn: Locator;
  readonly staffCards: Locator;
  readonly staffSuccessBanner: Locator;

  constructor(page: Page) {
    this.page = page;

    // Header & Navigation
    this.brandLogo = page.locator('nav, header').getByText('Tirupati Merchant Hub');
    this.platformTitle = page.getByText('Tirupati Merchant Hub');
    this.verifiedBadge = page.getByText('Verified Portal');
    this.navOverview = page.getByRole('link', { name: /Overview/i }).first();
    this.navVenues = page.getByRole('link', { name: /Venues/i }).first();
    this.navResources = page.getByRole('link', { name: /Doctors & Services|Resources/i }).first();
    this.navBookings = page.getByRole('link', { name: /Bookings Queue|Bookings/i }).first();
    this.navSchedule = page.getByRole('link', { name: /Availability & Hours|Schedule/i }).first();
    this.navTeam = page.getByRole('link', { name: /Team & Access|Team/i }).first();
    this.navSettings = page.getByRole('link', { name: /Settings/i }).first();
    this.userMenuButton = page.locator('header').getByTitle('Sign Out');
    this.realtimeSyncToast = page.locator('text=/Realtime Sync:/i');

    // Overview Page
    this.overviewHeading = page.getByRole('heading', { name: /City-Wide Vertical Summary|Merchant Dashboard|Overview/i });
    this.liveSyncBadge = page.getByText(/Live Synced|Live Hyperlocal/i).first();
    this.totalBookingsCard = page.getByText("Today's Live Appointments").first();
    this.confirmedBookingsCard = page.getByText('slots booked').first();
    this.diagnosticButton = page.getByRole('button', { name: /Run Diagnostics/i });
    this.diagnosticResultBanner = page.getByText(/Healthy \(0 Failures\)|Latency: [0-9]+ms/i).first();

    // Bookings & Queue Management
    this.bookingsHeading = page.getByRole('heading', { name: /Bookings & Queue/i, level: 1 });
    this.customerSearchInput = page.locator('#customer-search');
    this.filterAllPill = page.getByRole('button', { name: /^ALL$/i });
    this.filterHeldPill = page.getByRole('button', { name: /^HELD$/i });
    this.filterConfirmedPill = page.getByRole('button', { name: /^CONFIRMED$/i });
    this.filterCompletedPill = page.getByRole('button', { name: /^COMPLETED$/i });
    this.filterCancelledPill = page.getByRole('button', { name: /^CANCELLED$/i });
    this.venueSelector = page.locator('select').first();
    this.bookingCards = page.locator('.divide-y > div');

    // Reschedule Modal
    this.rescheduleModalHeading = page.getByRole('heading', { name: /Reschedule Appointment/i });
    this.newSlotTimeInput = page.locator('input[type="datetime-local"]');
    this.confirmRescheduleButton = page.getByRole('button', { name: /Confirm Reschedule/i });
    this.cancelRescheduleButton = page.getByRole('button', { name: /Cancel/i, exact: true });

    // Notification Audit Modal
    this.notificationModalHeading = page.getByRole('heading', { name: /WhatsApp & SMS Communications/i });
    this.notificationModalCloseBtn = page.getByRole('button', { name: 'Close', exact: true });
    this.notificationAuditTable = page.locator('.bg-slate-50\\/50');
    this.notificationChannelBadges = page.locator('text=/WHATSAPP|SMS/i');

    // Team Management
    this.teamHeading = page.getByRole('heading', { name: /Team & Merchant Credentials/i, level: 1 });
    this.addStaffMemberBtn = page.getByRole('button', { name: /Add Staff Member/i });
    this.staffNameInput = page.locator('#team-member-name');
    this.staffEmailInput = page.locator('#team-member-email');
    this.staffPasswordInput = page.locator('#team-member-password');
    this.staffRoleSelect = page.locator('#team-member-role');
    this.staffPhoneInput = page.locator('#team-member-phone');
    this.saveStaffBtn = page.getByRole('button', { name: /Save & Provision User/i });
    this.cancelStaffBtn = page.getByRole('button', { name: /Cancel/i, exact: true });
    this.staffCards = page.locator('h3:has-text("Dr.")');
    this.staffSuccessBanner = page.locator('text=/Staff account created for/i');
  }

  // Navigation Methods
  async goto() {
    await this.page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await expect(this.platformTitle).toBeVisible({ timeout: 15000 });
  }

  async gotoBookings() {
    await this.page.goto('http://localhost:3000/bookings', { waitUntil: 'domcontentloaded' });
    await expect(this.bookingsHeading).toBeVisible({ timeout: 15000 });
  }

  async gotoTeam() {
    await this.page.goto('http://localhost:3000/team', { waitUntil: 'domcontentloaded' });
    await expect(this.teamHeading).toBeVisible({ timeout: 15000 });
  }

  async gotoVenues() {
    await this.page.goto('http://localhost:3000/venues', { waitUntil: 'domcontentloaded' });
    await expect(this.page.getByRole('heading', { name: /Venues & Businesses/i })).toBeVisible({ timeout: 15000 });
  }

  async gotoResources() {
    await this.page.goto('http://localhost:3000/resources', { waitUntil: 'domcontentloaded' });
    await expect(this.page.getByRole('heading', { name: /Doctors & Service Units/i })).toBeVisible({ timeout: 15000 });
  }

  // Bookings Queue Actions
  async filterByStatus(status: 'ALL' | 'HELD' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED') {
    const pill = this.page.getByRole('button', { name: new RegExp(`^${status}$`, 'i') });
    await expect(pill).toBeVisible();
    await pill.click();
  }

  async searchBookings(query: string) {
    await expect(this.customerSearchInput).toBeVisible();
    await this.customerSearchInput.fill(query);
  }

  async clearSearch() {
    await expect(this.customerSearchInput).toBeVisible();
    await this.customerSearchInput.fill('');
  }

  getBookingCard(identifier: string): Locator {
    return this.page.locator('.divide-y > div').filter({ hasText: identifier }).first();
  }

  async expectBookingInQueue(identifier: string, expectedStatus?: string) {
    const card = this.getBookingCard(identifier);
    await expect(card).toBeVisible({ timeout: 10000 });
    if (expectedStatus) {
      await expect(card.getByText(expectedStatus).first()).toBeVisible();
    }
  }

  async markBookingCompleted(identifier: string) {
    const card = this.getBookingCard(identifier);
    await expect(card).toBeVisible();
    const completeBtn = card.getByRole('button', { name: /Complete/i });
    await expect(completeBtn).toBeVisible();
    await completeBtn.click();
    await expect(completeBtn).not.toBeVisible({ timeout: 10000 });
    await expect(card.getByText('COMPLETED')).toBeVisible({ timeout: 10000 });
  }

  async markBookingNoShow(identifier: string) {
    const card = this.getBookingCard(identifier);
    await expect(card).toBeVisible();
    const noShowBtn = card.getByRole('button', { name: /No-Show/i });
    await expect(noShowBtn).toBeVisible();
    await noShowBtn.click();
    await expect(noShowBtn).not.toBeVisible({ timeout: 10000 });
    await expect(card.getByText(/NO SHOW|NO_SHOW/i)).toBeVisible({ timeout: 10000 });
  }

  async cancelAndRefundBooking(identifier: string) {
    const card = this.getBookingCard(identifier);
    await expect(card).toBeVisible();
    const cancelBtn = card.getByRole('button', { name: /Cancel & Refund/i });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();
    await expect(cancelBtn).not.toBeVisible({ timeout: 10000 });
    await expect(card.getByText('CANCELLED')).toBeVisible({ timeout: 10000 });
  }

  async openNotificationModal(identifier: string) {
    const card = this.getBookingCard(identifier);
    await expect(card).toBeVisible();
    const logsBtn = card.getByRole('button', { name: /WA\/SMS Logs/i });
    await expect(logsBtn).toBeVisible();
    await logsBtn.click();
    await expect(this.notificationModalHeading).toBeVisible({ timeout: 10000 });
  }

  async closeNotificationModal() {
    const modal = this.page.locator('.fixed.inset-0');
    const closeBtn = modal.getByRole('button', { name: 'Close', exact: true });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(this.notificationModalHeading).not.toBeVisible({ timeout: 10000 });
  }

  async verifyNotificationAuditLogs(minimumCount: number = 1) {
    await expect(this.notificationModalHeading).toBeVisible();
    const modal = this.page.locator('.fixed.inset-0');
    await expect(modal.getByText(/Loading delivery logs/i)).not.toBeVisible({ timeout: 10000 });
    const logCards = modal.locator('.p-3.rounded-xl');
    await expect(logCards.first()).toBeVisible({ timeout: 10000 });
    const count = await logCards.count();
    expect(count).toBeGreaterThanOrEqual(minimumCount);
  }

  // Team Provisioning Actions
  async provisionStaffMember(name: string, email: string, role: 'admin' | 'merchant', phone: string) {
    await expect(this.addStaffMemberBtn).toBeVisible();
    await this.addStaffMemberBtn.click();

    await expect(this.staffNameInput).toBeVisible();
    await this.staffNameInput.fill(name);
    await this.staffEmailInput.fill(email);
    await this.staffPasswordInput.fill('SecureStaffPass123!');
    await this.staffRoleSelect.selectOption(role);
    await this.staffPhoneInput.fill(phone);

    await expect(this.saveStaffBtn).toBeVisible();
    await this.saveStaffBtn.click();

    await expect(
      this.page.getByText(new RegExp(`Staff account created for ${name}`, 'i'))
    ).toBeVisible({ timeout: 15000 });
  }

  // Overview Diagnostics
  async runSystemDiagnostics() {
    await expect(this.diagnosticButton).toBeVisible();
    await this.diagnosticButton.click();
    await expect(this.diagnosticResultBanner).toBeVisible({ timeout: 10000 });
  }
}
