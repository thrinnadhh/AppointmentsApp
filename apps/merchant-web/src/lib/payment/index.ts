import type { PaymentGatewayAdapter } from './types.ts';
import { CashfreeAdapter } from './cashfree-adapter.ts';

export type * from './types.ts';
export { CashfreeAdapter } from './cashfree-adapter.ts';

/**
 * Factory function returning the Cashfree payment gateway adapter.
 * Cashfree PG (Easy Split) is the sole supported payment gateway.
 * The 'provider' parameter is kept for backwards compatibility but always returns CashfreeAdapter.
 */
export function getPaymentGateway(_provider?: string): PaymentGatewayAdapter {
  return new CashfreeAdapter();
}
