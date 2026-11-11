import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Cashfree & Mock Payment Verification Security (API Layer)', () => {
  const verifyRoutePath = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/payments/verify/route.ts');
  const confirmRoutePath = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/bookings/confirm/route.ts');

  it('1. verify route strictly guards mock payments & mock orders with canMockPayments()', () => {
    const code = fs.readFileSync(verifyRoutePath, 'utf8');

    // Import check
    assert.match(code, /canMockPayments/, 'Must import canMockPayments');

    // Synthetic prefix detection in Cashfree branch
    assert.match(code, /incomingPaymentId\.startsWith\(['"]mock_['"]\)/, 'Must detect mock_ payment prefix');
    assert.match(code, /incomingPaymentId\.startsWith\(['"]sim_['"]\)/, 'Must detect sim_ payment prefix');
    assert.match(code, /incomingPaymentId\.startsWith\(['"]pay_mock_['"]\)/, 'Must detect pay_mock_ payment prefix');
    assert.match(code, /incomingPaymentId\.startsWith\(['"]cf_pay_['"]\)/, 'Must detect cf_pay_ synthetic payment prefix');
    assert.match(code, /incomingPaymentId\.startsWith\(['"]cf_mock_['"]\)/, 'Must detect cf_mock_ payment prefix');

    // Synthetic order prefix detection
    assert.match(code, /cfTargetOrderId\.startsWith\(['"]cf_mock_['"]\)/, 'Must detect cf_mock_ order prefix');
    assert.match(code, /cfTargetOrderId\.startsWith\(['"]mock_['"]\)/, 'Must detect mock_ order prefix');

    // Strict rejection message when mock payments are disabled
    assert.match(
      code,
      /Mock payments and mock orders are disabled in this environment/,
      'Must return 400 with "Mock payments and mock orders are disabled in this environment"'
    );
  });

  it('2. verify route strictly enforces order_id binding for Cashfree', () => {
    const code = fs.readFileSync(verifyRoutePath, 'utf8');
    assert.match(
      code,
      /!booking\.gateway_order_id \|\| booking\.gateway_order_id !== cfTargetOrderId/,
      'Cashfree branch must strictly verify booking.gateway_order_id matches incoming cfTargetOrderId'
    );
    assert.match(
      code,
      /Order ID mismatch or unlinked booking: Payment order ID does not match booking reservation/,
      'Must return 400 for unlinked or mismatched Cashfree order IDs'
    );
  });

  it('3. verify route strictly checks amount tampering against expected_payment_amount_paise', () => {
    const code = fs.readFileSync(verifyRoutePath, 'utf8');
    assert.match(
      code,
      /expectedAmountPaise/,
      'Must calculate expected amount in paise'
    );
    assert.match(
      code,
      /orderDetails\.amountInPaise !== expectedAmountPaise/,
      'Must strictly compare orderDetails.amountInPaise to expectedAmountPaise'
    );
    assert.match(
      code,
      /Tampered payment amount/,
      'Must reject with Tampered payment amount when amount differs'
    );
  });

  it('4. verify route enforces anti-replay protection on Cashfree payment identifier', () => {
    const code = fs.readFileSync(verifyRoutePath, 'utf8');
    assert.match(
      code,
      /from\(['"]payments['"]\)[\s\S]*?\.select\(['"]id, booking_id['"]\)[\s\S]*?\.eq\(['"]gateway_payment_id['"], effectivePaymentId\)/,
      'Must check payments table for existing payment identifier before confirmation'
    );
    assert.match(
      code,
      /Payment identifier has already been used for another booking/,
      'Must return 409 if payment identifier was used for a different booking'
    );
  });

  it('5. verify route handles expired hold with Cashfree auto-refund and audit logging', () => {
    const code = fs.readFileSync(verifyRoutePath, 'utf8');
    assert.match(code, /isHoldExpired/, 'Must calculate isHoldExpired');
    assert.match(code, /cfAdapter\.refundOrder/, 'Must call cfAdapter.refundOrder on hold expiration');
    assert.match(code, /REFUND_PENDING/, 'Must set booking payment_status to REFUND_PENDING during auto-refund');
    assert.match(code, /REFUNDED/, 'Must set booking payment_status to REFUNDED upon success');
    assert.match(code, /REFUND_FAILED/, 'Must set booking payment_status to REFUND_FAILED upon failure');
    assert.match(
      code,
      /REFUND_MANUAL_INTERVENTION_REQUIRED/,
      'Must record audit log entry for manual intervention on refund failure'
    );
  });

  it('6. confirm route strictly detects synthetic mock IDs including cf_pay_ and cf_mock_', () => {
    const code = fs.readFileSync(confirmRoutePath, 'utf8');
    assert.match(code, /gateway_payment_id\.startsWith\(['"]cf_pay_['"]\)/, 'Confirm route must detect cf_pay_ prefix');
    assert.match(code, /gateway_payment_id\.startsWith\(['"]cf_mock_['"]\)/, 'Confirm route must detect cf_mock_ prefix');
    assert.match(code, /canMockPayments\(\)/, 'Confirm route must guard with canMockPayments()');
  });
});
