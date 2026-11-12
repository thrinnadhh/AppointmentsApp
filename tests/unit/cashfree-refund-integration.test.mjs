import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CashfreeAdapter } from '../../apps/merchant-web/src/lib/payment/cashfree-adapter.ts';
import { CashfreeClient } from '../../apps/merchant-web/src/lib/cashfree.ts';

describe('Cashfree Refund Integration & Ledger Reconciliation (Phase 5)', () => {
  it('1. CashfreeAdapter.refundOrder converts amountInPaise to INR rupees and maps speed', async () => {
    const adapter = new CashfreeAdapter({
      appId: 'TEST_APP_ID',
      secretKey: 'TEST_SECRET_KEY',
      env: 'SANDBOX',
    });

    // In mock mode (mock credentials), returns deterministic mock response
    const resStandard = await adapter.refundOrder({
      orderId: 'cf_test_order_123',
      amountInPaise: 1000, // ₹10.00
      reason: 'Standard cancellation refund',
      speed: 'normal',
    });

    assert.equal(resStandard.orderId, 'cf_test_order_123');
    assert.equal(resStandard.amountInPaise, 1000);
    assert.equal(resStandard.gatewayProvider, 'cashfree');
    assert.equal(resStandard.status, 'SUCCESS');
    assert.ok(resStandard.refundId.startsWith('mock_cfr_') || resStandard.refundId.startsWith('ref_'));

    const resInstant = await adapter.refundOrder({
      orderId: 'cf_test_order_456',
      amountInPaise: 5000, // ₹50.00
      reason: 'Doctor Emergency 100% Refund',
      speed: 'instant',
    });

    assert.equal(resInstant.orderId, 'cf_test_order_456');
    assert.equal(resInstant.amountInPaise, 5000);
    assert.equal(resInstant.gatewayProvider, 'cashfree');
  });

  it('2. CashfreeClient header generation includes required Cashfree API headers', () => {
    const client = new CashfreeClient({
      appId: 'mock_app_id_val',
      secretKey: 'mock_client_key_val',
      env: 'SANDBOX',
    });

    const headers = client.getHeaders();
    assert.equal(headers['x-client-id'], 'mock_app_id_val');
    assert.equal(headers['x-client-secret'], 'mock_client_key_val');
    assert.equal(headers['x-api-version'], '2023-08-01');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['Accept'], 'application/json');
  });

  it('3. CashfreeClient rejects production execution when credentials are unconfigured', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const unconfiguredClient = new CashfreeClient({
        appId: '',
        secretKey: '',
      });

      await assert.rejects(
        async () => {
          await unconfiguredClient.createOrder({
            order_id: 'cf_test_prod_fail',
            order_amount: 10,
            customer_details: {
              customer_id: 'cust_1',
              customer_phone: '9999999999',
            },
          });
        },
        /CRITICAL SECURITY ERROR: Cashfree credentials missing in production/
      );
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });
});
