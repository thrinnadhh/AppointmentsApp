import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidCashfreeScriptUrl, CASHFREE_SDK_ORIGIN } from '../../packages/shared/src/constants.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('MODWEB-007: Cashfree Dynamic SDK Origin Pinning & SRI Verification', () => {
  it('1. Confirms official Cashfree SDK origin is pinned to https://sdk.cashfree.com', () => {
    assert.equal(CASHFREE_SDK_ORIGIN, 'https://sdk.cashfree.com');
  });

  it('2. Accepts legitimate Cashfree SDK v3 URL', () => {
    assert.equal(isValidCashfreeScriptUrl('https://sdk.cashfree.com/js/v3/cashfree.js'), true);
    assert.equal(isValidCashfreeScriptUrl('https://sdk.cashfree.com/js/v3/cashfree.min.js'), true);
  });

  it('3. Rejects attacker domains, subdomains, and spoofed URLs', () => {
    assert.equal(isValidCashfreeScriptUrl('https://evil-attacker.com/js/v3/cashfree.js'), false);
    assert.equal(isValidCashfreeScriptUrl('https://sdk.cashfree.com.evil.com/js/v3/cashfree.js'), false);
    assert.equal(isValidCashfreeScriptUrl('http://sdk.cashfree.com/js/v3/cashfree.js'), false); // Plain HTTP rejected
    assert.equal(isValidCashfreeScriptUrl('javascript:alert(1)'), false);
    assert.equal(isValidCashfreeScriptUrl(''), false);
  });

  it('4. Verifies next.config.mjs pins https://sdk.cashfree.com in script-src and frame-src without wildcard relaxation', () => {
    const nextConfigPath = path.join(rootDir, 'apps/merchant-web/next.config.mjs');
    const content = fs.readFileSync(nextConfigPath, 'utf8');

    assert.match(content, /script-src[^;]*https:\/\/sdk\.cashfree\.com/);
    assert.match(content, /frame-src[^;]*https:\/\/sdk\.cashfree\.com/);
    assert.doesNotMatch(content, /script-src[^;]*https:\/\/\*\.cashfree\.com/, 'script-src must NOT use wildcard *.cashfree.com');
  });

  it('5. Verifies CheckoutModal.tsx guards script loading with isValidCashfreeScriptUrl check', () => {
    const modalPath = path.join(rootDir, 'apps/customer-mobile/src/screens/CheckoutModal.tsx');
    const content = fs.readFileSync(modalPath, 'utf8');

    assert.match(content, /isValidCashfreeScriptUrl\(src\)/, 'loadCashfreeScript must validate src with isValidCashfreeScriptUrl');
    assert.match(content, /CASHFREE_SDK_ORIGIN/, 'CheckoutModal must reference pinned CASHFREE_SDK_ORIGIN');
  });
});
