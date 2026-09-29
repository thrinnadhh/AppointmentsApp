import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { initiateRazorpayRefund } from '@/lib/razorpay';
import { CancelBookingRequest, CancelBookingResponse } from '@appointments/shared';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CancelBookingRequest>;
    const { booking_id, reason, initiated_by = 'CUSTOMER' } = body;

    if (!booking_id) {
      return NextResponse.json<CancelBookingResponse>(
        { success: false, error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('cancel_booking', {
      p_booking_id: booking_id,
      p_reason: reason || 'Standard cancellation',
      p_initiated_by: initiated_by,
    });

    if (rpcError) {
      return NextResponse.json<CancelBookingResponse>(
        { success: false, error: rpcError.message },
        { status: 500 }
      );
    }

    const result = rpcData as {
      success: boolean;
      error?: string;
      booking_id?: string;
      status?: 'CANCELLED';
      payment_status?: 'REFUNDED' | 'FORFEITED';
      refund_eligible?: boolean;
      refund_amount?: number;
      merchant_strikes?: number;
      penalty_applied?: boolean;
      penalty_amount?: number;
      is_booking_frozen?: boolean;
    };

    if (!result?.success) {
      const isNotFound = result?.error === 'Booking not found';
      return NextResponse.json<CancelBookingResponse>(
        { success: false, error: result?.error || 'Failed to cancel booking' },
        { status: isNotFound ? 404 : 400 }
      );
    }

    let finalPaymentStatus: 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' | 'FORFEITED' =
      (result.payment_status as any) || 'FORFEITED';

    // If eligible for refund, trigger refund via Razorpay
    if (result.refund_eligible && (result.refund_amount ?? 0) > 0) {
      const { data: bkg } = await supabaseAdmin
        .from('bookings')
        .select('gateway_payment_id')
        .eq('id', booking_id)
        .maybeSingle();

      if (bkg?.gateway_payment_id) {
        try {
          const refundResult = await initiateRazorpayRefund({
            paymentId: bkg.gateway_payment_id,
            amount: Math.round(Number(result.refund_amount) * 100),
            notes: {
              booking_id,
              reason: reason || 'Policy-eligible cancellation refund',
            },
          });

          // Refund succeeded -> promote to REFUNDED
          finalPaymentStatus = 'REFUNDED';
          await supabaseAdmin
            .from('bookings')
            .update({ payment_status: 'REFUNDED', updated_at: new Date().toISOString() })
            .eq('id', booking_id);

          await supabaseAdmin
            .from('payments')
            .update({
              status: 'REFUNDED',
              updated_at: new Date().toISOString(),
              metadata: {
                refund_id: refundResult.id,
                refund_amount_paise: refundResult.amount,
                refund_amount: Number(result.refund_amount),
              },
            })
            .eq('booking_id', booking_id);

        } catch (refundErr) {
          // Refund failed -> mark REFUND_FAILED and alert operators
          finalPaymentStatus = 'REFUND_FAILED';
          const errorMsg = refundErr instanceof Error ? refundErr.message : String(refundErr);

          await supabaseAdmin
            .from('bookings')
            .update({ payment_status: 'REFUND_FAILED', updated_at: new Date().toISOString() })
            .eq('id', booking_id);

          await supabaseAdmin
            .from('payments')
            .update({
              status: 'REFUND_FAILED',
              updated_at: new Date().toISOString(),
            })
            .eq('booking_id', booking_id);

          // Log prominently to console for monitoring & on-call alerts
          console.error(
            '\n====================================================================\n' +
            '[CRITICAL REFUND FAILURE - MANUAL FOLLOWUP REQUIRED]\n' +
            `Booking ID: ${booking_id}\n` +
            `Payment ID: ${bkg.gateway_payment_id}\n` +
            `Refund Amount: ₹${result.refund_amount}\n` +
            `Error: ${errorMsg}\n` +
            'Action: Manual investigation required in Razorpay Dashboard.\n' +
            '====================================================================\n'
          );

          // Record in admin_audit_logs for incident tracking
          await supabaseAdmin.from('admin_audit_logs').insert({
            admin_id: null,
            action: 'REFUND_MANUAL_INTERVENTION_REQUIRED',
            target_type: 'bookings',
            target_id: booking_id,
            details: {
              error: errorMsg,
              gateway_payment_id: bkg.gateway_payment_id,
              refund_amount: result.refund_amount,
              reason: reason || 'Standard cancellation',
              initiated_by,
              failed_at: new Date().toISOString(),
            },
          });

          // Dispatch critical internal alert into notification_logs
          await supabaseAdmin.from('notification_logs').insert({
            booking_id,
            recipient_phone: '+910000000000',
            recipient_name: 'Operations Team',
            event_type: 'REFUND_FAILED_ALERT',
            channel: 'SYSTEM_AUDIT',
            status: 'FAILED',
            message_content: `Automated refund failed for booking ${booking_id} (Payment: ${bkg.gateway_payment_id}, Amount: ₹${result.refund_amount}). Reason: ${errorMsg}. Requires manual settlement.`,
            provider_response: {
              error: errorMsg,
              gateway_payment_id: bkg.gateway_payment_id,
              refund_amount: result.refund_amount,
              failed_at: new Date().toISOString(),
            },
          });
        }
      }
    }

    return NextResponse.json<CancelBookingResponse>(
      {
        success: true,
        booking_id: result.booking_id || booking_id,
        status: 'CANCELLED',
        payment_status: finalPaymentStatus as any,
        refund_eligible: result.refund_eligible ?? false,
        refund_amount: result.refund_amount !== undefined ? Number(result.refund_amount) : 0,
        refund_gateway_paise: result.refund_amount !== undefined ? Math.round(Number(result.refund_amount) * 100) : 0,
        merchant_strikes: result.merchant_strikes,
        penalty_applied: result.penalty_applied,
        penalty_amount: result.penalty_amount,
        is_booking_frozen: result.is_booking_frozen,
        error: undefined,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json<CancelBookingResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
