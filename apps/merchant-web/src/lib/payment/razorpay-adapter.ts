import crypto from 'crypto';
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
import {
  createRazorpayOrder,
  verifyRazorpaySignature,
  fetchRazorpayOrder,
  initiateRazorpayRefund,
} from '../razorpay.ts';

export class RazorpayAdapter implements PaymentGatewayAdapter {
  readonly provider = 'razorpay' as const;

  async createOrder(params: CreateGatewayOrderParams): Promise<GatewayOrderResult> {
    const order = await createRazorpayOrder({
      amount: params.amountInPaise,
      currency: params.currency || 'INR',
      receipt: `rcpt_${params.bookingId.slice(0, 16)}`,
      notes: {
        booking_id: params.bookingId,
        customer_id: params.customerId,
        ...params.notes,
      },
    });

    return {
      orderId: params.bookingId,
      gatewayOrderId: order.id,
      amountInPaise: order.amount,
      currency: order.currency,
      status: order.status,
      gatewayProvider: 'razorpay',
      isMock: order.is_mock,
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<boolean> {
    if (!params.paymentId || !params.signature) {
      return false;
    }
    return verifyRazorpaySignature({
      orderId: params.orderId,
      paymentId: params.paymentId,
      signature: params.signature,
    });
  }

  async fetchOrder(orderId: string): Promise<GatewayPaymentDetails | null> {
    const rawOrder = await fetchRazorpayOrder(orderId);
    if (!rawOrder) return null;

    let mappedStatus: 'PAID' | 'FAILED' | 'PENDING' | 'USER_DROPPED' = 'PENDING';
    if (rawOrder.status === 'paid') {
      mappedStatus = 'PAID';
    } else if (rawOrder.status === 'attempted') {
      mappedStatus = 'PENDING';
    }

    return {
      orderId: rawOrder.id,
      status: mappedStatus,
      amountInPaise: rawOrder.amount,
      currency: rawOrder.currency,
      gatewayProvider: 'razorpay',
    };
  }

  async refundOrder(params: GatewayRefundParams): Promise<GatewayRefundResult> {
    const res = await initiateRazorpayRefund({
      paymentId: params.paymentId,
      amount: params.amountInPaise,
      bookingId: params.orderId,
      reason: params.reason,
      speed: params.speed || 'optimum',
    });

    let mappedStatus: 'SUCCESS' | 'PENDING' | 'FAILED' = 'PENDING';
    if (res.status === 'processed' || res.status === 'COMPLETED') {
      mappedStatus = 'SUCCESS';
    } else if (res.status === 'failed') {
      mappedStatus = 'FAILED';
    }

    return {
      refundId: res.id,
      orderId: params.orderId,
      amountInPaise: res.amount,
      status: mappedStatus,
      gatewayProvider: 'razorpay',
      isMock: res.is_mock,
      error: res.error,
    };
  }

  verifyWebhook(params: VerifyWebhookParams): WebhookVerificationResult {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      return { isValid: false, error: 'Razorpay webhook secret unconfigured' };
    }
    if (!params.signature) {
      return { isValid: false, error: 'Missing signature' };
    }

    const expected = crypto.createHmac('sha256', secret).update(params.rawBody).digest('hex');
    const sigBuf = Buffer.from(params.signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { isValid: false, error: 'Invalid Razorpay webhook signature' };
    }

    try {
      const event = JSON.parse(params.rawBody);
      return { isValid: true, event };
    } catch (e: any) {
      return { isValid: false, error: `Invalid JSON payload: ${e.message}` };
    }
  }
}
