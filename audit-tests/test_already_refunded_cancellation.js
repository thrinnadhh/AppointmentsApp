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
const ALREADY_REFUNDED_PAYMENT_ID = 'pay_SYCBX4yi74t1Bc';

const rzpAuthHeader = 'Basic ' + Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString('base64');

async function getRazorpayPaymentDetails(paymentId) {
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
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
  console.log('TEST: CANCELLATION WITH AN ALREADY-REFUNDED RAZORPAY PAYMENT ID');
  console.log('Target App: ' + APP_URL);
  console.log('Target Payment ID: ' + ALREADY_REFUNDED_PAYMENT_ID);
  console.log('======================================================================\n');

  // 1. Verify Razorpay Payment is indeed already refunded
  console.log('1. Verifying Gateway Status of Target Payment:');
  const rzpPayment = await getRazorpayPaymentDetails(ALREADY_REFUNDED_PAYMENT_ID);
  console.log(`   - Payment ID: ${rzpPayment.id}`);
  console.log(`   - Status: ${rzpPayment.status}`);
  console.log(`   - Total Amount: ₹${rzpPayment.amount / 100}`);
  console.log(`   - Amount Refunded: ₹${rzpPayment.amount_refunded / 100}`);
  console.log(`   - Refund Status: "${rzpPayment.refund_status}" (confirmed fully refunded on Razorpay)\n`);

  if (rzpPayment.refund_status !== 'full') {
    throw new Error(`Expected payment ${ALREADY_REFUNDED_PAYMENT_ID} to be fully refunded, got: ${rzpPayment.refund_status}`);
  }

  const stamp = Date.now();
  const customerEmail = `already_rfnd_${stamp}@example.com`;
  const password = `AlreadyRfndPass_${stamp}!123`;
  let customerId, bookingId;

  try {
    // 2. Set up test customer
    console.log('2. Setting up test customer and session token...');
    customerId = await createUser(customerEmail, password);
    const customerToken = await loginUser(customerEmail, password);
    console.log(`   - Customer ID: ${customerId}\n`);

    // 3. Create booking with > 60m remaining
    console.log('3. Provisioning booking tied to this already-refunded payment ID...');
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

    // Confirm booking in DB and link the already-refunded payment
    const depositAmount = 100.00;
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
        gateway_payment_id: ALREADY_REFUNDED_PAYMENT_ID,
        deposit_amount: depositAmount,
        total_amount: depositAmount + 10.00,
        gateway_order_id: rzpPayment.order_id
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
        gateway_payment_id: ALREADY_REFUNDED_PAYMENT_ID,
        amount: depositAmount,
        currency: 'INR',
        status: 'CAPTURED'
      })
    });

    const bkgBeforeRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=id,status,payment_status,deposit_amount,slot_start,gateway_payment_id`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const bkgBefore = (await bkgBeforeRes.json())[0];
    const minutesToSlot = Math.round((new Date(bkgBefore.slot_start).getTime() - Date.now()) / (1000 * 60));
    console.log(`   - Booking ID: ${bkgBefore.id}`);
    console.log(`   - Status Before: ${bkgBefore.status}`);
    console.log(`   - Payment Status Before: ${bkgBefore.payment_status}`);
    console.log(`   - Linked Gateway Payment: ${bkgBefore.gateway_payment_id}`);
    console.log(`   - Time to Slot Start: ${minutesToSlot} minutes (> 60m cancellation policy)\n`);

    // 4. CALL POST /api/bookings/cancel
    console.log('4. Calling POST /api/bookings/cancel as customer...');
    const cancelRes = await fetch(`${APP_URL}/api/bookings/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId,
        initiated_by: 'CUSTOMER',
        reason: 'Testing cancellation on already-refunded payment'
      })
    });

    const cancelStatus = cancelRes.status;
    const cancelBody = await cancelRes.json();
    console.log(`   - HTTP Status: ${cancelStatus}`);
    console.log(`   - Cancel Response Body:`, JSON.stringify(cancelBody, null, 2));

    // 5. QUERY DATABASE POST-CANCELLATION
    console.log('\n5. Verifying Database State After Cancellation:');
    const bkgAfterRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=id,status,payment_status,deposit_amount,gateway_payment_id`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const bkgAfter = (await bkgAfterRes.json())[0];
    console.log(`   - DB Booking Status: "${bkgAfter.status}"`);
    console.log(`   - DB Payment Status: "${bkgAfter.payment_status}" (MUST BE REFUND_FAILED, NOT REFUNDED)`);

    const payAfterRes = await fetch(`${SUPABASE_URL}/rest/v1/payments?booking_id=eq.${bookingId}&select=status`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const payAfter = (await payAfterRes.json())[0];
    console.log(`   - DB Payment Ledger Status: "${payAfter?.status}"`);

    // 6. VERIFY AUDIT LOG AND ADMIN ALERTS
    console.log('\n6. Verifying Audit Log and Admin Alert Notifications:');
    const auditRes = await fetch(`${SUPABASE_URL}/rest/v1/admin_audit_logs?target_id=eq.${bookingId}&select=action,details`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const auditLogs = await auditRes.json();
    const latestAudit = auditLogs[0];
    console.log(`   - Admin Audit Log Found: ${Boolean(latestAudit)}`);
    console.log(`   - Action: ${latestAudit?.action}`);
    console.log(`   - Error Recorded from Razorpay: "${latestAudit?.details?.error}"`);

    const notifRes = await fetch(`${SUPABASE_URL}/rest/v1/notification_logs?booking_id=eq.${bookingId}&select=event_type,message_content`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const notifs = await notifRes.json();
    const alertNotif = notifs.find(n => n.event_type === 'REFUND_FAILED_ALERT');
    console.log(`   - Notification Alert Found: ${Boolean(alertNotif)}`);
    console.log(`   - Alert Message: "${alertNotif?.message_content}"`);

    // Assertions
    const passCancelled = bkgAfter.status === 'CANCELLED';
    const passRefundFailed = bkgAfter.payment_status === 'REFUND_FAILED' && cancelBody.payment_status === 'REFUND_FAILED';
    const notRefunded = bkgAfter.payment_status !== 'REFUNDED';
    const passAudit = latestAudit?.action === 'REFUND_MANUAL_INTERVENTION_REQUIRED' &&
                      latestAudit?.details?.error?.includes('The payment has been fully refunded already');
    const passAlert = Boolean(alertNotif);

    const testPassed = passCancelled && passRefundFailed && notRefunded && passAudit && passAlert;
    console.log('\n======================================================================');
    console.log(`VERIFICATION RESULT: [${testPassed ? 'PASS - PROPERLY ENDED IN REFUND_FAILED (NOT REFUNDED)' : 'FAIL'}]`);
    console.log('======================================================================\n');

    if (!testPassed) process.exit(1);

  } finally {
    console.log('Teardown: Cleaning up test fixtures...');
    if (bookingId) {
      await fetch(`${SUPABASE_URL}/rest/v1/notification_logs?booking_id=eq.${bookingId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
      await fetch(`${SUPABASE_URL}/rest/v1/admin_audit_logs?target_id=eq.${bookingId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
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
