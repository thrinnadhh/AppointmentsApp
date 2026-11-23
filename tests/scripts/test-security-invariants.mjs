import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import path from 'node:path';

const INVARIANT_TESTS = [
  'tests/security/invariants/route-auth-invariant.test.mjs',
  'tests/security/invariants/csrf-guard-invariant.test.mjs',
  'tests/security/invariants/security-definer-invariant.test.mjs',
  'tests/security/invariants/rls-with-check-invariant.test.mjs',
  'tests/security/invariants/webhooks-hmac-invariant.test.mjs',
  'tests/security/invariants/dom-sinks-invariant.test.mjs',
  'tests/security/invariants/client-env-secrets-invariant.test.mjs',
  'tests/security/invariants/unrestricted-grants-invariant.test.mjs',
];

for (const testPath of INVARIANT_TESTS) {
  test(`Security Invariant: ${path.basename(testPath, '.test.mjs')}`, () => {
    try {
      execSync(`node --test ${testPath}`, { stdio: 'pipe', encoding: 'utf8' });
      assert.ok(true);
    } catch (err) {
      console.error(`Invariant failure in ${testPath}:\n`, err.stdout || err.stderr || err.message);
      assert.fail(`Invariant suite ${testPath} failed: ${err.message}`);
    }
  });
}
