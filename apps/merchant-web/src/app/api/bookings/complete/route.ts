import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';
import { validateBookingStatusTransition } from '@/lib/hospital-access';

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
      .select('id, customer_id, provider_id, resource_id, status, payment_status')
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

    const transitionCheck = validateBookingStatusTransition(booking.status, 'COMPLETED');
    if (!transitionCheck.valid) {
      return NextResponse.json(
        { success: false, error: transitionCheck.error },
        { status: 409 }
      );
    }

    if (booking.status === 'COMPLETED') {
      return NextResponse.json({
        success: true,
        booking_id,
        status: 'COMPLETED',
      });
    }

    if (booking.status !== 'CONFIRMED' && booking.status !== 'CHECKED_IN') {
      return NextResponse.json(
        { success: false, error: `Invalid transition: Only CONFIRMED or CHECKED_IN bookings can be completed (current: ${booking.status})` },
        { status: 400 }
      );
    }

    // Try RPC first if CONFIRMED for backward compatibility
    let completed = false;
    if (booking.status === 'CONFIRMED') {
      try {
        const { data: rpcData, error: rpcError } = await (supabaseAdmin.rpc as any)('complete_booking', {
          p_booking_id: booking_id,
        });
        if (!rpcError && (rpcData as any)?.success) {
          completed = true;
        }
      } catch (rpcCatch) {
        console.warn('RPC complete_booking error, will use admin update:', rpcCatch);
      }
    }

    // If not completed via RPC (e.g., status is CHECKED_IN), update directly as service_role
    if (!completed) {
      const now = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin
        .from('bookings')
        .update({
          status: 'COMPLETED',
          updated_at: now,
        })
        .eq('id', booking_id);

      if (updateError) {
        console.error('Failed to complete booking via supabaseAdmin:', updateError);
        return NextResponse.json(
          { success: false, error: updateError.message },
          { status: 500 }
        );
      }
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
