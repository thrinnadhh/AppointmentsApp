import { Page, Locator, expect } from '@playwright/test';

/**
 * AdminDashboardPage - Page Object Model encapsulating the Next.js 15
 * Super Admin Multi-City Rollout & Merchant Pipeline Dashboard on port 3000.
 * Conforms strictly to Playwright POM principles in webapp-testing/SKILL.md (Section 4).
 */
export class AdminDashboardPage {
  readonly page: Page;

  // Header Locators
  readonly pageHeading: Locator;
  readonly refreshBtn: Locator;
  readonly expandNewCityBtn: Locator;

  // Time Window Filters
  readonly timeWindowToday: Locator;
  readonly timeWindow3Days: Locator;
  readonly timeWindowWeek: Locator;
  readonly timeWindowMonth: Locator;
  readonly timeWindowAllTime: Locator;
  readonly cityScopeSelect: Locator;

  // Top KPI Metric Cards
  readonly kpiCompletedBookings: Locator;
  readonly kpiCompletedValue: Locator;
  readonly kpiMerchantFunnel: Locator;
  readonly kpiRolloutCoverage: Locator;
  readonly kpiDepositVolume: Locator;
  readonly kpiDepositValue: Locator;
  readonly kpiWaitlist: Locator;
  readonly kpiWaitlistValue: Locator;

  // Territory Control Matrix
  readonly territoryMatrixHeading: Locator;
  readonly territorySearchInput: Locator;
  readonly territoryTable: Locator;

  // Merchant Pipeline Funnel
  readonly merchantFunnelHeading: Locator;
  readonly merchantTabAll: Locator;
  readonly merchantTabPending: Locator;
  readonly merchantTabActive: Locator;
  readonly merchantTabSuspended: Locator;
  readonly merchantSearchInput: Locator;
  readonly merchantTypeFilterSelect: Locator;
  readonly merchantCityFilterSelect: Locator;
  readonly merchantTable: Locator;

  // Demand Waitlist
  readonly waitlistHeading: Locator;
  readonly waitlistTable: Locator;

  // Audit Trail & Security Ledger
  readonly auditSection: Locator;
  readonly auditHeading: Locator;
  readonly auditSearchInput: Locator;
  readonly auditTable: Locator;
  readonly auditRows: Locator;

  // Authentication & Security Locators (Phase 1 & 3)
  readonly loginEmailInput: Locator;
  readonly loginPasswordInput: Locator;
  readonly loginSubmitBtn: Locator;
  readonly loginErrorAlert: Locator;
  readonly loginSuccessAlert: Locator;
  readonly identityBadge: Locator;
  readonly logoutBtn: Locator;

  // Multi-Factor Authentication (Phase 3)
  readonly mfaCodeInput: Locator;
  readonly mfaSubmitBtn: Locator;
  readonly mfaQrCode: Locator;
  readonly mfaSecretKey: Locator;
  readonly mfaSkipBtn: Locator;
  readonly mfaStatusBadge: Locator;
  readonly mfaModal: Locator;
  readonly mfaModalHeading: Locator;
  readonly mfaCloseBtn: Locator;

  // Add City Modal Locators
  readonly addCityModal: Locator;
  readonly cityIdInput: Locator;
  readonly cityNameInput: Locator;
  readonly cityLatInput: Locator;
  readonly cityLngInput: Locator;
  readonly cityRadiusInput: Locator;
  readonly cityTargetInput: Locator;
  readonly cityStatusSelect: Locator;
  readonly submitCityBtn: Locator;
  readonly cancelCityBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    // Header
    this.pageHeading = page.getByRole('heading', { name: /Super Admin City Rollout & Expansion Hub/i });
    this.refreshBtn = page.getByRole('button', { name: /Refresh/i });
    this.expandNewCityBtn = page.getByRole('button', { name: /Expand New City/i });

