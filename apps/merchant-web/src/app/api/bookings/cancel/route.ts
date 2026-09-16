import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
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
    };

    if (!result?.success) {
      const isNotFound = result?.error === 'Booking not found';
      return NextResponse.json<CancelBookingResponse>(
        { success: false, error: result?.error || 'Failed to cancel booking' },
        { status: isNotFound ? 404 : 400 }
      );
    }

    return NextResponse.json<CancelBookingResponse>(
      {
        success: true,
        booking_id: result.booking_id || booking_id,
        status: 'CANCELLED',
        payment_status: result.payment_status || 'FORFEITED',
        refund_eligible: result.refund_eligible ?? false,
        refund_amount: result.refund_amount !== undefined ? Number(result.refund_amount) : 0,
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
