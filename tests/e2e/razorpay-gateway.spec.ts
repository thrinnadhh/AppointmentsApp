import { test, expect } from '@playwright/test';
import crypto from 'crypto';

test.describe('Razorpay Payment Gateway & Signature Verification Suite', () => {
  const BASE_URL = 'http://localhost:3000';
  const DUMMY_RESOURCE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const DUMMY_CUSTOMER_ID = '99999999-9999-9999-9999-999999999991';

  test.describe('1. POST /api/payments/create-order', () => {
    test('1.1 should reject requests missing booking_id with 400', async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/payments/create-order`, {
        data: {},
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('booking_id');
    });

    test('1.2 should return 404 for non-existent booking_id', async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/payments/create-order`, {
        data: { booking_id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.status()).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Booking not found');
    });

    test('1.3 should create Razorpay order for active held booking', async ({ request }) => {
      // 1. Create a hold first
      const slotStart = new Date(Date.now() + 86400000 * 2).toISOString();
      const slotEnd = new Date(Date.now() + 86400000 * 2 + 1800000).toISOString();

      const holdRes = await request.post(`${BASE_URL}/api/bookings/hold`, {
        data: {
          resource_id: DUMMY_RESOURCE_ID,
          customer_id: DUMMY_CUSTOMER_ID,
          slot_start: slotStart,
          slot_end: slotEnd,
        },
      });

      expect(holdRes.status()).toBe(201);
      const holdData = await holdRes.json();
      expect(holdData.success).toBe(true);
      const bookingId = holdData.booking_id;
      expect(bookingId).toBeDefined();

      // 2. Request order creation
      const orderRes = await request.post(`${BASE_URL}/api/payments/create-order`, {
        data: { booking_id: bookingId },
      });

      expect(orderRes.status()).toBe(200);
      const orderData = await orderRes.json();
      expect(orderData.success).toBe(true);
      expect(orderData.order_id).toBeDefined();
      expect(orderData.order_id.length).toBeGreaterThan(5);
      expect(orderData.amount).toBe(11000); // 100 INR deposit + 10 INR platform fee = 110 INR (11000 paise)
      expect(orderData.deposit_amount).toBe(100);
      expect(orderData.platform_fee).toBe(10);
      expect(orderData.total_amount).toBe(110);
      expect(orderData.currency).toBe('INR');
      expect(orderData.key_id).toBeDefined();
    });

    test('1.4 should create Razorpay order with ₹50 platform fee for Gaming & Turf', async ({ request }) => {
      const GAMING_RESOURCE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      const slotStart = new Date(Date.now() + 86400000 * 4).toISOString();
      const slotEnd = new Date(Date.now() + 86400000 * 4 + 1800000).toISOString();

      const holdRes = await request.post(`${BASE_URL}/api/bookings/hold`, {
        data: {
          resource_id: GAMING_RESOURCE_ID,
          customer_id: DUMMY_CUSTOMER_ID,
          slot_start: slotStart,
          slot_end: slotEnd,
        },
      });

      expect(holdRes.status()).toBe(201);
      const holdData = await holdRes.json();
      expect(holdData.success).toBe(true);
      const bookingId = holdData.booking_id;
      expect(bookingId).toBeDefined();

      const orderRes = await request.post(`${BASE_URL}/api/payments/create-order`, {
        data: { booking_id: bookingId },
      });

      expect(orderRes.status()).toBe(200);
      const orderData = await orderRes.json();
      expect(orderData.success).toBe(true);
      expect(orderData.order_id).toBeDefined();
      expect(orderData.amount).toBe(25000); // 200 INR deposit + 50 INR platform fee = 250 INR (25000 paise)
      expect(orderData.deposit_amount).toBe(200);
      expect(orderData.platform_fee).toBe(50);
      expect(orderData.total_amount).toBe(250);
    });
  });


  test.describe('2. POST /api/payments/verify', () => {
    test('2.1 should reject requests with missing parameters with 400', async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/payments/verify`, {
        data: { booking_id: '123' },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    test('2.2 should reject forged/tampered signatures with 400', async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/payments/verify`, {
        data: {
          booking_id: '11111111-1111-1111-1111-111111111111',
          razorpay_order_id: 'order_12345',
          razorpay_payment_id: 'pay_12345',
          razorpay_signature: 'invalid_forged_signature_token',
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid payment signature');
    });

    test('2.3 should verify valid signature and confirm booking', async ({ request }) => {
      // 1. Create a hold
      const slotStart = new Date(Date.now() + 86400000 * 3).toISOString();
      const slotEnd = new Date(Date.now() + 86400000 * 3 + 1800000).toISOString();

      const holdRes = await request.post(`${BASE_URL}/api/bookings/hold`, {
        data: {
          resource_id: DUMMY_RESOURCE_ID,
          customer_id: DUMMY_CUSTOMER_ID,
          slot_start: slotStart,
          slot_end: slotEnd,
        },
      });

      expect(holdRes.status()).toBe(201);
      const holdData = await holdRes.json();
      const bookingId = holdData.booking_id;

      // 2. Create order
      const orderRes = await request.post(`${BASE_URL}/api/payments/create-order`, {
        data: { booking_id: bookingId },
      });
      const orderData = await orderRes.json();
      const orderId = orderData.order_id;
      const paymentId = `pay_test_${Date.now().toString(36)}`;
      const signature = `mock_sig_${paymentId}`;

      // 3. Verify payment signature
      const verifyRes = await request.post(`${BASE_URL}/api/payments/verify`, {
        data: {
          booking_id: bookingId,
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: signature,
        },
      });

      expect(verifyRes.status()).toBe(200);
      const verifyData = await verifyRes.json();
      expect(verifyData.success).toBe(true);
      expect(verifyData.booking_id).toBe(bookingId);
      expect(verifyData.status).toBe('CONFIRMED');
      expect(verifyData.payment_status).toBe('CAPTURED');
    });
  });

  test.describe('3. POST /api/webhooks/razorpay', () => {
    const webhookSecret =
      process.env.RAZORPAY_WEBHOOK_SECRET || '30772a35dc5bf0a5889b1af5dfd0409c364749e83c6e0e1d';


    test('3.1 should reject requests missing x-razorpay-signature header with 401', async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/webhooks/razorpay`, {
        data: JSON.stringify({ event: 'payment.captured', payload: {} }),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status()).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('x-razorpay-signature');
    });

    test('3.2 should reject requests with invalid HMAC signature with 400', async ({ request }) => {
      const rawPayload = JSON.stringify({ event: 'payment.captured', payload: {} });
      const res = await request.post(`${BASE_URL}/api/webhooks/razorpay`, {
        data: rawPayload,
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': '0000000000000000000000000000000000000000000000000000000000000000',
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid webhook signature');
    });

    test('3.3 should accept validly signed webhook for order.paid and payment.captured', async ({ request }) => {
      // 1. Create a hold
      const slotStart = new Date(Date.now() + 86400000 * 4).toISOString();
      const slotEnd = new Date(Date.now() + 86400000 * 4 + 1800000).toISOString();

      const holdRes = await request.post(`${BASE_URL}/api/bookings/hold`, {
        data: {
          resource_id: DUMMY_RESOURCE_ID,
          customer_id: DUMMY_CUSTOMER_ID,
          slot_start: slotStart,
          slot_end: slotEnd,
        },
      });

      expect(holdRes.status()).toBe(201);
      const holdData = await holdRes.json();
      const bookingId = holdData.booking_id;

      // 2. Prepare order.paid webhook payload
      const payloadObj = {
        event: 'order.paid',
        payload: {
          order: {
            entity: {
              id: `order_wh_${Date.now().toString(36)}`,
              amount: 10000,
              currency: 'INR',
              notes: {
                booking_id: bookingId,
              },
            },
          },
          payment: {
            entity: {
              id: `pay_wh_${Date.now().toString(36)}`,
              amount: 10000,
              currency: 'INR',
              notes: {
                booking_id: bookingId,
              },
            },
          },
        },
      };

      const rawBody = JSON.stringify(payloadObj);
      const validSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      const webhookRes = await request.post(`${BASE_URL}/api/webhooks/razorpay`, {
        data: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': validSignature,
        },
      });

      expect(webhookRes.status()).toBe(200);
      const webhookData = await webhookRes.json();
      expect(webhookData.received).toBe(true);
      expect(webhookData.event).toBe('order.paid');
    });
  });
});