    // Time Horizons
    this.timeWindowToday = page.getByRole('button', { name: 'Today', exact: true });
    this.timeWindow3Days = page.getByRole('button', { name: 'Last 3 Days', exact: true });
    this.timeWindowWeek = page.getByRole('button', { name: 'Last Week', exact: true });
    this.timeWindowMonth = page.getByRole('button', { name: 'Last 30 Days', exact: true });
    this.timeWindowAllTime = page.getByRole('button', { name: 'All Time', exact: true });
    this.cityScopeSelect = page.locator('select').first();

    // Top KPIs
    this.kpiCompletedBookings = page.getByText('Completed Bookings', { exact: true });
    this.kpiCompletedValue = page.getByTestId('admin-kpi-completed-value');
    this.kpiMerchantFunnel = page.getByText('Merchant Funnel', { exact: true });
    this.kpiRolloutCoverage = page.getByText('Rollout Coverage', { exact: true });
    this.kpiDepositVolume = page.getByText('Deposit Volume', { exact: true });
    this.kpiDepositValue = page.getByTestId('admin-kpi-deposit-value');
    this.kpiWaitlist = page.getByText('Expansion Waitlist', { exact: true });
    this.kpiWaitlistValue = page.getByTestId('admin-kpi-waitlist-value');

    // Section 1: Territory Matrix
    this.territoryMatrixHeading = page.getByRole('heading', { name: /City Expansion & Territory Control Matrix/i });
    this.territorySearchInput = page.getByPlaceholder('Filter cities...');
    this.territoryTable = page.locator('table').first();

    // Section 2: Merchant Pipeline
    this.merchantFunnelHeading = page.getByRole('heading', { name: /Merchant Onboarding Pipeline/i });
    this.merchantTabAll = page.getByTestId('admin-merchant-status-tab-all');
    this.merchantTabPending = page.getByTestId('admin-merchant-status-tab-pending');
    this.merchantTabActive = page.getByTestId('admin-merchant-status-tab-active');
    this.merchantTabSuspended = page.getByTestId('admin-merchant-status-tab-suspended');
    this.merchantSearchInput = page.getByTestId('admin-merchant-search');
    this.merchantTypeFilterSelect = page.getByTestId('admin-merchant-type-filter');
    this.merchantCityFilterSelect = page.getByTestId('admin-merchant-city-filter');
    this.merchantTable = page.locator('table').nth(1);

    // Section 3: Demand Waitlist
    this.waitlistHeading = page.getByRole('heading', { name: /Pre-Launch Expansion Waitlist & Demand Signals/i });
    this.waitlistTable = page.locator('table').nth(2);

    // Section 4: Audit Trail & Security Ledger
    this.auditSection = page.getByTestId('admin-audit-section');
    this.auditHeading = page.getByRole('heading', { name: /Administrative Audit Trail & Security Ledger/i });
    this.auditSearchInput = page.getByTestId('audit-search-input');
    this.auditTable = page.locator('table').nth(3);
    this.auditRows = page.getByTestId('audit-log-rows');

    // Authentication & Security Locators (Phase 1 & 3)
    this.loginEmailInput = page.getByTestId('admin-login-email');
    this.loginPasswordInput = page.getByTestId('admin-login-password');
    this.loginSubmitBtn = page.getByTestId('admin-login-submit');
    this.loginErrorAlert = page.getByTestId('admin-login-error');
    this.loginSuccessAlert = page.getByTestId('admin-login-success');
    this.identityBadge = page.getByTestId('admin-identity-badge');
    this.logoutBtn = page.getByTestId('admin-logout-btn');

    // MFA Locators
    this.mfaCodeInput = page.getByTestId('admin-mfa-code');
    this.mfaSubmitBtn = page.getByTestId('admin-mfa-submit');
    this.mfaQrCode = page.getByTestId('admin-mfa-qr');
    this.mfaSecretKey = page.getByTestId('admin-mfa-secret');
    this.mfaSkipBtn = page.getByTestId('admin-mfa-skip');
    this.mfaStatusBadge = page.getByTestId('admin-mfa-status-badge');
    this.mfaModal = page.getByTestId('admin-mfa-modal');
    this.mfaModalHeading = page.getByRole('heading', { name: /Two-Factor Authentication & Device Security/i });
    this.mfaCloseBtn = page.getByRole('button', { name: /Close Window/i });

