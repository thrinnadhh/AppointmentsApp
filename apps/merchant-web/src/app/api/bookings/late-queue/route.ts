import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { booking_id, action, buffer_offset = 2 } = body;

    if (!booking_id || !action) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: booking_id, action' },
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

    const isAuthorized = await isCallerAuthorizedForBooking(caller.id, booking, false);
    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Caller is not authorized for this merchant venue' },
        { status: 403 }
      );
    }

    if (booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') {
      return NextResponse.json(
        { success: false, error: `Cannot update queue for ${booking.status} appointment` },
        { status: 409 }
      );
    }

    if (action === 'MOVE_TO_STANDBY') {
      // Patient has not arrived by slot time: Put into standby waiting queue
      const { error: updateError } = await supabaseAdmin
        .from('bookings')
        .update({
          is_present: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking_id);

      if (updateError) {
        return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        booking_id,
        action: 'MOVE_TO_STANDBY',
        message: 'Patient moved to Standby Queue awaiting physical arrival',
      });
    }

    if (action === 'CHECKIN_LATE') {
      // Patient physically arrived late: Insert after specified member appointments (default 2)
      const slotDate = booking.slot_start.slice(0, 10);
      const { data: todayBookings } = await supabaseAdmin
        .from('bookings')
        .select('id, queue_position, status, is_present')
        .eq('resource_id', booking.resource_id)
        .gte('slot_start', `${slotDate}T00:00:00`)
        .lte('slot_start', `${slotDate}T23:59:59`)
        .in('status', ['CONFIRMED', 'COMPLETED'])
        .order('queue_position', { ascending: true, nullsFirst: false });

      const activePositions = (todayBookings || [])
        .map((b) => b.queue_position)
        .filter((p): p is number => typeof p === 'number');

      const maxPosition = activePositions.length > 0 ? Math.max(...activePositions) : 1;
      const offset = Number(buffer_offset) || 2;
      const newQueuePosition = maxPosition + offset;
      const waitMinutes = offset * 15;
      const arrivedAt = new Date().toISOString();

      const queueNotice = `You arrived after your scheduled slot (${new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). You have been accommodated and will be sent after ${offset} member appointments (Estimated wait: ~${waitMinutes} mins). Queue Token: #${newQueuePosition}.`;

      // Update booking
      const { error: updateError } = await supabaseAdmin
        .from('bookings')
        .update({
          is_present: true,
          customer_arrived_at: arrivedAt,
          queue_position: newQueuePosition,
          estimated_wait_minutes: waitMinutes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking_id);

      if (updateError) {
        return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
      }

      // Log notification
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
        console.warn('[LateQueueRoute] Error writing notification log:', notifyErr);
      }

      return NextResponse.json({
        success: true,
        booking_id,
        action: 'CHECKIN_LATE',
        is_present: true,
        customer_arrived_at: arrivedAt,
        queue_position: newQueuePosition,
        estimated_wait_minutes: waitMinutes,
        buffer_offset: offset,
        queue_notice: queueNotice,
      });
    }

    return NextResponse.json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
