/**
 * Unified Payment Gateway Types & Interface
 * Standardizes currency values in integer paise (amountInPaise: number)
 */

export interface CreateGatewayOrderParams {
  bookingId: string;
  amountInPaise: number;
  currency?: string;
  customerId: string;
  customerPhone: string;
  customerName?: string;
  customerEmail?: string;
  orderExpiryTime?: string; // ISO 8601 string, e.g. now + 5 minutes
  notes?: Record<string, string>;
}

export interface GatewayOrderResult {
  orderId: string;
  gatewayOrderId: string;
  paymentSessionId?: string;
  amountInPaise: number;
  currency: string;
  status: string;
  gatewayProvider: 'cashfree' | 'razorpay';
  isMock: boolean;
}

export interface VerifyPaymentParams {
  orderId: string;
  paymentId?: string;
  signature?: string;
}

export interface GatewayPaymentDetails {
  orderId: string;
  paymentId?: string;
  status: 'PAID' | 'FAILED' | 'PENDING' | 'USER_DROPPED';
  amountInPaise: number;
  currency: string;
  gatewayProvider: 'cashfree' | 'razorpay';
}

export interface GatewayRefundParams {
  orderId: string;
  paymentId?: string;
  amountInPaise: number;
  refundId?: string;
  reason?: string;
  speed?: 'normal' | 'optimum' | 'instant';
}

export interface GatewayRefundResult {
  refundId: string;
  orderId: string;
  amountInPaise: number;
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  gatewayProvider: 'cashfree' | 'razorpay';
  isMock: boolean;
  error?: string;
}

export interface VerifyWebhookParams {
  rawBody: string;
  signature: string;
  timestamp?: string;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  event?: any;
  error?: string;
}

export interface PaymentGatewayAdapter {
  readonly provider: 'cashfree' | 'razorpay';
  createOrder(params: CreateGatewayOrderParams): Promise<GatewayOrderResult>;
  verifyPayment(params: VerifyPaymentParams): Promise<boolean>;
  fetchOrder(orderId: string): Promise<GatewayPaymentDetails | null>;
  refundOrder(params: GatewayRefundParams): Promise<GatewayRefundResult>;
  verifyWebhook(params: VerifyWebhookParams): WebhookVerificationResult;
}
