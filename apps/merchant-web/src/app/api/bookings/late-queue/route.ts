import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  verifyAuthenticatedUser,
  isCallerAuthorizedForBooking,
  isCallerAuthorizedForProvider,
} from '@/lib/auth-admin';
import { authorizeHospitalResourceOrMerchant } from '@/lib/hospital-access';
import {
  evaluateConsultantQueue,
  toClinicDateString,
} from '@appointments/shared/queue-engine';

export async function POST(req: NextRequest) {
  try {
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { booking_id, action, buffer_offset = 2, provider_id, threshold_minutes = 45 } = body;

    if (!action) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: action' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (action === 'EXPIRE_STALE_STANDBY') {
      const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id });
      if (!isAdmin) {
        if (!provider_id) {
          return NextResponse.json(
            { success: false, error: 'Forbidden: provider_id is required for non-admin standby sweep' },
            { status: 403 }
          );
        }
        const authorized = await isCallerAuthorizedForProvider(caller.id, provider_id);
        let isHospitalStaff = false;
        if (!authorized) {
          const { data: hRole } = await (supabaseAdmin.rpc as any)('hospital_role', {
            p_provider_id: provider_id,
            p_user_id: caller.id,
          });
          isHospitalStaff =
            hRole === 'admin' || hRole === 'owner' || hRole === 'front_desk' || hRole === 'consultant';
        }
        if (!authorized && !isHospitalStaff) {
          return NextResponse.json(
            { success: false, error: 'Forbidden: Caller is not authorized for this venue' },
            { status: 403 }
          );
        }
      }

      const { data: sweepData, error: sweepErr } = await (supabaseAdmin.rpc as any)('expire_stale_standby_queue', {
        p_threshold_minutes: Number(threshold_minutes) || 45,
        p_provider_id: provider_id || null,
      });

      if (sweepErr) {
        return NextResponse.json({ success: false, error: sweepErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        ...(typeof sweepData === 'object' && sweepData !== null ? sweepData : { expired_count: 0 }),
      });
    }

    if (!booking_id) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: booking_id, action' },
        { status: 400 }
      );
    }
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

    if (booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') {
      return NextResponse.json(
        { success: false, error: `Cannot update queue for ${booking.status} appointment` },
        { status: 409 }
      );
    }

    if (action === 'MOVE_TO_STANDBY') {
      const nowIso = new Date().toISOString();
      // Patient has not arrived by slot time: Put into standby waiting queue and persist skipped_at (R7)
      const { error: updateError } = await supabaseAdmin
        .from('bookings')
        .update({
          is_present: false,
          skipped_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', booking_id);

      if (updateError) {
        return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        booking_id,
        action: 'MOVE_TO_STANDBY',
        skipped_at: nowIso,
        message: 'Patient moved to Standby Queue awaiting physical arrival',
      });
    }

    if (action === 'CHECKIN_LATE') {
      const offset = Math.max(1, Math.min(20, Number.isFinite(Number(buffer_offset)) ? Math.floor(Number(buffer_offset)) : 1));

      // Idempotency guard: if already checked in late with an assigned queue_position, return existing state
      if (booking.is_present && booking.queue_position && booking.queue_position > 0) {
        return NextResponse.json({
          success: true,
          booking_id,
          action: 'CHECKIN_LATE',
          already_checked_in: true,
          is_present: true,
          customer_arrived_at: booking.customer_arrived_at,
          queue_position: booking.queue_position,
          estimated_wait_minutes: booking.estimated_wait_minutes || 0,
          buffer_offset: offset,
        });
      }

      const arrivedAt = booking.customer_arrived_at || new Date().toISOString();

      // 1. Atomically assign arrival sequence position in Postgres
      const { data: atomicRows } = await (supabaseAdmin.rpc as any)(
        'atomic_assign_checkin_arrival',
        {
          p_booking_id: booking_id,
          p_arrived_at: arrivedAt,
        }
      );
      const atomicRow = Array.isArray(atomicRows) ? atomicRows[0] : atomicRows;
      const atomicPosition: number =
        typeof atomicRow?.queue_position === 'number'
          ? atomicRow.queue_position
          : booking.queue_position || 1;

      // 2. Evaluate position and wait estimate from the canonical per-consultant queue engine
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
          ? {
              ...b,
              is_present: true,
              customer_arrived_at: arrivedAt,
              checked_in_at: arrivedAt,
              skipped_at: b.skipped_at || arrivedAt,
            }
          : b
      );

      const consultantEval = evaluateConsultantQueue(normalizedToday, {
        now: arrivedAt,
        resourceId: booking.resource_id,
        clinicDateStr: slotDate,
      });

      const newQueuePosition =
        consultantEval.positionByBookingId.get(booking_id) ?? atomicPosition;
      const waitMinutes =
        consultantEval.waitMinutesByBookingId.get(booking_id) ?? 0;

      const queueNotice = `You arrived after your scheduled slot (${new Date(booking.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). You are checked in to the late queue and will be served in the next fitting gap without delaying scheduled on-time patients (Estimated wait: ~${waitMinutes} mins, Queue Position: #${newQueuePosition}).`;

      // Update booking
      const { error: updateError } = await supabaseAdmin
        .from('bookings')
        .update({
          ...(booking.status === 'CONFIRMED' ? { status: 'CHECKED_IN' } : {}),
          is_present: true,
          customer_arrived_at: arrivedAt,
          checked_in_at: arrivedAt,
          skipped_at: (booking as any).skipped_at || arrivedAt,
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
        queue_notice: queueNotice,
      });
    }

    return NextResponse.json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
