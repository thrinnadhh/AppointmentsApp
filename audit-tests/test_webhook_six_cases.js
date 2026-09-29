const fs = require('fs');
const crypto = require('crypto');

function loadEnv() {
  const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  });
  return env;
}

const env = loadEnv();
const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET || 'dev_razorpay_webhook_secret';
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const webhookUrl = 'http://localhost:3000/api/webhooks/razorpay';

function computeSignature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function run() {
  console.log('====================================================');
  console.log('CANONICAL RAZORPAY WEBHOOK ENDPOINT TEST (6 SCENARIOS)');
  console.log(`Target: ${webhookUrl}`);
  console.log('====================================================\n');

  // Fetch a valid resource and customer to create a real test booking
  const resRes = await fetch(`${supabaseUrl}/rest/v1/resources?select=id,provider_id,price,deposit_amount&limit=1`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const resources = await resRes.json();
  const resource = resources[0];

  const custRes = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id&role=eq.customer&limit=1`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const customers = await custRes.json();
  const customer = customers[0];

  // SCENARIO 1: No Signature
  console.log('--- SCENARIO 1: No signature ---');
  const payload1 = JSON.stringify({ event: 'payment.captured', payload: {} });
  const res1 = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload1
  });
  const body1 = await res1.json();
  console.log(`HTTP Status: ${res1.status}`);
  console.log(`Response Body:`, JSON.stringify(body1));
  console.log(`Result: ${res1.status === 401 ? 'PASS (Rejected without signature)' : 'FAIL'}\n`);

  // SCENARIO 2: Wrong Signature
  console.log('--- SCENARIO 2: Wrong signature ---');
  const payload2 = JSON.stringify({ event: 'payment.captured', payload: {} });
  const wrongSig = '0000000000000000000000000000000000000000000000000000000000000000';
  const res2 = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': wrongSig
    },
    body: payload2
  });
  const body2 = await res2.json();
  console.log(`HTTP Status: ${res2.status}`);
  console.log(`Response Body:`, JSON.stringify(body2));
  console.log(`Result: ${res2.status === 400 ? 'PASS (Rejected with wrong signature)' : 'FAIL'}\n`);

  // Setup test booking for Scenario 3 & 4
  const testOrderId = `order_live_wh_${Date.now()}`;
  const slotStart = new Date(Date.now() + 86400000).toISOString();
  const slotEnd = new Date(Date.now() + 86400000 + 1800000).toISOString();
  const createBookingRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      customer_id: customer.id,
      provider_id: resource.provider_id,
      resource_id: resource.id,
      slot_start: slotStart,
      slot_end: slotEnd,
      status: 'HELD',
      deposit_amount: 100,
      platform_fee: 10,
      total_amount: 110,
      gateway_order_id: testOrderId
    })
  });
  const createdBookings = await createBookingRes.json();
  const testBooking = createdBookings[0];
  console.log(`Created test fixture booking ${testBooking.id} with gateway_order_id=${testOrderId}, total_amount=₹110 (11000 paise)`);

  // SCENARIO 3: Valid signature + known order (booking becomes paid)
  console.log('\n--- SCENARIO 3: Valid signature + known order (transitions to paid/confirmed) ---');
  const paymentId3 = `pay_live_${Date.now()}`;
  const payload3Obj = {
    event: 'order.paid',
    payload: {
      order: {
        entity: {
          id: testOrderId,
          amount: 11000,
          currency: 'INR'
        }
      },
      payment: {
        entity: {
          id: paymentId3,
          order_id: testOrderId,
          amount: 11000,
          currency: 'INR'
        }
      }
    }
  };
  const rawBody3 = JSON.stringify(payload3Obj);
  const sig3 = computeSignature(rawBody3, webhookSecret);
  const res3 = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': sig3
    },
    body: rawBody3
  });
  const body3 = await res3.json();
  console.log(`HTTP Status: ${res3.status}`);
  console.log(`Response Body:`, JSON.stringify(body3));

  // Verify booking in DB
  const checkRes3 = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${testBooking.id}&select=id,status,payment_status,gateway_payment_id`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [bkg3] = await checkRes3.json();
  console.log(`DB State: status=${bkg3.status}, payment_status=${bkg3.payment_status}, gateway_payment_id=${bkg3.gateway_payment_id}`);
  console.log(`Result: ${res3.status === 200 && bkg3.status === 'CONFIRMED' ? 'PASS (Booking successfully confirmed/paid)' : 'FAIL'}\n`);

  // SCENARIO 4: Replayed event (no double effect)
  console.log('--- SCENARIO 4: Replayed event (idempotent duplicate event) ---');
  const res4 = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': sig3
    },
    body: rawBody3
  });
  const body4 = await res4.json();
  console.log(`HTTP Status: ${res4.status}`);
  console.log(`Response Body:`, JSON.stringify(body4));
  console.log(`Result: ${res4.status === 200 && body4.idempotent === true ? 'PASS (Idempotent response, no duplicate state change)' : 'FAIL'}\n`);

  // SCENARIO 5: Amount mismatch (rejected)
  console.log('--- SCENARIO 5: Amount mismatch (rejected) ---');
  const mismatchOrderId = `order_mismatch_${Date.now()}`;
  const createMismatchBkg = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      customer_id: customer.id,
      provider_id: resource.provider_id,
      resource_id: resource.id,
      slot_start: new Date(Date.now() + 172800000).toISOString(),
      slot_end: new Date(Date.now() + 172800000 + 1800000).toISOString(),
      status: 'HELD',
      deposit_amount: 100,
      platform_fee: 10,
      total_amount: 110,
      gateway_order_id: mismatchOrderId
    })
  });
  const [mismatchBooking] = await createMismatchBkg.json();

  // Send webhook with 5000 paise instead of expected 11000 paise
  const payload5Obj = {
    event: 'order.paid',
    payload: {
      order: {
        entity: {
          id: mismatchOrderId,
          amount: 5000,
          currency: 'INR'
        }
      },
      payment: {
        entity: {
          id: `pay_bad_amt_${Date.now()}`,
          order_id: mismatchOrderId,
          amount: 5000,
          currency: 'INR'
        }
      }
    }
  };
  const rawBody5 = JSON.stringify(payload5Obj);
  const sig5 = computeSignature(rawBody5, webhookSecret);
  const res5 = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': sig5
    },
    body: rawBody5
  });
  const body5 = await res5.json();
  console.log(`HTTP Status: ${res5.status}`);
  console.log(`Response Body:`, JSON.stringify(body5));
  console.log(`Result: ${res5.status === 400 && body5.error.includes('Payment amount mismatch') ? 'PASS (Amount mismatch correctly rejected)' : 'FAIL'}\n`);

  // SCENARIO 6: Unknown order
  console.log('--- SCENARIO 6: Unknown order (rejected) ---');
  const unknownOrderId = `order_unknown_${Date.now()}`;
  const payload6Obj = {
    event: 'order.paid',
    payload: {
      order: {
        entity: {
          id: unknownOrderId,
          amount: 11000,
          currency: 'INR'
        }
      },
      payment: {
        entity: {
          id: `pay_unk_${Date.now()}`,
          order_id: unknownOrderId,
          amount: 11000,
          currency: 'INR'
        }
      }
    }
  };
  const rawBody6 = JSON.stringify(payload6Obj);
  const sig6 = computeSignature(rawBody6, webhookSecret);
  const res6 = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': sig6
    },
    body: rawBody6
  });
  const body6 = await res6.json();
  console.log(`HTTP Status: ${res6.status}`);
  console.log(`Response Body:`, JSON.stringify(body6));
  console.log(`Result: ${res6.status === 404 && body6.error.includes('Unknown order') ? 'PASS (Unknown order correctly rejected with 404)' : 'FAIL'}\n`);

  // Cleanup test bookings
  await fetch(`${supabaseUrl}/rest/v1/bookings?id=in.(${testBooking.id},${mismatchBooking.id})`, {
    method: 'DELETE',
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  console.log('Cleaned up test fixture bookings.');
}

run().catch(console.error);
