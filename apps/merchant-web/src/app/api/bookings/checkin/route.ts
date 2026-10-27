import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const code = (body.code || '').trim();
    let shopId = body.shopId || body.shop_id || null;
    const isOfflineWalkIn = Boolean(body.is_offline_walk_in || body.offline_walk_in || body.walk_in);
    const bookingId = body.booking_id || body.bookingId || null;

    if (!code && !isOfflineWalkIn) {
      return NextResponse.json(
        { success: false, error: 'INVALID_CODE', message: 'Check-in code is required' },
        { status: 400 }
      );
    }

    if (isOfflineWalkIn && !bookingId && !code) {
      return NextResponse.json(
        { success: false, error: 'MISSING_PARAM', message: 'Booking ID or check-in code is required for offline walk-in' },
        { status: 400 }
      );
    }

    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json(
        { success: false, error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Check if caller is admin or authorized for the shop
    const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id });

    let booking: any = null;
    let targetProviderId: string | null = shopId;

    if (isOfflineWalkIn && bookingId) {
      // 1. Offline Walk-In direct booking lookup (bypasses PIN verification)
      const { data: b, error: bErr } = await supabaseAdmin
        .from('bookings')
        .select('id, customer_id, provider_id, resource_id, slot_start, slot_end, status, is_present, checked_in_at')
        .eq('id', bookingId)
        .maybeSingle();

      if (bErr || !b) {
        return NextResponse.json(
          { success: false, error: 'INVALID_BOOKING', message: 'Associated appointment not found' },
          { status: 404 }
        );
      }
      booking = b;
      targetProviderId = b.provider_id;
    } else if (code) {
      // 2. Online or PIN-based check-in: look up in appointment_checkin_codes first
      let query = supabaseAdmin
        .from('appointment_checkin_codes')
        .select('id, booking_id, provider_id, customer_id, code, appointment_date')
        .eq('code', code);

      if (shopId) {
        query = query.eq('provider_id', shopId);
      }

      const { data: codeRecords, error: codeErr } = await query;

      if (!codeErr && codeRecords && codeRecords.length > 0) {
        const codeRecord = codeRecords[0];
        targetProviderId = codeRecord.provider_id;

        const { data: b, error: bErr } = await supabaseAdmin
          .from('bookings')
          .select('id, customer_id, provider_id, resource_id, slot_start, slot_end, status, is_present, checked_in_at')
          .eq('id', codeRecord.booking_id)
          .maybeSingle();

        if (b && !bErr) {
          booking = b;
        }
      }

      // 3. Fallback: Check customer permanent lifetime PIN in public.profiles
      if (!booking) {
        const { data: profileWithPin } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('permanent_checkin_pin', code)
          .maybeSingle();

        if (profileWithPin) {
          let bQuery = supabaseAdmin
            .from('bookings')
            .select('id, customer_id, provider_id, resource_id, slot_start, slot_end, status, is_present, checked_in_at')
            .eq('customer_id', profileWithPin.id)
            .in('status', ['CONFIRMED', 'CHECKED_IN']);

          if (shopId) {
            bQuery = bQuery.eq('provider_id', shopId);
          }

          const { data: pinBookings } = await bQuery;
          if (pinBookings && pinBookings.length > 0) {
            // Pick CONFIRMED over CHECKED_IN, closest to current time
            pinBookings.sort((a: any, b: any) => {
              if (a.status === 'CONFIRMED' && b.status !== 'CONFIRMED') return -1;
              if (b.status === 'CONFIRMED' && a.status !== 'CONFIRMED') return 1;
              return Math.abs(new Date(a.slot_start).getTime() - Date.now()) - Math.abs(new Date(b.slot_start).getTime() - Date.now());
            });
            booking = pinBookings[0];
            targetProviderId = booking.provider_id;
          }
        }
      }

      if (!booking) {
        return NextResponse.json(
          { success: false, error: 'INVALID_CODE', message: 'Invalid check-in code' },
          { status: 404 }
        );
      }
    }

    // Front Desk assignment scoping: staff can only check in patients for their assigned doctors
    const { data: callerRole } = await (supabaseAdmin.rpc as any)('hospital_role', {
      p_provider_id: targetProviderId,
      p_user_id: caller.id,
    });
    if (callerRole === 'front_desk' && booking.resource_id) {
      const { data: accessibleResources } = await (supabaseAdmin.rpc as any)('hospital_accessible_resource_ids', {
        p_provider_id: targetProviderId,
        p_user_id: caller.id,
      });
      const accessibleList = Array.isArray(accessibleResources) ? accessibleResources : [];
      if (!accessibleList.includes(booking.resource_id)) {
        return NextResponse.json(
          { success: false, error: 'UNAUTHORIZED', message: 'You are not assigned to this doctor' },
          { status: 403 }
        );
      }
    }

    // Fetch patient name & doctor name
    const [{ data: patientProfile }, { data: doctorResource }] = await Promise.all([
      supabaseAdmin.from('profiles').select('full_name').eq('id', booking.customer_id).maybeSingle(),
      supabaseAdmin.from('resources').select('name').eq('id', booking.resource_id).maybeSingle(),
    ]);

    const patientName = patientProfile?.full_name || 'Patient';
    const doctorName = doctorResource?.name || 'Doctor';
    const slotTimeStr = new Date(booking.slot_start).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });

    const now = new Date();
    const isLate = now.getTime() > (new Date(booking.slot_start).getTime() + 10 * 60 * 1000);

    // If already checked in
    if (booking.status === 'CHECKED_IN' || booking.is_present) {
      return NextResponse.json({
        success: false,
        error: 'ALREADY_CHECKED_IN',
        message: 'This appointment has already been checked in',
        booking_id: booking.id,
        patient_name: patientName,
        service_doctor: doctorName,
        slot_time: slotTimeStr,
        is_late: isLate,
        checked_in_at: booking.checked_in_at || now.toISOString(),
      });
    }

    if (booking.status !== 'CONFIRMED') {
      return NextResponse.json(
        { success: false, error: 'INVALID_STATUS', message: `Cannot check in. Appointment status is ${booking.status}` },
        { status: 400 }
      );
    }

    const checkedInMethod = isOfflineWalkIn ? 'manual' : 'code';

    // Update the booking status to CHECKED_IN
    const { error: updateErr } = await supabaseAdmin
      .from('bookings')
      .update({
        status: 'CHECKED_IN',
        is_present: true,
        checked_in_at: now.toISOString(),
        checked_in_by: caller.id,
        checked_in_method: checkedInMethod,
        customer_arrived_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', booking.id);

    if (updateErr) {
      console.error('Failed to update booking to CHECKED_IN:', updateErr);
      return NextResponse.json(
        { success: false, error: 'UPDATE_FAILED', message: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      booking_id: booking.id,
      patient_name: patientName,
      service_doctor: doctorName,
      slot_time: slotTimeStr,
      is_late: isLate,
      is_offline_walk_in: isOfflineWalkIn,
      checked_in_method: checkedInMethod,
      checked_in_at: now.toISOString(),
    });
  } catch (err) {
    console.error('Exception in checkin route:', err);
    return NextResponse.json(
      { success: false, error: 'SERVER_ERROR', message: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
