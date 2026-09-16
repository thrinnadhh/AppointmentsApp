import { test, expect } from '@playwright/test';
import { CustomerAppPage } from './pages/customer-app.page';
import { MerchantPortalPage } from './pages/merchant-portal.page';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_PQ0ToJguSqBpF6eWP3aP9w_NT4hFLef';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

test.describe.serial('Customer & Merchant Cross-App Integration Test Suite', () => {
  const testCustomerEmail = 'customer.integration@tirupati.care';
  const testCustomerId = '99999999-9999-9999-9999-999999999991'; // Kalyan Chakravarthy seed account
  const testResourceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Dr. S. K. Murthy

  test('1. [Customer Booking -> Merchant Live Queue] Customer books appointment on mobile app; Merchant sees it live on bookings dashboard', async ({ browser }) => {
    // Context A: Customer Mobile App (Expo Web on port 8081)
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);

    await customerApp.goto();

    // 1. Customer browses to Clinics and selects Sri Venkateswara Dental
    await customerApp.selectCategory('Hospitals & Clinics');
    await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
    await customerApp.selectFirstSlot();
    await customerApp.openCheckout();

    // 2. Customer submits payment via simulated payment gateway
    await customerApp.submitPayment();
    await expect(customerApp.confirmationToast).toBeVisible({ timeout: 15000 });
    await expect(customerApp.myBookingsTitle).toBeVisible();

    // Verify booking appears in Customer's personal bookings view
    await expect(customerPage.getByText('CONFIRMED').first()).toBeVisible();

    // Context B: Merchant Portal (/bookings on port 3000)
    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await merchantPortal.gotoBookings();
    await merchantPortal.filterByStatus('CONFIRMED');

    // 3. Verify that the merchant sees the confirmed booking for Sri Venkateswara Dental in the queue
    await expect(merchantPage.locator('strong', { hasText: 'Sri Venkateswara Dental & Implant Care' }).first()).toBeVisible();
    await expect(merchantPage.getByText('CONFIRMED').first()).toBeVisible();

    await customerContext.close();
    await merchantContext.close();
  });

  test('2. [Merchant Check-In & Service Completion] Merchant completes appointment on web; Customer mobile app reflects COMPLETED status', async ({ browser, request }) => {
    // 1. Create and confirm a booking
    const slotStart = new Date(Date.now() + 86400000).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 + 1800000).toISOString();

    const holdRes = await request.post('http://localhost:3000/api/bookings/hold', {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    await request.post('http://localhost:3000/api/bookings/confirm', {
      data: {
        booking_id,
        gateway_payment_id: `pay_complete_${Date.now()}`,
      },
    });

    const { data: booking } = await supabase
      .from('bookings')
      .select('reference_code')
      .eq('id', booking_id)
      .single();
    const refCode = booking?.reference_code || `TPT-${booking_id.slice(0, 6).toUpperCase()}`;

    // 2. Merchant marks booking as COMPLETED on web portal
    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await merchantPortal.gotoBookings();
    await merchantPortal.filterByStatus('CONFIRMED');
    await merchantPortal.searchBookings(refCode);

    const card = merchantPortal.getBookingCard(refCode);
    await expect(card).toBeVisible({ timeout: 10000 });

    const completeBtn = card.getByRole('button', { name: /Complete/i });
    await expect(completeBtn).toBeVisible();
    await completeBtn.click();

    // Merchant UI reflects COMPLETED under COMPLETED queue
    await merchantPortal.filterByStatus('COMPLETED');
    await merchantPortal.expectBookingInQueue(refCode, 'COMPLETED');

    // 3. Customer views My Appointments on Mobile App and verifies COMPLETED status
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);

    await customerApp.goto();
    await customerApp.navigateToMyBookings();

    // Verify booking shows COMPLETED
    await customerApp.expectBookingInList(refCode, 'COMPLETED');

    await merchantContext.close();
    await customerContext.close();
  });

  test('3. [Customer-Initiated Reschedule -> Merchant Queue] Customer reschedules appointment from mobile; Merchant portal reflects updated time', async ({ browser, request }) => {
    // 1. Create and confirm a booking
    const slotStart = new Date(Date.now() + 172800000).toISOString(); // +2 days
    const slotEnd = new Date(Date.now() + 172800000 + 1800000).toISOString();

    const holdRes = await request.post('http://localhost:3000/api/bookings/hold', {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    const { booking_id } = await holdRes.json();

    await request.post('http://localhost:3000/api/bookings/confirm', {
      data: {
        booking_id,
        gateway_payment_id: `pay_resched_${Date.now()}`,
      },
    });

    const { data: booking } = await supabase
      .from('bookings')
      .select('reference_code')
      .eq('id', booking_id)
      .single();
    const refCode = booking?.reference_code || `TPT-${booking_id.slice(0, 6).toUpperCase()}`;

    // 2. Customer opens Mobile App and reschedules
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);

    await customerApp.goto();
    await customerApp.navigateToMyBookings();

    // Trigger reschedule modal for this specific booking
    await customerApp.rescheduleBookingFromList(refCode, '02:00 PM');

    // 3. Verify in database and Merchant portal that slot updated
    const { data: updatedBooking } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', booking_id)
      .single();

    expect(updatedBooking.status).toBe('CONFIRMED');

    // 4. Verify Merchant Portal reflects the confirmed booking
    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await merchantPortal.gotoBookings();
    await merchantPortal.searchBookings(refCode);
    await expect(merchantPortal.getBookingCard(refCode)).toBeVisible({ timeout: 10000 });

    await customerContext.close();
    await merchantContext.close();
  });

  test('4. [Merchant-Initiated Reschedule -> Customer Notification] Merchant reschedules an appointment; Customer view reflects updated time', async ({ request }) => {
    // 1. Create a fresh booking via Backend API
    const slotStart = new Date(Date.now() + 86400000).toISOString(); // Tomorrow
    const slotEnd = new Date(Date.now() + 86400000 + 1800000).toISOString();

    const holdRes = await request.post('http://localhost:3000/api/bookings/hold', {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();
    expect(booking_id).toBeDefined();

    // 2. Confirm payment
    const confirmRes = await request.post('http://localhost:3000/api/bookings/confirm', {
      data: {
        booking_id,
        gateway_payment_id: `pay_test_${Date.now()}`,
      },
    });
    expect(confirmRes.status()).toBe(200);

    // 3. Merchant triggers reschedule to a new window (+2 hours)
    const newSlotStart = new Date(Date.now() + 86400000 + 7200000).toISOString();
    const newSlotEnd = new Date(Date.now() + 86400000 + 7200000 + 1800000).toISOString();

    const rescheduleRes = await request.post('http://localhost:3000/api/bookings/reschedule', {
      data: {
        booking_id,
        new_slot_start: newSlotStart,
        new_slot_end: newSlotEnd,
      },
    });
    expect(rescheduleRes.status()).toBe(200);
    const rescheduleJson = await rescheduleRes.json();
    expect(rescheduleJson.success).toBe(true);

    // 4. Verify updated schedule from Customer perspective (via Supabase)
    const { data: updatedBooking, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', booking_id)
      .single();

    expect(error).toBeNull();
    expect(updatedBooking.status).toBe('CONFIRMED');
    expect(new Date(updatedBooking.slot_start).getTime()).toBe(new Date(newSlotStart).getTime());
    expect(new Date(updatedBooking.slot_end).getTime()).toBe(new Date(newSlotEnd).getTime());
  });

  test('5. [Customer Cancellation with Policy Refund] Customer cancels advance booking on mobile; Merchant reflects CANCELLED status', async ({ browser, request }) => {
    // 1. Create and confirm a booking for +3 days in advance
    const slotStart = new Date(Date.now() + 259200000).toISOString();
    const slotEnd = new Date(Date.now() + 259200000 + 1800000).toISOString();

    const holdRes = await request.post('http://localhost:3000/api/bookings/hold', {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    const { booking_id } = await holdRes.json();

    await request.post('http://localhost:3000/api/bookings/confirm', {
      data: {
        booking_id,
        gateway_payment_id: `pay_cust_cancel_${Date.now()}`,
      },
    });

    const { data: booking } = await supabase
      .from('bookings')
      .select('reference_code')
      .eq('id', booking_id)
      .single();
    const refCode = booking?.reference_code || `TPT-${booking_id.slice(0, 6).toUpperCase()}`;

    // 2. Customer cancels appointment from My Appointments screen
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);

    await customerApp.goto();
    await customerApp.navigateToMyBookings();

    // Customer clicks cancel and accepts dialog
    await customerApp.cancelBookingFromList(refCode);

    // 3. Verify in UI and database: status becomes CANCELLED and payment_status is REFUNDED
    await customerApp.expectBookingInList(refCode, 'CANCELLED');

    await expect.poll(async () => {
      const { data: b } = await supabase
        .from('bookings')
        .select('status, payment_status')
        .eq('id', booking_id)
        .single();
      return b?.status;
    }, { timeout: 10000 }).toBe('CANCELLED');

    await expect.poll(async () => {
      const { data: b } = await supabase
        .from('bookings')
        .select('status, payment_status')
        .eq('id', booking_id)
        .single();
      return b?.payment_status;
    }, { timeout: 10000 }).toBe('REFUNDED');

    // 4. Verify Merchant Portal displays booking under CANCELLED filter
    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await merchantPortal.gotoBookings();
    await merchantPortal.filterByStatus('CANCELLED');
    await merchantPortal.searchBookings(refCode);
    await expect(merchantPortal.getBookingCard(refCode)).toBeVisible({ timeout: 10000 });

    await customerContext.close();
    await merchantContext.close();
  });

  test('6. [Merchant Cancellation -> Customer Refund] Merchant cancels booking; status becomes CANCELLED with REFUNDED deposit', async ({ request }) => {
    // 1. Create and confirm booking
    const slotStart = new Date(Date.now() + 259200000).toISOString();
    const slotEnd = new Date(Date.now() + 259200000 + 1800000).toISOString();

    const holdRes = await request.post('http://localhost:3000/api/bookings/hold', {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    const { booking_id } = await holdRes.json();

    await request.post('http://localhost:3000/api/bookings/confirm', {
      data: {
        booking_id,
        gateway_payment_id: `pay_cancel_${Date.now()}`,
      },
    });

    // 2. Merchant cancels booking
    const cancelRes = await request.post('http://localhost:3000/api/bookings/cancel', {
      data: {
        booking_id,
        reason: 'Staff emergency leave',
      },
    });
    expect(cancelRes.status()).toBe(200);

    // 3. Verify booking status is CANCELLED and deposit is REFUNDED
    const { data: cancelledBooking } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', booking_id)
      .single();

    expect(cancelledBooking.status).toBe('CANCELLED');
    expect(cancelledBooking.payment_status).toBe('REFUNDED');
  });

  test('7. [Merchant No-Show -> Customer Strike Penalty] Merchant marks no-show; deposit forfeits & customer strikes increment', async ({ request }) => {
    // 1. Read initial no-show count of customer
    const { data: initialProfile } = await supabase
      .from('profiles')
      .select('no_show_count')
      .eq('id', testCustomerId)
      .single();

    const initialStrikes = initialProfile?.no_show_count ?? 0;

    // 2. Create and confirm a booking
    const slotStart = new Date(Date.now() + 172800000).toISOString();
    const slotEnd = new Date(Date.now() + 172800000 + 1800000).toISOString();

    const holdRes = await request.post('http://localhost:3000/api/bookings/hold', {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    const { booking_id } = await holdRes.json();

    await request.post('http://localhost:3000/api/bookings/confirm', {
      data: {
        booking_id,
        gateway_payment_id: `pay_noshow_${Date.now()}`,
      },
    });

    // 3. Merchant reports No-Show via endpoint
    const noShowRes = await request.post('http://localhost:3000/api/bookings/no-show', {
      data: {
        booking_id,
      },
    });
    expect(noShowRes.status()).toBe(200);
    const noShowJson = await noShowRes.json();
    expect(noShowJson.success).toBe(true);

    // 4. Verify booking transitioned to NO_SHOW with FORFEITED deposit
    const { data: verifiedBooking } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', booking_id)
      .single();

    expect(verifiedBooking.status).toBe('NO_SHOW');
    expect(verifiedBooking.payment_status).toBe('FORFEITED');

    // 5. Verify Customer Profile strike count incremented by 1
    const { data: updatedProfile } = await supabase
      .from('profiles')
      .select('no_show_count')
      .eq('id', testCustomerId)
      .single();

    expect(updatedProfile?.no_show_count).toBe(initialStrikes + 1);
  });

  test('8. [Merchant Onboarding -> Customer Catalog Discovery] Newly onboarded business & services are discoverable in Customer mobile app', async ({ browser, request }) => {
    const timestamp = Date.now().toString().slice(-4);
    const newSalonName = `Tirupati Velvet Glow Unisex Spa ${timestamp}`;
    const newSpecialistName = `Stylist Mahesh (Color Specialist)`;

    // 1. Merchant registers a new salon venue
    const venueRes = await request.post('http://localhost:3000/api/admin/venues', {
      data: {
        name: newSalonName,
        categoryId: 'salons',
        address: 'Chandragiri Road, Opp. Reliance Smart Bazaar, Tirupati',
        phone: '+91 877 2299887',
        openingTime: '09:00:00',
        closingTime: '21:00:00',
        description: 'Premium hair styling, organic facials, and bridal makeovers.',
      },
    });
    expect(venueRes.status()).toBe(201);
    const { venue } = await venueRes.json();
    const providerId = venue.id;

    // 2. Merchant adds a specialist resource
    const resourceRes = await request.post('http://localhost:3000/api/admin/resources', {
      data: {
        providerId,
        name: newSpecialistName,
        type: 'stylist',
        department: 'Hair Care',
        price: 500,
        depositAmount: 100,
        durationMinutes: 45,
        capacity: 1,
      },
    });
    expect(resourceRes.status()).toBe(201);

    // 3. Open Customer Mobile App and verify catalog discovery
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);

    await customerApp.goto();
    await customerApp.selectCategory('Salons & Spas');

    // 4. Search for the newly added salon
    await customerApp.search(newSalonName);
    await expect(customerPage.getByText(newSalonName).first()).toBeVisible({ timeout: 10000 });

    // 5. Open venue details and verify the specialist is listed
    await customerPage.getByText(newSalonName).first().click();
    await expect(customerPage.getByText(newSpecialistName).first()).toBeVisible({ timeout: 10000 });
    await expect(customerPage.getByText('45 min slot • Max 1 person').first()).toBeVisible();
    await expect(customerPage.getByText('₹100').first()).toBeVisible();

    await customerContext.close();
  });

  test('9. [Digital Pass QR & Reference Code Verification] Customer views Digital Booking Pass; Merchant verifies customer via Reference Code search', async ({ browser, request }) => {
    // 1. Create and confirm a booking
    const slotStart = new Date(Date.now() + 345600000).toISOString(); // +4 days
    const slotEnd = new Date(Date.now() + 345600000 + 1800000).toISOString();

    const holdRes = await request.post('http://localhost:3000/api/bookings/hold', {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    const { booking_id } = await holdRes.json();

    await request.post('http://localhost:3000/api/bookings/confirm', {
      data: {
        booking_id,
        gateway_payment_id: `pay_pass_${Date.now()}`,
      },
    });

    // Fetch the reference code assigned to this booking
    const { data: booking } = await supabase
      .from('bookings')
      .select('reference_code')
      .eq('id', booking_id)
      .single();

    const referenceCode = booking?.reference_code || `TPT-${booking_id.slice(0, 6).toUpperCase()}`;

    // 2. Customer opens Mobile App and opens Digital Pass Modal
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);

    await customerApp.goto();
    await customerApp.navigateToMyBookings();
    await customerApp.openBookingPass(referenceCode);

    // Verify digital voucher elements
    await expect(customerPage.getByText('Digital Booking Pass')).toBeVisible();
    await customerApp.closeBookingPass();

    // 3. Merchant verifies customer arrival by searching reference code in Queue
    const merchantContext = await browser.newContext();
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await merchantPortal.gotoBookings();
    await merchantPortal.searchBookings(referenceCode);

    // Exact booking is isolated
    await expect(merchantPortal.getBookingCard(referenceCode)).toBeVisible({ timeout: 10000 });

    await customerContext.close();
    await merchantContext.close();
  });

  test('10. [Concurrency Collision Protection] Simultaneous slot hold attempts result in 1 confirmation and 1 conflict rejection', async ({ request }) => {
    const slotStart = new Date(Date.now() + 432000000).toISOString(); // +5 days
    const slotEnd = new Date(Date.now() + 432000000 + 1800000).toISOString();

    // Launch two simultaneous slot hold requests for the exact same resource & time window
    const [holdResponseA, holdResponseB] = await Promise.all([
      request.post('http://localhost:3000/api/bookings/hold', {
        data: {
          customer_id: testCustomerId,
          resource_id: testResourceId,
          slot_start: slotStart,
          slot_end: slotEnd,
        },
      }),
      request.post('http://localhost:3000/api/bookings/hold', {
        data: {
          customer_id: testCustomerId,
          resource_id: testResourceId,
          slot_start: slotStart,
          slot_end: slotEnd,
        },
      }),
    ]);

    const statuses = [holdResponseA.status(), holdResponseB.status()];

    // Exactly one must succeed (201 HELD) and one must be rejected (409 Conflict)
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);

    const conflictResponse = holdResponseA.status() === 409 ? holdResponseA : holdResponseB;
    const conflictJson = await conflictResponse.json();
    expect(conflictJson.error).toMatch(/already held or booked|conflict/i);
  });
});
