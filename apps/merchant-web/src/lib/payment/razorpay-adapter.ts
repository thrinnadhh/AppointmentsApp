import type {
  PaymentGatewayAdapter,
  CreateGatewayOrderParams,
  GatewayOrderResult,
  VerifyPaymentParams,
  GatewayPaymentDetails,
  GatewayRefundParams,
  GatewayRefundResult,
  VerifyWebhookParams,
  WebhookVerificationResult,
} from './types.ts';
import { CashfreeAdapter } from './cashfree-adapter.ts';

/**
 * @deprecated Razorpay is deprecated and retired in favor of Cashfree PG only.
 * RazorpayAdapter transparently re-routes all operations to CashfreeAdapter.
 */
export class RazorpayAdapter implements PaymentGatewayAdapter {
  readonly provider = 'cashfree' as const;
  private readonly delegate: CashfreeAdapter;

  constructor() {
    this.delegate = new CashfreeAdapter();
  }

  async createOrder(params: CreateGatewayOrderParams): Promise<GatewayOrderResult> {
    return this.delegate.createOrder(params);
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<boolean> {
    return this.delegate.verifyPayment(params);
  }

  async fetchOrder(orderId: string): Promise<GatewayPaymentDetails | null> {
    return this.delegate.fetchOrder(orderId);
  }

  async refundOrder(params: GatewayRefundParams): Promise<GatewayRefundResult> {
    return this.delegate.refundOrder(params);
  }

  verifyWebhook(params: VerifyWebhookParams): WebhookVerificationResult {
    return this.delegate.verifyWebhook(params);
  }
}
