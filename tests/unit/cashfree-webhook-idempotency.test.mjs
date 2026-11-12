import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'crypto';
import { CashfreeAdapter } from '../../apps/merchant-web/src/lib/payment/cashfree-adapter.ts';

describe('Cashfree Webhook Ingestion & Idempotency Lifecycle (Phase 3)', () => {
  const testSecret = 'mock_test_secret_for_webhook_tests_12345';
  const adapter = new CashfreeAdapter({
    appId: 'TEST_APP_ID',
    secretKey: testSecret,
    env: 'SANDBOX',
  });

  function generateWebhookSignature(secret, timestamp, rawBody) {
    const payload = `${timestamp}${rawBody}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('base64');
  }

  it('1. Replay Protection: Rejects webhook timestamps drifting > 300 seconds', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const staleTimestamp = (nowSec - 305).toString(); // 305 seconds ago
    const futureTimestamp = (nowSec + 305).toString(); // 305 seconds in future
    const freshTimestamp = (nowSec - 10).toString(); // 10 seconds ago

    const rawBody = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: 'cf_12345', order_amount: 10.0, order_currency: 'INR' },
        payment: { cf_payment_id: '998877', payment_status: 'SUCCESS' },
      },
    });

    // Test stale timestamp
    const staleSig = generateWebhookSignature(testSecret, staleTimestamp, rawBody);
    const staleResult = adapter.verifyWebhook({
      rawBody,
      signature: staleSig,
      timestamp: staleTimestamp,
    });
    assert.equal(staleResult.isValid, false);
    assert.match(staleResult.error || '', /300s replay window/);

    // Test future timestamp
    const futureSig = generateWebhookSignature(testSecret, futureTimestamp, rawBody);
    const futureResult = adapter.verifyWebhook({
      rawBody,
      signature: futureSig,
      timestamp: futureTimestamp,
    });
    assert.equal(futureResult.isValid, false);
    assert.match(futureResult.error || '', /300s replay window/);

    // Test valid fresh timestamp
    const freshSig = generateWebhookSignature(testSecret, freshTimestamp, rawBody);
    const freshResult = adapter.verifyWebhook({
      rawBody,
      signature: freshSig,
      timestamp: freshTimestamp,
    });
    assert.equal(freshResult.isValid, true);
    assert.ok(freshResult.event);
    assert.equal(freshResult.event.type, 'PAYMENT_SUCCESS_WEBHOOK');
  });

  it('2. Cryptographic Timing-Safe Verification: Rejects tampered signatures & payload alterations', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: 'cf_booking_abc', order_amount: 10.0 },
      },
    });

    const validSig = generateWebhookSignature(testSecret, timestamp, rawBody);

    // Tampered signature
    const tamperedSig = validSig.slice(0, -4) + 'AAAA';
    const tamperedRes = adapter.verifyWebhook({
      rawBody,
      signature: tamperedSig,
      timestamp,
    });
    assert.equal(tamperedRes.isValid, false);

    // Tampered payload with valid original signature
    const tamperedBody = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: 'cf_booking_abc', order_amount: 10000.0 },
      },
    });
    const alteredBodyRes = adapter.verifyWebhook({
      rawBody: tamperedBody,
      signature: validSig,
      timestamp,
    });
    assert.equal(alteredBodyRes.isValid, false);
  });

  it('3. Webhook Route Handler Invariants & Idempotency Structure', () => {
    const routePath = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/webhooks/cashfree/route.ts');
    assert.ok(fs.existsSync(routePath), 'Cashfree webhook route file must exist');

    const content = fs.readFileSync(routePath, 'utf8');

    // Header validations
    assert.match(content, /x-webhook-signature/, 'Must inspect x-webhook-signature header');
    assert.match(content, /x-webhook-timestamp/, 'Must inspect x-webhook-timestamp header');

    // Raw body extraction
    assert.match(content, /req\.text\(\)/, 'Must read rawBody via req.text() to prevent byte mutation');

    // Replay tolerance & timing-safe HMAC via adapter
    assert.match(content, /adapter\.verifyWebhook/, 'Must verify signature via Cashfree adapter');

    // Currency and integer paise amount checks
    assert.match(content, /paymentCurrency !== 'INR'/, 'Must validate currency is INR');
    assert.match(content, /expectedAmountPaise/, 'Must validate amount in integer paise');

    // Hold expiry & auto-refund logic
    assert.match(content, /isHoldExpired/, 'Must compute hold expiration status');
    assert.match(content, /adapter\.refundOrder/, 'Must dispatch auto-refund on expired hold payment');
    assert.match(content, /REFUND_PENDING/, 'Must transition expired hold booking to REFUND_PENDING');

    // Settle valid payment via RPC
    assert.match(content, /confirm_booking_payment/, 'Must call confirm_booking_payment RPC for valid payments');

    // Dropped / failed payment cleanup
    assert.match(content, /PAYMENT_FAILED_WEBHOOK/, 'Must handle PAYMENT_FAILED_WEBHOOK');
    assert.match(content, /PAYMENT_USER_DROPPED_WEBHOOK/, 'Must handle PAYMENT_USER_DROPPED_WEBHOOK');
  });

  it('4. Middleware Bypass: /api/webhooks/cashfree is registered in PUBLIC_API_ROUTES', () => {
    const middlewarePath = path.resolve(process.cwd(), 'apps/merchant-web/src/middleware.ts');
    const content = fs.readFileSync(middlewarePath, 'utf8');
    assert.match(content, /'\/api\/webhooks\/cashfree'/, 'Middleware must whitelist /api/webhooks/cashfree in PUBLIC_API_ROUTES');
  });
});
