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
        payment?: { entity?: { id: string; amount?: number; currency?: string; order_id?: string; notes?: { booking_id?: string; customer_id?: string } } };
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

    if (!event || (!payment && !order)) {
      return NextResponse.json({ received: true, message: 'Ignored non-payment event' }, { status: 200 });
    }

    const orderId = payment?.order_id || order?.id;
    const bookingIdFromNotes = payment?.notes?.booking_id || order?.notes?.booking_id;
    const paymentId = payment?.id || (order ? `pay_ord_${order.id}` : `pay_wh_${Date.now()}`);
    const rawAmount = payment?.amount ?? order?.amount;
    const paymentCurrency = payment?.currency ?? order?.currency ?? 'INR';

    const supabaseAdmin = getSupabaseAdmin();

    // Handle payment.captured or order.paid
    if (event === 'payment.captured' || event === 'order.paid') {
      // 4. Find booking by gateway_order_id first, fallback to notes.booking_id
      let booking = null;
      if (orderId) {
        const { data: bByOrder } = await supabaseAdmin
          .from('bookings')
          .select('id, status, payment_status, deposit_amount, platform_fee, total_amount, gateway_payment_id, gateway_order_id')
          .eq('gateway_order_id', orderId)
          .maybeSingle();
        booking = bByOrder;
      }

      if (!booking && bookingIdFromNotes) {
        const { data: bById } = await supabaseAdmin
          .from('bookings')
          .select('id, status, payment_status, deposit_amount, platform_fee, total_amount, gateway_payment_id, gateway_order_id')
          .eq('id', bookingIdFromNotes)
          .maybeSingle();
        booking = bById;
      }

      if (!booking) {
        return NextResponse.json({ error: 'Unknown order: booking not found' }, { status: 404 });
      }

      // 5. Verify currency and exact order amount match created order
      if (paymentCurrency !== 'INR') {
        return NextResponse.json({ error: `Invalid currency: expected INR, received ${paymentCurrency}` }, { status: 400 });
      }

      const expectedOrderAmountPaise = Math.round(Number(booking.total_amount ?? booking.deposit_amount ?? 100) * 100);
      if (rawAmount !== expectedOrderAmountPaise) {
        return NextResponse.json(
          { error: `Payment amount mismatch: expected ${expectedOrderAmountPaise} paise, received ${rawAmount}` },
          { status: 400 }
        );
      }

      // 6. Idempotency Check: if booking is already confirmed with this payment
      if (booking.status === 'CONFIRMED' && booking.gateway_payment_id === paymentId) {
        return NextResponse.json(
          { success: true, booking_id: booking.id, idempotent: true, status: 'CONFIRMED' },
          { status: 200 }
        );
      }

      // If already confirmed with any payment, return idempotent success
      if (booking.status === 'CONFIRMED') {
        return NextResponse.json(
          { success: true, booking_id: booking.id, idempotent: true, status: 'CONFIRMED' },
          { status: 200 }
        );
      }

      const payableStatuses = ['HELD', 'PENDING_PAYMENT', 'PENDING'];
      if (!payableStatuses.includes(booking.status)) {
        return NextResponse.json(
          { error: `Cannot confirm booking in state: ${booking.status}` },
          { status: 400 }
        );
      }

      // 7. Atomic confirmation via RPC
      const depositInInr = rawAmount ? rawAmount / 100 : Number(booking.deposit_amount);
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('confirm_booking_payment', {
        p_booking_id: booking.id,
        p_gateway_payment_id: paymentId,
        p_deposit_amount: depositInInr,
      });

      if (rpcError) {
        console.error('Webhook confirm_booking_payment RPC failed:', rpcError);
        return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 });
      }

      // 8. Record in payments ledger
      await supabaseAdmin.from('payments').upsert(
        {
          booking_id: booking.id,
          gateway_payment_id: paymentId,
          amount: depositInInr,
          currency: paymentCurrency,
          status: 'CAPTURED',
          metadata: {
            gateway: 'razorpay',
            order_id: orderId || booking.gateway_order_id,
            event,
            captured_at: new Date().toISOString(),
          },
        },
        { onConflict: 'gateway_payment_id' }
      );

      return NextResponse.json({ success: true, booking_id: booking.id, status: 'CONFIRMED' }, { status: 200 });
    } else if (event === 'payment.failed') {
      const orderIdOrNotes = orderId;
      if (orderIdOrNotes) {
        await supabaseAdmin
          .from('bookings')
          .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
          .eq('gateway_order_id', orderIdOrNotes)
          .in('status', ['HELD', 'PENDING_PAYMENT']);
      }
      return NextResponse.json({ received: true, event }, { status: 200 });
    }

    return NextResponse.json({ received: true, event }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal webhook error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
