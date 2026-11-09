import crypto from 'crypto';

export interface CashfreeConfig {
  appId?: string;
  secretKey?: string;
  env?: 'SANDBOX' | 'PRODUCTION';
}

export interface CashfreeOrderResponse {
  cf_order_id: string;
  order_id: string;
  payment_session_id?: string;
  order_status: string;
  order_amount: number;
  order_currency: string;
}

export interface CashfreeRefundResponse {
  cf_refund_id?: string;
  refund_id: string;
  refund_status: 'SUCCESS' | 'PENDING' | 'FAILED';
  refund_amount: number;
  refund_currency?: string;
}

/**
 * Normalizes phone numbers to a 10-digit format for Cashfree's strict validation.
 */
export function normalizePhoneNumber(phone?: string): string {
  if (!phone) return '9999999999';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  if (digits.length === 10) {
    return digits;
  }
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits.padEnd(10, '9');
}

/**
 * Formats a UUID booking ID into Cashfree's order_id specification (starts with cf_, length <= 45).
 */
export function formatOrderIdForCashfree(bookingId: string): string {
  const cleanId = bookingId.replace(/-/g, '').slice(0, 32);
  return `cf_${cleanId}`;
}

export class CashfreeClient {
  private appId: string;
  private secretKey: string;
  private baseUrl: string;

  constructor(config?: CashfreeConfig) {
    this.appId = config?.appId || process.env.CASHFREE_APP_ID || '';
    this.secretKey = config?.secretKey || process.env.CASHFREE_SECRET_KEY || '';
    const env = config?.env || (process.env.CASHFREE_ENV as 'SANDBOX' | 'PRODUCTION') || 'SANDBOX';
    this.baseUrl = env === 'PRODUCTION' 
      ? 'https://api.cashfree.com/pg' 
      : 'https://sandbox.cashfree.com/pg';
  }

  isConfigured(): boolean {
    return Boolean(
      this.appId &&
      this.secretKey &&
      !this.appId.includes('your-') &&
      !this.secretKey.includes('your-') &&
      !this.appId.startsWith('TEST_') &&
      !this.secretKey.startsWith('TEST_') &&
      this.appId.trim().length > 0 &&
      this.secretKey.trim().length > 0
    );
  }

  getHeaders(): Record<string, string> {
    return {
      'x-client-id': this.appId,
      'x-client-secret': this.secretKey,
      'x-api-version': '2023-08-01',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  async createOrder(payload: {
    order_id: string;
    order_amount: number;
    order_currency?: string;
    customer_details: {
      customer_id: string;
      customer_phone: string;
      customer_name?: string;
      customer_email?: string;
    };
    order_meta?: {
      return_url?: string;
      notify_url?: string;
    };
    order_expiry_time?: string;
    order_note?: string;
  }): Promise<CashfreeOrderResponse> {
    if (!this.isConfigured()) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('CRITICAL SECURITY ERROR: Cashfree credentials missing in production.');
      }
      // Deterministic mock order for non-production development if unconfigured
      return {
        cf_order_id: `mock_cf_${Date.now()}`,
        order_id: payload.order_id,
        payment_session_id: `session_mock_${Date.now()}`,
        order_status: 'ACTIVE',
        order_amount: payload.order_amount,
        order_currency: payload.order_currency || 'INR',
      };
    }

    const res = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Cashfree createOrder failed (${res.status}): ${errBody}`);
    }

    return await res.json();
  }

  async getOrder(orderId: string): Promise<CashfreeOrderResponse | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const res = await fetch(`${this.baseUrl}/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Cashfree getOrder failed (${res.status}): ${errBody}`);
    }

    return await res.json();
  }

  async createRefund(orderId: string, payload: {
    refund_amount: number;
    refund_id: string;
    refund_note?: string;
    refund_speed?: 'STANDARD' | 'INSTANT';
  }): Promise<CashfreeRefundResponse> {
    if (!this.isConfigured()) {
      return {
        cf_refund_id: `mock_cfr_${Date.now()}`,
        refund_id: payload.refund_id,
        refund_status: 'SUCCESS',
        refund_amount: payload.refund_amount,
      };
    }

    const res = await fetch(`${this.baseUrl}/orders/${encodeURIComponent(orderId)}/refunds`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Cashfree createRefund failed (${res.status}): ${errBody}`);
    }

    return await res.json();
  }

  verifyWebhookSignature(params: {
    rawBody: string;
    signature: string;
    timestamp?: string;
  }): { isValid: boolean; error?: string } {
    const { rawBody, signature, timestamp } = params;

    if (!signature) {
      return { isValid: false, error: 'Missing webhook signature' };
    }

    if (!this.secretKey) {
      return { isValid: false, error: 'Cashfree secret key unconfigured' };
    }

    if (timestamp) {
      const tsNum = parseInt(timestamp, 10);
      const timestampMs = tsNum > 10000000000 ? tsNum : tsNum * 1000;
      const nowMs = Date.now();
      if (isNaN(timestampMs) || Math.abs(nowMs - timestampMs) > 300_000) {
        return { isValid: false, error: 'Webhook timestamp tolerance exceeded (300s replay window)' };
      }
    }

    const payload = timestamp ? `${timestamp}${rawBody}` : rawBody;
    const computedSignature = crypto
      .createHmac('sha256', this.secretKey)
      .update(payload)
      .digest('base64');

    const sigBuffer = Buffer.from(signature, 'utf8');
    const compBuffer = Buffer.from(computedSignature, 'utf8');

    if (sigBuffer.length !== compBuffer.length) {
      return { isValid: false, error: 'Signature length mismatch' };
    }

    const isValid = crypto.timingSafeEqual(sigBuffer, compBuffer);
    return {
      isValid,
      error: isValid ? undefined : 'Invalid signature verification',
    };
  }
}
