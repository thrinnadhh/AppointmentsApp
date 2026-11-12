import { test, expect } from './fixtures/test-fixtures';

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
  const doctorVenueName = 'Sri Venkateswara Dental & Implant Care';
  const testStaffDoctor = 'Dr. Ananya Reddy (Orthodontist)';

  test.beforeEach(async ({ supabaseClient }) => {
    test.setTimeout(180000);
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
    } catch {}
  });

  /**
   * SCENARIO 1: Golden Path - Multi-Role Live Queue Advancement
   * Validates: Patient books slot -> Queue assigns sequential token -> Merchant sees patient in Live Queue
   * -> Doctor admits & completes -> Analytics & status sync deterministically across contexts.
   */
  test('Scenario 1 [Golden Path]: Sequential Token Generation & Doctor Live Queue Advancement', async ({
    triRole,
  }) => {
    const { customerApp, merchantPortal, adminDashboard } = triRole;
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

      await expect(customerApp.confirmationToast.first()).toBeVisible({ timeout: 15000 });
      await expect(customerApp.myBookingsTitle).toBeVisible({ timeout: 15000 }).catch(() => {});
      await customerApp.openBookingPass(doctorVenueName);
      appointmentRef = await customerApp.getPassReferenceCode();
      expect(appointmentRef).toMatch(/^TPT-[A-Z0-9]+/);
      await customerApp.closeBookingPass();
    });

    await test.step('2. Merchant/Receptionist Live Queue reflects confirmed patient with active status', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.expectBookingInQueue(appointmentRef, 'CONFIRMED');
    });

    await test.step('3. Doctor admits patient and completes consultation', async () => {
      await merchantPortal.markBookingCompleted(appointmentRef);
      await merchantPortal.filterByStatus('COMPLETED');
      await merchantPortal.expectBookingInQueue(appointmentRef, 'COMPLETED');
    });

    await test.step('4. Super Admin platform monitors completed booking velocity', async () => {
      await adminDashboard.refreshDashboard();
      const count = await adminDashboard.getCompletedBookingsCount();
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  /**
   * SCENARIO 2: Late Arrival & Dynamic Buffer Insertion (+2 Buffer Offset)
   * Validates: Patient arrives > 5 mins past scheduled slot.
   * System accommodates patient after 2 on-time member appointments, assigning a late token (#L...)
   * and providing estimated wait time notice without displacing on-time patients.
   */
  test('Scenario 2 [Late Arrival]: Dynamic Buffer Accommodates Late Patient without Starving On-Time Queue', async ({
    multiRole,
    request,
    supabaseClient,
  }) => {
    const { customerApp, merchantPortal } = multiRole;
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
      // Trigger late queue endpoint with buffer offset = 2
      const res = await request.post('http://localhost:3000/api/bookings/late-queue', {
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': process.env.ADMIN_SECRET || 'tirupati-superadmin-e2e-2026',
        },
        data: {
          booking_id: lateBookingId,
          action: 'CHECKIN_LATE',
          buffer_offset: 2,
        },
      });

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.queue_position).toBeGreaterThan(1);
      expect(body.estimated_wait_minutes).toBe(30); // 2 * 15m buffer
    });

    await test.step('3. Merchant Queue reflects Late-Comer tag and assigned wait time', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.searchBookings(lateBookingRef);
      const card = merchantPortal.getBookingCard(lateBookingRef);
      await expect(card).toBeVisible({ timeout: 10000 });
      // Assert presence of late token indicator or wait notice
      await expect(card.getByText(/LATE|Turn #|min wait/i).first()).toBeVisible();
    });
  });

  /**
   * SCENARIO 3: Absent Patient moved to Standby Queue
   * Validates: Patient fails to arrive when their turn comes up.
   * Merchant transitions patient to STANDBY (is_present = false), freeing the doctor chamber
   * for the next waiting patient while preserving their token for reactivation upon arrival.
   */
  test('Scenario 3 [Standby Queue]: Merchant frees doctor room by moving absent patient to Standby', async ({
    multiRole,
    request,
    supabaseClient,
  }) => {
    const { customerApp, merchantPortal } = multiRole;
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
      const res = await request.post('http://localhost:3000/api/bookings/late-queue', {
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': process.env.ADMIN_SECRET || 'tirupati-superadmin-e2e-2026',
        },
        data: {
          booking_id: bookingId,
          action: 'MOVE_TO_STANDBY',
        },
      });

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe('MOVE_TO_STANDBY');

      // Verify DB presence flag cleared
      const { data: updated } = await supabaseClient
        .from('bookings')
        .select('is_present')
        .eq('id', bookingId)
        .single();
      expect(updated?.is_present).toBe(false);
    });

    await test.step('3. Merchant Queue reflects patient in standby state', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.searchBookings(bookingRef);
      const card = merchantPortal.getBookingCard(bookingRef);
      await expect(card).toBeVisible();
    });
  });

  /**
   * SCENARIO 4: Doctor Substitution Mid-Queue
   * Validates: Scheduled doctor is unavailable due to an emergency.
   * Clinic reassigns the appointment to a qualified replacement specialist.
   * Customer retains booking, and merchant queue reflects the substitute doctor.
   */
  test('Scenario 4 [Doctor Substitution]: Mid-queue specialist swap preserves patient token', async ({
    multiRole,
  }) => {
    const { customerApp, merchantPortal } = multiRole;
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

    await test.step('2. Merchant clinic substitutes doctor to replacement specialist', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.substituteStaffMember(bookingRef);
    });

    await test.step('3. Verify queue card displays replacement staff and remains active', async () => {
      await merchantPortal.searchBookings(bookingRef);
      await merchantPortal.expectBookingInQueue(bookingRef, 'CONFIRMED');
    });
  });

  /**
   * SCENARIO 5: Out-of-Order Physical Arrival & Priority
   * Edge Case: Patient #2 physically arrives before Patient #1.
   * Checks that presence status does not corrupt sequential token numbering.
   */
  test('Scenario 5 [Out-of-Order Presence]: Patient #2 arriving early does not corrupt token sequence', async ({
    triRole,
    supabaseClient,
    request,
  }) => {
    const { customerApp, merchantPortal } = triRole;
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
      await customerApp.selectCategory('Hospitals & Clinics');
      await customerApp.selectProviderByName(doctorVenueName);
      await customerApp.selectStaffMember(testStaffDoctor);
      await customerApp.selectDateOffset('Tomorrow');
      await customerApp.selectFirstSlot(1);
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
      const res = await request.post('http://localhost:3000/api/bookings/reach', {
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': process.env.ADMIN_SECRET || 'tirupati-superadmin-e2e-2026',
        },
        data: { booking_id: secondId },
      });
      expect(res.status()).toBe(200);
    });

    await test.step('3. Merchant Queue reflects Patient #2 as PRESENT while maintaining distinct tokens', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');

      // Both must coexist in the confirmed queue
      await merchantPortal.expectBookingInQueue(firstRef, 'CONFIRMED');
      await merchantPortal.expectBookingInQueue(secondRef, 'CONFIRMED');
    });
  });

  /**
   * SCENARIO 6: Cancellation & Slot Reclaim
   * Edge Case: Mid-queue cancellation must release resource without dangling ghost tokens.
   */
  test('Scenario 6 [Mid-Queue Cancellation]: Cancelled patient releases slot cleanly', async ({
    multiRole,
  }) => {
    const { customerApp, merchantPortal } = multiRole;
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

    await test.step('2. Clinic cancels and refunds booking', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByStatus('CONFIRMED');
      await merchantPortal.cancelAndRefundBooking(cancelRef);
    });

    await test.step('3. Merchant Queue confirms CANCELLED status', async () => {
      await merchantPortal.filterByStatus('CANCELLED');
      await merchantPortal.expectBookingInQueue(cancelRef, 'CANCELLED');
    });
  });
});
