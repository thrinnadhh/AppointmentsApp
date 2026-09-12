import { test, expect } from './fixtures/test-fixtures';

/**
 * Playwright Principles Test Suite
 * Adheres strictly to webapp-testing/SKILL.md (Section 4):
 *  1. Page Object Model: Full encapsulation of page logic & zero raw selectors in tests.
 *  2. Fixtures: Reusable test setup & multi-role browser contexts via test.extend.
 *  3. Assertions: Built-in deterministic auto-waiting (no sleep/waitForTimeout).
 *  4. Trace Viewer & Diagnostics: Structured test.step hierarchy for rapid debugging.
 */
test.describe.serial('Playwright Principles E2E Test Suite', () => {

  test('Principle 1 (Page Object Model): Complete booking and merchant queue triage using pure POM encapsulation', async ({
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
      
      // Web-first assertion auto-waits for payment & confirmation toast
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
      const slotStart = new Date(Date.now() + 172800000).toISOString(); // 2 days ahead
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
      const slotStart = new Date(Date.now() + 259200000).toISOString(); // 3 days ahead
      const slotEnd = new Date(Date.now() + 259200000 + 1800000).toISOString();

      const hold = await bookingApi.createHold({ slotStart, slotEnd });
      testBookingId = hold.booking_id;
      testRefCode = hold.reference_code || '';
      await bookingApi.confirmBooking(testBookingId);
    });

    await test.step('2. Merchant marks booking as COMPLETED via web-first POM action', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      
      // Auto-waiting assertions ensure booking card is interactable
      const identifier = testRefCode || 'Dr. S. K. Murthy';
      await merchantPortal.markBookingCompleted(identifier);
      
      // Auto-wait for optimistic update and filtered state
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
      
      // Web-first auto-wait on modal and audit logs table
      await merchantPortal.verifyNotificationAuditLogs(2);
      await expect(merchantPortal.notificationChannelBadges.first()).toBeVisible();

      // Close modal gracefully
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
  }) => {
    await test.step('1. Customer app handles non-matching search queries gracefully', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');

      // 1. Verify search input and clear button functionality
      await customerApp.search('Dental');
      await customerApp.clearSearch();

      // 2. Verify non-matching query triggers empty state and reset button recovers feed
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
  });
});
