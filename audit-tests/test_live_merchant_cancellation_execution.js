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
const TARGET_PAYMENT_ID = 'pay_SbqEyR99JWpTF8'; // Captured payment with ₹9,776 available balance

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
  console.log('LIVE VERIFICATION: MERCHANT CANCELLATION REFUND (DEPOSIT + FEES)');
  console.log('Target Server: ' + APP_URL);
  console.log('Razorpay Test Payment ID: ' + TARGET_PAYMENT_ID);
  console.log('======================================================================\n');

  // 1. Check GST Status
  const configRes = await fetch(`${SUPABASE_URL}/rest/v1/platform_config?key=eq.gst_active&select=value`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const configData = await configRes.json();
  const gstActive = configData[0]?.value === 'true';
  console.log(`[CONFIG] gst_active = "${configData[0]?.value}" (${gstActive ? 'Active' : 'Disabled'})`);

  const deposit = 100.00;
  const platformFee = 10.00;
  const gstRate = 0.18;
  const platformFeeGst = gstActive ? Number((platformFee * gstRate).toFixed(2)) : 0.00;
  const expectedRefundAmount = deposit + platformFee + platformFeeGst;
  const expectedRefundPaise = Math.round(expectedRefundAmount * 100);

  console.log(`[BOOKING PARAMS]:`);
  console.log(`- deposit_amount:   ₹${deposit.toFixed(2)}`);
  console.log(`- platform_fee:     ₹${platformFee.toFixed(2)}`);
  console.log(`- platform_fee_gst: ₹${platformFeeGst.toFixed(2)}`);
  console.log(`- expected_refund:  ₹${expectedRefundAmount.toFixed(2)} (${expectedRefundPaise} paise)`);
  console.log(`- old_buggy_refund: ₹${deposit.toFixed(2)} (deposit only — would fail)\n`);

  // 2. Check Razorpay Payment state before refund
  console.log('1. Checking Gateway Payment on Razorpay before refund...');
  const rzpBefore = await getRazorpayPayment(TARGET_PAYMENT_ID);
  const rzpRefundsBefore = await getRazorpayRefunds(TARGET_PAYMENT_ID);
  const initialRefundCount = rzpRefundsBefore.count || 0;
  const initialRefundedPaise = rzpBefore.amount_refunded || 0;

  console.log(`   - Payment Status: ${rzpBefore.status}`);
  console.log(`   - Total Captured: ₹${rzpBefore.amount / 100}`);
  console.log(`   - Already Refunded: ₹${initialRefundedPaise / 100}`);
  console.log(`   - Prior Refunds Count: ${initialRefundCount}\n`);

  // 3. Create test booking
  console.log('2. Creating paid test booking in database...');
  const resRes = await fetch(`${SUPABASE_URL}/rest/v1/resources?select=id,provider_id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const resource = (await resRes.json())[0];
  const customerId = await createUser(`merch_cancel_test_${Date.now()}@example.com`, 'TestPassword!123');

  let bookingId;
  try {
    const slotStart = new Date(Date.now() + 86400000 * 4).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 4 + 1800000).toISOString();

    const holdRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_customer_id: customerId,
        p_resource_id: resource.id,
        p_slot_start: slotStart,
        p_slot_end: slotEnd
      })
    });
    const hold = await holdRes.json();
    bookingId = hold.booking_id;

    // Confirm booking and attach payment details
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        gateway_payment_id: TARGET_PAYMENT_ID,
        deposit_amount: deposit,
        platform_fee: platformFee,
        platform_fee_gst: platformFeeGst,
        total_amount: expectedRefundAmount
      })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId,
        gateway_payment_id: TARGET_PAYMENT_ID,
        amount: expectedRefundAmount,
        currency: 'INR',
        status: 'CAPTURED'
      })
    });

    console.log(`   - Booking ID: ${bookingId}`);
    console.log(`   - Attached Payment ID: ${TARGET_PAYMENT_ID}\n`);

    // 4. Have merchant cancel it via API directly
    console.log('3. Cancelling booking via API directly (initiated_by: "MERCHANT")...');
    console.log(`   POST ${APP_URL}/api/bookings/cancel`);
    console.log(`   Payload: { booking_id: "${bookingId}", initiated_by: "MERCHANT", reason: "Merchant emergency schedule change" }\n`);

    const cancelRes = await fetch(`${APP_URL}/api/bookings/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId,
        initiated_by: 'MERCHANT',
        reason: 'Merchant emergency schedule change'
      })
    });

    const cancelData = await cancelRes.json();
    console.log('4. API Cancellation Response Received:');
    console.log(JSON.stringify(cancelData, null, 2));

    // 5. Cross-check Razorpay refund call & test dashboard
    console.log('\n5. Cross-checking live Razorpay test dashboard & API for payment ' + TARGET_PAYMENT_ID + '...');
    const rzpAfter = await getRazorpayPayment(TARGET_PAYMENT_ID);
    const rzpRefundsAfter = await getRazorpayRefunds(TARGET_PAYMENT_ID);
    const newestRefund = rzpRefundsAfter.items && rzpRefundsAfter.items[0];

    console.log('\n======================================================================');
    console.log('CROSS-CHECK VERIFICATION DETAILS:');
    console.log('======================================================================');
    console.log(`API response refund_amount:       ₹${cancelData.refund_amount}`);
    console.log(`API response refund_gateway_paise: ${cancelData.refund_gateway_paise} paise`);
    console.log(`Razorpay Refund ID on Gateway:     ${newestRefund?.id}`);
    console.log(`Razorpay Refund Amount on Gateway: ₹${(newestRefund?.amount || 0) / 100} (${newestRefund?.amount} paise)`);
    console.log(`Razorpay Refund Gateway Status:    ${newestRefund?.status}`);
    console.log(`Razorpay Total Amount Refunded:    ₹${(rzpAfter.amount_refunded || 0) / 100} (was ₹${initialRefundedPaise / 100})`);
    console.log(`Razorpay Refund Created At:        ${new Date((newestRefund?.created_at || 0) * 1000).toISOString()}`);
    console.log(`Razorpay Refund Notes:             `, newestRefund?.notes);

    // 6. Pass / Fail Evaluation
    const isPass = (
      cancelData.refund_amount === expectedRefundAmount &&
      cancelData.refund_gateway_paise === expectedRefundPaise &&
      newestRefund?.amount === expectedRefundPaise &&
      newestRefund?.status === 'processed'
    );

    const isDepositOnly = (
      cancelData.refund_amount === deposit ||
      newestRefund?.amount === Math.round(deposit * 100)
    );

    console.log('\n======================================================================');
    if (isPass) {
      console.log(`RESULT: PASS`);
      console.log(`Refund amount equals deposit (₹${deposit}) + platform fee (₹${platformFee}) + GST (₹${platformFeeGst}) = ₹${expectedRefundAmount} (${expectedRefundPaise} paise).`);
      console.log(`Both the API response and the actual amount sent to Razorpay equal ₹${expectedRefundAmount} exactly.`);
    } else if (isDepositOnly) {
      console.log(`RESULT: FAIL`);
      console.log(`Refund amount was deposit only (₹${deposit})! Platform fee was not refunded.`);
      process.exit(1);
    } else {
      console.log(`RESULT: FAIL (Unexpected refund amounts)`);
      process.exit(1);
    }
    console.log('======================================================================\n');

  } finally {
    console.log('Cleaning up test booking and customer fixtures...');
    if (bookingId) {
      await fetch(`${SUPABASE_URL}/rest/v1/payments?booking_id=eq.${bookingId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
      await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
    }
    if (customerId) await deleteUser(customerId);
    console.log('Teardown complete.');
  }
}

run().catch(err => {
  console.error('Execution error:', err);
  process.exit(1);
});
