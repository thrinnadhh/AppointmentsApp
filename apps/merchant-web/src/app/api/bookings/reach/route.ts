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
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: booking, error: fetchError } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, resource_id, slot_start, slot_end, status, is_present, customer_arrived_at, queue_position, estimated_wait_minutes')
      .eq('id', booking_id)
      .maybeSingle();

    if (fetchError || !booking) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    const isAuthorized = await isCallerAuthorizedForBooking(caller.id, booking, true);
    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Caller is not authorized for this booking' },
        { status: 403 }
      );
    }

    if (booking.status === 'CANCELLED') {
      return NextResponse.json(
        { success: false, error: 'Cannot mark arrived: Booking is cancelled' },
        { status: 409 }
      );
    }

    if (booking.status === 'NO_SHOW') {
      return NextResponse.json(
        { success: false, error: 'Cannot mark arrived: Booking was marked as no-show' },
        { status: 409 }
      );
    }

    const arrivedAt = booking.customer_arrived_at || new Date().toISOString();
    const slotStartTime = new Date(booking.slot_start).getTime();
    const arrivalTime = new Date(arrivedAt).getTime();
    // Grace window: arrived more than 5 minutes after scheduled slot start
    const isLateArrival = arrivalTime > (slotStartTime + 5 * 60 * 1000);

    let queuePosition = booking.queue_position;
    let waitMinutes = booking.estimated_wait_minutes || 0;
    let queueNotice: string | null = null;

    if (isLateArrival) {
      // Find ongoing/active appointments for this resource today
      const slotDate = booking.slot_start.slice(0, 10);
      const { data: todayBookings } = await supabaseAdmin
        .from('bookings')
        .select('id, queue_position, status, is_present')
        .eq('resource_id', booking.resource_id)
        .gte('slot_start', `${slotDate}T00:00:00`)
        .lte('slot_start', `${slotDate}T23:59:59`)
        .in('status', ['CONFIRMED', 'COMPLETED'])
        .order('queue_position', { ascending: true, nullsFirst: false });

      // Determine the ongoing token (the highest completed or present booking token)
      const activePositions = (todayBookings || [])
        .map((b) => b.queue_position)
        .filter((p): p is number => typeof p === 'number');

      const maxPosition = activePositions.length > 0 ? Math.max(...activePositions) : 1;
      
      // Dynamic +2 Buffer Rule: Accommodate after 2 member appointments
      queuePosition = maxPosition + 2;
      waitMinutes = 2 * 15; // 2 appointments * ~15 mins avg duration
      queueNotice = `You arrived after your scheduled slot (${new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). You will be accommodated after 2 member appointments (Estimated wait: ~${waitMinutes} mins). Queue Token: #${queuePosition}.`;

      // Dispatch / record notification to customer
      try {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('phone, full_name')
          .eq('id', booking.customer_id)
          .maybeSingle();

        if (profile?.phone) {
          await supabaseAdmin.from('notification_logs').insert({
            booking_id: booking_id,
            recipient_phone: profile.phone,
            recipient_name: profile.full_name || 'Patient',
            event_type: 'LATE_ARRIVAL_QUEUE_UPDATE',
            channel: 'WHATSAPP',
            status: 'DELIVERED',
            message_content: `Namaste ${profile.full_name || 'Patient'}! ${queueNotice}`,
            sent_at: new Date().toISOString(),
          });
        }
      } catch (notifyErr) {
        console.warn('[ReachRoute] Error writing late queue notification log:', notifyErr);
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('bookings')
      .update({
        is_present: true,
        customer_arrived_at: arrivedAt,
        queue_position: queuePosition,
        estimated_wait_minutes: waitMinutes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking_id);

    if (updateError) {
      return NextResponse.json(
        { success: false, error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      booking_id,
      is_present: true,
      customer_arrived_at: arrivedAt,
      is_late_arrival: isLateArrival,
      queue_position: queuePosition,
      estimated_wait_minutes: waitMinutes,
      queue_notice: queueNotice,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
