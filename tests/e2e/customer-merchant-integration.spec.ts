import { test, expect } from '@playwright/test';
import { CustomerAppPage } from './pages/customer-app.page';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_PQ0ToJguSqBpF6eWP3aP9w_NT4hFLef';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

test.describe.serial('Customer & Merchant Cross-App Integration Test Suite', () => {
  const testCustomerEmail = 'customer.integration@tirupati.care';
  const testCustomerId = '99999999-9999-9999-9999-999999999991'; // Kalyan Chakravarthy seed account

  test('1. [Customer Booking -> Merchant Live Queue] Customer books appointment on mobile app; Merchant sees it live on bookings dashboard', async ({ browser, request }) => {
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

    await merchantPage.goto('http://localhost:3000/bookings');
    await expect(merchantPage.getByRole('heading', { name: 'Bookings & Queue' })).toBeVisible();

    // 3. Merchant searches for customer or verifies confirmed bookings
    const searchInput = merchantPage.locator('#customer-search');
    await expect(searchInput).toBeVisible();

    // Click 'CONFIRMED' status filter pill
    const confirmedFilterBtn = merchantPage.getByRole('button', { name: 'CONFIRMED', exact: true });
    await expect(confirmedFilterBtn).toBeVisible();
    await confirmedFilterBtn.click();

    // 4. Verify that the merchant sees the confirmed booking for Sri Venkateswara Dental in the queue
    await expect(merchantPage.locator('strong', { hasText: 'Sri Venkateswara Dental & Implant Care' }).first()).toBeVisible();
    await expect(merchantPage.getByText('CONFIRMED').first()).toBeVisible();

    await customerContext.close();
    await merchantContext.close();
  });

  test('2. [Merchant Reschedule -> Customer Notification] Merchant reschedules an appointment; Customer view reflects updated time', async ({ request }) => {
    // 1. Create a fresh booking via Backend API
    const slotStart = new Date(Date.now() + 86400000).toISOString(); // Tomorrow
    const slotEnd = new Date(Date.now() + 86400000 + 1800000).toISOString();

    const holdRes = await request.post('http://localhost:3000/api/bookings/hold', {
      data: {
        customer_id: testCustomerId,
        resource_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', // Dr. S. K. Murthy
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

  test('3. [Merchant No-Show -> Customer Strike Penalty] Merchant marks no-show; deposit forfeits & customer strikes increment', async ({ request }) => {
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
        resource_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
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

  test('4. [Merchant Cancellation -> Customer Refund] Merchant cancels booking; status becomes CANCELLED with REFUNDED deposit', async ({ request }) => {
    // 1. Create and confirm booking
    const slotStart = new Date(Date.now() + 259200000).toISOString();
    const slotEnd = new Date(Date.now() + 259200000 + 1800000).toISOString();

    const holdRes = await request.post('http://localhost:3000/api/bookings/hold', {
      data: {
        customer_id: testCustomerId,
        resource_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
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

  test('5. [Merchant Onboarding -> Customer Catalog Discovery] Newly onboarded business & services are discoverable in Customer mobile app', async ({ browser, request }) => {
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
});
