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
const APP_URL = 'http://localhost:3000';

async function createUser(email, password, role) {
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
      user_metadata: { role }
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
  console.log('LIVE VERIFICATION: REFUND PENDING / FAILED / SUCCESS BUSINESS LOGIC');
  console.log('Target App: ' + APP_URL);
  console.log('Supabase Host: ' + SUPABASE_URL);
  console.log('======================================================================\n');

  const stamp = Date.now();
  const customerEmail = `refund_cust_${stamp}@example.com`;
  const adminEmail = `refund_admin_${stamp}@example.com`;
  const password = `RefundPass_${stamp}!123`;

  let customerId, adminId;
  const createdBookingIds = [];

  try {
    console.log('1. Setting up test fixtures...');
    customerId = await createUser(customerEmail, password, 'customer');
    adminId = await createUser(adminEmail, password, 'admin');

    // Ensure admin profile has role = 'admin'
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${adminId}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'admin' }),
    });

    const customerToken = await loginUser(customerEmail, password);
    const adminToken = await loginUser(adminEmail, password);

    // Get an active resource
    const resRes = await fetch(`${SUPABASE_URL}/rest/v1/resources?select=id,provider_id,deposit_amount&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const resources = await resRes.json();
    const resource = resources[0];
    console.log(`   - Customer: ${customerId}`);
    console.log(`   - Admin: ${adminId}`);
    console.log(`   - Resource: ${resource.id} (Provider: ${resource.provider_id})\n`);

    // =========================================================================
    // CASE 1: CANCELLATION WITH SIMULATED RAZORPAY FAILURE -> REFUND_FAILED
    // =========================================================================
    console.log('======================================================================');
    console.log('CASE 1: Cancellation with Razorpay Gateway Failure');
    console.log('======================================================================');
    const slotStart1 = new Date(Date.now() + 86400000 * 2).toISOString();
    const slotEnd1 = new Date(Date.now() + 86400000 * 2 + 1800000).toISOString();

    const holdRes1 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_customer_id: customerId,
        p_resource_id: resource.id,
        p_slot_start: slotStart1,
        p_slot_end: slotEnd1
      })
    });
    const hold1 = await holdRes1.json();
    const bookingId1 = hold1.booking_id;
    createdBookingIds.push(bookingId1);

    // Confirm booking with simulated failing payment ID
    const failingPaymentId = `pay_mock_fail_cancel_${stamp}`;
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_booking_payment`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_booking_id: bookingId1,
        p_gateway_payment_id: failingPaymentId
      })
    });

    console.log(`   - Created & Confirmed Booking: ${bookingId1}`);
    console.log(`   - Gateway Payment ID: ${failingPaymentId}`);

    // Call POST /api/bookings/cancel
    const cancelRes1 = await fetch(`${APP_URL}/api/bookings/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId1,
        initiated_by: 'CUSTOMER',
        reason: 'Change of plans'
      })
    });

    const cancelStatus1 = cancelRes1.status;
    const cancelBody1 = await cancelRes1.json();
    console.log(`   - Cancel HTTP Status: ${cancelStatus1}`);
    console.log(`   - Cancel Response:`, JSON.stringify(cancelBody1, null, 2));

    // Verify DB State
    const bkgRes1 = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId1}&select=id,status,payment_status`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const bkg1 = (await bkgRes1.json())[0];
    console.log(`   - DB State: status="${bkg1.status}", payment_status="${bkg1.payment_status}"`);

    // Verify Admin Audit Log
    const auditRes1 = await fetch(`${SUPABASE_URL}/rest/v1/admin_audit_logs?target_id=eq.${bookingId1}&select=action,details`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const auditLogs1 = await auditRes1.json();
    console.log(`   - Admin Audit Logs: ${auditLogs1.length} found (Action: ${auditLogs1[0]?.action})`);

    // Verify Notification Logs (Admin Alert)
    const notifRes1 = await fetch(`${SUPABASE_URL}/rest/v1/notification_logs?booking_id=eq.${bookingId1}&select=event_type,message_content`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const notifs1 = await notifRes1.json();
    console.log(`   - Notification Logs: ${notifs1.length} found (Event: ${notifs1.find(n => n.event_type === 'REFUND_FAILED_ALERT')?.event_type})`);

    const case1Pass =
      bkg1.status === 'CANCELLED' &&
      bkg1.payment_status === 'REFUND_FAILED' &&
      cancelBody1.payment_status === 'REFUND_FAILED' &&
      auditLogs1.some(l => l.action === 'REFUND_MANUAL_INTERVENTION_REQUIRED') &&
      notifs1.some(n => n.event_type === 'REFUND_FAILED_ALERT');

    console.log(`Case 1 Result: [${case1Pass ? 'PASS - PROPERLY MARKED REFUND_FAILED WITH AUDIT & ALERT' : 'FAIL'}]\n`);

    // =========================================================================
    // CASE 2: CANCELLATION WITH SUCCESSFUL RAZORPAY REFUND -> REFUNDED
    // =========================================================================
    console.log('======================================================================');
    console.log('CASE 2: Cancellation with Successful Gateway Refund');
    console.log('======================================================================');
    const slotStart2 = new Date(Date.now() + 86400000 * 3).toISOString();
    const slotEnd2 = new Date(Date.now() + 86400000 * 3 + 1800000).toISOString();

    const holdRes2 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_customer_id: customerId,
        p_resource_id: resource.id,
        p_slot_start: slotStart2,
        p_slot_end: slotEnd2
      })
    });
    const hold2 = await holdRes2.json();
    const bookingId2 = hold2.booking_id;
    createdBookingIds.push(bookingId2);

    // Confirm booking with successful mock payment ID
    const successfulPaymentId = `pay_mock_success_${stamp}`;
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_booking_payment`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_booking_id: bookingId2,
        p_gateway_payment_id: successfulPaymentId
      })
    });

    console.log(`   - Created & Confirmed Booking: ${bookingId2}`);
    console.log(`   - Gateway Payment ID: ${successfulPaymentId}`);

    // Call POST /api/bookings/cancel
    const cancelRes2 = await fetch(`${APP_URL}/api/bookings/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId2,
        initiated_by: 'CUSTOMER',
        reason: 'Customer rescheduling'
      })
    });

    const cancelStatus2 = cancelRes2.status;
    const cancelBody2 = await cancelRes2.json();
    console.log(`   - Cancel HTTP Status: ${cancelStatus2}`);
    console.log(`   - Cancel Response:`, JSON.stringify(cancelBody2, null, 2));

    // Verify DB State
    const bkgRes2 = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId2}&select=id,status,payment_status`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const bkg2 = (await bkgRes2.json())[0];
    console.log(`   - DB State: status="${bkg2.status}", payment_status="${bkg2.payment_status}"`);

    const case2Pass =
      bkg2.status === 'CANCELLED' &&
      bkg2.payment_status === 'REFUNDED' &&
      cancelBody2.payment_status === 'REFUNDED';

    console.log(`Case 2 Result: [${case2Pass ? 'PASS - PROPERLY PROMOTED TO REFUNDED ON SUCCESS' : 'FAIL'}]\n`);

    // =========================================================================
    // CASE 3: NO-SHOW WITH RAZORPAY FAILURE -> REFUND_FAILED
    // =========================================================================
    console.log('======================================================================');
    console.log('CASE 3: No-Show Courtesy Refund with Gateway Failure');
    console.log('======================================================================');
    const slotStart3 = new Date(Date.now() + 86400000 * 4).toISOString();
    const slotEnd3 = new Date(Date.now() + 86400000 * 4 + 1800000).toISOString();

    const holdRes3 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_customer_id: customerId,
        p_resource_id: resource.id,
        p_slot_start: slotStart3,
        p_slot_end: slotEnd3
      })
    });
    const hold3 = await holdRes3.json();
    const bookingId3 = hold3.booking_id;
    createdBookingIds.push(bookingId3);

    // Confirm booking with simulated failing payment ID
    const noShowFailPaymentId = `pay_mock_fail_noshow_${stamp}`;
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_booking_payment`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_booking_id: bookingId3,
        p_gateway_payment_id: noShowFailPaymentId
      })
    });

    // Backdate slot_start so no-show is eligible (not premature)
    const pastSlotStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const pastSlotEnd = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId3}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        slot_start: pastSlotStart,
        slot_end: pastSlotEnd
      })
    });

    // Call POST /api/bookings/no-show as admin
    const noShowRes = await fetch(`${APP_URL}/api/bookings/no-show`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        booking_id: bookingId3
      })
    });

    const noShowStatus = noShowRes.status;
    const noShowBody = await noShowRes.json();
    console.log(`   - No-Show HTTP Status: ${noShowStatus}`);
    console.log(`   - No-Show Response:`, JSON.stringify(noShowBody, null, 2));

    // Verify DB State
    const bkgRes3 = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId3}&select=id,status,payment_status`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const bkg3 = (await bkgRes3.json())[0];
    console.log(`   - DB State: status="${bkg3.status}", payment_status="${bkg3.payment_status}"`);

    const case3Pass =
      bkg3.status === 'NO_SHOW' &&
      bkg3.payment_status === 'REFUND_FAILED' &&
      noShowBody.payment_status === 'REFUND_FAILED';

    console.log(`Case 3 Result: [${case3Pass ? 'PASS - NO-SHOW GRACE FAILURE MARKED REFUND_FAILED' : 'FAIL'}]\n`);

    // =========================================================================
    // CASE 4: ADMIN RECONCILIATION ENDPOINTS
    // =========================================================================
    console.log('======================================================================');
    console.log('CASE 4: Admin Manual Reconciliation Endpoints');
    console.log('======================================================================');

    // 4.1 Test GET /api/admin/refunds
    console.log('--- Subcase 4.1: Dedicated GET /api/admin/refunds Endpoint ---');
    const refundsRes = await fetch(`${APP_URL}/api/admin/refunds`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const refundsStatus = refundsRes.status;
    const refundsData = await refundsRes.json();
    console.log(`   - HTTP Status: ${refundsStatus}`);
    console.log(`   - Summary:`, refundsData.summary);

    const foundBooking1 = (refundsData.bookings || []).find(b => b.id === bookingId1);
    const foundBooking3 = (refundsData.bookings || []).find(b => b.id === bookingId3);
    console.log(`   - Found Failed Cancellation (Booking ${bookingId1}): ${Boolean(foundBooking1)}`);
    console.log(`   - Attached Audit Log Action: ${foundBooking1?.latest_audit_log?.action}`);
    console.log(`   - Found Failed No-Show (Booking ${bookingId3}): ${Boolean(foundBooking3)}`);

    // 4.2 Test GET /api/admin/bookings?needs_reconciliation=true
    console.log('\n--- Subcase 4.2: Filter GET /api/admin/bookings?needs_reconciliation=true ---');
    const filterRes = await fetch(`${APP_URL}/api/admin/bookings?needs_reconciliation=true`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const filterStatus = filterRes.status;
    const filterData = await filterRes.json();
    console.log(`   - HTTP Status: ${filterStatus}`);
    console.log(`   - Count returned: ${filterData.count}`);

    const case4Pass =
      refundsStatus === 200 &&
      Boolean(foundBooking1) &&
      Boolean(foundBooking3) &&
      filterStatus === 200 &&
      filterData.bookings.some(b => b.id === bookingId1);

    console.log(`Case 4 Result: [${case4Pass ? 'PASS - ALL RECONCILIATION ENDPOINTS FUNCTIONAL' : 'FAIL'}]\n`);

    // Summary
    const allPass = case1Pass && case2Pass && case3Pass && case4Pass;
    console.log('======================================================================');
    console.log(`FINAL TEST VERDICT: ${allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
    console.log('======================================================================\n');

    if (!allPass) process.exit(1);

  } finally {
    console.log('Teardown: Cleaning up test fixtures...');
    for (const id of createdBookingIds) {
      await fetch(`${SUPABASE_URL}/rest/v1/notification_logs?booking_id=eq.${id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
      await fetch(`${SUPABASE_URL}/rest/v1/admin_audit_logs?target_id=eq.${id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
      await fetch(`${SUPABASE_URL}/rest/v1/payments?booking_id=eq.${id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
      await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      });
    }
    if (customerId) await deleteUser(customerId);
    if (adminId) await deleteUser(adminId);
    console.log('Teardown complete.');
  }
}

run().catch(err => {
  console.error('Audit run error:', err);
  process.exit(1);
});
