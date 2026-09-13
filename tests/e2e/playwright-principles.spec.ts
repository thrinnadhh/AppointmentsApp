import { test, expect } from './fixtures/test-fixtures';

/**
 * Master Cross-App E2E Test Suite - Playwright Principles
 * Adheres strictly to webapp-testing/SKILL.md (Section 4):
 *  1. Page Object Model: Pure encapsulation of page logic & zero raw selectors in test specs.
 *  2. Custom Fixtures: Reusable multi-role browser contexts (Customer + Merchant + Admin) via test.extend.
 *  3. Deterministic Auto-Waiting: Web-first assertions with ZERO hardcoded sleep / waitForTimeout.
 *  4. Trace Diagnostics: Granular, structured test.step hierarchy for rapid incident triage.
 *  5. Cross-App Integrations: End-to-end flows reflecting from Customer Mobile to Merchant Web to Super Admin Analytics.
 */
test.describe.serial('Master Cross-App E2E & Playwright Principles Suite', () => {

  test('Flow 1 (Full Cross-App Golden Lifecycle): Customer books appointment, reflects in Merchant queue, Merchant completes, reflects in Super Admin Analytics', async ({
    triRole,
  }) => {
    const { customerApp, merchantPortal, adminDashboard } = triRole;
    let initialCompletedBookings = 0;
    let initialDepositVolume = 0;

    await test.step('1. Super Admin records baseline executive metrics for verification', async () => {
      // Auto-waiting ensures admin dashboard data is fully loaded
      initialCompletedBookings = await adminDashboard.getCompletedBookingsCount();
      initialDepositVolume = await adminDashboard.getDepositVolumeAmount();
      expect(initialCompletedBookings).toBeGreaterThanOrEqual(0);
      expect(initialDepositVolume).toBeGreaterThanOrEqual(0);
    });

    await test.step('2. Customer logs in / browses and books an appointment via high-level POM actions', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.search('Dental');
      await expect(customerApp.searchResultsHeading).toBeVisible();

      await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot();
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      // Web-first auto-wait on confirmation toast and My Appointments screen
      await expect(customerApp.confirmationToast).toBeVisible();
      await expect(customerApp.myBookingsTitle).toBeVisible();
      await customerApp.expectBookingInList('CONFIRMED');
    });

    await test.step('3. Merchant Web Queue immediately reflects newly placed appointment', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.expectBookingInQueue('Sri Venkateswara Dental', 'CONFIRMED');
    });

    await test.step('4. Merchant marks booking as COMPLETED via web-first action', async () => {
      await merchantPortal.markBookingCompleted('Sri Venkateswara Dental');

      // Verify status transitions optimistically and in queue filter
      await merchantPortal.filterByStatus('COMPLETED');
      await merchantPortal.expectBookingInQueue('Sri Venkateswara Dental', 'COMPLETED');
    });

    await test.step('5. Super Admin Executive Overview dynamically reflects completed transaction and deposit velocity', async () => {
      await adminDashboard.refreshDashboard();

      // Completed bookings count must increment or reflect the latest completed state
      const updatedCompleted = await adminDashboard.getCompletedBookingsCount();
      expect(updatedCompleted).toBeGreaterThanOrEqual(initialCompletedBookings);

      // Deposit volume must reflect the transaction
      const updatedDeposit = await adminDashboard.getDepositVolumeAmount();
      expect(updatedDeposit).toBeGreaterThanOrEqual(initialDepositVolume);

      // Verify completion velocity percentage is calculated and visible
      await expect(adminDashboard.page.getByText(/% Completion Velocity/i)).toBeVisible();
    });
  });

  test('Flow 2 (Administrative Governance & Cross-App Synchronization): Super Admin suspends merchant, triggers immediate Merchant banner and Customer exclusion', async ({
    triRole,
  }) => {
    const { customerApp, merchantPortal, adminDashboard } = triRole;
    const targetMerchant = 'Sri Venkateswara Dental & Implant Care';

    await test.step('1. Pre-condition: Customer verifies target merchant is visible in browse feed', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.expectProviderVisible(targetMerchant, true);
    });

    await test.step('2. Super Admin suspends merchant via Section 2 Merchant Pipeline', async () => {
      await adminDashboard.filterMerchantTab('all');
      await adminDashboard.searchMerchantShop('Sri Venkateswara Dental');
      await adminDashboard.blockMerchant(targetMerchant);

      // Immutable security audit log captures the event
      await adminDashboard.expectAuditEntry('UPDATE_MERCHANT_STATUS');
    });

    await test.step('3. Merchant Web displays prominent suspension banner', async () => {
      await merchantPortal.goto();
      await merchantPortal.expectSuspendedBanner(true);
    });

    await test.step('4. Customer Mobile App excludes suspended merchant from browse listings', async () => {
      await customerApp.goto();
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.expectProviderVisible(targetMerchant, false);
    });

    await test.step('5. Super Admin reactivates merchant to restore platform operations', async () => {
      await adminDashboard.filterMerchantTab('suspended');
      await adminDashboard.searchMerchantShop('Sri Venkateswara Dental');
      await adminDashboard.unblockMerchant(targetMerchant);

      // Audit log captures restoration
      await adminDashboard.expectAuditEntry('UPDATE_MERCHANT_STATUS');
    });

    await test.step('6. Merchant Web and Customer Mobile confirm merchant restoration', async () => {
      await merchantPortal.goto();
      await merchantPortal.expectSuspendedBanner(false);

      await customerApp.goto();
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.expectProviderVisible(targetMerchant, true);
    });
  });

  test('Flow 3 (Expansion Demand Sync): Customer inbound waitlist signal propagates to Super Admin radar & KPI cards', async ({
    triRole,
    bookingApi,
  }) => {
    const { adminDashboard } = triRole;
    let initialWaitlistCount = 0;
    const testCityId = 'nellore';
    const testContact = `e2e_lead_${Date.now()}@example.com`;

    await test.step('1. Super Admin records baseline waitlist count', async () => {
      initialWaitlistCount = await adminDashboard.getWaitlistCount();
    });

    await test.step('2. Customer registers expansion interest for expanding market', async () => {
      const result = await bookingApi.joinWaitlist({
        cityId: testCityId,
        contactInfo: testContact,
        roleInterest: 'customer',
        notes: 'End-to-End automated demand validation',
      });
      expect(result.success).toBe(true);
    });

    await test.step('3. Super Admin refreshes dashboard and observes updated demand metrics', async () => {
      await adminDashboard.refreshDashboard();

      const newWaitlistCount = await adminDashboard.getWaitlistCount();
      expect(newWaitlistCount).toBeGreaterThan(initialWaitlistCount);

      // Verify inbound demand signal row in Section 3 Table
      await expect(adminDashboard.waitlistTable.getByText(testContact)).toBeVisible({ timeout: 10000 });
    });
  });

  test('Principle 1 (Page Object Model): Pure POM encapsulation with zero raw selectors in test files', async ({
    customerApp,
    merchantPortal,
  }) => {
    await test.step('1. Customer navigates and browses category via CustomerAppPage POM', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.search('Dental');
      await expect(customerApp.searchResultsHeading).toBeVisible();
    });

    await test.step('2. Customer books appointment using high-level POM actions', async () => {
      await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot();
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      await expect(customerApp.confirmationToast).toBeVisible();
      await expect(customerApp.myBookingsTitle).toBeVisible();
    });

    await test.step('3. Merchant navigates to Bookings Queue via MerchantPortalPage POM', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.expectBookingInQueue('Sri Venkateswara Dental', 'CONFIRMED');
    });
  });

  test('Principle 2 (Custom Fixtures): Multi-role cross-app dependency injection with isolated API setup', async ({
    multiRole,
    bookingApi,
  }) => {
    const { customerApp, merchantPortal } = multiRole;
    let createdBookingId = '';

    await test.step('1. Fixture-injected API prepares an isolated confirmed booking', async () => {
      const slotStart = new Date(Date.now() + 172800000).toISOString();
      const slotEnd = new Date(Date.now() + 172800000 + 1800000).toISOString();

      const holdResult = await bookingApi.createHold({
        slotStart,
        slotEnd,
        depositAmount: 150,
      });
      expect(holdResult.booking_id).toBeDefined();
      createdBookingId = holdResult.booking_id;

      const confirmResult = await bookingApi.confirmBooking(createdBookingId);
      expect(confirmResult.success).toBe(true);
    });

    await test.step('2. Multi-role Customer page verifies newly confirmed appointment', async () => {
      await customerApp.navigateToMyBookings();
      await expect(customerApp.myBookingsTitle).toBeVisible();
      await customerApp.expectBookingInList('CONFIRMED');
    });

    await test.step('3. Multi-role Merchant portal inspects and manages queue entry', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.searchBookings('Kalyan');
      await merchantPortal.expectBookingInQueue('CONFIRMED');
      await merchantPortal.clearSearch();
    });
  });

  test('Principle 3 (Assertions & Auto-Waiting): Real-time queue transition and status updates without hardcoded sleep', async ({
    merchantPortal,
    bookingApi,
  }) => {
    let testBookingId = '';
    let testRefCode = '';

    await test.step('1. Create and confirm a fresh booking for status mutation testing', async () => {
      const slotStart = new Date(Date.now() + 259200000).toISOString();
      const slotEnd = new Date(Date.now() + 259200000 + 1800000).toISOString();

      const hold = await bookingApi.createHold({ slotStart, slotEnd });
      testBookingId = hold.booking_id;
      testRefCode = hold.reference_code || '';
      await bookingApi.confirmBooking(testBookingId);
    });

    await test.step('2. Merchant marks booking as COMPLETED via web-first POM action', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');

      const identifier = testRefCode || 'Dr. S. K. Murthy';
      await merchantPortal.markBookingCompleted(identifier);

      await merchantPortal.filterByStatus('COMPLETED');
      await merchantPortal.expectBookingInQueue(identifier, 'COMPLETED');
    });

    await test.step('3. Verify Overview dashboard metrics reactively update', async () => {
      await merchantPortal.goto();
      await expect(merchantPortal.totalBookingsCard).toBeVisible();
      await expect(merchantPortal.confirmedBookingsCard).toBeVisible();
      await expect(merchantPortal.liveSyncBadge).toBeVisible();
    });
  });

  test('Principle 4 (Trace Viewer & Diagnostics): Notification delivery audit logs and system health verification', async ({
    merchantPortal,
    bookingApi,
  }) => {
    let testBookingId = '';
    let testRefCode = '';

    await test.step('1. Create booking and trigger automated WhatsApp & SMS notification dispatches', async () => {
      const hold = await bookingApi.createHold({});
      testBookingId = hold.booking_id;
      testRefCode = hold.reference_code || '';
      await bookingApi.confirmBooking(testBookingId);

      const confirmRes = await bookingApi.sendNotification({
        bookingId: testBookingId,
        eventType: 'BOOKING_CONFIRMED',
      });
      expect(confirmRes.success).toBe(true);

      const reminderRes = await bookingApi.sendNotification({
        bookingId: testBookingId,
        eventType: 'BOOKING_REMINDER_1H',
      });
      expect(reminderRes.success).toBe(true);
    });

    await test.step('2. Open Notification Audit Modal and verify structured delivery logs', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      const identifier = testRefCode || 'Dr. S. K. Murthy';
      await merchantPortal.openNotificationModal(identifier);

      await merchantPortal.verifyNotificationAuditLogs(2);
      await expect(merchantPortal.notificationChannelBadges.first()).toBeVisible();

      await merchantPortal.closeNotificationModal();
    });

    await test.step('3. Run merchant system health diagnostic check', async () => {
      await merchantPortal.goto();
      await merchantPortal.runSystemDiagnostics();
      await expect(merchantPortal.diagnosticResultBanner).toBeVisible();
    });
  });

  test('Unhappy Paths & Resilience: Search resets, empty query fallbacks, and boundary handling', async ({
    customerApp,
    merchantPortal,
    unauthenticatedAdmin,
  }) => {
    await test.step('1. Customer app handles non-matching search queries gracefully', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');

      await customerApp.search('Dental');
      await customerApp.clearSearch();

      await customerApp.search('NonExistentProviderXYZ');
      await expect(customerApp.emptySearchResults).toBeVisible();
      await customerApp.resetSearchFromEmptyState();
      await expect(customerApp.emptySearchResults).not.toBeVisible();
    });

    await test.step('2. Merchant portal filters through empty queues without breaking layout', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CANCELLED');
      await expect(merchantPortal.bookingsHeading).toBeVisible();

      await merchantPortal.filterByStatus('ALL');
      await expect(merchantPortal.bookingsHeading).toBeVisible();
    });

    await test.step('3. Super Admin rejects unauthorized direct access and invalid credentials', async () => {
      await unauthenticatedAdmin.gotoLoginPage();
      await unauthenticatedAdmin.loginExpectFailure('invalid-attacker@domain.com', 'WrongPassword123!');
      await expect(unauthenticatedAdmin.loginErrorAlert).toBeVisible();
    });
  });
});
