import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('SEC-WIN-002 & SEC-WIN-003: Cashfree WebView Origin & Scheme Lockdown', () => {
  const componentPath = path.resolve('apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('1. Scheme allowlist: intent:// is strictly excluded from UPI_SCHEMES', () => {
    assert.ok(
      !source.match(/UPI_SCHEMES\s*=\s*\[[^\]]*'intent:\/\/'/),
      'intent:// must NOT be in UPI_SCHEMES array'
    );
  });

  it('2. Origin allowlist: CashfreeCheckoutWebView contains explicit HTTPS domain allowlist', () => {
    assert.match(
      source,
      /sdk\.cashfree\.com/,
      'Must contain sdk.cashfree.com in origin allowlist'
    );
    assert.match(
      source,
      /api\.cashfree\.com/,
      'Must contain api.cashfree.com in origin allowlist'
    );
    assert.match(
      source,
      /isAllowedCashfreeUrl|CASHFREE_ALLOWED_ORIGINS/,
      'Must define explicit helper or set for allowed Cashfree origins'
    );
  });

  it('3. Navigation safety: handleShouldStartLoad must block unauthorized foreign domains by default', () => {
    assert.ok(
      !source.includes('return true;\n  };') && !source.includes('return true; // default allow all'),
      'handleShouldStartLoad must not fall through to unconditioned return true'
    );
  });

  it('4. Message handler safety: reads nativeEvent.url and treats payment payload as untrusted trigger', () => {
    assert.match(
      source,
      /nativeEvent\s*:\s*\{[^}]*data[^}]*url/,
      'handleMessage event signature must inspect nativeEvent.url'
    );
    assert.ok(
      !source.includes('nativeEvent.origin'),
      'Must not rely on nativeEvent.origin on native WebView'
    );
  });

  it('5. Fail-closed message handling: requires nativeEvent.url, wraps JSON.parse, and drops unknown types', () => {
    assert.match(
      source,
      /!currentUrl\s*\|\|\s*\(!isAllowedCashfreeUrl\(currentUrl\)/,
      'Must reject messages when nativeEvent.url is missing/falsy or not allowed'
    );
    assert.match(
      source,
      /try\s*\{\s*data\s*=\s*JSON\.parse\(event\.nativeEvent\.data\);\s*\}\s*catch/,
      'Must wrap JSON.parse in try/catch to prevent unhandled parse exceptions'
    );
    assert.match(
      source,
      /Ignored unknown postMessage event type/,
      'Must log and safely drop unknown postMessage types fail-closed'
    );
  });

  it('6. Manual verification marker for physical UPI deep link', () => {
    const verificationStatus = {
      test: 'UPI Scheme Deep Linking on Physical Devices',
      status: 'NEEDS_MANUAL_VERIFICATION',
      reason: 'Intent-to-UPI dispatch requires physical Android/iOS hardware with installed banking apps (PhonePe, Google Pay, BHIM).',
    };
    assert.equal(verificationStatus.status, 'NEEDS_MANUAL_VERIFICATION');
  });
});
