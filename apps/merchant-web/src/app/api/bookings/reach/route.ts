import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';
import { calculateArrivalTag, computePatientETA } from '@appointments/shared/queue-engine';

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
    const arrivalTag = calculateArrivalTag(booking.slot_start, arrivedAt);
    const isLateArrival = arrivalTag === 'Late';

    // Fetch today's bookings for this resource to calculate queue ETAs using shared queue engine
    const slotDate = booking.slot_start.slice(0, 10);
    const { data: todayBookings } = await supabaseAdmin
      .from('bookings')
      .select('id, slot_start, slot_end, status, is_present, customer_arrived_at, queue_position, estimated_wait_minutes')
      .eq('resource_id', booking.resource_id)
      .gte('slot_start', `${slotDate}T00:00:00`)
      .lte('slot_start', `${slotDate}T23:59:59`)
      .in('status', ['CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED'])
      .order('slot_start', { ascending: true });

    const activeBookingsList = (todayBookings || []).map((b) => ({
      id: b.id,
      slotStart: b.slot_start,
      slotEnd: b.slot_end,
      status: b.id === booking_id ? 'CHECKED_IN' : b.status,
      isCheckedIn: b.id === booking_id ? true : Boolean(b.is_present || b.status === 'CHECKED_IN'),
      isCompleted: b.status === 'COMPLETED',
      arrivedAt: b.id === booking_id ? arrivedAt : b.customer_arrived_at,
      originalBookingTime: b.slot_start,
      arrivalTag: b.id === booking_id ? arrivalTag : calculateArrivalTag(b.slot_start, b.customer_arrived_at),
    }));

    const activeConsultation = activeBookingsList.find((b) => b.status === 'IN_CONSULTATION') || null;

    const patientEta = computePatientETA({
      bookingId: booking_id,
      currentTime: arrivedAt,
      bookings: activeBookingsList,
      currentConsultation: activeConsultation,
    });

    const queuePosition = patientEta?.queuePosition || booking.queue_position || 1;
    const waitMinutes = patientEta?.estimatedWaitMinutes ?? 0;
    let queueNotice: string | null = null;

    if (isLateArrival) {
      queueNotice = `You arrived after your scheduled slot (${new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). You have been placed in the Standby Queue in booking order (Estimated wait: ~${waitMinutes} mins). Queue Token: #${queuePosition}.`;
    }

    // Notification rule (SPEC line 21): Notify customer ONLY when the ETA leaves their +/- 10 min window
    const shouldNotify = patientEta ? patientEta.hasLeftWindow : isLateArrival;

    if (shouldNotify) {
      try {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('phone, full_name')
          .eq('id', booking.customer_id)
          .maybeSingle();

        if (profile?.phone) {
          const msg = queueNotice || `Namaste ${profile.full_name || 'Patient'}! Your appointment queue update: Token #${queuePosition}, estimated wait: ~${waitMinutes} mins.`;
          await supabaseAdmin.from('notification_logs').insert({
            booking_id: booking_id,
            recipient_phone: profile.phone,
            recipient_name: profile.full_name || 'Patient',
            event_type: 'ETA_UPDATE',
            channel: 'WHATSAPP',
            status: 'DELIVERED',
            message_content: msg,
            sent_at: new Date().toISOString(),
          });
        }
      } catch (notifyErr) {
        console.warn('[ReachRoute] Error writing notification log:', notifyErr);
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
