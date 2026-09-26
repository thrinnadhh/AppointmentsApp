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
const APP_URL = 'http://localhost:3000';

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
  console.log('LIVE VERIFICATION: CUSTOMER CANCELLATION AT 45 MINUTES BEFORE SLOT');
  console.log('Policy Rule: Cancellation at 45 minutes before slot must be fully refunded');
  console.log('Target Server: ' + APP_URL);
  console.log('Supabase Host: ' + SUPABASE_URL);
  console.log('======================================================================\n');

  // 1. Fetch test resource
  const resRes = await fetch(`${SUPABASE_URL}/rest/v1/resources?select=id,provider_id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const resource = (await resRes.json())[0];
  const customerId = await createUser(`cust_cancel_45m_${Date.now()}@example.com`, 'SecurePass!123');

  let bookingId;
  try {
    // 2. Schedule slot exactly 45 minutes in future
    const slot45Min = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    const slotEnd = new Date(Date.now() + (45 + 30) * 60 * 1000).toISOString();

    console.log(`1. Booking slot scheduled for: ${slot45Min} (45 minutes from now)`);

    const holdRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_customer_id: customerId,
        p_resource_id: resource.id,
        p_slot_start: slot45Min,
        p_slot_end: slotEnd
      })
    });
    const hold = await holdRes.json();
    bookingId = hold.booking_id;

    const mockPaymentId = `pay_mock_45m_${Date.now()}`;
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        gateway_payment_id: mockPaymentId,
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
        booking_id: bookingId,
        gateway_payment_id: mockPaymentId,
        amount: 100.00,
        currency: 'INR',
        status: 'CAPTURED'
      })
    });

    console.log(`2. Provisioned confirmed booking ${bookingId} with ₹100 deposit paid.\n`);

    // 3. Customer cancels the booking via API
    console.log('3. Executing customer cancellation via POST /api/bookings/cancel...');
    console.log(`   Initiated By: "CUSTOMER"`);
    console.log(`   Time Before Slot: exactly 45 minutes`);

    const cancelRes = await fetch(`${APP_URL}/api/bookings/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId,
        initiated_by: 'CUSTOMER',
        reason: 'Client personal emergency'
      })
    });

    const cancelData = await cancelRes.json();
    console.log('\n4. Cancellation API Response:');
    console.log(JSON.stringify(cancelData, null, 2));

    // 4. Query Database
    const bkgRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=status,payment_status`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const bkg = (await bkgRes.json())[0];
    console.log(`\n5. Database Post-Cancellation State:`);
    console.log(`   - Booking Status:  "${bkg.status}"`);
    console.log(`   - Payment Status:  "${bkg.payment_status}"`);

    // 5. Verification Assertions
    const isSuccess = cancelData.success === true;
    const isCancelled = cancelData.status === 'CANCELLED';
    const isEligible = cancelData.refund_eligible === true;
    const isRefunded = cancelData.payment_status === 'REFUNDED';
    const isRefundFull = cancelData.refund_amount === 100.00;

    console.log('\n======================================================================');
    console.log('ASSERTIONS (Cancellation at 45 minutes before slot):');
    console.log('======================================================================');
    console.log(`- cancelData.success === true:          ${isSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`- cancelData.status === "CANCELLED":     ${isCancelled ? 'PASS' : 'FAIL'}`);
    console.log(`- cancelData.refund_eligible === true:  ${isEligible ? 'PASS' : 'FAIL'}`);
    console.log(`- cancelData.payment_status === REFUNDED: ${isRefunded ? 'PASS' : 'FAIL'}`);
    console.log(`- cancelData.refund_amount === 100.00:   ${isRefundFull ? 'PASS' : 'FAIL'}`);

    if (isSuccess && isCancelled && isEligible && isRefunded && isRefundFull) {
      console.log('\n>>> RESULT: PASS — A cancellation at 45 minutes before slot is now fully refunded (₹100.00).');
    } else {
      console.log('\n>>> RESULT: FAIL — Cancellation was not fully refunded.');
      process.exit(1);
    }
    console.log('======================================================================\n');

  } finally {
    console.log('Cleaning up test fixtures...');
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
  console.error('Test run failed:', err);
  process.exit(1);
});
