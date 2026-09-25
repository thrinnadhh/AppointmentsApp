import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { RazorpayWebhookPayload } from '@appointments/shared';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // 1. Validate JSON payload first (rejects malformed payloads with 400)
    let body: RazorpayWebhookPayload & {
      payload?: {
        payment?: { entity?: { id: string; amount?: number; currency?: string; notes?: { booking_id?: string; customer_id?: string } } };
        order?: { entity?: { id: string; amount?: number; currency?: string; notes?: { booking_id?: string; customer_id?: string } } };
      };
    };

    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // 2. Secret resolution with dev fallback
    const webhookSecret =
      process.env.RAZORPAY_WEBHOOK_SECRET ||
      (process.env.NODE_ENV !== 'production' ? 'dev_razorpay_webhook_secret' : undefined);

    if (!webhookSecret) {
      console.error('RAZORPAY_WEBHOOK_SECRET is not configured — refusing webhook request');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    // 3. Signature verification
    const signature = req.headers.get('x-razorpay-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Missing x-razorpay-signature header' }, { status: 401 });
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const isMatch =
      signature.length === expectedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

    if (!isMatch) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
    }

    const { event, payload } = body;
    const payment = payload?.payment?.entity;
    const order = payload?.order?.entity;
    const bookingId = payment?.notes?.booking_id || order?.notes?.booking_id;
    const paymentId = payment?.id || (order ? `pay_ord_${order.id}` : `pay_wh_${Date.now()}`);
    const rawAmount = payment?.amount ?? order?.amount;

    const supabaseAdmin = getSupabaseAdmin();

    // Handle payment.captured or order.paid via security definer RPC
    if ((event === 'payment.captured' || event === 'order.paid') && bookingId) {
      const depositInInr = rawAmount ? rawAmount / 100 : undefined;
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('confirm_booking_payment', {
        p_booking_id: bookingId,
        p_gateway_payment_id: paymentId,
        p_deposit_amount: depositInInr,
      });

      if (rpcError) {
        console.error('Webhook confirm_booking_payment RPC failed:', rpcError);
        return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 });
      }
    } else if (event === 'payment.failed' && bookingId) {
      await supabaseAdmin
        .from('bookings')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', bookingId)
        .eq('status', 'PENDING_PAYMENT');
    }

    return NextResponse.json({ received: true, event }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal webhook error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
