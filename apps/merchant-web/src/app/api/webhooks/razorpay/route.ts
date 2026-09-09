import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { RazorpayWebhookPayload } from '@appointments/shared';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Verify webhook signature if secret is configured
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers.get('x-razorpay-signature');
    if (webhookSecret) {
      if (!signature) {
        return NextResponse.json({ error: 'Missing x-razorpay-signature header' }, { status: 401 });
      }
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      if (signature !== expectedSignature) {
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
      }
    }

    let body: RazorpayWebhookPayload;

    try {
      body = JSON.parse(rawBody) as RazorpayWebhookPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const { event, payload } = body;
    const payment = payload?.payment?.entity;
    const bookingId = payment?.notes?.booking_id;

    if (event === 'payment.captured' && bookingId) {
      // 1. Mark booking confirmed
      const { error: bookingError } = await supabase
        .from('bookings')
        .update({
          status: 'CONFIRMED',
          payment_status: 'CAPTURED',
          gateway_payment_id: payment.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bookingId);

      if (bookingError) {
        console.error('Webhook booking update failed:', bookingError);
      }

      // 2. Insert or update payment record
      await supabase.from('payments').upsert({
        booking_id: bookingId,
        gateway_payment_id: payment.id,
        amount: (payment.amount || 10000) / 100, // Razorpay uses paise
        currency: payment.currency || 'INR',
        status: 'CAPTURED',
        metadata: {
          webhook_event: event,
          received_at: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json({ received: true, event }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal webhook error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
