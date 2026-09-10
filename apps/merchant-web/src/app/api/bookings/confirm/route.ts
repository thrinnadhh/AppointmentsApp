import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';
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

    const supabaseAdmin = getSupabaseAdmin();
    const resolvedGatewayId = gateway_payment_id || `sim_${Date.now()}`;

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: resolvedGatewayId,
      p_deposit_amount: deposit_amount ?? undefined,
    });

    if (rpcError) {
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: rpcError.message },
        { status: 500 }
      );
    }

    const result = rpcData as { success: boolean; error?: string };
    if (!result?.success) {
      const isNotFound = result?.error === 'Booking not found';
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: result?.error || 'Failed to confirm booking' },
        { status: isNotFound ? 404 : 400 }
      );
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
