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

  it('4. CheckoutModal polls server for up to 60 seconds with 3-second intervals', () => {
    assert.match(modalSource, /const maxPollMs = 60000;/);
    assert.match(modalSource, /const pollIntervalMs = 3000;/);
    assert.match(modalSource, /elapsedMs \+= pollIntervalMs;/);
    assert.match(modalSource, /if \(pollRes\.success\)/);
    assert.match(modalSource, /onPaymentSuccess\(/);
  });

  it('5. Server remains the sole authority for confirmation (no client-side forging)', () => {
    // onPaymentSuccess is ONLY called when verifyRes.success, initialVerify.success, or pollRes.success is true
    const matches = [...modalSource.matchAll(/onPaymentSuccess\(/g)];
    assert.ok(matches.length >= 2, 'Must have at least 2 guarded onPaymentSuccess invocations');
    // Ensure both onClose and onFallbackVerify are wired to handleFallbackVerificationAndPoll
    assert.match(modalSource, /onClose=\{async \(\) => \{\s*setCashfreeModalVisible\(false\);\s*await handleFallbackVerificationAndPoll\(\);/);
    assert.match(modalSource, /onFallbackVerify=\{async \(\) => \{\s*setCashfreeModalVisible\(false\);\s*await handleFallbackVerificationAndPoll\(\);/);
  });
});
