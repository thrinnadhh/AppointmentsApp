import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

describe('F-05 Credentials & Mock Payments Security Audit', () => {
  it('verifies admin login page has no literal password or dev helper autofill', () => {
    const adminLoginPage = fs.readFileSync(
      path.join(ROOT_DIR, 'apps/merchant-web/src/app/admin/login/page.tsx'),
      'utf8'
    );

    assert.ok(
      !adminLoginPage.includes('AdminSecure2026!'),
      'admin login page must not contain hardcoded "AdminSecure2026!" password'
    );
    assert.ok(
      !adminLoginPage.includes('quick-fill-admin'),
      'admin login page must not contain quick-fill-admin test button'
    );
    assert.ok(
      !adminLoginPage.includes('quick-fill-merchant'),
      'admin login page must not contain quick-fill-merchant test button'
    );
    assert.ok(
      !adminLoginPage.includes('handleQuickFill'),
      'admin login page must not contain handleQuickFill function'
    );
  });

  it('verifies sensitive env files (.env, .env.local, .env.production) are NOT tracked by git', () => {
    const trackedFiles = execSync('git ls-files', { cwd: ROOT_DIR, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);

    const trackedSensitive = trackedFiles.filter((f) => {
      const base = path.basename(f);
      return (
        base === '.env' ||
        base === '.env.local' ||
        base === '.env.production' ||
        base === '.env.development' ||
        base.endsWith('.local')
      );
    });

    assert.deepEqual(
      trackedSensitive,
      [],
      `Sensitive env files must not be tracked in git: ${trackedSensitive.join(', ')}`
    );
  });

  it('verifies env.mjs throws fatal error when ALLOW_MOCK_PAYMENTS is true in production', () => {
    const envMjsPath = path.join(ROOT_DIR, 'apps/merchant-web/src/env.mjs');
    const envMjsContent = fs.readFileSync(envMjsPath, 'utf8');

    assert.ok(
      envMjsContent.includes("process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PAYMENTS === 'true'"),
      'env.mjs must contain explicit production assertion for ALLOW_MOCK_PAYMENTS'
    );

    // Run node subprocess simulating production environment with ALLOW_MOCK_PAYMENTS=true
    let threw = false;
    try {
      execSync(
        `node -e "process.env.NODE_ENV='production'; process.env.ALLOW_MOCK_PAYMENTS='true'; import('${envMjsPath}')"`,
        { stdio: 'pipe' }
      );
    } catch (err) {
      threw = true;
      const stderr = err.stderr ? err.stderr.toString() : '';
      assert.ok(
        stderr.includes('FATAL SECURITY VIOLATION: ALLOW_MOCK_PAYMENTS cannot be set to "true" in production'),
        `Expected fatal error output but got: ${stderr}`
      );
    }
    assert.ok(threw, 'env.mjs must throw when NODE_ENV=production and ALLOW_MOCK_PAYMENTS=true');
  });

  it('verifies canMockPayments throws in production when ALLOW_MOCK_PAYMENTS=true', async () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origMock = process.env.ALLOW_MOCK_PAYMENTS;
    const origSecret = process.env.RAZORPAY_KEY_SECRET;

    try {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_MOCK_PAYMENTS = 'true';
      process.env.RAZORPAY_KEY_SECRET = 'live_secret_sample_test_key_xyz123';

      const { canMockPayments } = await import(
        `../../apps/merchant-web/src/lib/razorpay.ts?t=${Date.now()}`
      );

      assert.throws(
        () => canMockPayments(),
        /FATAL SECURITY VIOLATION/,
        'canMockPayments must throw in production if ALLOW_MOCK_PAYMENTS is true'
      );
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      process.env.ALLOW_MOCK_PAYMENTS = origMock;
      process.env.RAZORPAY_KEY_SECRET = origSecret;
    }
  });

  it('verifies canMockPayments returns false in production when ALLOW_MOCK_PAYMENTS=false', async () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origMock = process.env.ALLOW_MOCK_PAYMENTS;
    const origSecret = process.env.RAZORPAY_KEY_SECRET;

    try {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_MOCK_PAYMENTS = 'false';
      process.env.RAZORPAY_KEY_SECRET = 'live_secret_sample_test_key_xyz123';

      const { canMockPayments } = await import(
        `../../apps/merchant-web/src/lib/razorpay.ts?t=${Date.now() + 1}`
      );

      assert.equal(
        canMockPayments(),
        false,
        'canMockPayments must return false in production'
      );
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      process.env.ALLOW_MOCK_PAYMENTS = origMock;
      process.env.RAZORPAY_KEY_SECRET = origSecret;
    }
  });
});
