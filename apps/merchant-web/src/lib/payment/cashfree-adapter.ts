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
import type { CashfreeConfig } from '../cashfree.ts';
import {
  CashfreeClient,
  formatOrderIdForCashfree,
  normalizePhoneNumber,
} from '../cashfree.ts';

export class CashfreeAdapter implements PaymentGatewayAdapter {
  readonly provider = 'cashfree' as const;
  private client: CashfreeClient;

  constructor(config?: CashfreeConfig) {
    this.client = new CashfreeClient(config);
  }

  paiseToRupees(paise: number): number {
    return Math.round(paise) / 100;
  }

  rupeesToPaise(rupees: number): number {
    return Math.round(rupees * 100);
  }

  async createOrder(params: CreateGatewayOrderParams): Promise<GatewayOrderResult> {
    const cfOrderId = formatOrderIdForCashfree(params.bookingId);
    const amountInRupees = this.paiseToRupees(params.amountInPaise);

    // Default expiry to 5 minutes from now if not provided
    const expiryTime = params.orderExpiryTime || new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const response = await this.client.createOrder({
      order_id: cfOrderId,
      order_amount: amountInRupees,
      order_currency: params.currency || 'INR',
      customer_details: {
        customer_id: params.customerId || `cust_${params.bookingId.slice(0, 8)}`,
        customer_phone: normalizePhoneNumber(params.customerPhone),
        customer_name: params.customerName || 'Hospital Patient',
        customer_email: params.customerEmail,
      },
      order_expiry_time: expiryTime,
    });

    return {
      orderId: params.bookingId,
      gatewayOrderId: response.cf_order_id || response.order_id,
      paymentSessionId: response.payment_session_id,
      amountInPaise: params.amountInPaise,
      currency: response.order_currency || 'INR',
      status: response.order_status,
      gatewayProvider: 'cashfree',
      isMock: !this.client.isConfigured(),
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<boolean> {
    const order = await this.fetchOrder(params.orderId);
    return order !== null && order.status === 'PAID';
  }

  async fetchOrder(orderId: string): Promise<GatewayPaymentDetails | null> {
    const rawOrder = await this.client.getOrder(orderId);
    if (!rawOrder) return null;

    let mappedStatus: 'PAID' | 'FAILED' | 'PENDING' | 'USER_DROPPED' = 'PENDING';
    if (rawOrder.order_status === 'PAID') {
      mappedStatus = 'PAID';
    } else if (rawOrder.order_status === 'EXPIRED') {
      mappedStatus = 'FAILED';
    } else if (rawOrder.order_status === 'USER_DROPPED') {
      mappedStatus = 'USER_DROPPED';
    }

    return {
      orderId: rawOrder.order_id,
      paymentId: rawOrder.cf_order_id,
      status: mappedStatus,
      amountInPaise: this.rupeesToPaise(rawOrder.order_amount),
      currency: rawOrder.order_currency,
      gatewayProvider: 'cashfree',
    };
  }

  async refundOrder(params: GatewayRefundParams): Promise<GatewayRefundResult> {
    const refundAmountRupees = this.paiseToRupees(params.amountInPaise);
    const refundId = params.refundId || `ref_${Date.now()}`;

    const res = await this.client.createRefund(params.orderId, {
      refund_amount: refundAmountRupees,
      refund_id: refundId,
      refund_note: params.reason || 'Hospital appointment refund',
      refund_speed: params.speed === 'instant' ? 'INSTANT' : 'STANDARD',
    });

    return {
      refundId: res.refund_id,
      orderId: params.orderId,
      amountInPaise: params.amountInPaise,
      status: res.refund_status,
      gatewayProvider: 'cashfree',
      isMock: !this.client.isConfigured(),
    };
  }

  verifyWebhook(params: VerifyWebhookParams): WebhookVerificationResult {
    const verification = this.client.verifyWebhookSignature(params);
    if (!verification.isValid) {
      return { isValid: false, error: verification.error };
    }

    try {
      const parsed = JSON.parse(params.rawBody);
      return { isValid: true, event: parsed };
    } catch (e: any) {
      return { isValid: false, error: `Invalid JSON payload: ${e.message}` };
    }
  }
}
