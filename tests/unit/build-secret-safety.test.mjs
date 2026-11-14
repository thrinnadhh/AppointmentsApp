import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import path from 'path';

describe('Layer 2: API & Build Secret Safety (DEF-RC-01)', () => {
  const merchantWebDir = path.resolve(process.cwd(), 'apps/merchant-web');

  it('1. importing cashfree module in production mode without secrets must NOT throw at module evaluation time', () => {
    const script = `
      process.env.NODE_ENV = 'production';
      delete process.env.CASHFREE_APP_ID;
      delete process.env.CASHFREE_SECRET_KEY;
      delete process.env.CASHFREE_WEBHOOK_SECRET;
      try {
        const mod = require('./src/lib/cashfree.ts');
        console.log('SUCCESS_IMPORT_CASHFREE');
      } catch (err) {
        console.error('IMPORT_FAILED:', err.message);
        process.exit(1);
      }
    `;

    let stdout = '';
    try {
      stdout = execSync(
        `node -e "${script.replace(/"/g, '\\"')}"`,
        { cwd: merchantWebDir, encoding: 'utf8' }
      );
    } catch (e) {
      stdout = (e.stdout || '') + (e.stderr || '');
    }

    assert.ok(
      stdout.includes('SUCCESS_IMPORT_CASHFREE'),
      `Importing cashfree module in production without secrets must succeed during build/import evaluation. Got: ${stdout}`
    );
  });

  it('2. calling CashfreeClient.createOrder in production without secrets must throw fail-fast error at runtime', () => {
    const script = `
      process.env.NODE_ENV = 'production';
      delete process.env.CASHFREE_APP_ID;
      delete process.env.CASHFREE_SECRET_KEY;
      delete process.env.ALLOW_MOCK_PAYMENTS;
      const { CashfreeClient } = require('./src/lib/cashfree.ts');
      const client = new CashfreeClient();
      client.createOrder({
        order_id: 'cf_test_123',
        order_amount: 100,
        customer_details: {
          customer_id: 'cust_123',
          customer_phone: '9999999999'
        }
      }).then(() => {
        console.log('UNEXPECTED_SUCCESS');
        process.exit(1);
      }).catch(err => {
        if (err.message.includes('Cashfree credentials missing') || err.message.includes('CRITICAL SECURITY ERROR')) {
          console.log('EXPECTED_RUNTIME_SECURITY_THROW_CASHFREE');
        } else {
          console.error('DIFFERENT_ERROR:', err.message);
          process.exit(1);
        }
      });
    `;

    const stdout = execSync(
      `node -e "${script.replace(/"/g, '\\"')}"`,
      { cwd: merchantWebDir, encoding: 'utf8' }
    );

    assert.ok(
      stdout.includes('EXPECTED_RUNTIME_SECURITY_THROW_CASHFREE'),
      `Calling CashfreeClient.createOrder without secrets in production must throw at runtime. Got: ${stdout}`
    );
  });
});
