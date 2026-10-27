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

    // 2. Secret resolution strictly from environment variable
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('CRITICAL SECURITY ERROR: RAZORPAY_WEBHOOK_SECRET environment variable is missing in production');
      }
      console.error('RAZORPAY_WEBHOOK_SECRET is not configured — refusing webhook request');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    // 3. Signature verification
    const signature = req.headers.get('x-razorpay-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Missing x-razorpay-signature header' }, { status: 401 });
    }

    if (!/^[a-f0-9]{64}$/i.test(signature)) {
      return NextResponse.json({ error: 'Malformed x-razorpay-signature header' }, { status: 400 });
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');

    const isMatch =
      sigBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(sigBuf, expectedBuf);

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

    // Check payment ledger for already-processed event ID (idempotency)
    if (paymentId) {
      const { data: existingPayment } = await supabaseAdmin
        .from('payments')
        .select('id, booking_id, status')
        .eq('gateway_payment_id', paymentId)
        .maybeSingle();

      if (existingPayment && existingPayment.status === 'CAPTURED') {
        return NextResponse.json(
          { success: true, booking_id: existingPayment.booking_id, idempotent: true, status: 'CONFIRMED' },
          { status: 200 }
        );
      }
    }

    // Handle payment.captured or order.paid
    if (event === 'payment.captured' || event === 'order.paid') {
      // 4. Find booking by gateway_order_id first, fallback to notes.booking_id
      let booking = null;
      if (orderId) {
        const { data: bByOrder } = await supabaseAdmin
          .from('bookings')
          .select('id, status, payment_status, deposit_amount, platform_fee, total_amount, gateway_payment_id, gateway_order_id, hold_expires_at')
          .eq('gateway_order_id', orderId)
          .maybeSingle();
        booking = bByOrder;
      }

      if (!booking && bookingIdFromNotes) {
        const { data: bById } = await supabaseAdmin
          .from('bookings')
          .select('id, status, payment_status, deposit_amount, platform_fee, total_amount, gateway_payment_id, gateway_order_id, hold_expires_at')
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

      // 6. Idempotency Check: if booking is already confirmed or captured
      if (booking.status === 'CONFIRMED' || booking.payment_status === 'CAPTURED') {
        return NextResponse.json(
          { success: true, booking_id: booking.id, idempotent: true, status: booking.status },
          { status: 200 }
        );
      }

      const payableStatuses = ['HELD', 'PENDING_PAYMENT', 'PENDING'];
      const isHoldExpired =
        booking.status === 'HELD' &&
        (booking as any).hold_expires_at &&
        new Date((booking as any).hold_expires_at).getTime() < Date.now();

      if (!payableStatuses.includes(booking.status) || isHoldExpired) {
        if (booking.status === 'CANCELLED' || isHoldExpired) {
          // Late payment arrived for cancelled or expired hold:
          // Record payment into ledger, mark booking as REFUND_PENDING, and trigger automated refund.
          const depositInInr = rawAmount ? rawAmount / 100 : Number(booking.deposit_amount || 0);
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
                reason: 'Late payment received after booking hold expired or cancelled',
                captured_at: new Date().toISOString(),
              },
            },
            { onConflict: 'gateway_payment_id' }
          );

          await supabaseAdmin
            .from('bookings')
            .update({
              status: 'CANCELLED',
              payment_status: 'REFUND_PENDING',
              gateway_payment_id: paymentId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', booking.id);

          try {
            const { initiateRazorpayRefund } = await import('@/lib/razorpay');
            const refundResult = await initiateRazorpayRefund({
              paymentId,
              amount: Math.round(depositInInr * 100),
              notes: {
                booking_id: booking.id,
                reason: 'Hold expired before payment completion',
              },
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
              gateway_payment_id: refundResult.id,
              amount: depositInInr,
              currency: paymentCurrency,
              status: 'REFUNDED',
              metadata: {
                original_payment_id: paymentId,
                reason: 'Hold expired before payment completion',
              },
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

            console.error(
              '\n====================================================================\n' +
              '[CRITICAL REFUND FAILURE - MANUAL FOLLOWUP REQUIRED]\n' +
              `Booking ID: ${booking.id}\n` +
              `Payment ID: ${paymentId}\n` +
              `Refund Amount: ₹${depositInInr}\n` +
              `Error: ${errorMsg}\n` +
              'Action: Manual investigation required in Razorpay Dashboard.\n' +
              '====================================================================\n'
            );

            await supabaseAdmin.from('admin_audit_logs').insert({
              admin_id: null,
              action: 'REFUND_MANUAL_INTERVENTION_REQUIRED',
              target_type: 'bookings',
              target_id: booking.id,
              details: {
                error: errorMsg,
                gateway_payment_id: paymentId,
                refund_amount: depositInInr,
                reason: 'Hold expired before payment completion (webhook)',
                failed_at: new Date().toISOString(),
              },
            });
          }

          return NextResponse.json(
            { success: true, received: true, event, booking_id: booking.id, status: 'CANCELLED', payment_status: 'REFUND_PENDING' },
            { status: 200 }
          );
        }

        return NextResponse.json(
          { error: `Cannot confirm booking in state: ${booking.status}` },
          { status: 400 }
        );
      }

      // 7. Atomic confirmation via RPC (pass held deposit amount, not total amount with fees)
      const expectedDepositAmount = Number(booking.deposit_amount);
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('confirm_booking_payment', {
        p_booking_id: booking.id,
        p_gateway_payment_id: paymentId,
        p_deposit_amount: expectedDepositAmount,
      });

      if (rpcError || !rpcData || !(rpcData as any).success) {
        const errorMsg = rpcError?.message || (rpcData as any)?.error || 'Failed to update booking';
        console.error('Webhook confirm_booking_payment RPC failed:', errorMsg);
        return NextResponse.json({ error: errorMsg }, { status: 500 });
      }

      // 8. Record in payments ledger
      const depositInInr = rawAmount ? rawAmount / 100 : expectedDepositAmount;
      const { error: paymentInsertError } = await supabaseAdmin.from('payments').upsert(
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

      if (paymentInsertError) {
        console.error('Webhook payments upsert failed:', paymentInsertError);
        return NextResponse.json({ error: 'Failed to record payment in ledger' }, { status: 500 });
      }

      return NextResponse.json({ success: true, received: true, event, booking_id: booking.id, status: 'CONFIRMED' }, { status: 200 });
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
