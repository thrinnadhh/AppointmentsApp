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
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const RZP_KEY_ID = env.RAZORPAY_KEY_ID;
const RZP_KEY_SECRET = env.RAZORPAY_KEY_SECRET;
const APP_URL = 'http://localhost:3000';
const REAL_PAYMENT_ID = 'pay_SbphcmXyewhEKW';

const rzpAuthHeader = 'Basic ' + Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString('base64');

async function getRazorpayPaymentDetails(paymentId) {
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

async function loginUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Login failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function deleteUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
}

async function run() {
  console.log('======================================================================');
  console.log('REAL RAZORPAY TEST CANCELLATION & VERIFIABLE REFUND AUDIT');
  console.log('Target App: ' + APP_URL);
  console.log('Target Razorpay Payment: ' + REAL_PAYMENT_ID);
  console.log('======================================================================\n');

  // 1. CHECK RAZORPAY PAYMENT STATE BEFORE CANCELLATION
  console.log('1. Checking Razorpay Payment State BEFORE Cancellation:');
  const rzpBefore = await getRazorpayPaymentDetails(REAL_PAYMENT_ID);
  const refundsBefore = await getRazorpayRefunds(REAL_PAYMENT_ID);
  console.log(`   - Payment ID: ${rzpBefore.id}`);
  console.log(`   - Status: ${rzpBefore.status}`);
  console.log(`   - Total Amount: ₹${rzpBefore.amount / 100}`);
  console.log(`   - Amount Already Refunded: ₹${rzpBefore.amount_refunded / 100}`);
  console.log(`   - Refund Status: ${rzpBefore.refund_status || 'none'}`);
  console.log(`   - Prior Refunds Count on Gateway: ${refundsBefore.count || 0}\n`);

  if (rzpBefore.status !== 'captured') {
    throw new Error(`Target payment ${REAL_PAYMENT_ID} is not captured (status: ${rzpBefore.status})`);
  }

  const initialRefundCount = refundsBefore.count || 0;
  const initialRefundedAmount = rzpBefore.amount_refunded / 100;

  const stamp = Date.now();
  const customerEmail = `real_refund_cust_${stamp}@example.com`;
  const password = `RealRefundPass_${stamp}!123`;
  let customerId, bookingId;

  try {
    // 2. CREATE TEST CUSTOMER & JWT
    console.log('2. Setting up test customer...');
    customerId = await createUser(customerEmail, password);
    const customerToken = await loginUser(customerEmail, password);
    console.log(`   - Customer ID: ${customerId}`);
    console.log(`   - Acquired valid customer session token.\n`);

    // 3. CREATE BOOKING WITH > 60 MINS REMAINING (3 DAYS IN FUTURE)
    console.log('3. Provisioning real booking tied to captured Razorpay payment...');
    const resRes = await fetch(`${SUPABASE_URL}/rest/v1/resources?select=id,provider_id&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const resource = (await resRes.json())[0];

    const slotStart = new Date(Date.now() + 86400000 * 3).toISOString(); // 3 days in future (> 60m)
    const slotEnd = new Date(Date.now() + 86400000 * 3 + 1800000).toISOString();

    const holdRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_customer_id: customerId,
        p_resource_id: resource.id,
        p_slot_start: slotStart,
        p_slot_end: slotEnd
      })
    });
    const hold = await holdRes.json();
    bookingId = hold.booking_id;

    // Confirm booking in DB and link the real Razorpay payment
    const refundAmountToIssue = 100.00; // ₹100 refund
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        gateway_payment_id: REAL_PAYMENT_ID,
        deposit_amount: refundAmountToIssue,
        total_amount: refundAmountToIssue + 10.00,
        gateway_order_id: rzpBefore.order_id
      })
    });

    // Create payment ledger record
    await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId,
        gateway_payment_id: REAL_PAYMENT_ID,
        amount: refundAmountToIssue,
        currency: 'INR',
        status: 'CAPTURED'
      })
    });

    // Verify initial DB state
    const bkgBeforeRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=id,status,payment_status,deposit_amount,slot_start,gateway_payment_id`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const bkgBefore = (await bkgBeforeRes.json())[0];
    const minutesToSlot = Math.round((new Date(bkgBefore.slot_start).getTime() - Date.now()) / (1000 * 60));
    console.log(`   - Booking ID: ${bkgBefore.id}`);
    console.log(`   - Status: ${bkgBefore.status}`);
    console.log(`   - Payment Status: ${bkgBefore.payment_status}`);
    console.log(`   - Linked Gateway Payment: ${bkgBefore.gateway_payment_id}`);
    console.log(`   - Deposit Amount: ₹${bkgBefore.deposit_amount}`);
    console.log(`   - Time to Slot Start: ${minutesToSlot} minutes (> 60m cancellation policy)\n`);

    // 4. CALL POST /api/bookings/cancel
    console.log('4. Executing customer cancellation via POST /api/bookings/cancel...');
    const cancelRes = await fetch(`${APP_URL}/api/bookings/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId,
        initiated_by: 'CUSTOMER',
        reason: 'Verification of live Razorpay refund gateway call'
      })
    });

    const cancelStatus = cancelRes.status;
    const cancelBody = await cancelRes.json();
    console.log(`   - HTTP Status: ${cancelStatus}`);
    console.log(`   - Cancel Response:`, JSON.stringify(cancelBody, null, 2));

    // 5. QUERY DATABASE POST-CANCELLATION
    console.log('\n5. Verifying Database State After Cancellation:');
    const bkgAfterRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=id,status,payment_status,deposit_amount,gateway_payment_id`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const bkgAfter = (await bkgAfterRes.json())[0];
    console.log(`   - DB Booking Status: "${bkgAfter.status}"`);
    console.log(`   - DB Payment Status: "${bkgAfter.payment_status}"`);

    const payAfterRes = await fetch(`${SUPABASE_URL}/rest/v1/payments?booking_id=eq.${bookingId}&select=status`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const payAfter = (await payAfterRes.json())[0];
    console.log(`   - DB Payment Ledger Status: "${payAfter?.status}"\n`);

    // 6. QUERY RAZORPAY DIRECTLY TO CONFIRM REFUND WAS ACTUALLY ISSUED ON GATEWAY
    console.log('6. Verifying Real Status in Razorpay Test Gateway/Dashboard:');
    const rzpAfter = await getRazorpayPaymentDetails(REAL_PAYMENT_ID);
    const refundsAfter = await getRazorpayRefunds(REAL_PAYMENT_ID);

    console.log(`   - Gateway Payment ID: ${rzpAfter.id}`);
    console.log(`   - Gateway Payment Status: ${rzpAfter.status}`);
    console.log(`   - Total Amount: ₹${rzpAfter.amount / 100}`);
    console.log(`   - Amount Refunded Now: ₹${rzpAfter.amount_refunded / 100} (was ₹${initialRefundedAmount})`);
    console.log(`   - Refund Status on Razorpay: "${rzpAfter.refund_status}"`);
    console.log(`   - Total Refunds on Payment: ${refundsAfter.count} (was ${initialRefundCount})`);

    const newestRefund = refundsAfter.items && refundsAfter.items[0];
    if (newestRefund) {
      console.log('\n   [OFFICIAL RAZORPAY REFUND RECEIPT]:');
      console.log(`   - Razorpay Refund ID: ${newestRefund.id}`);
      console.log(`   - Amount: ₹${newestRefund.amount / 100} ${newestRefund.currency}`);
      console.log(`   - Gateway Status: ${newestRefund.status}`);
      console.log(`   - Created At: ${new Date(newestRefund.created_at * 1000).toISOString()}`);
      console.log(`   - Notes:`, newestRefund.notes);
    }

    const dbRefunded = bkgAfter.status === 'CANCELLED' && bkgAfter.payment_status === 'REFUNDED';
    const rzpRefundProcessed = refundsAfter.count > initialRefundCount && newestRefund?.status === 'processed';

    const testPassed = dbRefunded && rzpRefundProcessed;
    console.log('\n======================================================================');
    console.log(`VERIFICATION RESULT: [${testPassed ? 'PASS - REFUND VERIFIED IN RAZORPAY DASHBOARD & DB REFUNDED' : 'FAIL'}]`);
    console.log('======================================================================\n');

    if (!testPassed) process.exit(1);

  } finally {
    console.log('Teardown: Cleaning up test fixtures...');
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
  console.error('Audit run error:', err);
  process.exit(1);
});
