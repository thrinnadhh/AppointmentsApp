import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';
import { initiateRazorpayRefund } from '@/lib/razorpay';
import { RecordNoShowRequest, RecordNoShowResponse } from '@appointments/shared';

interface RpcNoShowResult {
  success: boolean;
  no_show_count?: number;
  penalty_applied?: boolean;
  payment_status?: 'REFUNDED' | 'FORFEITED';
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

    // If Strike 1 or Strike 2 (Courtesy Grace Period with refund), initiate gateway refund
    if (result.payment_status === 'REFUNDED' && booking?.gateway_payment_id) {
      try {
        await initiateRazorpayRefund({
          paymentId: booking.gateway_payment_id,
          amount: Math.round(Number(result.refund_amount ?? booking.deposit_amount ?? 100) * 100),
          notes: {
            booking_id,
            reason: `Courtesy no-show grace refund (Strike ${result.no_show_count})`,
          },
        });
      } catch (refundErr) {
        console.error('Courtesy no-show refund warning (non-fatal):', refundErr);
      }
    }

    return NextResponse.json<RecordNoShowResponse>(
      {
        success: true,
        booking_id,
        no_show_count: result.no_show_count,
        penalty_applied: result.penalty_applied ?? false,
        payment_status: result.payment_status || 'FORFEITED',
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
