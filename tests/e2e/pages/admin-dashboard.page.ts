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
  readonly kpiMerchantFunnel: Locator;
  readonly kpiRolloutCoverage: Locator;
  readonly kpiDepositVolume: Locator;
  readonly kpiWaitlist: Locator;

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

  // Multi-Factor Authentication (Phase 3)
  readonly mfaCodeInput: Locator;
  readonly mfaSubmitBtn: Locator;
  readonly mfaQrCode: Locator;
  readonly mfaSecretKey: Locator;
  readonly mfaSkipBtn: Locator;
  readonly mfaStatusBadge: Locator;
  readonly mfaModal: Locator;

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
    this.kpiMerchantFunnel = page.getByText('Merchant Funnel', { exact: true });
    this.kpiRolloutCoverage = page.getByText('Rollout Coverage', { exact: true });
    this.kpiDepositVolume = page.getByText('Deposit Volume', { exact: true });
    this.kpiWaitlist = page.getByText('Expansion Waitlist', { exact: true });

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

    // MFA Locators
    this.mfaCodeInput = page.getByTestId('admin-mfa-code');
    this.mfaSubmitBtn = page.getByTestId('admin-mfa-submit');
    this.mfaQrCode = page.getByTestId('admin-mfa-qr');
    this.mfaSecretKey = page.getByTestId('admin-mfa-secret');
    this.mfaSkipBtn = page.getByTestId('admin-mfa-skip');
    this.mfaStatusBadge = page.getByTestId('admin-mfa-status-badge');
    this.mfaModal = page.getByTestId('admin-mfa-modal');

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
    if (this.page.url().includes('/admin/login')) {
      await this.loginAsAdmin();
    }
    await expect(this.pageHeading).toBeVisible({ timeout: 12000 });
  }

  async gotoLoginPage() {
    await this.page.goto('http://localhost:3000/admin/login');
    await expect(this.page.getByTestId('admin-login-email')).toBeVisible();
  }

  async loginAsAdmin(email = 'admin@appointments-tirupati.com', password = 'AdminSecure2026!') {
    await this.page.getByTestId('admin-login-email').fill(email);
    await this.page.getByTestId('admin-login-password').fill(password);
    await this.page.getByTestId('admin-login-submit').click();

    // In local dev/preview, if MFA stage is prompted, allow smooth skip or completion
    const skipBtn = this.page.getByTestId('admin-mfa-skip');
    try {
      await skipBtn.waitFor({ state: 'visible', timeout: 3000 });
      await skipBtn.click();
    } catch {
      // If no MFA skip prompt, user already proceeded directly
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
    await expect(this.page.getByText(/Merchant Blocked & Suspended/i)).toBeVisible({ timeout: 10000 });
  }

  async unblockMerchant(merchantName: string) {
    const row = this.merchantTable.locator('tr', { hasText: merchantName });
    await expect(row).toBeVisible({ timeout: 10000 });
    const unblockBtn = row.getByRole('button', { name: /Unblock Merchant/i });
    await expect(unblockBtn).toBeVisible({ timeout: 10000 });
    await unblockBtn.click();
    await expect(this.page.getByText(/Merchant Activated & Visible/i)).toBeVisible({ timeout: 10000 });
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
}
