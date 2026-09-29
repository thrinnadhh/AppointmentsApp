import { test, expect } from '@playwright/test';
import { CustomerAppPage } from './pages/customer-app.page';
import { MerchantPortalPage } from './pages/merchant-portal.page';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

test.describe('Comprehensive Razorpay Payment Gateway Full-Flow Suite', () => {
  const testCustomerId = '99999999-9999-9999-9999-999999999991'; // Kalyan Chakravarthy seed account

  test('End-to-End Payment: UI Method Selection -> Order Creation -> Verification -> DB Settle -> Merchant Queue', async ({ browser }) => {
    // =========================================================================
    // STEP 1: Customer Browse & Slot Selection on Mobile Web (port 8081)
    // =========================================================================
    const customerContext = await browser.newContext({
      viewport: { width: 412, height: 915 },
      timezoneId: 'Asia/Kolkata',
      locale: 'en-IN',
    });
    const customerPage = await customerContext.newPage();
    const customerApp = new CustomerAppPage(customerPage);

    await customerApp.goto();
    await customerApp.selectCategory('Hospitals & Clinics');
    await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
    await customerApp.selectFirstSlot();

    // =========================================================================
    // STEP 2: Open Checkout Modal & Verify Timer + Details
    // =========================================================================
    await customerApp.openCheckout();

    // Verify 5-minute countdown card
    const timerCard = customerPage.locator('text=/Slot Held for You/i');
    await expect(timerCard).toBeVisible();

    // Verify deposit amount
    await expect(customerPage.locator('text=₹100').first()).toBeVisible();

    // =========================================================================
    // STEP 3: Interactive Payment Method Selector (UPI, QR, Card)
    // =========================================================================
    const paymentCard = customerPage.locator('[data-testid="payment-method-card"]');
    await expect(paymentCard).toBeVisible();
    await expect(paymentCard.getByText('⚡ Razorpay Secure')).toBeVisible();

    // 3a. Switch to QR Code tab
    const qrTab = customerPage.getByRole('button', { name: 'Select QR Code Payment' });
    await qrTab.click();
    await expect(customerPage.getByText(/Scan & Pay ₹(100|110)/)).toBeVisible();


    // 3b. Switch to Card tab
    const cardTab = customerPage.getByRole('button', { name: 'Select Card Payment' });
    await cardTab.click();
    await expect(customerPage.getByText('4242 (Razorpay Sandbox)')).toBeVisible();

    // 3c. Switch back to UPI tab & select PhonePe
    const upiTab = customerPage.getByRole('button', { name: 'Select UPI Payment' });
    await upiTab.click();
    const phonePeBtn = customerPage.getByRole('button', { name: 'PhonePe' });
    await expect(phonePeBtn).toBeVisible();
    await phonePeBtn.click();

    // =========================================================================
    // STEP 4: Submit Payment & Intercept Order / Verify API Calls
    // =========================================================================
    let orderApiCalled = false;
    let verifyApiCalled = false;
    let returnedKeyId = '';

    customerPage.on('request', (req) => {
      if (req.url().includes('/api/payments/create-order')) orderApiCalled = true;
      if (req.url().includes('/api/payments/verify')) verifyApiCalled = true;
    });

    customerPage.on('response', async (res) => {
      if (res.url().includes('/api/payments/create-order') && res.status() === 200) {
        try {
          const json = await res.json();
          if (json.key_id) returnedKeyId = json.key_id;
        } catch {}
      }
    });

    await customerApp.submitPayment();

    // =========================================================================
    // STEP 5: Verify Confirmation & Customer State Progression
    // =========================================================================
    await expect(customerApp.confirmationToast).toBeVisible({ timeout: 15000 });
    await expect(customerApp.myBookingsTitle).toBeVisible();

    // Verify active confirmed appointment in My Bookings
    const confirmedBadge = customerPage.getByText('CONFIRMED').first();
    await expect(confirmedBadge).toBeVisible();
    await expect(customerPage.getByText(/Deposit Paid:\s*₹100/i).first()).toBeVisible();

    expect(orderApiCalled).toBe(true);
    expect(verifyApiCalled).toBe(true);
    expect(returnedKeyId).toMatch(/^rzp_test_/);

    // =========================================================================
    // STEP 6: Verify Supabase Database Ledger Directly
    // =========================================================================
    const { data: dbBookings, error: dbError } = await supabase
      .from('bookings')
      .select('id, reference_code, status, payment_status, deposit_amount, gateway_payment_id')
      .eq('customer_id', testCustomerId)
      .eq('status', 'CONFIRMED')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(dbError).toBeNull();
    expect(dbBookings).toBeDefined();
    expect(dbBookings!.length).toBeGreaterThan(0);

    const latestBooking = dbBookings![0];
    expect(latestBooking.status).toBe('CONFIRMED');
    expect(latestBooking.payment_status).toBe('CAPTURED');
    expect(latestBooking.deposit_amount).toBe(100);
    expect(latestBooking.gateway_payment_id).toMatch(/^pay_/);
    console.log(`Verified Supabase Booking: ID=${latestBooking.id}, Code=${latestBooking.reference_code}, PaymentID=${latestBooking.gateway_payment_id}`);

    // =========================================================================
    // STEP 7: Cross-App Verification: Merchant Live Bookings Queue (port 3000)
    // =========================================================================
    const merchantContext = await browser.newContext({
      timezoneId: 'Asia/Kolkata',
      locale: 'en-IN',
    });
    const merchantPage = await merchantContext.newPage();
    const merchantPortal = new MerchantPortalPage(merchantPage);

    await merchantPortal.gotoBookings();
    await merchantPortal.filterByStatus('CONFIRMED');

    // Verify booking appears in Merchant's queue with deposit
    await expect(
      merchantPage.locator('strong', { hasText: 'Sri Venkateswara Dental & Implant Care' }).first()
    ).toBeVisible();
    await expect(merchantPage.getByText('CONFIRMED').first()).toBeVisible();

    await customerContext.close();
    await merchantContext.close();
  });
});
