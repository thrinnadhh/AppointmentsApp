import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Web & Legal Copy Security Claims Veracity Suite', () => {
  const privacyPagePath = path.resolve('apps/merchant-web/src/app/privacy/page.tsx');
  const adminPagePath = path.resolve('apps/merchant-web/src/app/admin/page.tsx');
  const decisionsDocPath = path.resolve('docs/decisions.md');

  it('1. Privacy page must not make false "not shared with third parties" or unqualified "AES-256 / TLS 1.3" claims', () => {
    const content = fs.readFileSync(privacyPagePath, 'utf8');

    assert.equal(
      content.includes('Clinic name and slot — not shared with third parties'),
      false,
      'Privacy page must not claim clinical data is not shared with third parties given essential sub-processors'
    );
    assert.equal(
      content.includes('AES-256 / TLS 1.3'),
      false,
      'Privacy page must not claim TLS 1.3 only or unqualified AES-256'
    );

    assert.ok(
      content.includes('TLS 1.2+'),
      'Privacy page must accurately state modern TLS (TLS 1.2+) support'
    );
    assert.ok(
      content.includes('Meta / WhatsApp') && content.includes('Upstash') && content.includes('Expo'),
      'Privacy page must catalog essential sub-processors (Meta/WhatsApp, Upstash, Expo)'
    );
  });

  it('2. Admin page must not claim audit trail is "Cryptographically secured" when secured via append-only RLS', () => {
    const content = fs.readFileSync(adminPagePath, 'utf8');

    assert.equal(
      content.includes('Cryptographically secured audit trail'),
      false,
      'Admin page must not claim cryptographic security without Merkle/HMAC proofs'
    );
    assert.ok(
      content.includes('Immutable administrative audit trail'),
      'Admin page must accurately claim immutable administrative audit trail'
    );
  });

  it('3. decisions.md must not state PIN verification uses "cryptographic hash RPC"', () => {
    const content = fs.readFileSync(decisionsDocPath, 'utf8');

    assert.equal(
      content.includes('cryptographic hash RPC'),
      false,
      'ADR must accurately describe verify_checkin_code as server-side RPC rather than cryptographic hash RPC'
    );
    assert.ok(
      content.includes('server-side RPC'),
      'ADR must state server-side RPC verification'
    );
  });

  it('4. apps/* source code must not contain exaggerated marketing claims (zero-knowledge, AES-256, bank-grade, compliant with DPDPA 2023)', () => {
    const prohibitedPatterns = [
      /compliant with the DPDPA 2023/i,
      /zero-?knowledge/i,
      /bank-?grade/i,
      /AES-256/i,
      /never shared/i,
    ];

    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === 'dist' || e.name === '.expo') continue;
        const fullPath = path.join(dir, e.name);
        if (e.isDirectory()) {
          scanDir(fullPath);
        } else if (/\.(tsx?|jsx?|md)$/.test(e.name)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          for (const pattern of prohibitedPatterns) {
            assert.equal(
              pattern.test(content),
              false,
              `Exaggerated claim matching ${pattern} found in ${fullPath}`
            );
          }
        }
      }
    }

    scanDir(path.resolve('apps/merchant-web/src'));
    scanDir(path.resolve('apps/customer-mobile/src'));
  });
});
