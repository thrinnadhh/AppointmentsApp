import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
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

    // 1. Fetch current booking to identify resource
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, resource_id, status')
      .eq('id', booking_id)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json<RescheduleBookingResponse>(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
      return NextResponse.json<RescheduleBookingResponse>(
        { success: false, error: `Cannot reschedule a ${booking.status.toLowerCase()} booking` },
        { status: 400 }
      );
    }

    // 2. Check if new slot is already occupied
    const { data: conflict } = await supabase
      .from('bookings')
      .select('id')
      .eq('resource_id', booking.resource_id)
      .eq('slot_start', new_slot_start)
      .in('status', ['HELD', 'PENDING_PAYMENT', 'CONFIRMED'])
      .neq('id', booking_id)
      .maybeSingle();

    if (conflict) {
      return NextResponse.json<RescheduleBookingResponse>(
        { success: false, error: 'The requested new slot is already booked or held' },
        { status: 409 }
      );
    }

    // 3. Update slot timestamps
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        slot_start: new_slot_start,
        slot_end: new_slot_end,
        status: 'CONFIRMED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking_id);

    if (updateError) {
      return NextResponse.json<RescheduleBookingResponse>(
        { success: false, error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json<RescheduleBookingResponse>(
      {
        success: true,
        booking_id,
        slot_start: new_slot_start,
        slot_end: new_slot_end,
        status: 'CONFIRMED',
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
