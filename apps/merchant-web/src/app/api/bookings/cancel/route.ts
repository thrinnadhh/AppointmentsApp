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

    // If eligible for refund, trigger refund via Razorpay
    if (result.refund_eligible && (result.refund_amount ?? 0) > 0) {
      const { data: bkg } = await supabaseAdmin
        .from('bookings')
        .select('gateway_payment_id')
        .eq('id', booking_id)
        .maybeSingle();

      if (bkg?.gateway_payment_id) {
        try {
          await initiateRazorpayRefund({
            paymentId: bkg.gateway_payment_id,
            amount: Math.round(Number(result.refund_amount) * 100),
            notes: {
              booking_id,
              reason: reason || 'Policy-eligible cancellation refund',
            },
          });
        } catch (refundErr) {
          console.error('Razorpay refund trigger warning:', refundErr);
        }
      }
    }

    return NextResponse.json<CancelBookingResponse>(
      {
        success: true,
        booking_id: result.booking_id || booking_id,
        status: 'CANCELLED',
        payment_status: result.payment_status || 'FORFEITED',
        refund_eligible: result.refund_eligible ?? false,
        refund_amount: result.refund_amount !== undefined ? Number(result.refund_amount) : 0,
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
