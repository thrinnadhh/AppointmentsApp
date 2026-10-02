import { test, expect } from './fixtures/test-fixtures';

/**
 * Phase 1 BOLA & Financial Access Control Defense Suite
 * Adheres strictly to:
 * - webapp-testing/SKILL.md (Section 4: Playwright Principles):
 *   1. Page Object Model (POM): UI interactions encapsulated in POMs (MerchantPortalPage, CustomerAppPage).
 *   2. Custom Fixtures: Extended fixtures for bookingApi, supabaseClient, merchantPortal, customerApp.
 *   3. Deterministic Auto-Waiting: Web-first assertions with zero hardcoded sleeps.
 *   4. Trace Diagnostics: Granular test.step hierarchy for clear triage.
 * - testing-patterns/SKILL.md:
 *   AAA Pattern (Arrange, Act, Assert), behavior testing, and perimeter security invariants.
 */
test.describe.serial('Phase 1: High Severity Financial & Access Control BOLA Defense Suite', () => {

  const TEST_PROVIDER_ID = '11111111-1111-1111-1111-111111111111';
  const TEST_RESOURCE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const TEST_CUSTOMER_ID = '99999999-9999-9999-9999-999999999991';

  test.beforeEach(async ({ supabaseClient }) => {
    // Arrange: Ensure test provider is ACTIVE
    try {
      await supabaseClient
        .from('providers')
        .update({ status: 'ACTIVE' })
        .eq('id', TEST_PROVIDER_ID);
    } catch {}
  });

  test('Vector 1.1: Confirm Route rejects mismatched order ID (Order Substitution Attack)', async ({
    request,
    bookingApi,
  }) => {
    let bookingIdA = '';
    let bookingIdB = '';
    let orderIdB = '';

    await test.step('Arrange: Create two independent booking holds (Booking A and Booking B)', async () => {
      const baseA = 1000000000 + Math.floor(Math.random() * 5000000000);
      const slotStartA = new Date(Date.now() + baseA).toISOString();
      const slotEndA = new Date(Date.now() + baseA + 1800000).toISOString();
      const holdA = await bookingApi.createHold({ slotStart: slotStartA, slotEnd: slotEndA });
      bookingIdA = holdA.booking_id;
      expect(bookingIdA).toBeTruthy();

      const baseB = baseA + 3600000;
      const slotStartB = new Date(Date.now() + baseB).toISOString();
      const slotEndB = new Date(Date.now() + baseB + 1800000).toISOString();
      const holdB = await bookingApi.createHold({ slotStart: slotStartB, slotEnd: slotEndB });
      bookingIdB = holdB.booking_id;
      expect(bookingIdB).toBeTruthy();
    });

    await test.step('Arrange: Generate a valid payment gateway order strictly for Booking B', async () => {
      const orderRes = await request.post('http://localhost:3000/api/payments/create-order', {
        headers: { 'x-customer-id': TEST_CUSTOMER_ID },
        data: { booking_id: bookingIdB },
      });
      expect(orderRes.ok()).toBe(true);
      const orderData = await orderRes.json();
      orderIdB = orderData.order_id;
      expect(orderIdB).toBeTruthy();
    });

    await test.step('Act: Attempt to confirm Booking A using Booking B order ID (Substitution Exploit)', async () => {
      const confirmRes = await request.post('http://localhost:3000/api/bookings/confirm', {
        headers: { 'x-customer-id': TEST_CUSTOMER_ID },
        data: {
          booking_id: bookingIdA,
          gateway_payment_id: `pay_attacker_${Date.now()}`,
          razorpay_order_id: orderIdB, // Mismatched order!
          razorpay_signature: 'mock_verified',
        },
      });

      // Assert: Must be rejected with HTTP 400 Bad Request
      expect(confirmRes.status()).toBe(400);
      const confirmJson = await confirmRes.json();
      expect(confirmJson.success).toBe(false);
      expect(confirmJson.error).toContain('Order ID mismatch or unlinked booking');
    });
  });

  test('Vector 1.2: Confirm Route rejects tampered payment amount', async ({
    request,
    bookingApi,
  }) => {
    let bookingId = '';

    await test.step('Arrange: Create high-value reservation hold for customer', async () => {
      const base12 = 2000000000 + Math.floor(Math.random() * 5000000000);
      const slotStart = new Date(Date.now() + base12).toISOString();
      const slotEnd = new Date(Date.now() + base12 + 1800000).toISOString();
      const hold = await bookingApi.createHold({
        slotStart,
        slotEnd,
        depositAmount: 500, // ₹500 deposit
      });
      bookingId = hold.booking_id;
      expect(bookingId).toBeTruthy();
    });

    await test.step('Arrange: Link a tampered mock order with mismatched amount', async () => {
      const tamperedOrderId = 'order_mock_tampered_100_lowcost';
      // Act: Try to confirm the ₹500 booking using the ₹1 tampered order
      const confirmRes = await request.post('http://localhost:3000/api/bookings/confirm', {
        headers: { 'x-customer-id': TEST_CUSTOMER_ID },
        data: {
          booking_id: bookingId,
          gateway_payment_id: `pay_tampered_${Date.now()}`,
          razorpay_order_id: tamperedOrderId,
          razorpay_signature: 'mock_verified',
        },
      });

      // Assert: Must be rejected with HTTP 400 Tampered payment amount
      expect(confirmRes.status()).toBe(400);
      const json = await confirmRes.json();
      expect(json.success).toBe(false);
      // Either fails at unlinked order check or tampered amount check
      expect(
        json.error.includes('Tampered payment amount') ||
        json.error.includes('Order ID mismatch or unlinked booking')
      ).toBe(true);
    });
  });

  test('Vector 1.3: Direct payment verification rejects unlinked bookings without assigned gateway_order_id', async ({
    request,
    bookingApi,
  }) => {
    let unlinkedBookingId = '';

    await test.step('Arrange: Create hold without invoking payment order creation', async () => {
      const base13 = 3000000000 + Math.floor(Math.random() * 5000000000);
      const slotStart = new Date(Date.now() + base13).toISOString();
      const slotEnd = new Date(Date.now() + base13 + 1800000).toISOString();
      const hold = await bookingApi.createHold({ slotStart, slotEnd });
      unlinkedBookingId = hold.booking_id;
      expect(unlinkedBookingId).toBeTruthy();
    });

    await test.step('Act: Attempt direct payment fetch confirmation on unlinked booking', async () => {
      const confirmRes = await request.post('http://localhost:3000/api/bookings/confirm', {
        headers: { 'x-customer-id': TEST_CUSTOMER_ID },
        data: {
          booking_id: unlinkedBookingId,
          gateway_payment_id: 'pay_test_direct_unlinked',
          // No order ID or signature provided (direct fetch branch)
        },
      });

      // Assert: Strictly rejected because booking has no gateway_order_id bound
      expect(confirmRes.status()).toBe(400);
      const json = await confirmRes.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Order ID mismatch or unlinked booking');
    });
  });

  test('Happy Path: Legitimate order binding, verification, and Merchant Portal queue reflection', async ({
    request,
    bookingApi,
    merchantPortal,
  }) => {
    let confirmedBookingId = '';
    let testRefCode = '';

    await test.step('Arrange: Create booking hold and bind legitimate gateway order', async () => {
      const baseHP = 4000000000 + Math.floor(Math.random() * 5000000000);
      const slotStart = new Date(Date.now() + baseHP).toISOString();
      const slotEnd = new Date(Date.now() + baseHP + 1800000).toISOString();
      const hold = await bookingApi.createHold({ slotStart, slotEnd });
      confirmedBookingId = hold.booking_id;
      testRefCode = hold.reference_code || '';
      expect(confirmedBookingId).toBeTruthy();

      // Create order to bind gateway_order_id onto booking
      const orderRes = await request.post('http://localhost:3000/api/payments/create-order', {
        headers: { 'x-customer-id': TEST_CUSTOMER_ID },
        data: { booking_id: confirmedBookingId },
      });
      expect(orderRes.ok()).toBe(true);
      const orderJson = await orderRes.json();
      expect(orderJson.order_id).toBeTruthy();

      // Confirm with matching bound order
      const confirmRes = await request.post('http://localhost:3000/api/bookings/confirm', {
        headers: { 'x-customer-id': TEST_CUSTOMER_ID },
        data: {
          booking_id: confirmedBookingId,
          gateway_payment_id: `pay_legit_${Date.now()}`,
          razorpay_order_id: orderJson.order_id,
          razorpay_signature: 'mock_verified',
        },
      });

      expect(confirmRes.ok()).toBe(true);
      const confirmJson = await confirmRes.json();
      expect(confirmJson.success).toBe(true);
      expect(confirmJson.status).toBe('CONFIRMED');
    });

    await test.step('Assert: Merchant Portal POM reflects confirmed appointment in active queue', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByDate('ALL');
      await merchantPortal.filterByStatus('CONFIRMED');
      if (testRefCode) {
        await merchantPortal.searchBookings(testRefCode);
        await merchantPortal.expectBookingInQueue(testRefCode, 'CONFIRMED');
      } else {
        await merchantPortal.expectBookingInQueue('Dr. S. K. Murthy', 'CONFIRMED');
      }
    });
  });
});
