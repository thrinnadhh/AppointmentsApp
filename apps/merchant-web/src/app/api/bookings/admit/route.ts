import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';
import { validateBookingStatusTransition } from '@/lib/hospital-access';

export const dynamic = 'force-dynamic';

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
        { success: false, error: 'Authentication required to admit a patient' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: booking, error: fetchError } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, resource_id, status, is_present, slot_start, slot_end')
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
        { success: false, error: 'Unauthorized: Only authorized merchant staff or administrators can admit this patient' },
        { status: 403 }
      );
    }

    const transitionCheck = validateBookingStatusTransition(booking.status, 'CHECKED_IN');
    if (!transitionCheck.valid) {
      return NextResponse.json(
        { success: false, error: transitionCheck.error },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();

    // If already marked present / checked in, return success idempotently
    if (booking.is_present && booking.status === 'CHECKED_IN') {
      return NextResponse.json({
        success: true,
        booking_id,
        status: 'CHECKED_IN',
        is_present: true,
        already_present: true,
      });
    }

    // Try mark_present_manually RPC first
    let admitted = false;
    try {
      const { data: rpcData, error: rpcError } = await (supabaseAdmin.rpc as any)('mark_present_manually', {
        p_booking_id: booking_id,
      });
      if (!rpcError && (rpcData as any)?.success) {
        admitted = true;
      }
    } catch (rpcCatch) {
      console.warn('mark_present_manually RPC error, falling back to admin update:', rpcCatch);
    }

    // Fallback: direct service_role update
    if (!admitted) {
      const { error: updateError } = await supabaseAdmin
        .from('bookings')
        .update({
          status: 'CHECKED_IN',
          is_present: true,
          checked_in_at: now,
          checked_in_by: caller.id,
          checked_in_method: 'manual',
          customer_arrived_at: now,
          updated_at: now,
        })
        .eq('id', booking_id);

      if (updateError) {
        console.error('Failed to admit patient via supabaseAdmin:', updateError);
        return NextResponse.json(
          { success: false, error: updateError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      booking_id,
      status: 'CHECKED_IN',
      is_present: true,
      admitted_at: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
