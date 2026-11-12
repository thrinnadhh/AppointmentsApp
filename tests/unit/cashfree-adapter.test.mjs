import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { CashfreeAdapter } from '../../apps/merchant-web/src/lib/payment/cashfree-adapter.ts';
import { RazorpayAdapter } from '../../apps/merchant-web/src/lib/payment/razorpay-adapter.ts';
import { getPaymentGateway } from '../../apps/merchant-web/src/lib/payment/index.ts';
import { normalizePhoneNumber, formatOrderIdForCashfree } from '../../apps/merchant-web/src/lib/cashfree.ts';

describe('Payment Gateway Abstraction & Cashfree Adapter (Phase 2)', () => {
  it('1. formatOrderIdForCashfree ensures order ID starts with cf_ and is <= 45 chars', () => {
    const bookingId = 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';
    const cfOrderId = formatOrderIdForCashfree(bookingId);
    
    assert.match(cfOrderId, /^cf_[a-f0-9]{32}$/, 'Order ID must match cf_<clean-uuid>');
    assert.ok(cfOrderId.length <= 45, 'Order ID length must be <= 45 characters for Cashfree');
    assert.equal(cfOrderId, `cf_${bookingId.replace(/-/g, '').slice(0, 32)}`);
  });

  it('2. normalizePhoneNumber strips country codes and non-digits to 10 digits', () => {
    assert.equal(normalizePhoneNumber('+919876543210'), '9876543210');
    assert.equal(normalizePhoneNumber('91-9876543210'), '9876543210');
    assert.equal(normalizePhoneNumber('09876543210'), '9876543210');
    assert.equal(normalizePhoneNumber('9876543210'), '9876543210');
    assert.equal(normalizePhoneNumber(''), '9999999999'); // Fallback safe phone
  });

  it('3. CashfreeAdapter converts amountInPaise to INR rupee amount with 2 decimal precision', () => {
    const adapter = new CashfreeAdapter({
      appId: 'TEST_APP_ID',
      secretKey: 'TEST_SECRET_KEY',
      env: 'SANDBOX',
    });

    assert.equal(adapter.paiseToRupees(1000), 10.00);
    assert.equal(adapter.paiseToRupees(5000), 50.00);
    assert.equal(adapter.paiseToRupees(100), 1.00);
    assert.equal(adapter.rupeesToPaise(10.00), 1000);
    assert.equal(adapter.rupeesToPaise(50.00), 5000);
  });

  it('4. CashfreeAdapter.verifyWebhook verifies timing-safe HMAC-SHA256 signature', () => {
    const secret = 'mock_test_secret_for_adapter_test';
    const adapter = new CashfreeAdapter({
      appId: 'TEST_APP_ID',
      secretKey: secret,
      env: 'SANDBOX',
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify({ data: { order: { order_id: 'cf_123', order_status: 'PAID' } }, type: 'PAYMENT_SUCCESS_WEBHOOK' });
    
    // Cashfree signature format: base64(hmac-sha256(timestamp + rawBody, secret))
    const signaturePayload = `${timestamp}${rawBody}`;
    const validSignature = crypto.createHmac('sha256', secret).update(signaturePayload).digest('base64');

    const validResult = adapter.verifyWebhook({
      rawBody,
      signature: validSignature,
      timestamp,
    });
    assert.equal(validResult.isValid, true, 'Valid signature must return isValid: true');

    const invalidResult = adapter.verifyWebhook({
      rawBody,
      signature: 'invalid_signature_base64==',
      timestamp,
    });
    assert.equal(invalidResult.isValid, false, 'Invalid signature must return isValid: false');
  });

  it('5. CashfreeAdapter.verifyWebhook rejects replay attacks outside 300s window', () => {
    const secret = 'mock_test_secret_for_adapter_test';
    const adapter = new CashfreeAdapter({
      appId: 'TEST_APP_ID',
      secretKey: secret,
      env: 'SANDBOX',
    });

    // 400 seconds in the past
    const expiredTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
    const rawBody = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK' });
    const signature = crypto.createHmac('sha256', secret).update(`${expiredTimestamp}${rawBody}`).digest('base64');

    const result = adapter.verifyWebhook({
      rawBody,
      signature,
      timestamp: expiredTimestamp,
    });

    assert.equal(result.isValid, false, 'Expired timestamp must be rejected');
    assert.match(result.error || '', /replay|timestamp/i, 'Error message should cite timestamp tolerance');
  });

  it('6. RazorpayAdapter provides provider = "razorpay" and satisfies adapter contract', () => {
    const adapter = new RazorpayAdapter();
    assert.equal(adapter.provider, 'razorpay');
    assert.equal(typeof adapter.createOrder, 'function');
    assert.equal(typeof adapter.verifyPayment, 'function');
    assert.equal(typeof adapter.fetchOrder, 'function');
    assert.equal(typeof adapter.refundOrder, 'function');
    assert.equal(typeof adapter.verifyWebhook, 'function');
  });

  it('7. getPaymentGateway factory resolves configured adapter based on environment variable', () => {
    const originalProvider = process.env.PAYMENT_GATEWAY_PROVIDER;
    try {
      process.env.PAYMENT_GATEWAY_PROVIDER = 'cashfree';
      const cfGateway = getPaymentGateway();
      assert.equal(cfGateway.provider, 'cashfree');

      process.env.PAYMENT_GATEWAY_PROVIDER = 'razorpay';
      const rzGateway = getPaymentGateway();
      assert.equal(rzGateway.provider, 'razorpay');

      delete process.env.PAYMENT_GATEWAY_PROVIDER;
      const defaultGateway = getPaymentGateway();
      assert.equal(defaultGateway.provider, 'razorpay', 'Default provider must be razorpay');
    } finally {
      if (originalProvider !== undefined) {
        process.env.PAYMENT_GATEWAY_PROVIDER = originalProvider;
      } else {
        delete process.env.PAYMENT_GATEWAY_PROVIDER;
      }
    }
  });
});
