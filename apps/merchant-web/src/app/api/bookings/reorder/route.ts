import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';

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

    // Case 1: Reorder a single booking to a new position using transactional override RPC
    if (booking_id && new_position !== undefined) {
      const pos = Math.max(1, parseInt(new_position, 10));

      const { data: rpcRes, error: rpcErr } = await (supabaseAdmin.rpc as any)('override_hospital_queue_position', {
        p_booking_id: booking_id,
        p_override_position: pos,
        p_caller_id: caller.id,
      });

      if (rpcErr || (rpcRes && !rpcRes.success)) {
        const errorMsg = rpcErr?.message || rpcRes?.error || 'Failed to reorder queue position';
        const isAuth = errorMsg.includes('Unauthorized') || errorMsg.includes('Forbidden');
        const isNotFound = errorMsg.includes('not found');
        return NextResponse.json(
          { success: false, error: errorMsg },
          { status: isNotFound ? 404 : isAuth ? 403 : 500 }
        );
      }

      return NextResponse.json({
        success: true,
        booking_id,
        queue_position: pos,
      });
    }

    // Case 2: Batch reorder given an ordered array of booking_ids using transactional reorder RPC
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

      const { data: rpcRes, error: rpcErr } = await (supabaseAdmin.rpc as any)('reorder_hospital_queue', {
        p_provider_id: firstBooking.provider_id,
        p_doctor_id: firstBooking.resource_id,
        p_booking_ids: booking_ids,
        p_caller_id: caller.id,
      });

      if (rpcErr || (rpcRes && !rpcRes.success)) {
        const errorMsg = rpcErr?.message || rpcRes?.error || 'Failed to reorder queue';
        const isAuth = errorMsg.includes('Unauthorized') || errorMsg.includes('Forbidden');
        return NextResponse.json(
          { success: false, error: errorMsg },
          { status: isAuth ? 403 : 500 }
        );
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
