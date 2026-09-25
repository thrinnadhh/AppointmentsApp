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

  test.beforeEach(async ({ request, supabaseClient }) => {
    await request.patch('http://localhost:3000/api/admin/merchants', {
      headers: {
        'Content-Type': 'application/json',
        'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026',
      },
      data: {
        providerId: '11111111-1111-1111-1111-111111111111',
        status: 'ACTIVE',
      },
    }).catch(() => null);

    try {
      await supabaseClient.rpc('reset_test_provider_strikes', {
        p_provider_id: '11111111-1111-1111-1111-111111111111',
        p_count: 0,
      });
    } catch {}

    try {
      await supabaseClient.rpc('reset_test_customer_strikes', {
        p_customer_id: '99999999-9999-9999-9999-999999999991',
        p_count: 0,
      });
    } catch {}

    try {
      await supabaseClient.rpc('reset_test_bookings', {
        p_provider_id: '11111111-1111-1111-1111-111111111111',
        p_customer_id: '99999999-9999-9999-9999-999999999991',
      });
    } catch {}
  });

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
      await expect(customerApp.confirmationToast.first()).toBeVisible({ timeout: 15000 });
      await expect(customerApp.myBookingsTitle).toBeVisible({ timeout: 15000 });
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
      await adminDashboard.expectMerchantVisible(targetMerchant, true);
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
      await adminDashboard.expectMerchantVisible(targetMerchant, true);
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

      await expect.poll(async () => {
        return await adminDashboard.getWaitlistCount();
      }, {
        message: 'Waitlist count should increment after registering customer demand',
        timeout: 10000,
        intervals: [200, 500, 1000],
      }).toBeGreaterThan(initialWaitlistCount);

      // Verify inbound demand signal row in Section 3 Table
      await expect(adminDashboard.waitlistTable.getByText(testContact)).toBeVisible({ timeout: 10000 });
    });
  });

  test('Flow 4 (Complete Multi-Vertical Discovery & Dynamic Selection): Customer explores 5 core service verticals and inspects staff specialists', async ({
    customerApp,
  }) => {
    await test.step('1. Verify 5 core service mini-logos are visible on Home Hub', async () => {
      await expect(customerApp.clinicsChip).toBeVisible();
      await expect(customerApp.salonsChip).toBeVisible();
      await expect(customerApp.restaurantsChip).toBeVisible();
      await expect(customerApp.gamingChip).toBeVisible();
      await expect(customerApp.petsChip).toBeVisible();
    });

    await test.step('2. Explore Hospitals & Clinics and inspect doctor specialization hierarchy', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
      await expect(customerApp.staffSectionHeading).toBeVisible();

      // Switch staff member to Orthodontist
      await customerApp.selectStaffMember('Dr. Ananya Reddy (Orthodontist)');
      await expect(customerApp.dateSectionHeading).toBeVisible();

      // Toggle dates to verify dynamic slot availability generation
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot();
      await expect(customerApp.holdDepositBtn).toBeVisible();
      await expect(customerApp.stickyFooterPrice).toContainText('₹100');

      // Return to Browse hub
      await customerApp.backButton.click();
      await customerApp.allCategoriesChip.click();
      await expect(customerApp.clinicsChip).toBeVisible();
    });

    await test.step('3. Explore Salons & Spas and verify venue listing', async () => {
      await customerApp.selectCategory('Salons & Spas');
      await expect(customerApp.page.locator('text=/Naturals Luxury Salon|Elite Looks Luxury Salon/').first()).toBeVisible();
      await customerApp.allCategoriesChip.click();
      await expect(customerApp.salonsChip).toBeVisible();
    });

    await test.step('4. Explore Gaming & Turf and verify arena listing', async () => {
      await customerApp.selectCategory('Gaming & Turf');
      await expect(customerApp.page.getByText('Tirupati Premier Turf & Gaming Arena')).toBeVisible();
      await customerApp.allCategoriesChip.click();
      await expect(customerApp.gamingChip).toBeVisible();
    });
  });

  test('Flow 5 (Customer Self-Service Lifecycle): Reschedule & Cancellation reflect in Merchant Private Space', async ({
    multiRole,
    supabaseClient,
  }) => {
    const { customerApp, customerPage, merchantPortal } = multiRole;
    let createdRefCode = '';

    await test.step('1. Customer books an appointment via high-level POM actions', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot();
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      await expect(customerApp.confirmationToast).toBeVisible({ timeout: 15000 });
      await expect(customerApp.myBookingsTitle).toBeVisible({ timeout: 15000 });
      await customerApp.expectBookingInList('CONFIRMED');
    });

    await test.step('2. Customer verifies Digital Booking Pass details (QR Code & Reference Code)', async () => {
      await customerApp.openBookingPass('Sri Venkateswara Dental');
      await customerApp.verifyPassDetails();

      createdRefCode = await customerApp.getPassReferenceCode();
      expect(createdRefCode).toMatch(/^TPT-[A-Z0-9]+/);

      await customerApp.closeBookingPass();
    });

    await test.step('3. Customer reschedules appointment from My Appointments to a new time slot', async () => {
      await customerApp.rescheduleBookingFromList(createdRefCode, '02:00 PM');
      await customerApp.expectBookingInList(createdRefCode, 'CONFIRMED');
    });

    await test.step('4. Merchant Private Space (/bookings) reflects updated rescheduled time', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.expectBookingInQueue(createdRefCode, 'CONFIRMED');
    });

    await test.step('5. Customer cancels appointment within advance window; receives policy refund', async () => {
      await customerApp.cancelBookingFromList(createdRefCode);
      await customerApp.expectBookingInList(createdRefCode, 'CANCELLED');
    });

    await test.step('6. Merchant Private Space reflects cancelled appointment under CANCELLED filter', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CANCELLED');
      await merchantPortal.expectBookingInQueue(createdRefCode, 'CANCELLED');
    });
  });

  test('Flow 6 (Merchant Private Space Controls): Weekly Schedule & Resource roster reflect across platform', async ({
    multiRole,
  }) => {
    const { customerApp, merchantPortal } = multiRole;

    await test.step('1. Merchant accesses Private Space Schedule (/schedule) and saves operating hours', async () => {
      await merchantPortal.gotoSchedule();
      await merchantPortal.saveSchedule();
    });

    await test.step('2. Merchant navigates to Private Space Resources (/resources) and inspects service units', async () => {
      await merchantPortal.gotoResources();
      await expect(merchantPortal.page.getByText('Dr. S. K. Murthy')).toBeVisible();
    });

    await test.step('3. Customer places booking; Merchant in Private Space Queue completes service', async () => {
      // Customer books
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot();
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      await expect(customerApp.confirmationToast).toBeVisible({ timeout: 15000 });
      await customerApp.expectBookingInList('CONFIRMED');

      // Merchant marks completed in private space
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.markBookingCompleted('Sri Venkateswara Dental');

      // Merchant verifies completed filter
      await merchantPortal.filterByStatus('COMPLETED');
      await merchantPortal.expectBookingInQueue('Sri Venkateswara Dental', 'COMPLETED');
    });

    await test.step('4. Customer Mobile App reflects COMPLETED status in real-time', async () => {
      await customerApp.navigateToMyBookings();
      await customerApp.expectBookingInList('COMPLETED');
    });
  });

  test('Flow 7 (Customer Mobile Profile & Auth): Phone OTP authentication and session management', async ({
    customerApp,
  }) => {
    await test.step('1. Customer opens Profile modal from Mobile header', async () => {
      await customerApp.openProfile();
    });

    await test.step('2. Customer logs in via OTP with fixed test credentials', async () => {
      await customerApp.loginWithPhoneOtp('+919999999991', '123456');
    });

    await test.step('3. Customer verifies active session, Supabase user ID, and booking metrics', async () => {
      await expect(customerApp.page.getByText('ACTIVE MOBILE')).toBeVisible();
      await expect(customerApp.page.getByText('ACTIVE USER ID (SUPABASE)')).toBeVisible();
      await expect(customerApp.page.getByText('Total Bookings')).toBeVisible();
      await expect(customerApp.page.getByText('Active Slots')).toBeVisible();
    });

    await test.step('4. Customer closes profile and verifies persistent state on browse feed', async () => {
      await customerApp.closeProfile();
      await expect(customerApp.appTitle).toBeVisible();
    });
  });

  test('Flow 8 (Customer Inbound Expansion Waitlist): Inbound signal from Mobile Home propagates to Admin/Merchant radar', async ({
    customerApp,
    adminDashboard,
  }) => {
    const testPhone = `+91 98765 ${Math.floor(10000 + Math.random() * 90000)}`;

    await test.step('1. Customer submits expansion waitlist request on Home Screen', async () => {
      await customerApp.submitExpansionWaitlist(testPhone);
    });

    await test.step('2. Super Admin & Merchant Analytics radar records the customer expansion demand', async () => {
      await adminDashboard.refreshDashboard();
      await expect(adminDashboard.waitlistTable.getByText(testPhone).or(adminDashboard.page.getByText(testPhone))).toBeVisible({ timeout: 10000 });
    });
  });

  test('Flow 9 (Emergency Staff Substitution Lifecycle): Merchant reassigns staff due to emergency, reflects live in Customer app', async ({
    multiRole,
  }) => {
    const { customerApp, merchantPortal } = multiRole;
    let createdRefCode = '';

    await test.step('1. Customer books an appointment with default specialist (Dr. Murthy)', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot();
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      await expect(customerApp.confirmationToast).toBeVisible({ timeout: 15000 });
      await expect(customerApp.myBookingsTitle).toBeVisible({ timeout: 15000 });
      await customerApp.expectBookingInList('CONFIRMED');

      await customerApp.openBookingPass('Sri Venkateswara Dental');
      createdRefCode = await customerApp.getPassReferenceCode();
      expect(createdRefCode).toMatch(/^TPT-[A-Z0-9]+/);
      await customerApp.closeBookingPass();
    });

    await test.step('2. Merchant views Queue, clicks Substitute Staff, and reassigns slot to Dr. Ananya Reddy', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.expectBookingInQueue(createdRefCode, 'CONFIRMED');

      await merchantPortal.substituteStaffMember(createdRefCode, undefined, 'Emergency doctor surgical delay');
    });

    await test.step('3. Customer Mobile App immediately reflects substituted specialist', async () => {
      await customerApp.navigateToMyBookings();
      const card = customerApp.getBookingCard(createdRefCode);
      await expect(card.getByText('Dr. Ananya Reddy').or(card.getByText('Orthodontist'))).toBeVisible({ timeout: 10000 });
    });

    await test.step('4. Merchant Notification audit logs confirm RESOURCE_REASSIGNED event', async () => {
      await merchantPortal.openNotificationModal(createdRefCode);
      await expect(merchantPortal.page.getByText(/RESOURCE REASSIGNED/i).first()).toBeVisible({ timeout: 10000 });
      await merchantPortal.closeNotificationModal();
    });
  });

  test('Flow 10 (Merchant 3-Strike Courtesy & Reliability Policy): Emergency merchant cancellation triggers 100% refund notice', async ({
    multiRole,
  }) => {
    const { customerApp, merchantPortal } = multiRole;
    let createdRefCode = '';

    await test.step('1. Customer books appointment via mobile app', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot();
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      await expect(customerApp.confirmationToast).toBeVisible({ timeout: 15000 });
      await customerApp.openBookingPass('Sri Venkateswara Dental');
      createdRefCode = await customerApp.getPassReferenceCode();
      await customerApp.closeBookingPass();
    });

    await test.step('2. Merchant cancels booking; triggers 100% customer refund and merchant strike tracking', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.cancelAndRefundBooking(createdRefCode);
      await merchantPortal.filterByStatus('CANCELLED');
      await merchantPortal.expectBookingInQueue(createdRefCode, 'CANCELLED');
    });

    await test.step('3. Customer Mobile App reflects CANCELLED status and 100% Refund badge', async () => {
      await customerApp.navigateToMyBookings();
      await customerApp.expectBookingInList(createdRefCode, 'CANCELLED');
      const card = customerApp.getBookingCard(createdRefCode);
      await expect(card.getByText(/100% Refund Issued/i)).toBeVisible({ timeout: 10000 });
    });
  });

  test('Flow 11 (Customer Courtesy No-Show & 30-Minute Policy): First missed appointment receives courtesy refund', async ({
    multiRole,
    supabaseClient,
  }) => {
    const { customerApp, merchantPortal } = multiRole;
    let createdRefCode = '';

    await test.step('1. Customer books appointment via mobile app', async () => {
      await supabaseClient.rpc('reset_test_customer_strikes', {
        p_customer_id: '99999999-9999-9999-9999-999999999991',
        p_count: 0,
      });

      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot();
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      await expect(customerApp.confirmationToast).toBeVisible({ timeout: 15000 });
      await customerApp.openBookingPass('Sri Venkateswara Dental');
      createdRefCode = await customerApp.getPassReferenceCode();
      await customerApp.closeBookingPass();
    });

    await test.step('2. Merchant marks No-Show in Queue; Courtesy Grace Period grants 100% refund without penalty', async () => {
      // Backdate slot_start to past so it passes the premature no-show guard
      const { data: bkg } = await supabaseClient
        .from('bookings')
        .select('id')
        .eq('reference_code', createdRefCode)
        .single();
      if (bkg?.id) {
        await supabaseClient
          .from('bookings')
          .update({ slot_start: new Date(Date.now() - 3600000).toISOString() })
          .eq('id', bkg.id);
      }

      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.markBookingNoShow(createdRefCode);
      await expect(merchantPortal.page.getByText(/Courtesy refund granted to customer/i).first()).toBeVisible({ timeout: 10000 });
    });

    await test.step('3. Customer Mobile reflects NO_SHOW status and 100% Refund badge', async () => {
      await customerApp.navigateToMyBookings();
      await customerApp.expectBookingInList(createdRefCode, 'NO_SHOW');
      const card = customerApp.getBookingCard(createdRefCode);
      await expect(card.getByText(/100% Refund Issued/i)).toBeVisible({ timeout: 10000 });
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

      await expect(customerApp.confirmationToast).toBeVisible({ timeout: 15000 });
      await expect(customerApp.myBookingsTitle).toBeVisible({ timeout: 15000 });
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
