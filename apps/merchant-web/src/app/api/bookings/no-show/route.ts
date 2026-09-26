import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';
import { initiateRazorpayRefund } from '@/lib/razorpay';
import { RecordNoShowRequest, RecordNoShowResponse } from '@appointments/shared';

interface RpcNoShowResult {
  success: boolean;
  no_show_count?: number;
  penalty_applied?: boolean;
  payment_status?: 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' | 'FORFEITED';
  refund_amount?: number;
  flagged?: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<RecordNoShowRequest>;
    const { booking_id } = body;

    if (!booking_id) {
      return NextResponse.json<RecordNoShowResponse>(
        { success: false, error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Guard: check booking status and start time
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, status, slot_start, gateway_payment_id, deposit_amount')
      .eq('id', booking_id)
      .single();

    if (booking?.status === 'COMPLETED') {
      return NextResponse.json<RecordNoShowResponse>(
        { success: false, error: 'Cannot report no-show on an already completed booking' },
        { status: 409 }
      );
    }

    if (booking?.slot_start) {
      const slotTime = new Date(booking.slot_start).getTime();
      // If appointment is more than 30 minutes in the future, it cannot be a no-show yet
      if (slotTime > Date.now() + 30 * 60 * 1000) {
        return NextResponse.json<RecordNoShowResponse>(
          { success: false, error: 'Premature no-show: Cannot report no-show for a future appointment that has not started' },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabaseAdmin.rpc('record_no_show', {
      p_booking_id: booking_id,
    });

    if (error) {
      return NextResponse.json<RecordNoShowResponse>(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    const result = data as unknown as RpcNoShowResult;

    if (!result?.success) {
      return NextResponse.json<RecordNoShowResponse>(
        { success: false, error: result?.error || 'Failed to record no-show' },
        { status: 400 }
      );
    }

    let finalPaymentStatus: 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' | 'FORFEITED' =
      result.payment_status || 'FORFEITED';

    // If Strike 1 or Strike 2 (Courtesy Grace Period with refund), initiate gateway refund
    if (result.payment_status === 'REFUND_PENDING' && booking?.gateway_payment_id) {
      const refundAmt = Math.round(Number(result.refund_amount ?? booking.deposit_amount ?? 100) * 100);
      try {
        await initiateRazorpayRefund({
          paymentId: booking.gateway_payment_id,
          amount: refundAmt,
          notes: {
            booking_id,
            reason: `Courtesy no-show grace refund (Strike ${result.no_show_count})`,
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
          .update({ status: 'REFUNDED', updated_at: new Date().toISOString() })
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
          .update({ status: 'REFUND_FAILED', updated_at: new Date().toISOString() })
          .eq('booking_id', booking_id);

        // Log prominently to console for monitoring & on-call alerts
        console.error(
          '\n====================================================================\n' +
          '[CRITICAL REFUND FAILURE - MANUAL FOLLOWUP REQUIRED]\n' +
          `Booking ID: ${booking_id}\n` +
          `Payment ID: ${booking.gateway_payment_id}\n` +
          `Refund Amount: ₹${result.refund_amount ?? booking.deposit_amount ?? 100}\n` +
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
            gateway_payment_id: booking.gateway_payment_id,
            refund_amount: result.refund_amount ?? booking.deposit_amount ?? 100,
            reason: `Courtesy no-show grace refund (Strike ${result.no_show_count})`,
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
          message_content: `Automated no-show refund failed for booking ${booking_id} (Payment: ${booking.gateway_payment_id}, Amount: ₹${result.refund_amount ?? booking.deposit_amount ?? 100}). Reason: ${errorMsg}. Requires manual settlement.`,
          provider_response: {
            error: errorMsg,
            gateway_payment_id: booking.gateway_payment_id,
            refund_amount: result.refund_amount ?? booking.deposit_amount ?? 100,
            failed_at: new Date().toISOString(),
          },
        });
      }
    }

    return NextResponse.json<RecordNoShowResponse>(
      {
        success: true,
        booking_id,
        no_show_count: result.no_show_count,
        penalty_applied: result.penalty_applied ?? false,
        payment_status: finalPaymentStatus,
        refund_amount: result.refund_amount !== undefined ? Number(result.refund_amount) : 0,
        is_flagged: result.flagged,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json<RecordNoShowResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
