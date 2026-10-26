import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import path from 'path';

describe('Layer 2: API & Build Secret Safety (DEF-RC-01)', () => {
  const merchantWebDir = path.resolve(process.cwd(), 'apps/merchant-web');

  it('1. importing razorpay module in production mode without secrets must NOT throw at module evaluation time', () => {
    // Run an isolated node process evaluating an import of razorpay.ts
    // with NODE_ENV=production and stripped secrets
    const script = `
      process.env.NODE_ENV = 'production';
      delete process.env.RAZORPAY_KEY_SECRET;
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
      try {
        const mod = require('./src/lib/razorpay.ts');
        console.log('SUCCESS_IMPORT');
      } catch (err) {
        console.error('IMPORT_FAILED:', err.message);
        process.exit(1);
      }
    `;

    let stdout = '';
    try {
      stdout = execSync(
        `npx tsx -e "${script.replace(/"/g, '\\"')}"`,
        { cwd: merchantWebDir, encoding: 'utf8' }
      );
    } catch (e) {
      stdout = (e.stdout || '') + (e.stderr || '');
    }

    assert.ok(
      stdout.includes('SUCCESS_IMPORT'),
      `Importing razorpay module in production without secrets must succeed during build/import evaluation. Got: ${stdout}`
    );
  });

  it('2. calling createRazorpayOrder in production without secrets must throw fail-fast error at runtime', () => {
    const script = `
      process.env.NODE_ENV = 'production';
      delete process.env.RAZORPAY_KEY_SECRET;
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.ALLOW_MOCK_PAYMENTS;
      const mod = require('./src/lib/razorpay.ts');
      mod.createRazorpayOrder({ amount: 5000 }).then(() => {
        console.log('UNEXPECTED_SUCCESS');
        process.exit(1);
      }).catch(err => {
        if (err.message.includes('RAZORPAY_KEY_SECRET') || err.message.includes('CRITICAL SECURITY')) {
          console.log('EXPECTED_RUNTIME_SECURITY_THROW');
        } else {
          console.error('DIFFERENT_ERROR:', err.message);
          process.exit(1);
        }
      });
    `;

    const stdout = execSync(
      `npx tsx -e "${script.replace(/"/g, '\\"')}"`,
      { cwd: merchantWebDir, encoding: 'utf8' }
    );

    assert.ok(
      stdout.includes('EXPECTED_RUNTIME_SECURITY_THROW'),
      `Calling createRazorpayOrder without secrets must throw at runtime. Got: ${stdout}`
    );
  });
});
