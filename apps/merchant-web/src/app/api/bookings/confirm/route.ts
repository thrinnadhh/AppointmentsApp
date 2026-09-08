import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { ConfirmPaymentRequest, ConfirmPaymentResponse } from '@appointments/shared';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ConfirmPaymentRequest>;
    const { booking_id, gateway_payment_id, deposit_amount } = body;

    if (!booking_id) {
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, deposit_amount')
      .eq('id', booking_id)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    const resolvedAmount = deposit_amount ?? booking.deposit_amount ?? 100;
    const resolvedGatewayId = gateway_payment_id || `sim_${Date.now()}`;

    // 1. Update booking
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        gateway_payment_id: resolvedGatewayId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking_id);

    if (updateError) {
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: updateError.message },
        { status: 500 }
      );
    }

    // 2. Record payment in ledger
    const { error: paymentError } = await supabase.from('payments').insert({
      booking_id,
      gateway_payment_id: resolvedGatewayId,
      amount: resolvedAmount,
      currency: 'INR',
      status: 'CAPTURED',
    });

    if (paymentError) {
      console.warn('Payment insert notice:', paymentError.message);
    }

    return NextResponse.json<ConfirmPaymentResponse>(
      {
        success: true,
        booking_id,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json<ConfirmPaymentResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
