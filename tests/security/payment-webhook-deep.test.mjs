import './setup-env.mjs';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { POST as handleCashfreeWebhook } from '../../apps/merchant-web/src/app/api/webhooks/cashfree/route.ts';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const testWebhookSecret = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY || ['test', 'cf', 'secret', 'key'].join('_');

function generateSignature(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}${rawBody}`).digest('base64');
}

describe('TASK 3B: Deep Payment Lifecycle & Webhook Hardening', () => {
  let supabaseAdmin;
  let testProvider;
  let testResource;
  let testCustomer;
  const createdBookingIds = new Set();
  let slotCounter = 0;

  before(async () => {
    assert.ok(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY must be configured');
    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: provider } = await supabaseAdmin
      .from('providers')
      .select('id')
      .limit(1)
      .single();

    const { data: resource } = await supabaseAdmin
      .from('resources')
      .select('id')
      .eq('provider_id', provider.id)
      .limit(1)
      .single();

    const { data: customer } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('role', 'customer')
      .neq('id', 'e9e9e739-9128-4368-b298-c869c93302f3')
      .limit(1)
      .single();

    testProvider = provider;
    testResource = resource;
    testCustomer = customer;
  });

  afterEach(async () => {
    if (supabaseAdmin && createdBookingIds.size > 0) {
      await supabaseAdmin
        .from('bookings')
        .delete()
        .in('id', Array.from(createdBookingIds));
      createdBookingIds.clear();
    }
  });

  async function createDedicatedBooking(initialStatus = 'HELD', initialPaymentStatus = 'PENDING') {
    slotCounter++;
    const orderId = `test_order_${Date.now()}_${slotCounter}_${Math.floor(Math.random() * 100000)}`;
    const slotStartTime = new Date(Date.now() + 800 * 86400 * 1000 + slotCounter * 3600 * 1000);
    const slotStart = slotStartTime.toISOString();
    const slotEnd = new Date(slotStartTime.getTime() + 30 * 60 * 1000).toISOString();

    const { data: b, error: bErr } = await supabaseAdmin
      .from('bookings')
      .insert({
        provider_id: testProvider.id,
        resource_id: testResource.id,
        customer_id: testCustomer.id,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: initialStatus,
        payment_status: initialPaymentStatus,
        deposit_amount: 10.00,
        platform_fee: 10.00,
        total_amount: 10.00,
        expected_payment_amount_paise: 1000,
        gateway_order_id: orderId,
        hold_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    assert.ok(!bErr && b, `Booking creation must succeed: ${bErr?.message}`);
    if (b?.id) createdBookingIds.add(b.id);
    return b;
  }

  it('1. Webhook Replay & Timestamp Tolerance: Rejects timestamps outside 300s window', async () => {
    const booking = await createDedicatedBooking();
    const nowSec = Math.floor(Date.now() / 1000);
    const staleTimestamp = (nowSec - 305).toString();
    const rawBody = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: booking.gateway_order_id, order_amount: 10.0, order_currency: 'INR' },
        payment: { cf_payment_id: `cf_pay_stale_${Date.now()}`, payment_status: 'SUCCESS', payment_amount: 10.0, payment_currency: 'INR' },
      },
    });

    const staleSig = generateSignature(testWebhookSecret, staleTimestamp, rawBody);
    const req = new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
      method: 'POST',
      headers: {
        'x-webhook-signature': staleSig,
        'x-webhook-timestamp': staleTimestamp,
        'content-type': 'application/json',
      },
      body: rawBody,
    });

    const res = await handleCashfreeWebhook(req);
    assert.equal(res.status, 400, 'Stale webhook timestamp must be rejected with 400');
    const json = await res.json();
    assert.match(json.error, /replay window/i);
  });

  it('2. Currency & Amount Tampering: Rejects foreign currency (USD) and tampered amount (paise mismatch)', async () => {
    const booking = await createDedicatedBooking();
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // 2a: USD Currency tampering
    const usdBody = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: booking.gateway_order_id, order_amount: 10.0, order_currency: 'USD' },
        payment: { cf_payment_id: `cf_pay_usd_${Date.now()}`, payment_status: 'SUCCESS', payment_amount: 10.0, payment_currency: 'USD' },
      },
    });
    const usdSig = generateSignature(testWebhookSecret, timestamp, usdBody);
    const usdReq = new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
      method: 'POST',
      headers: {
        'x-webhook-signature': usdSig,
        'x-webhook-timestamp': timestamp,
        'content-type': 'application/json',
      },
      body: usdBody,
    });
    const usdRes = await handleCashfreeWebhook(usdReq);
    assert.equal(usdRes.status, 400, 'Non-INR currency must be rejected');

    // 2b: Amount tampering: paid 1.00 INR (100 paise) instead of 10.00 INR (1000 paise)
    const cheapBody = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: booking.gateway_order_id, order_amount: 1.0, order_currency: 'INR' },
        payment: { cf_payment_id: `cf_pay_cheap_${Date.now()}`, payment_status: 'SUCCESS', payment_amount: 1.0, payment_currency: 'INR' },
      },
    });
    const cheapSig = generateSignature(testWebhookSecret, timestamp, cheapBody);
    const cheapReq = new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
      method: 'POST',
      headers: {
        'x-webhook-signature': cheapSig,
        'x-webhook-timestamp': timestamp,
        'content-type': 'application/json',
      },
      body: cheapBody,
    });
    const cheapRes = await handleCashfreeWebhook(cheapReq);
    assert.equal(cheapRes.status, 400, 'Tampered amount must be rejected');
    const cheapJson = await cheapRes.json();
    assert.match(cheapJson.error, /amount mismatch/i);
  });

  it('3. Status Downgrade Prevention: Out-of-order PAYMENT_FAILED cannot cancel CONFIRMED booking', async () => {
    // Create directly in CONFIRMED state with CAPTURED payment
    const booking = await createDedicatedBooking('CONFIRMED', 'CAPTURED');

    // Send delayed PAYMENT_FAILED_WEBHOOK for the same order
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const failBody = JSON.stringify({
      type: 'PAYMENT_FAILED_WEBHOOK',
      data: {
        order: { order_id: booking.gateway_order_id },
        payment: { cf_payment_id: `cf_pay_failed_${Date.now()}`, payment_status: 'FAILED' },
      },
    });
    const failSig = generateSignature(testWebhookSecret, timestamp, failBody);
    const failReq = new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
      method: 'POST',
      headers: {
        'x-webhook-signature': failSig,
        'x-webhook-timestamp': timestamp,
        'content-type': 'application/json',
      },
      body: failBody,
    });

    const res = await handleCashfreeWebhook(failReq);
    assert.equal(res.status, 200, 'Webhook acknowledges receipt');

    // Confirm status in DB was NOT downgraded
    const { data: verified } = await supabaseAdmin
      .from('bookings')
      .select('status, payment_status')
      .eq('id', booking.id)
      .single();

    assert.equal(verified.status, 'CONFIRMED', 'Confirmed booking MUST NOT be cancelled by delayed failed webhook');
    assert.equal(verified.payment_status, 'CAPTURED', 'Captured payment status must remain intact');
  });

  it('4. Duplicate Idempotency: Duplicate PAYMENT_SUCCESS returns idempotent: true without state corruption', async () => {
    const booking = await createDedicatedBooking('CONFIRMED', 'CAPTURED');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const dupBody = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: booking.gateway_order_id, order_amount: 10.0, order_currency: 'INR' },
        payment: { cf_payment_id: `cf_pay_dup_${Date.now()}`, payment_status: 'SUCCESS', payment_amount: 10.0, payment_currency: 'INR' },
      },
    });

    const dupSig = generateSignature(testWebhookSecret, timestamp, dupBody);
    const dupReq = new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
      method: 'POST',
      headers: {
        'x-webhook-signature': dupSig,
        'x-webhook-timestamp': timestamp,
        'content-type': 'application/json',
      },
      body: dupBody,
    });

    const res = await handleCashfreeWebhook(dupReq);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.idempotent, true, 'Duplicate success event must report idempotent: true');
  });
});
