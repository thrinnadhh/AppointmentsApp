import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getPaymentGateway } from '@/lib/payment/index.ts';
import { assertSafePayloadStructure, PayloadLimitExceededError } from '@/lib/validation-limits';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // 1. Signature and timestamp headers
    const signature = req.headers.get('x-webhook-signature');
    const timestamp = req.headers.get('x-webhook-timestamp');

    if (!signature) {
      return NextResponse.json({ error: 'Missing x-webhook-signature header' }, { status: 400 });
    }

    if (!timestamp) {
      return NextResponse.json({ error: 'Missing x-webhook-timestamp header' }, { status: 400 });
    }

    // 2. Cryptographic signature and 300s replay tolerance check via adapter
    const adapter = getPaymentGateway('cashfree');
    const verification = adapter.verifyWebhook({
      rawBody,
      signature,
      timestamp,
    });

    if (!verification.isValid) {
      return NextResponse.json({ error: verification.error || 'Invalid webhook signature' }, { status: 400 });
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
      assertSafePayloadStructure(body);
    } catch (parseErr) {
      if (parseErr instanceof PayloadLimitExceededError) {
        return NextResponse.json({ error: parseErr.message }, { status: 413 });
      }
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const eventType = body?.type || body?.event;
    const data = body?.data;
    const order = data?.order;
    const payment = data?.payment;

    if (!eventType || (!order && !payment)) {
      return NextResponse.json({ status: 'OK', received: true, message: 'Ignored unhandled event' }, { status: 200 });
    }

    const orderId = order?.order_id || payment?.order_id;
    const paymentId = payment?.cf_payment_id != null ? String(payment.cf_payment_id) : (orderId ? `cf_pay_${orderId}` : `cf_pay_${Date.now()}`);
    const rawAmountInRupees = Number(payment?.payment_amount ?? order?.order_amount ?? 0);
    const paymentCurrency = payment?.payment_currency ?? order?.order_currency ?? 'INR';

    const supabaseAdmin = getSupabaseAdmin();

    // 3. Check payment ledger for already-processed event ID (idempotency)
    if (paymentId) {
      const { data: existingPayment } = await supabaseAdmin
        .from('payments')
        .select('id, booking_id, status')
        .eq('gateway_payment_id', paymentId)
        .maybeSingle();

      if (existingPayment && existingPayment.status === 'CAPTURED') {
        return NextResponse.json(
          { status: 'OK', success: true, booking_id: existingPayment.booking_id, idempotent: true },
          { status: 200 }
        );
      }
    }

    // 4. Handle PAYMENT_SUCCESS_WEBHOOK
    if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' || eventType === 'order.paid') {
      let booking: any = null;
      if (orderId) {
        const { data: bByOrder } = await supabaseAdmin
          .from('bookings')
          .select('id, status, payment_status, deposit_amount, platform_fee, total_amount, expected_payment_amount_paise, gateway_payment_id, gateway_order_id, hold_expires_at, resource_id, slot_start')
          .eq('gateway_order_id', orderId)
          .maybeSingle();
        booking = bByOrder;
      }

      if (!booking) {
        return NextResponse.json({ error: 'Unknown order: booking not found' }, { status: 404 });
      }

      // Currency check
      if (paymentCurrency !== 'INR') {
        return NextResponse.json({ error: `Invalid currency: expected INR, received ${paymentCurrency}` }, { status: 400 });
      }

      // Amount verification in integer paise
      const expectedAmountPaise = booking.expected_payment_amount_paise != null
        ? Number(booking.expected_payment_amount_paise)
        : Math.round(Number(booking.total_amount ?? booking.deposit_amount ?? 10) * 100);

      const receivedAmountPaise = Math.round(rawAmountInRupees * 100);

      if (receivedAmountPaise !== expectedAmountPaise) {
        return NextResponse.json(
          { error: `Payment amount mismatch: expected ${expectedAmountPaise} paise, received ${receivedAmountPaise} paise` },
          { status: 400 }
        );
      }

      // Idempotency check: if booking is already confirmed or captured
      if (booking.status === 'CONFIRMED' || booking.payment_status === 'CAPTURED') {
        return NextResponse.json(
          { status: 'OK', success: true, booking_id: booking.id, idempotent: true, booking_status: booking.status },
          { status: 200 }
        );
      }

      const payableStatuses = ['HELD', 'PENDING_PAYMENT', 'PENDING'];
      const isHoldExpired =
        (booking.status === 'HELD' &&
          booking.hold_expires_at &&
          new Date(booking.hold_expires_at).getTime() < Date.now()) ||
        booking.status === 'CANCELLED';

      if (!payableStatuses.includes(booking.status) || isHoldExpired) {
        // Late payment arrived for expired hold or cancelled slot:
        // Use atomic PostgreSQL RPC with slot-level transactional locking
        // to eliminate TOCTOU race conditions and double-booking.
        const { data: rpcData, error: rpcErr } = await (supabaseAdmin.rpc as any)('reclaim_expired_hold_or_refund', {
          p_booking_id: booking.id,
          p_payment_id: paymentId,
          p_order_id: orderId,
          p_amount: rawAmountInRupees,
          p_currency: paymentCurrency,
        });

        if (rpcErr) {
          console.error('[Cashfree Webhook] Error in reclaim_expired_hold_or_refund RPC:', rpcErr);
          return NextResponse.json({ error: rpcErr.message }, { status: 500 });
        }

        if (rpcData?.reclaimed) {
          // Case A: Slot was free and atomically reclaimed
          return NextResponse.json({
            status: 'OK',
            success: true,
            booking_id: booking.id,
            reclaimed: true,
            message: 'Slot reclaimed and confirmed after expired hold',
          });
        }

        // Case B: Slot is occupied by a competing booking.
        // The RPC atomically set booking to CANCELLED / REFUND_PENDING and created the CRITICAL audit log.
        // Now trigger the real Cashfree refund API call.
        try {
          const refundResult = await adapter.refundOrder({
            orderId: orderId,
            paymentId: paymentId,
            amountInPaise: receivedAmountPaise,
            reason: 'Hold expired and slot occupied before payment completion',
          });

          await supabaseAdmin
            .from('bookings')
            .update({
              payment_status: 'REFUNDED',
              updated_at: new Date().toISOString(),
            })
            .eq('id', booking.id);

          await supabaseAdmin.from('payments').insert({
            booking_id: booking.id,
            gateway_payment_id: refundResult.refundId,
            amount: rawAmountInRupees,
            currency: paymentCurrency,
            status: 'REFUNDED',
            metadata: {
              original_payment_id: paymentId,
              reason: 'Hold expired and slot occupied before payment completion',
            },
          });

          return NextResponse.json({
            status: 'OK',
            success: true,
            booking_id: booking.id,
            reclaimed: false,
            refund_id: refundResult.refundId,
            message: 'Slot was occupied by competitor. Late payment automatically refunded via Cashfree.',
          });
        } catch (refundErr) {
          const errorMsg = refundErr instanceof Error ? refundErr.message : String(refundErr);
          await supabaseAdmin
            .from('bookings')
            .update({ payment_status: 'REFUND_FAILED', updated_at: new Date().toISOString() })
            .eq('id', booking.id);

          await supabaseAdmin
            .from('payments')
            .update({ status: 'REFUND_FAILED', updated_at: new Date().toISOString() })
            .eq('gateway_payment_id', paymentId);

          console.error('[Cashfree Webhook] Refund failed for expired hold booking:', booking.id, errorMsg);
          return NextResponse.json({
            status: 'ERROR',
            success: false,
            booking_id: booking.id,
            reclaimed: false,
            error: errorMsg || 'Auto-refund failed; marked REFUND_FAILED for admin reconciliation',
          }, { status: 500 });
        }
      }

      // Valid active hold: settle payment via Supabase RPC confirm_booking_payment
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('confirm_booking_payment', {
        p_booking_id: booking.id,
        p_gateway_payment_id: paymentId,
        p_deposit_amount: rawAmountInRupees,
      });

      if (rpcError) {
        console.error('Error confirming Cashfree payment via RPC:', rpcError);
        return NextResponse.json({ error: rpcError.message }, { status: 500 });
      }

      const result = rpcData as { success: boolean; error?: string };
      if (!result?.success) {
        return NextResponse.json({ error: result?.error || 'Failed to confirm booking' }, { status: 400 });
      }

      // Release Redis slot lock if applicable
      if (booking.resource_id && booking.slot_start) {
        try {
          const { releaseSlotLock } = await import('@/lib/redis');
          await releaseSlotLock(`${booking.resource_id}:${booking.slot_start}`);
        } catch (e) {
          console.warn('[Cashfree Webhook] Failed to release slot lock:', e);
        }
      }

      return NextResponse.json(
        { status: 'OK', success: true, booking_id: booking.id },
        { status: 200 }
      );
    }

    // 5. Handle PAYMENT_FAILED_WEBHOOK or PAYMENT_USER_DROPPED_WEBHOOK
    if (eventType === 'PAYMENT_FAILED_WEBHOOK' || eventType === 'PAYMENT_USER_DROPPED_WEBHOOK') {
      if (orderId) {
        const { data: booking } = await supabaseAdmin
          .from('bookings')
          .select('id, status, resource_id, slot_start')
          .eq('gateway_order_id', orderId)
          .maybeSingle();

        if (booking && ['HELD', 'PENDING_PAYMENT'].includes(booking.status)) {
          await supabaseAdmin
            .from('bookings')
            .update({
              status: 'CANCELLED',
              updated_at: new Date().toISOString(),
            })
            .eq('id', booking.id);

          if (booking.resource_id && booking.slot_start) {
            try {
              const { releaseSlotLock } = await import('@/lib/redis');
              await releaseSlotLock(`${booking.resource_id}:${booking.slot_start}`);
            } catch (e) {
              console.warn('[Cashfree Webhook] Failed to release slot lock:', e);
            }
          }
        }
      }

      return NextResponse.json({ status: 'OK', received: true }, { status: 200 });
    }

    // Unhandled event types
    return NextResponse.json({ status: 'OK', received: true }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error processing Cashfree webhook';
    console.error('Cashfree webhook endpoint failure:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
