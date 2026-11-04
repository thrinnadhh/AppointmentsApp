import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

// 1. Load apps/merchant-web/.env.local if not already populated
const envLocalPath = path.resolve(process.cwd(), 'apps/merchant-web/.env.local');
if (fs.existsSync(envLocalPath)) {
  const lines = fs.readFileSync(envLocalPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

// Import Razorpay refund helpers
const {
  initiateRazorpayRefund,
  isRazorpayConfigured,
  resolveRefundIdempotencyKey,
} = await import('../../apps/merchant-web/src/lib/razorpay.ts');

/**
 * Live Key Safety Guard:
 * Strictly inspects RAZORPAY_KEY_ID and NEXT_PUBLIC_RAZORPAY_KEY_ID.
 * If any configured key starts with 'rzp_live_', throws a fatal error immediately
 * before any network requests can be initiated.
 */
export function assertNoLiveRazorpayKeys(customKeyId, customClientKeyId) {
  const keyId = customKeyId !== undefined ? customKeyId : (process.env.RAZORPAY_KEY_ID || '');
  const clientKeyId =
    customClientKeyId !== undefined ? customClientKeyId : (process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '');

  if (typeof keyId === 'string' && keyId.trim().startsWith('rzp_live_')) {
    throw new Error(
      `FATAL LIVE KEY BREACH: RAZORPAY_KEY_ID starts with rzp_live_ (${keyId.slice(0, 12)}...). Automated tests must NEVER run against live Razorpay keys!`
    );
  }

  if (typeof clientKeyId === 'string' && clientKeyId.trim().startsWith('rzp_live_')) {
    throw new Error(
      `FATAL LIVE KEY BREACH: NEXT_PUBLIC_RAZORPAY_KEY_ID starts with rzp_live_ (${clientKeyId.slice(0, 12)}...). Automated tests must NEVER run against live Razorpay keys!`
    );
  }
}

describe('Group 3: Razorpay Refund API & Idempotency Integration Suite', () => {
  it('1. Live Key Safety Guard (Hard Fail) - throws immediately if rzp_live_* is present', () => {
    // Sub-check A: Server-side secret key starts with rzp_live_
    assert.throws(
      () => assertNoLiveRazorpayKeys('rzp_live_ProductionKeySecret12345', undefined),
      /FATAL LIVE KEY BREACH: RAZORPAY_KEY_ID starts with rzp_live_/,
      'Must reject RAZORPAY_KEY_ID starting with rzp_live_'
    );

    // Sub-check B: Client-side public key starts with rzp_live_
    assert.throws(
      () => assertNoLiveRazorpayKeys(undefined, 'rzp_live_ClientPublicKey99999'),
      /FATAL LIVE KEY BREACH: NEXT_PUBLIC_RAZORPAY_KEY_ID starts with rzp_live_/,
      'Must reject NEXT_PUBLIC_RAZORPAY_KEY_ID starting with rzp_live_'
    );

    // Sub-check C: Clean test keys and empty keys do not throw
    assert.doesNotThrow(() => assertNoLiveRazorpayKeys('rzp_test_ValidTestKey123', 'rzp_test_ClientKey456'));
    assert.doesNotThrow(() => assertNoLiveRazorpayKeys('', ''));

    // Sub-check D: Active environment check — verify current process.env has NO live keys
    assertNoLiveRazorpayKeys();
  });

  it('2. Missing Key Handling (Visible Skip) - gracefully skips when rzp_test_* keys are absent', (t) => {
    const savedKeyId = process.env.RAZORPAY_KEY_ID;
    const savedKeySecret = process.env.RAZORPAY_KEY_SECRET;

    try {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;

      const keyId = process.env.RAZORPAY_KEY_ID || '';
      const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

      if (!keyId || !keySecret || !keyId.startsWith('rzp_test_')) {
        t.skip('Reason: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (rzp_test_*) not present in environment');
        return;
      }

      assert.fail('Should have skipped due to missing keys');
    } finally {
      if (savedKeyId !== undefined) process.env.RAZORPAY_KEY_ID = savedKeyId;
      if (savedKeySecret !== undefined) process.env.RAZORPAY_KEY_SECRET = savedKeySecret;
    }
  });

  it('3. Real Test-Mode Razorpay Refund & Idempotent Replay Verification (X-Refund-Idempotency)', async (t) => {
    // 1. Live Key Safety Guard: Hard fail immediately if live credentials are configured
    assertNoLiveRazorpayKeys();

    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

    // Permitted skip ONLY when keys are absent
    if (!keyId || !keySecret || !keyId.startsWith('rzp_test_')) {
      t.skip('Reason: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (rzp_test_*) not present in environment');
      return;
    }

    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    // 2. Retrieve real captured test payments from Razorpay test API
    const listRes = await fetch('https://api.razorpay.com/v1/payments?status=captured&count=50', {
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(listRes.ok, true, `Razorpay list payments API must return 200 OK (got ${listRes.status})`);

    const listData = await listRes.json();
    const items = listData.items || [];
    assert.ok(items.length > 0, 'Razorpay test account must have captured test payments');

    // 3. Generate a brand-new, fresh idempotency key for this test run
    // Spec: >= 10 chars, [a-zA-Z0-9_-]
    const customIdempotencyKey = `grp3-fresh-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const verifiedIdempKey = resolveRefundIdempotencyKey(customIdempotencyKey);
    assert.equal(verifiedIdempKey, customIdempotencyKey, 'Key must pass official spec validator unmodified');

    const refundAmountPaise = 100; // ₹1.00

    // 4. Iterate over candidate payments to find one that accepts a fresh refund
    let successfulPaymentId = null;
    let res1 = null;
    let res2 = null;

    for (const candidate of items) {
      if (!candidate.captured || (candidate.amount - (candidate.amount_refunded || 0)) < refundAmountPaise) {
        continue;
      }

      const refundPayload = {
        paymentId: candidate.id,
        amount: refundAmountPaise,
        idempotencyKey: customIdempotencyKey,
        speed: 'optimum',
      };

      try {
        // Call 1: Execute initial fresh refund
        res1 = await initiateRazorpayRefund(refundPayload);
        successfulPaymentId = candidate.id;

        // Call 2: Replay identical refund request with the EXACT SAME freshly generated key and payload
        res2 = await initiateRazorpayRefund(refundPayload);
        break;
      } catch (err) {
        if (err.message && err.message.includes('more than 6 months old')) {
          // If this specific historical payment hit the bank 6-month limit, continue to the next candidate
          continue;
        }
        throw err;
      }
    }

    assert.ok(
      successfulPaymentId,
      'Must successfully execute fresh refund on an eligible Razorpay test payment'
    );

    // Assertions on Call 1
    assert.equal(res1.success, true, 'First refund attempt must succeed');
    assert.ok(res1.id.startsWith('rfnd_'), `Expected rfnd_* ID, got ${res1.id}`);
    assert.equal(res1.amount, refundAmountPaise, 'Refund amount must match requested 100 paise');
    assert.equal(res1.is_mock, false, 'Must be real Razorpay gateway response');

    // Assertions on Call 2 (Idempotent Replay)
    assert.equal(res2.success, true, 'Idempotent replay call must succeed');
    assert.equal(
      res2.id,
      res1.id,
      `Idempotent replay MUST return the exact same refund ID (${res1.id} vs ${res2.id})`
    );
    assert.equal(
      res2.amount,
      res1.amount,
      'Idempotent replay amount must match original refund amount'
    );
    assert.equal(res2.is_mock, false, 'Replay must be real Razorpay gateway response');

    // Verify against Razorpay's list refunds endpoint that exactly ONE refund exists for this refund ID
    const refundsListRes = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(successfulPaymentId)}/refunds`,
      {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    assert.equal(refundsListRes.ok, true, 'Must successfully query payment refunds');
    const refundsListData = await refundsListRes.json();
    const matchingRefunds = (refundsListData.items || []).filter((r) => r.id === res1.id);
    assert.equal(
      matchingRefunds.length,
      1,
      `Exactly one refund entity must exist in Razorpay for refund ID ${res1.id} (found: ${matchingRefunds.length})`
    );
  });
});
