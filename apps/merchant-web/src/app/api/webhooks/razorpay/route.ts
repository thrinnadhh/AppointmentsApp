import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { RazorpayWebhookPayload } from '@appointments/shared';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // 1. Validate JSON payload first (rejects malformed payloads with 400)
    let body: RazorpayWebhookPayload;
    try {
      body = JSON.parse(rawBody) as RazorpayWebhookPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // 2. Fail closed: if secret isn't configured, reject rather than skip verification
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
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

    if (
      signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
    }

    const { event, payload } = body;
    const payment = payload?.payment?.entity;
    const bookingId = payment?.notes?.booking_id;
    const supabaseAdmin = getSupabaseAdmin();

    if (event === 'payment.captured' && bookingId) {
      // supabaseAdmin uses the service-role key: bypasses RLS/trigger restrictions
      // as a deliberately trusted write, and actually has permission to write at all
      // (the previous anon-key client had no session and no RLS policy match here).
      const { error: bookingError } = await supabaseAdmin
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
        return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 });
      }

      if (!payment.amount) {
        console.error('Razorpay payload missing amount for booking', bookingId);
      }

      await supabaseAdmin.from('payments').upsert({
        booking_id: bookingId,
        gateway_payment_id: payment.id,
        amount: payment.amount ? payment.amount / 100 : 0, // Razorpay uses paise; no silent fallback amount
        currency: payment.currency || 'INR',
        status: 'CAPTURED',
        metadata: {
          webhook_event: event,
          received_at: new Date().toISOString(),
        },
      });
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
