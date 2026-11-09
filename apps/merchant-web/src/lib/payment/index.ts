import type { PaymentGatewayAdapter } from './types.ts';
import { CashfreeAdapter } from './cashfree-adapter.ts';
import { RazorpayAdapter } from './razorpay-adapter.ts';

export type * from './types.ts';
export { CashfreeAdapter } from './cashfree-adapter.ts';
export { RazorpayAdapter } from './razorpay-adapter.ts';

/**
 * Factory function returning the active payment gateway adapter
 * based on PAYMENT_GATEWAY_PROVIDER environment variable ('cashfree' | 'razorpay').
 * Defaults to 'razorpay' to ensure backward compatibility.
 */
export function getPaymentGateway(provider?: 'cashfree' | 'razorpay'): PaymentGatewayAdapter {
  const selectedProvider = provider || (process.env.PAYMENT_GATEWAY_PROVIDER?.toLowerCase() as 'cashfree' | 'razorpay') || 'razorpay';

  if (selectedProvider === 'cashfree') {
    return new CashfreeAdapter();
  }

  return new RazorpayAdapter();
}
