import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';
import { authorizeHospitalResourceOrMerchant } from '@/lib/hospital-access';
import {
  evaluateConsultantQueue,
  ON_TIME_GRACE_MS,
  toClinicDateString,
} from '@appointments/shared/queue-engine';

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
      .select('id, customer_id, provider_id, resource_id, slot_start, slot_end, status, is_present, customer_arrived_at, skipped_at, queue_position, estimated_wait_minutes')
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

    if (caller.id !== booking.customer_id) {
      const resourceAuth = await authorizeHospitalResourceOrMerchant(
        req,
        caller.id,
        booking.provider_id,
        booking.resource_id
      );
      if (!resourceAuth.authorized) {
        return NextResponse.json(
          { success: false, error: 'Forbidden: Caller is not authorized for this doctor' },
          { status: 403 }
        );
      }
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
    // Unified grace window: arrived more than ON_TIME_GRACE_MS (5 minutes) after scheduled slot start or was skipped (R7)
    const isLateArrival = Boolean(booking.skipped_at) || arrivalTime > slotStartTime + ON_TIME_GRACE_MS;

    if (booking.is_present && booking.customer_arrived_at && booking.queue_position && booking.queue_position > 0) {
      return NextResponse.json({
        success: true,
        booking_id,
        is_present: true,
        customer_arrived_at: booking.customer_arrived_at,
        is_late_arrival: isLateArrival,
        queue_position: booking.queue_position,
        estimated_wait_minutes: booking.estimated_wait_minutes || 0,
        already_reached: true,
      });
    }

    // 1. Atomically assign arrival sequence position in Postgres (Phase 3 Item 7)
    const { data: atomicRows } = await (supabaseAdmin.rpc as any)('atomic_assign_checkin_arrival', {
      p_booking_id: booking_id,
      p_arrived_at: arrivedAt,
    });
    const atomicRow = Array.isArray(atomicRows) ? atomicRows[0] : atomicRows;
    const atomicPosition: number =
      typeof atomicRow?.queue_position === 'number'
        ? atomicRow.queue_position
        : booking.queue_position || 1;

    // 2. Evaluate position and wait estimate from the canonical per-consultant queue engine (Phase 3 Item 1 & 7)
    const slotDate = toClinicDateString(booking.slot_start);
    const { data: todayBookings } = await supabaseAdmin
      .from('bookings')
      .select('id, resource_id, slot_start, slot_end, status, is_present, checked_in_at, customer_arrived_at, skipped_at, queue_position')
      .eq('resource_id', booking.resource_id)
      .gte('slot_start', `${slotDate}T00:00:00+05:30`)
      .lte('slot_start', `${slotDate}T23:59:59.999+05:30`)
      .order('slot_start', { ascending: true });

    const normalizedToday = (todayBookings || []).map((b: any) =>
      b.id === booking_id
        ? { ...b, is_present: true, customer_arrived_at: arrivedAt, checked_in_at: arrivedAt }
        : b
    );

    const consultantEval = evaluateConsultantQueue(normalizedToday, {
      now: arrivedAt,
      resourceId: booking.resource_id,
      clinicDateStr: slotDate,
    });

    const queuePosition =
      consultantEval.positionByBookingId.get(booking_id) ?? atomicPosition;
    const waitMinutes =
      consultantEval.waitMinutesByBookingId.get(booking_id) ?? 0;
    let queueNotice: string | null = null;

    if (isLateArrival) {
      queueNotice = `You arrived after your scheduled slot (${new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). You are in the late queue and will be served in the next fitting gap without delaying on-time patients (Estimated wait: ~${waitMinutes} mins, Queue Position: #${queuePosition}).`;

      // Dispatch / record notification to customer
      try {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('phone, full_name')
          .eq('id', booking.customer_id)
          .maybeSingle();

        if (profile?.phone) {
          await (supabaseAdmin.from('notification_logs') as any).upsert(
            {
              booking_id: booking_id,
              recipient_phone: profile.phone,
              recipient_name: profile.full_name || 'Patient',
              event_type: 'LATE_ARRIVAL_QUEUE_UPDATE',
              channel: 'whatsapp',
              status: 'QUEUED',
              message_content: `Namaste ${profile.full_name || 'Patient'}! ${queueNotice}`,
              sent_at: new Date().toISOString(),
            },
            { onConflict: 'booking_id,event_type,channel', ignoreDuplicates: true }
          );
        }
      } catch (notifyErr) {
        console.warn('[ReachRoute] Error writing late queue notification log:', notifyErr);
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('bookings')
      .update({
        ...(booking.status === 'CONFIRMED' ? { status: 'CHECKED_IN' } : {}),
        is_present: true,
        customer_arrived_at: arrivedAt,
        checked_in_at: arrivedAt,
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
