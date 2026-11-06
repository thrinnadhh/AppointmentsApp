import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Mobile App Security & Privacy Claims Veracity', () => {
  const checkoutModalPath = path.resolve('apps/customer-mobile/src/screens/CheckoutModal.tsx');
  const consentScreenPath = path.resolve('apps/customer-mobile/src/screens/ConsentScreen.tsx');

  it('1. CheckoutModal must not make false claims regarding Supabase Vault or 256-Bit ciphers', () => {
    const content = fs.readFileSync(checkoutModalPath, 'utf8');

    assert.equal(
      content.includes('Encrypted in Supabase Vault'),
      false,
      'CheckoutModal must not claim files are stored in Supabase Vault when stored in Storage'
    );
    assert.equal(
      content.includes('256-Bit Encrypted Payment Gateway'),
      false,
      'CheckoutModal must not claim 256-Bit payment gateway when TLS negotiates 128-bit AES-GCM'
    );
    assert.ok(
      content.includes('Stored in Private Storage'),
      'CheckoutModal must accurately claim "Stored in Private Storage"'
    );
    assert.ok(
      content.includes('Secured by Razorpay (PCI-DSS Level 1)'),
      'CheckoutModal must accurately claim PCI-DSS Level 1 certification'
    );
  });

  it('2. ConsentScreen must not falsely claim data is "not shared with third parties"', () => {
    const content = fs.readFileSync(consentScreenPath, 'utf8');

    assert.equal(
      content.includes('This data is not shared with third parties'),
      false,
      'ConsentScreen must not claim clinical data is not shared with third parties given essential sub-processors'
    );
    assert.ok(
      content.includes('processed securely by our platform and healthcare providers'),
      'ConsentScreen must accurately describe data processing by platform and healthcare providers'
    );
  });
});
