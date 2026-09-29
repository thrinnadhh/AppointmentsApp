import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';
import { RescheduleBookingRequest, RescheduleBookingResponse } from '@appointments/shared';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<RescheduleBookingRequest>;
    const { booking_id, new_slot_start, new_slot_end } = body;

    if (!booking_id || !new_slot_start || !new_slot_end) {
      return NextResponse.json<RescheduleBookingResponse>(
        { success: false, error: 'Missing required parameters: booking_id, new_slot_start, new_slot_end' },
        { status: 400 }
      );
    }

    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json<RescheduleBookingResponse>(
        { success: false, error: 'Authentication required to reschedule a booking' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: booking, error: bkgErr } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, status')
      .eq('id', booking_id)
      .maybeSingle();

    if (bkgErr || !booking) {
      return NextResponse.json<RescheduleBookingResponse>(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    const isAuthorized = await isCallerAuthorizedForBooking(caller.id, booking, true);
    if (!isAuthorized) {
      return NextResponse.json<RescheduleBookingResponse>(
        { success: false, error: 'Unauthorized: Caller is not authorized to reschedule this booking' },
        { status: 403 }
      );
    }

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('reschedule_booking_slot', {
      p_booking_id: booking_id,
      p_new_slot_start: new_slot_start,
      p_new_slot_end: new_slot_end,
    });

    if (rpcError) {
      return NextResponse.json<RescheduleBookingResponse>(
        { success: false, error: rpcError.message },
        { status: 500 }
      );
    }

    const result = rpcData as {
      success: boolean;
      error?: string;
      booking_id?: string;
      slot_start?: string;
      slot_end?: string;
      status?: 'CONFIRMED';
    };

    if (!result?.success) {
      const isNotFound = result?.error === 'Booking not found';
      const isConflict = result?.error === 'The requested new slot is already booked or held';
      const status = isNotFound ? 404 : isConflict ? 409 : 400;
      return NextResponse.json<RescheduleBookingResponse>(
        { success: false, error: result?.error || 'Failed to reschedule booking' },
        { status }
      );
    }

    return NextResponse.json<RescheduleBookingResponse>(
      {
        success: true,
        booking_id: result.booking_id || booking_id,
        slot_start: result.slot_start || new_slot_start,
        slot_end: result.slot_end || new_slot_end,
        status: result.status || 'CONFIRMED',
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json<RescheduleBookingResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