    // Modal
    this.addCityModal = page.locator('text=Expand to New Territory').locator('..');
    this.cityIdInput = page.getByPlaceholder(/e\.g\. nellore, kadapa/i);
    this.cityNameInput = page.getByPlaceholder('e.g. Nellore');
    this.cityLatInput = page.locator('input[type="number"][step="any"]').first();
    this.cityLngInput = page.locator('input[type="number"][step="any"]').nth(1);
    this.cityRadiusInput = page.locator('input[type="number"]').nth(2);
    this.cityTargetInput = page.locator('input[type="number"]').nth(3);
    this.cityStatusSelect = page.locator('form select');
    this.submitCityBtn = page.getByRole('button', { name: /Add City to Radar/i });
    this.cancelCityBtn = page.getByRole('button', { name: /Cancel/i });
  }

  async goto() {
    await this.page.goto('http://localhost:3000/admin');
    const isLogin = await Promise.race([
      this.page.waitForURL(/\/admin\/login/, { timeout: 4000 }).then(() => true).catch(() => false),
      this.pageHeading.waitFor({ state: 'visible', timeout: 4000 }).then(() => false).catch(() => false),
    ]);

    if (isLogin || this.page.url().includes('/admin/login')) {
      await this.loginAsAdmin();
    }
    await expect(this.pageHeading).toBeVisible({ timeout: 15000 });
  }

  async gotoLoginPage() {
    await this.page.goto('http://localhost:3000/admin/login');
    await expect(this.page.getByTestId('admin-login-email')).toBeVisible();
  }

  async loginAsAdmin(
    email = process.env.TEST_ADMIN_EMAIL || 'admin@appointments-tirupati.com',
    password = process.env.TEST_ADMIN_PASSWORD || ''
  ) {
    await expect(this.page.getByTestId('admin-login-email')).toBeVisible({ timeout: 10000 });
    await this.page.getByTestId('admin-login-email').fill(email);
    await this.page.getByTestId('admin-login-password').fill(password);
    await this.page.getByTestId('admin-login-submit').click();

    // In local dev/preview, if MFA stage is prompted, allow smooth skip or completion
    const skipBtn = this.page.getByTestId('admin-mfa-skip');
    const outcome = await Promise.race([
      skipBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'mfa' as const).catch(() => null),
      this.pageHeading.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'heading' as const).catch(() => null),
    ]);

    if (outcome === 'mfa') {
      await skipBtn.click();
    }

    await expect(this.pageHeading).toBeVisible({ timeout: 15000 });
  }

  async submitCredentials(email: string, password: string) {
    await this.page.getByTestId('admin-login-email').fill(email);
    await this.page.getByTestId('admin-login-password').fill(password);
    await this.page.getByTestId('admin-login-submit').click();
  }

  async enterMfaCode(code: string) {
    await expect(this.mfaCodeInput).toBeVisible({ timeout: 6000 });
    await this.mfaCodeInput.fill(code);
    await this.mfaSubmitBtn.click();
  }

  async loginExpectFailure(email: string, password: string) {
    await this.page.getByTestId('admin-login-email').fill(email);
    await this.page.getByTestId('admin-login-password').fill(password);
    await this.page.getByTestId('admin-login-submit').click();
    await expect(this.page.getByTestId('admin-login-error')).toBeVisible({ timeout: 10000 });
  }

  async signOutAdmin() {
    await expect(this.logoutBtn).toBeVisible({ timeout: 6000 });
    await this.logoutBtn.click();
    await expect(this.loginEmailInput).toBeVisible({ timeout: 8000 });
  }

  async openMfaModal() {
    await expect(this.mfaStatusBadge).toBeVisible({ timeout: 6000 });
    await this.mfaStatusBadge.click();
    await expect(this.mfaModal).toBeVisible({ timeout: 6000 });
    await expect(this.mfaModalHeading).toBeVisible();
  }

  async closeMfaModal() {
    await expect(this.mfaCloseBtn).toBeVisible({ timeout: 6000 });
    await this.mfaCloseBtn.click();
    await expect(this.mfaModal).not.toBeVisible({ timeout: 6000 });
  }

  async filterAuditSearch(query: string) {
    await expect(this.auditSearchInput).toBeVisible({ timeout: 6000 });
    await this.auditSearchInput.fill(query);
  }


  async selectTimeHorizon(horizon: 'today' | '3days' | '7days' | '30days' | 'all') {
    switch (horizon) {
      case 'today':
        await this.timeWindowToday.click();
        break;
      case '3days':
        await this.timeWindow3Days.click();
        break;
      case '7days':
        await this.timeWindowWeek.click();
        break;
      case '30days':
        await this.timeWindowMonth.click();
        break;
      case 'all':
        await this.timeWindowAllTime.click();
        break;
    }
    // Auto-waits for re-render
    await expect(this.pageHeading).toBeVisible();
  }

  async filterTerritorySearch(query: string) {
    await this.territorySearchInput.fill(query);
  }

  async expectCityInMatrix(cityName: string, statusText?: string) {
    const row = this.territoryTable.locator('tr', { hasText: cityName });
    await expect(row).toBeVisible();
    if (statusText) {
      if (statusText === 'ACTIVE') {
        await expect(row.getByText('ACTIVE (LIVE)')).toBeVisible();
      } else if (statusText === 'EXPANDING') {
        await expect(row.getByText(/EXPANDING/i).first()).toBeVisible();
      } else if (statusText === 'PLANNED') {
        await expect(row.getByText(/PLANNED/i).first()).toBeVisible();
      } else {
        await expect(row.getByText(new RegExp(statusText, 'i')).first()).toBeVisible();
      }
    }
  }

  async clickCityAction(cityName: string, actionButtonText: 'Launch Active' | 'Start Expansion' | 'Pause' | 'Resume') {
    const row = this.territoryTable.locator('tr', { hasText: cityName });
    const actionBtn = row.getByRole('button', { name: new RegExp(actionButtonText, 'i') });
    await expect(actionBtn).toBeVisible();
    await actionBtn.click();
  }

  async searchMerchantShop(query: string) {
    await expect(this.merchantSearchInput).toBeVisible();
    await this.merchantSearchInput.fill(query);
  }

  async filterMerchantType(type: string) {
    await expect(this.merchantTypeFilterSelect).toBeVisible();
    await this.merchantTypeFilterSelect.selectOption(type);
  }

  async filterMerchantCity(city: string) {
    await expect(this.merchantCityFilterSelect).toBeVisible();
    await this.merchantCityFilterSelect.selectOption(city);
  }

  async filterMerchantTab(tab: 'all' | 'pending' | 'active' | 'suspended') {
    if (tab === 'pending') {
      await this.merchantTabPending.click();
    } else if (tab === 'active') {
      await this.merchantTabActive.click();
    } else if (tab === 'suspended') {
      await this.merchantTabSuspended.click();
    } else {
      await this.merchantTabAll.click();
    }
  }

  async expectMerchantInPipeline(merchantName: string, statusText?: string) {
    const row = this.merchantTable.locator('tr', { hasText: merchantName });
    await expect(row).toBeVisible({ timeout: 10000 });
    if (statusText) {
      const escaped = statusText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(row.getByText(new RegExp(escaped, 'i'))).toBeVisible({ timeout: 10000 });
    }
  }

  async expectMerchantStatus(merchantName: string, statusText: string) {
    await this.expectMerchantInPipeline(merchantName, statusText);
  }

  async expectMerchantVisible(merchantName: string, shouldBeVisible: boolean = true) {
    const row = this.merchantTable.locator('tr', { hasText: merchantName });
    if (shouldBeVisible) {
      await expect(row).toBeVisible({ timeout: 10000 });
    } else {
      await expect(row).not.toBeVisible({ timeout: 10000 });
    }
  }

  async blockMerchant(merchantName: string) {
    const row = this.merchantTable.locator('tr', { hasText: merchantName });
    await expect(row).toBeVisible({ timeout: 10000 });
    const blockBtn = row.getByRole('button', { name: /Block Merchant/i });
    await expect(blockBtn).toBeVisible({ timeout: 10000 });
    await blockBtn.click();

    const feedbackOrStatus = this.page
      .getByText(/Merchant Blocked & Suspended/i)
      .or(row.getByText(/BLOCKED \/ SUSPENDED/i));
    const succeeded = await feedbackOrStatus
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    if (!succeeded && (await blockBtn.isVisible().catch(() => false))) {
      await blockBtn.click();
    }
    await expect(feedbackOrStatus).toBeVisible({ timeout: 10000 });
  }

  async unblockMerchant(merchantName: string) {
    const row = this.merchantTable.locator('tr', { hasText: merchantName });
    await expect(row).toBeVisible({ timeout: 10000 });
    const unblockBtn = row.getByRole('button', { name: /Unblock Merchant/i });
    await expect(unblockBtn).toBeVisible({ timeout: 10000 });
    await unblockBtn.click();

    const feedbackOrStatus = this.page
      .getByText(/Merchant Activated & Visible/i)
      .or(row.getByText(/ONBOARDED \(ACTIVE\)/i));
    const succeeded = await feedbackOrStatus
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    if (!succeeded && (await unblockBtn.isVisible().catch(() => false))) {
      await unblockBtn.click();
    }
    await expect(feedbackOrStatus).toBeVisible({ timeout: 10000 });
  }

  async approveMerchant(merchantName: string) {
    const row = this.merchantTable.locator('tr', { hasText: merchantName });
    const approveBtn = row.getByRole('button', { name: /Approve & Launch/i });
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();
  }

  async openAddCityModal() {
    await this.expandNewCityBtn.click();
    await expect(this.cityNameInput).toBeVisible();
  }

  async addNewCity(params: {
    id: string;
    name: string;
    lat?: string;
    lng?: string;
    target?: string;
    status?: 'ACTIVE' | 'EXPANDING' | 'PLANNED';
  }) {
    await this.openAddCityModal();
    await this.cityIdInput.fill(params.id);
    await this.cityNameInput.fill(params.name);
    if (params.lat) await this.cityLatInput.fill(params.lat);
    if (params.lng) await this.cityLngInput.fill(params.lng);
    if (params.target) await this.cityTargetInput.fill(params.target);
    if (params.status) await this.cityStatusSelect.selectOption(params.status);
    await this.submitCityBtn.click();
    await expect(this.page.getByText(new RegExp(`City ${params.name} added`, 'i'))).toBeVisible();
  }

  async getCompletedBookingsCount(): Promise<number> {
    await expect(this.kpiCompletedValue).toBeVisible({ timeout: 10000 });
    const text = await this.kpiCompletedValue.innerText();
    return parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
  }

  async getDepositVolumeAmount(): Promise<number> {
    await expect(this.kpiDepositValue).toBeVisible({ timeout: 10000 });
    const text = await this.kpiDepositValue.innerText();
    return parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
  }

  async getWaitlistCount(): Promise<number> {
    await expect(this.kpiWaitlistValue).toBeVisible({ timeout: 10000 });
    const text = await this.kpiWaitlistValue.innerText();
    return parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
  }

  async refreshDashboard() {
    const waitlistPromise = this.page.waitForResponse(
      (resp) => resp.url().includes('/api/admin/waitlist') && resp.status() === 200,
      { timeout: 15000 }
    ).catch(() => null);
    await this.refreshBtn.click();
    await waitlistPromise;
    await expect(this.refreshBtn).toBeEnabled({ timeout: 15000 });
    await expect(this.pageHeading).toBeVisible();
  }

  async expectAuditEntry(action: string) {
    await expect(this.auditSection).toBeVisible({ timeout: 10000 });
    const entry = this.auditTable.locator('tr', { hasText: action }).first();
    await expect(entry).toBeVisible({ timeout: 10000 });
  }
}
