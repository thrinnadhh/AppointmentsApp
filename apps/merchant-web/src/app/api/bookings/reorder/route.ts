import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { booking_id, new_position, doctor_id, provider_id, booking_ids } = body;

    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json(
        { success: false, error: 'Authentication required to reorder queue' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Case 1: Reorder a single booking to a new position
    if (booking_id && new_position !== undefined) {
      const { data: booking, error: fetchErr } = await supabaseAdmin
        .from('bookings')
        .select('id, customer_id, provider_id, resource_id, status, queue_position')
        .eq('id', booking_id)
        .maybeSingle();

      if (fetchErr || !booking) {
        return NextResponse.json(
          { success: false, error: 'Booking not found' },
          { status: 404 }
        );
      }

      const isAuthorized = await isCallerAuthorizedForBooking(caller.id, booking, false);
      if (!isAuthorized) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized: Caller is not authorized for this doctor queue' },
          { status: 403 }
        );
      }

      const pos = Math.max(1, parseInt(new_position, 10));

      const { error: updateErr } = await supabaseAdmin
        .from('bookings')
        .update({ queue_position: pos, updated_at: new Date().toISOString() })
        .eq('id', booking_id);

      if (updateErr) {
        return NextResponse.json(
          { success: false, error: updateErr.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        booking_id,
        queue_position: pos,
      });
    }

    // Case 2: Batch reorder given an ordered array of booking_ids
    if (Array.isArray(booking_ids) && booking_ids.length > 0) {
      const { data: firstBooking } = await supabaseAdmin
        .from('bookings')
        .select('id, customer_id, provider_id, resource_id')
        .eq('id', booking_ids[0])
        .maybeSingle();

      if (!firstBooking) {
        return NextResponse.json(
          { success: false, error: 'Booking not found' },
          { status: 404 }
        );
      }

      const isAuthorized = await isCallerAuthorizedForBooking(caller.id, firstBooking, false);
      if (!isAuthorized) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized: Caller is not authorized for this doctor queue' },
          { status: 403 }
        );
      }

      for (let i = 0; i < booking_ids.length; i++) {
        await supabaseAdmin
          .from('bookings')
          .update({ queue_position: i + 1, updated_at: new Date().toISOString() })
          .eq('id', booking_ids[i]);
      }

      return NextResponse.json({
        success: true,
        count: booking_ids.length,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Missing required parameters for queue reordering' },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
