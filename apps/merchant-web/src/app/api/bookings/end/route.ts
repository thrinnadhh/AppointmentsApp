import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';
import { validateBookingStatusTransition } from '@/lib/hospital-access';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { booking_id, expected_version, expected_updated_at } = body;

    if (!booking_id) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json(
        { success: false, error: 'Authentication required to end consultation' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: booking, error: fetchError } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, resource_id, status, version, updated_at')
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
        { success: false, error: 'Unauthorized: Caller is not authorized for this booking' },
        { status: 403 }
      );
    }

    // Optimistic concurrency control check
    if (expected_version !== undefined && booking.version !== expected_version) {
      return NextResponse.json(
        { success: false, error: 'Updated by someone else, please refresh', code: 'STALE_VERSION' },
        { status: 409 }
      );
    }
    if (expected_updated_at !== undefined && booking.updated_at && new Date(booking.updated_at).getTime() !== new Date(expected_updated_at).getTime()) {
      return NextResponse.json(
        { success: false, error: 'Updated by someone else, please refresh', code: 'STALE_VERSION' },
        { status: 409 }
      );
    }

    const transitionCheck = validateBookingStatusTransition(booking.status, 'COMPLETED');
    if (!transitionCheck.valid) {
      return NextResponse.json(
        { success: false, error: transitionCheck.error },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    let updateQuery = supabaseAdmin
      .from('bookings')
      .update({
        status: 'COMPLETED',
        updated_at: now,
      })
      .eq('id', booking_id)
      .eq('status', 'IN_CONSULTATION');

    if (expected_version !== undefined) {
      updateQuery = updateQuery.eq('version', expected_version);
    }

    const { data: updatedRows, error: updateError } = await updateQuery.select('id, status, version');

    if (updateError) {
      return NextResponse.json(
        { success: false, error: updateError.message },
        { status: 500 }
      );
    }

    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Updated by someone else, please refresh', code: 'CONCURRENT_UPDATE' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      booking_id,
      status: 'COMPLETED',
      version: updatedRows[0].version,
      completed_at: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
