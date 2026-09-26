const fs = require('fs');

function loadEnv() {
  const content = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const RZP_KEY_ID = env.RAZORPAY_KEY_ID;
const RZP_KEY_SECRET = env.RAZORPAY_KEY_SECRET;
const APP_URL = 'http://localhost:3000';
const rzpAuthHeader = 'Basic ' + Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString('base64');

async function getRazorpayPayment(paymentId) {
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { Authorization: rzpAuthHeader }
  });
  return res.json();
}

async function getRazorpayRefunds(paymentId) {
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refunds`, {
    headers: { Authorization: rzpAuthHeader }
  });
  return res.json();
}

async function createUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'customer' }
    })
  });
  const data = await res.json();
  if (!data.id) throw new Error(`User creation failed: ${JSON.stringify(data)}`);
  return data.id;
}

async function deleteUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
}

async function run() {
  console.log('======================================================================');
  console.log('E2E TEST: MERCHANT CANCELLATION FULL REFUND (DEPOSIT + FEES + GST)');
  console.log('Policy Reference: /refund-policy Section 4 & CheckoutModal');
  console.log('Published Policy: "full refund of deposit and platform fee, regardless of timing"');
  console.log('Target Server: ' + APP_URL);
  console.log('Supabase Host: ' + SUPABASE_URL);
  console.log('======================================================================\n');

  // Check platform_config for gst_active
  const configRes = await fetch(`${SUPABASE_URL}/rest/v1/platform_config?key=eq.gst_active&select=value`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const configData = await configRes.json();
  const gstActive = configData[0]?.value === 'true';
  console.log(`Current Platform GST Status: [gst_active = "${configData[0]?.value}"] (${gstActive ? 'GST Active' : 'GST Disabled'})\n`);

  // Fetch test resource and provider
  const resRes = await fetch(`${SUPABASE_URL}/rest/v1/resources?select=id,provider_id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const resource = (await resRes.json())[0];
  if (!resource) throw new Error('No resource found for testing');

  const customerId = await createUser(`merchant_refund_test_${Date.now()}@example.com`, 'TestPassword!123');
  const createdBookings = [];

  try {
    // -------------------------------------------------------------------------
    // TEST CASE 1: Real booking under current configuration (GST Disabled: deposit + platform_fee)
    // -------------------------------------------------------------------------
    console.log('----------------------------------------------------------------------');
    console.log('TEST CASE 1: Merchant Cancellation with GST Disabled (platform_fee alone)');
    console.log('Values: Deposit = ₹100.00, Platform Fee = ₹10.00, GST = ₹0.00');
    console.log('Expected Full Refund: ₹110.00 (11000 paise)');
    console.log('Before Fix would have refunded: ₹100.00 (10000 paise) [BUG: lost ₹10 fee]');
    console.log('----------------------------------------------------------------------');

    const slotStart1 = new Date(Date.now() + 86400000 * 5).toISOString();
    const slotEnd1 = new Date(Date.now() + 86400000 * 5 + 1800000).toISOString();

    const hold1Res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_customer_id: customerId,
        p_resource_id: resource.id,
        p_slot_start: slotStart1,
        p_slot_end: slotEnd1
      })
    });
    const hold1 = await hold1Res.json();
    const bookingId1 = hold1.booking_id;
    createdBookings.push(bookingId1);

    const mockPaymentId1 = `pay_mock_gst_disabled_${Date.now()}`;
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId1}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        gateway_payment_id: mockPaymentId1,
        deposit_amount: 100.00,
        platform_fee: 10.00,
        platform_fee_gst: 0.00,
        total_amount: 110.00
      })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId1,
        gateway_payment_id: mockPaymentId1,
        amount: 110.00,
        currency: 'INR',
        status: 'CAPTURED'
      })
    });

    console.log(`Booking created: ${bookingId1}`);
    console.log(`- deposit_amount: 100.00`);
    console.log(`- platform_fee:   10.00`);
    console.log(`- platform_fee_gst: 0.00`);

    // Merchant cancels the booking
    const cancel1Res = await fetch(`${APP_URL}/api/bookings/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId1,
        initiated_by: 'MERCHANT',
        reason: 'Provider emergency maintenance'
      })
    });
    const cancel1Body = await cancel1Res.json();
    console.log('\nCancellation API Response:');
    console.log(`- success: ${cancel1Body.success}`);
    console.log(`- status: ${cancel1Body.status}`);
    console.log(`- payment_status: ${cancel1Body.payment_status}`);
    console.log(`- refund_amount returned: ₹${cancel1Body.refund_amount}`);
    console.log(`- amount sent to Razorpay (paise): ${cancel1Body.refund_gateway_paise} paise`);

    // Verify DB payments metadata
    const pay1Res = await fetch(`${SUPABASE_URL}/rest/v1/payments?booking_id=eq.${bookingId1}&select=status,metadata`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const pay1Record = (await pay1Res.json())[0];
    console.log(`- DB Payment status: ${pay1Record?.status}`);
    console.log(`- DB Payment recorded refund paise: ${pay1Record?.metadata?.refund_amount_paise} paise`);

    const case1RefundExact = cancel1Body.refund_amount === 110.00;
    const case1RazorpayExact = cancel1Body.refund_gateway_paise === 11000;
    const case1DbExact = pay1Record?.metadata?.refund_amount_paise === 11000;

    console.log(`\nCase 1 Assertions:`);
    console.log(`  [ASSERT] refund_amount === 110.00: ${case1RefundExact ? 'PASS' : 'FAIL'}`);
    console.log(`  [ASSERT] refund_gateway_paise === 11000: ${case1RazorpayExact ? 'PASS' : 'FAIL'}`);
    console.log(`  [ASSERT] DB metadata paise === 11000: ${case1DbExact ? 'PASS' : 'FAIL'}`);

    if (!case1RefundExact || !case1RazorpayExact || !case1DbExact) {
      throw new Error('Case 1 assertions failed!');
    }

    // -------------------------------------------------------------------------
    // TEST CASE 2: Booking with non-zero GST (deposit + platform_fee + platform_fee_gst)
    // -------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------------');
    console.log('TEST CASE 2: Merchant Cancellation with Active GST (non-zero platform_fee_gst)');
    console.log('Values: Deposit = ₹100.00, Platform Fee = ₹10.00, GST (18%) = ₹1.80');
    console.log('Expected Full Refund: ₹111.80 (11180 paise)');
    console.log('Before Fix would have refunded: ₹100.00 (10000 paise) [BUG: lost ₹11.80 fees+GST]');
    console.log('----------------------------------------------------------------------');

    const slotStart2 = new Date(Date.now() + 86400000 * 6).toISOString();
    const slotEnd2 = new Date(Date.now() + 86400000 * 6 + 1800000).toISOString();

    const hold2Res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_customer_id: customerId,
        p_resource_id: resource.id,
        p_slot_start: slotStart2,
        p_slot_end: slotEnd2
      })
    });
    const hold2 = await hold2Res.json();
    const bookingId2 = hold2.booking_id;
    createdBookings.push(bookingId2);

    const mockPaymentId2 = `pay_mock_gst_active_${Date.now()}`;
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId2}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        gateway_payment_id: mockPaymentId2,
        deposit_amount: 100.00,
        platform_fee: 10.00,
        platform_fee_gst: 1.80,
        total_amount: 111.80
      })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId2,
        gateway_payment_id: mockPaymentId2,
        amount: 111.80,
        currency: 'INR',
        status: 'CAPTURED'
      })
    });

    console.log(`Booking created: ${bookingId2}`);
    console.log(`- deposit_amount: 100.00`);
    console.log(`- platform_fee:   10.00`);
    console.log(`- platform_fee_gst: 1.80`);

    // Merchant cancels the booking
    const cancel2Res = await fetch(`${APP_URL}/api/bookings/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId2,
        initiated_by: 'MERCHANT',
        reason: 'Provider equipment breakdown'
      })
    });
    const cancel2Body = await cancel2Res.json();
    console.log('\nCancellation API Response:');
    console.log(`- success: ${cancel2Body.success}`);
    console.log(`- status: ${cancel2Body.status}`);
    console.log(`- payment_status: ${cancel2Body.payment_status}`);
    console.log(`- refund_amount returned: ₹${cancel2Body.refund_amount}`);
    console.log(`- amount sent to Razorpay (paise): ${cancel2Body.refund_gateway_paise} paise`);

    // Verify DB payments metadata
    const pay2Res = await fetch(`${SUPABASE_URL}/rest/v1/payments?booking_id=eq.${bookingId2}&select=status,metadata`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const pay2Record = (await pay2Res.json())[0];
    console.log(`- DB Payment status: ${pay2Record?.status}`);
    console.log(`- DB Payment recorded refund paise: ${pay2Record?.metadata?.refund_amount_paise} paise`);

    const case2RefundExact = cancel2Body.refund_amount === 111.80;
    const case2RazorpayExact = cancel2Body.refund_gateway_paise === 11180;
    const case2DbExact = pay2Record?.metadata?.refund_amount_paise === 11180;

    console.log(`\nCase 2 Assertions:`);
    console.log(`  [ASSERT] refund_amount === 111.80: ${case2RefundExact ? 'PASS' : 'FAIL'}`);
    console.log(`  [ASSERT] refund_gateway_paise === 11180: ${case2RazorpayExact ? 'PASS' : 'FAIL'}`);
    console.log(`  [ASSERT] DB metadata paise === 11180: ${case2DbExact ? 'PASS' : 'FAIL'}`);

    if (!case2RefundExact || !case2RazorpayExact || !case2DbExact) {
      throw new Error('Case 2 assertions failed!');
    }

    // -------------------------------------------------------------------------
    // TEST CASE 3: Live Razorpay Gateway Execution & Direct Verification
    // -------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------------');
    console.log('TEST CASE 3: Live Razorpay Gateway Execution (Real Payment ID)');
    console.log('Testing live dispatch to Razorpay API with deposit + fees');
    console.log('----------------------------------------------------------------------');

    const REAL_PAYMENT_ID = 'pay_SbphcmXyewhEKW';
    const rzpPaymentBefore = await getRazorpayPayment(REAL_PAYMENT_ID);
    const rzpRefundsBefore = await getRazorpayRefunds(REAL_PAYMENT_ID);
    const initialRefundCount = rzpRefundsBefore.count || 0;
    const initialRefundedAmount = (rzpPaymentBefore.amount_refunded || 0) / 100;

    console.log(`Target Live Payment: ${REAL_PAYMENT_ID}`);
    console.log(`- Gateway Status: ${rzpPaymentBefore.status}`);
    console.log(`- Prior Refunds Count on Razorpay: ${initialRefundCount}`);
    console.log(`- Prior Amount Refunded: ₹${initialRefundedAmount}`);

    const slotStart3 = new Date(Date.now() + 86400000 * 7).toISOString();
    const slotEnd3 = new Date(Date.now() + 86400000 * 7 + 1800000).toISOString();

    const hold3Res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_customer_id: customerId,
        p_resource_id: resource.id,
        p_slot_start: slotStart3,
        p_slot_end: slotEnd3
      })
    });
    const hold3 = await hold3Res.json();
    const bookingId3 = hold3.booking_id;
    createdBookings.push(bookingId3);

    // Using deposit ₹100 + platform fee ₹10 = ₹110.00 refund on live Razorpay payment
    const liveDeposit = 100.00;
    const liveFee = 10.00;
    const liveGst = 0.00;
    const liveTotalRefund = liveDeposit + liveFee + liveGst; // ₹110.00 (11000 paise)

    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId3}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        gateway_payment_id: REAL_PAYMENT_ID,
        deposit_amount: liveDeposit,
        platform_fee: liveFee,
        platform_fee_gst: liveGst,
        total_amount: liveTotalRefund
      })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId3,
        gateway_payment_id: REAL_PAYMENT_ID,
        amount: liveTotalRefund,
        currency: 'INR',
        status: 'CAPTURED'
      })
    });

    // Merchant cancels live booking
    const cancel3Res = await fetch(`${APP_URL}/api/bookings/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId3,
        initiated_by: 'MERCHANT',
        reason: 'Merchant emergency shutdown'
      })
    });
    const cancel3Body = await cancel3Res.json();
    console.log('\nLive Cancellation API Response:');
    console.log(`- success: ${cancel3Body.success}`);
    console.log(`- status: ${cancel3Body.status}`);
    console.log(`- payment_status: ${cancel3Body.payment_status}`);
    console.log(`- refund_amount: ₹${cancel3Body.refund_amount}`);
    console.log(`- refund_gateway_paise: ${cancel3Body.refund_gateway_paise}`);

    // Query Razorpay Gateway directly to verify refund receipt
    const rzpRefundsAfter = await getRazorpayRefunds(REAL_PAYMENT_ID);
    const newestRefund = rzpRefundsAfter.items && rzpRefundsAfter.items[0];

    console.log('\nRazorpay Test Gateway Live Receipt:');
    console.log(`- Razorpay Refund ID: ${newestRefund?.id}`);
    console.log(`- Gateway Refund Amount: ₹${(newestRefund?.amount || 0) / 100} (${newestRefund?.amount} paise)`);
    console.log(`- Gateway Refund Status: ${newestRefund?.status}`);
    console.log(`- Created At: ${new Date((newestRefund?.created_at || 0) * 1000).toISOString()}`);

    const case3RefundExact = cancel3Body.refund_amount === 110.00;
    const case3GatewayExact = newestRefund?.amount === 11000;
    const case3Processed = newestRefund?.status === 'processed';

    console.log(`\nCase 3 Assertions:`);
    console.log(`  [ASSERT] API refund_amount === 110.00: ${case3RefundExact ? 'PASS' : 'FAIL'}`);
    console.log(`  [ASSERT] Razorpay actual refund === 11000 paise: ${case3GatewayExact ? 'PASS' : 'FAIL'}`);
    console.log(`  [ASSERT] Razorpay refund status === "processed": ${case3Processed ? 'PASS' : 'FAIL'}`);

    if (!case3RefundExact || !case3GatewayExact || !case3Processed) {
      throw new Error('Case 3 assertions failed!');
    }

    console.log('\n======================================================================');
    console.log('ALL TESTS PASSED: Merchant cancellation refunds full deposit + platform fee + GST exactly!');
    console.log('======================================================================\n');

  } finally {
    console.log('Cleaning up test bookings & customer fixtures...');
    for (const bId of createdBookings) {
      await fetch(`${SUPABASE_URL}/rest/v1/payments?booking_id=eq.${bId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
      await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
    }
    if (customerId) await deleteUser(customerId);
    console.log('Teardown complete.');
  }
}

run().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
