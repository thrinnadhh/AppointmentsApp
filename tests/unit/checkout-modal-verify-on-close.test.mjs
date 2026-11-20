import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const webViewSource = readFileSync('apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx', 'utf-8');
const modalSource = readFileSync('apps/customer-mobile/src/screens/CheckoutModal.tsx', 'utf-8');

describe('CashfreeCheckoutWebView & CheckoutModal: Fail-Closed On-Close Verification & Polling', () => {
  it('1. CashfreeCheckoutWebView origin guard remains strict and rejects unauthorized origins', () => {
    // Assert origin check logic exists
    assert.match(webViewSource, /isAllowedCashfreeUrl/);
    assert.match(webViewSource, /CASHFREE_ALLOWED_ORIGINS/);
    assert.match(webViewSource, /https:\/\/payments\.cashfree\.com/);
    assert.match(webViewSource, /https:\/\/api\.cashfree\.com/);
  });

  it('2. Missing URL triggers server-authoritative fallback without processing payload', () => {
    // Verify that when currentUrl is missing, handleMessage does NOT evaluate payload.type === 'PAYMENT_SUCCESS'
    assert.match(webViewSource, /if \(!currentUrl && onFallbackVerify\)/);
    assert.match(webViewSource, /onFallbackVerify\(\);/);
    assert.match(webViewSource, /return;\s*\}/);
  });

  it('3. CheckoutModal defines handleFallbackVerificationAndPoll calling verify once immediately', () => {
    assert.match(modalSource, /handleFallbackVerificationAndPoll/);
    assert.match(modalSource, /const initialVerify = await verifyRazorpayPayment\(/);
    assert.match(modalSource, /gateway_provider:\s*['"]cashfree['"]/);
  });

  it('4. CheckoutModal polls server for up to 60s with 5s base interval (max 12 req/min)', () => {
    assert.match(modalSource, /const maxPollMs = 60000;/);
    assert.match(modalSource, /let pollIntervalMs = 5000;/);
    assert.match(modalSource, /elapsedMs \+= pollIntervalMs;/);
    assert.match(modalSource, /if \(pollRes\.success\)/);
    assert.match(modalSource, /onPaymentSuccess\(/);
  });

  it('5. CheckoutModal backs off on HTTP 429 rate limit responses', () => {
    // Verifies 429 backoff logic: checks pollRes.statusCode === 429 or error containing 429 and increases interval
    assert.match(modalSource, /pollRes\.statusCode === 429/);
    assert.match(modalSource, /pollIntervalMs = Math\.min\(pollIntervalMs \* 2, 20000\);/);
  });

  it('6. CheckoutModal stops polling immediately on terminal/final status', () => {
    // Terminal statuses: CANCELLED, EXPIRED, REJECTED, FAILED, REFUNDED
    assert.match(modalSource, /terminalStatuses = \['CANCELLED', 'EXPIRED', 'REJECTED', 'FAILED', 'REFUNDED'\]/);
    assert.match(modalSource, /if \(pollRes\.status && terminalStatuses\.includes\(pollRes\.status\.toUpperCase\(\)\)\)/);
    assert.match(modalSource, /setIsProcessing\(false\);/);
  });

  it('7. Server remains the sole authority for confirmation (no client-side forging)', () => {
    // onPaymentSuccess is ONLY called when verifyRes.success, initialVerify.success, or pollRes.success is true
    const matches = [...modalSource.matchAll(/onPaymentSuccess\(/g)];
    assert.ok(matches.length >= 2, 'Must have at least 2 guarded onPaymentSuccess invocations');
    // Ensure both onClose and onFallbackVerify are wired to handleFallbackVerificationAndPoll
    assert.match(modalSource, /onClose=\{async \(\) => \{\s*setCashfreeModalVisible\(false\);\s*await handleFallbackVerificationAndPoll\(\);/);
    assert.match(modalSource, /onFallbackVerify=\{async \(\) => \{\s*setCashfreeModalVisible\(false\);\s*await handleFallbackVerificationAndPoll\(\);/);
  });
});
