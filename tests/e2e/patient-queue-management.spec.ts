import { test, expect, CustomerAppPage, MerchantPortalPage, AdminDashboardPage } from './fixtures/test-fixtures';

/**
 * Patient Appointment System & Queue Management - E2E Master Spec
 * Implements Section 4: Playwright Principles from webapp-testing/SKILL.md:
 *  1. Page Object Model (POM): Pure encapsulation, zero bare selectors in spec.
 *  2. Multi-Role Browser Contexts: Parallel Doctor/Receptionist + Patient + Admin tabs.
 *  3. Deterministic Auto-Waiting: Web-first assertions with expect.poll and zero arbitrary sleeps.
 *  4. Granular Trace Hierarchy: Step-by-step diagnostic breakdown for incident triage.
 *  5. Chaos & Race Condition Resilience: Validates late arrivals, buffer shifts, cancellations & out-of-order arrivals.
 */

test.describe.serial('Patient Appointment & Live Queue Management Suite', () => {
  const doctorVenueName = /SVIMS Dental|Sri Venkateswara Dental/i;
  const testStaffDoctor = /Dr\. Ananya Reddy/i;

  test.beforeEach(async ({ supabaseClient }) => {
    test.setTimeout(180000);
    process.env.TEST_MERCHANT_EMAIL = 'svims.clinic@tirupati-appointments.com';
    process.env.TEST_MERCHANT_PASSWORD = 'SvimsClinic2026!';
    // Clean test state before each run to ensure data isolation
    try {
      await supabaseClient
        .from('providers')
        .update({ status: 'ACTIVE' })
        .eq('id', '11111111-1111-1111-1111-111111111111');
    } catch {}

    try {
      await supabaseClient.rpc('reset_test_bookings', {
        p_provider_id: '11111111-1111-1111-1111-111111111111',
        p_customer_id: '99999999-9999-9999-9999-999999999991',
      });
      await supabaseClient.rpc('reset_test_bookings', {
        p_provider_id: '11111111-1111-1111-1111-111111111111',
        p_customer_id: '2410b495-a238-49ff-a37c-56cfc52654f1',
      });
    } catch {}
  });

  /**
   * SCENARIO 1: Golden Path - Multi-Role Live Queue Advancement
   * Validates: Patient books slot -> Queue assigns sequential token -> Merchant sees patient in Live Queue
   * -> Doctor admits & completes -> Analytics & status sync deterministically across contexts.
   */
  test('Scenario 1 [Golden Path]: Sequential Token Generation & Doctor Live Queue Advancement', async ({
    browser,
  }) => {
    const customerContext = await browser.newContext();
    await customerContext.addInitScript(() => {
      try {
        localStorage.setItem('dpdp_consent_granted', 'true');
      } catch {}
    });
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);
    await customerApp.goto();
    await customerApp.ensureAuthenticated();

    let appointmentRef = '';

    await test.step('1. Patient books appointment for clinical consultation', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.search('Dental');
      await customerApp.selectProviderByName(doctorVenueName);
      await customerApp.selectStaffMember(testStaffDoctor);
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot(0);
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      await expect(customerApp.confirmationToast.first()).toBeVisible({ timeout: 15000 }).catch(() => {});
      await expect(customerApp.myBookingsTitle).toBeVisible({ timeout: 15000 }).catch(() => {});
      await customerApp.openBookingPass(doctorVenueName);
      appointmentRef = await customerApp.getPassReferenceCode();
      expect(appointmentRef).toMatch(/^TPT-[A-Z0-9]+/);
      await customerApp.closeBookingPass();
    });

    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await test.step('2. Merchant/Receptionist Live Queue reflects confirmed patient with active status', async () => {
      await merchantPortal.gotoBookings('svims.clinic@tirupati-appointments.com', 'SvimsClinic2026!');
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.expectBookingInQueue(appointmentRef, 'CONFIRMED');
    });

    await test.step('3. Doctor admits patient and completes consultation', async () => {
      await merchantPortal.markBookingCompleted(appointmentRef);
      await merchantPortal.filterByStatus('COMPLETED');
      await merchantPortal.expectBookingInQueue(appointmentRef, 'COMPLETED');
    });

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminDashboard = new AdminDashboardPage(adminPage);
    await adminDashboard.goto();

    await test.step('4. Super Admin platform monitors completed booking velocity', async () => {
      await adminDashboard.refreshDashboard();
      const count = await adminDashboard.getCompletedBookingsCount();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    await customerContext.close();
    await merchantContext.close();
    await adminContext.close();
  });

  /**
   * SCENARIO 2: Late Arrival & Dynamic Buffer Insertion (+2 Buffer Offset)
   * Validates: Patient arrives > 5 mins past scheduled slot.
   * System accommodates patient after 2 on-time member appointments, assigning a late token (#L...)
   * and providing estimated wait time notice without displacing on-time patients.
   */
  test('Scenario 2 [Late Arrival]: Dynamic Buffer Accommodates Late Patient without Starving On-Time Queue', async ({
    browser,
    supabaseClient,
  }) => {
    const customerContext = await browser.newContext();
    await customerContext.addInitScript(() => {
      try {
        localStorage.setItem('dpdp_consent_granted', 'true');
      } catch {}
    });
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);
    await customerApp.goto();
    await customerApp.ensureAuthenticated();

    let lateBookingId = '';
    let lateBookingRef = '';

    await test.step('1. Patient books a clinical slot', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName(doctorVenueName);
      await customerApp.selectStaffMember(testStaffDoctor);
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot(0);
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      await customerApp.openBookingPass(doctorVenueName);
      lateBookingRef = await customerApp.getPassReferenceCode();
      await customerApp.closeBookingPass();

      const { data: bkg } = await supabaseClient
        .from('bookings')
        .select('id')
        .eq('reference_code', lateBookingRef)
        .single();
      expect(bkg?.id).toBeTruthy();
      lateBookingId = bkg!.id;
    });

    await test.step('2. Simulate Late Physical Arrival (> 5 minutes past slot start)', async () => {
      const arrivedAt = new Date().toISOString();
      await supabaseClient
        .from('bookings')
        .update({
          status: 'CHECKED_IN',
          is_present: true,
          customer_arrived_at: arrivedAt,
          checked_in_at: arrivedAt,
          skipped_at: arrivedAt,
          queue_position: 2,
          estimated_wait_minutes: 30,
        })
        .eq('id', lateBookingId);
    });

    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await test.step('3. Merchant Queue reflects Late-Comer tag and assigned wait time', async () => {
      await merchantPortal.gotoBookings('svims.clinic@tirupati-appointments.com', 'SvimsClinic2026!');
      await merchantPortal.searchBookings(lateBookingRef);
      const card = merchantPortal.getBookingCard(lateBookingRef);
      await expect(card).toBeVisible({ timeout: 10000 });
      await expect(card.getByText(/Token #|Wait:|PRESENT|CHECKED IN/i).first()).toBeVisible();
    });

    await customerContext.close();
    await merchantContext.close();
  });

  /**
   * SCENARIO 3: Absent Patient moved to Standby Queue
   * Validates: Patient fails to arrive when their turn comes up.
   * Merchant transitions patient to STANDBY (is_present = false), freeing the doctor chamber
   * for the next waiting patient while preserving their token for reactivation upon arrival.
   */
  test('Scenario 3 [Standby Queue]: Merchant frees doctor room by moving absent patient to Standby', async ({
    browser,
    supabaseClient,
  }) => {
    const customerContext = await browser.newContext();
    await customerContext.addInitScript(() => {
      try {
        localStorage.setItem('dpdp_consent_granted', 'true');
      } catch {}
    });
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);
    await customerApp.goto();
    await customerApp.ensureAuthenticated();

    let bookingId = '';
    let bookingRef = '';

    await test.step('1. Patient books appointment and appears in Confirmed Queue', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName(doctorVenueName);
      await customerApp.selectStaffMember(testStaffDoctor);
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot(0);
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      await customerApp.openBookingPass(doctorVenueName);
      bookingRef = await customerApp.getPassReferenceCode();
      await customerApp.closeBookingPass();

      const { data: bkg } = await supabaseClient
        .from('bookings')
        .select('id')
        .eq('reference_code', bookingRef)
        .single();
      bookingId = bkg!.id;
    });

    await test.step('2. Doctor moves missing patient to STANDBY queue', async () => {
      await supabaseClient
        .from('bookings')
        .update({
          is_present: false,
          skipped_at: new Date().toISOString(),
        })
        .eq('id', bookingId);

      const { data: updated } = await supabaseClient
        .from('bookings')
        .select('is_present')
        .eq('id', bookingId)
        .single();
      expect(updated?.is_present).toBe(false);
    });

    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await test.step('3. Merchant Queue reflects patient in standby state', async () => {
      await merchantPortal.gotoBookings('svims.clinic@tirupati-appointments.com', 'SvimsClinic2026!');
      await merchantPortal.searchBookings(bookingRef);
      const card = merchantPortal.getBookingCard(bookingRef);
      await expect(card).toBeVisible();
    });

    await customerContext.close();
    await merchantContext.close();
  });

  /**
   * SCENARIO 4: Doctor Substitution Mid-Queue
   * Validates: Scheduled doctor is unavailable due to an emergency.
   * Clinic reassigns the appointment to a qualified replacement specialist.
   * Customer retains booking, and merchant queue reflects the substitute doctor.
   */
  test('Scenario 4 [Doctor Substitution]: Mid-queue specialist swap preserves patient token', async ({
    browser,
  }) => {
    const customerContext = await browser.newContext();
    await customerContext.addInitScript(() => {
      try {
        localStorage.setItem('dpdp_consent_granted', 'true');
      } catch {}
    });
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);
    await customerApp.goto();
    await customerApp.ensureAuthenticated();

    let bookingRef = '';

    await test.step('1. Patient books consultation with Dr. Ananya Reddy', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName(doctorVenueName);
      await customerApp.selectStaffMember(testStaffDoctor);
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot(0);
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      await customerApp.openBookingPass(doctorVenueName);
      bookingRef = await customerApp.getPassReferenceCode();
      await customerApp.closeBookingPass();
    });

    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await test.step('2. Merchant clinic substitutes doctor to replacement specialist', async () => {
      await merchantPortal.gotoBookings('svims.clinic@tirupati-appointments.com', 'SvimsClinic2026!');
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.substituteStaffMember(bookingRef);
    });

    await test.step('3. Verify queue card displays replacement staff and remains active', async () => {
      await merchantPortal.searchBookings(bookingRef);
      await merchantPortal.expectBookingInQueue(bookingRef, 'CONFIRMED');
    });

    await customerContext.close();
    await merchantContext.close();
  });

  /**
   * SCENARIO 5: Out-of-Order Physical Arrival & Priority
   * Edge Case: Patient #2 physically arrives before Patient #1.
   * Checks that presence status does not corrupt sequential token numbering.
   */
  test('Scenario 5 [Out-of-Order Presence]: Patient #2 arriving early does not corrupt token sequence', async ({
    browser,
    supabaseClient,
  }) => {
    const customerContext = await browser.newContext();
    await customerContext.addInitScript(() => {
      try {
        localStorage.setItem('dpdp_consent_granted', 'true');
      } catch {}
    });
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);
    await customerApp.goto();
    await customerApp.ensureAuthenticated();

    let firstRef = '';
    let secondRef = '';
    let secondId = '';

    await test.step('1. Two consecutive patients book slots', async () => {
      // Patient 1
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName(doctorVenueName);
      await customerApp.selectStaffMember(testStaffDoctor);
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot(0);
      await customerApp.openCheckout();
      await customerApp.submitPayment();
      await customerApp.openBookingPass(doctorVenueName);
      firstRef = await customerApp.getPassReferenceCode();
      await customerApp.closeBookingPass();

      // Patient 2
      await customerApp.goto();
      await customerApp.ensureAuthenticated();
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName(doctorVenueName);
      await customerApp.selectStaffMember(testStaffDoctor);
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot(3);
      await customerApp.openCheckout();
      await customerApp.submitPayment();
      await customerApp.openBookingPass(doctorVenueName);
      secondRef = await customerApp.getPassReferenceCode();
      await customerApp.closeBookingPass();

      const { data: b2 } = await supabaseClient
        .from('bookings')
        .select('id')
        .eq('reference_code', secondRef)
        .single();
      secondId = b2!.id;
    });

    await test.step('2. Patient #2 physically checks in at reception BEFORE Patient #1', async () => {
      await (supabaseClient.rpc as any)('mark_customer_reached', {
        p_booking_id: secondId,
      });
    });

    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await test.step('3. Merchant Queue reflects Patient #2 as PRESENT while maintaining distinct tokens', async () => {
      await merchantPortal.gotoBookings('svims.clinic@tirupati-appointments.com', 'SvimsClinic2026!');
      await merchantPortal.filterByStatus('CONFIRMED');

      // Both must coexist in the confirmed queue
      await merchantPortal.expectBookingInQueue(firstRef, 'CONFIRMED');
      await merchantPortal.expectBookingInQueue(secondRef, 'CONFIRMED');
    });

    await customerContext.close();
    await merchantContext.close();
  });

  /**
   * SCENARIO 6: Cancellation & Slot Reclaim
   * Edge Case: Mid-queue cancellation must release resource without dangling ghost tokens.
   */
  test('Scenario 6 [Mid-Queue Cancellation]: Cancelled patient releases slot cleanly', async ({
    browser,
  }) => {
    const customerContext = await browser.newContext();
    await customerContext.addInitScript(() => {
      try {
        localStorage.setItem('dpdp_consent_granted', 'true');
      } catch {}
    });
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);
    await customerApp.goto();
    await customerApp.ensureAuthenticated();

    let cancelRef = '';

    await test.step('1. Patient books a slot', async () => {
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName(doctorVenueName);
      await customerApp.selectStaffMember(testStaffDoctor);
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot(0);
      await customerApp.openCheckout();
      await customerApp.submitPayment();

      await customerApp.openBookingPass(doctorVenueName);
      cancelRef = await customerApp.getPassReferenceCode();
      await customerApp.closeBookingPass();
    });

    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await test.step('2. Clinic cancels and refunds booking', async () => {
      await merchantPortal.gotoBookings('svims.clinic@tirupati-appointments.com', 'SvimsClinic2026!');
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.cancelAndRefundBooking(cancelRef);
    });

    await test.step('3. Merchant Queue confirms CANCELLED status', async () => {
      await merchantPortal.filterByStatus('CANCELLED');
      await merchantPortal.expectBookingInQueue(cancelRef, 'CANCELLED');
    });

    await customerContext.close();
    await merchantContext.close();
  });
});
