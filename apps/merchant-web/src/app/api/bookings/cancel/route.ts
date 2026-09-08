import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { CancelBookingRequest, CancelBookingResponse, isEligibleForFullRefund } from '@appointments/shared';

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

    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, slot_start, deposit_amount, status, payment_status, gateway_payment_id')
      .eq('id', booking_id)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json<CancelBookingResponse>(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    if (booking.status === 'CANCELLED') {
      return NextResponse.json<CancelBookingResponse>(
        { success: false, error: 'Booking is already cancelled' },
        { status: 400 }
      );
    }

    // Determine refund eligibility based on 1-hour policy
    const policyResult = isEligibleForFullRefund(booking.slot_start, initiated_by);
    const newPaymentStatus = policyResult.eligible ? 'REFUNDED' : 'FORFEITED';
    const refundAmount = policyResult.eligible ? Number(booking.deposit_amount) : 0;

    // 1. Update booking
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'CANCELLED',
        payment_status: newPaymentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking_id);

    if (updateError) {
      return NextResponse.json<CancelBookingResponse>(
        { success: false, error: updateError.message },
        { status: 500 }
      );
    }

    // 2. Update payment ledger
    if (booking.gateway_payment_id) {
      await supabase
        .from('payments')
        .update({
          status: newPaymentStatus,
          updated_at: new Date().toISOString(),
          metadata: {
            cancellation_reason: reason || 'Standard cancellation',
            initiated_by,
            policy_rule: policyResult.rule,
          },
        })
        .eq('booking_id', booking_id);
    }

    return NextResponse.json<CancelBookingResponse>(
      {
        success: true,
        booking_id,
        status: 'CANCELLED',
        payment_status: newPaymentStatus,
        refund_eligible: policyResult.eligible,
        refund_amount: refundAmount,
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
