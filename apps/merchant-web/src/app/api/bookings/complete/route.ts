import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { booking_id } = body;

    if (!booking_id) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json(
        { success: false, error: 'Authentication required to complete a booking' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: booking, error: fetchError } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, status, payment_status')
      .eq('id', booking_id)
      .maybeSingle();

    if (fetchError || !booking) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    const isAuthorized = await isCallerAuthorizedForBooking(caller.id, booking, false);
    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Only authorized merchant staff or administrators can complete this booking' },
        { status: 403 }
      );
    }

    // Edge check: cannot complete a cancelled or no-show booking
    if (booking.status === 'CANCELLED') {
      return NextResponse.json(
        { success: false, error: 'Invalid transition: Booking is already cancelled' },
        { status: 409 }
      );
    }

    if (booking.status === 'NO_SHOW') {
      return NextResponse.json(
        { success: false, error: 'Invalid transition: Booking is marked as no-show' },
        { status: 409 }
      );
    }

    // Mark completed via SECURITY DEFINER RPC
    const { data: rpcData, error: rpcError } = await (supabaseAdmin.rpc as any)('complete_booking', {
      p_booking_id: booking_id,
    });

    if (rpcError) {
      return NextResponse.json(
        { success: false, error: rpcError.message },
        { status: 500 }
      );
    }

    const rpcResult = rpcData as { success: boolean; error?: string };
    if (!rpcResult?.success) {
      return NextResponse.json(
        { success: false, error: rpcResult?.error || 'Failed to complete booking' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      booking_id,
      status: 'COMPLETED',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
