import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const code = (body.code || '').trim();
    let shopId = body.shopId || body.shop_id || null;

    if (!code) {
      return NextResponse.json(
        { success: false, error: 'INVALID_CODE', message: 'Check-in code is required' },
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

    // Look up the code in appointment_checkin_codes
    let query = supabaseAdmin
      .from('appointment_checkin_codes')
      .select('id, booking_id, provider_id, customer_id, code, appointment_date')
      .eq('code', code);

    if (shopId) {
      query = query.eq('provider_id', shopId);
    }

    const { data: codeRecords, error: codeErr } = await query;

    if (codeErr || !codeRecords || codeRecords.length === 0) {
      return NextResponse.json(
        { success: false, error: 'INVALID_CODE', message: 'Invalid check-in code' },
        { status: 404 }
      );
    }

    const codeRecord = codeRecords[0];
    const targetProviderId = codeRecord.provider_id;

    // Authorization check
    if (!isAdmin) {
      const { data: authProviders } = await (supabaseAdmin.rpc as any)('get_user_authorized_providers', {
        p_user_id: caller.id,
      });
      const allowedList = Array.isArray(authProviders) ? authProviders : [];
      let isAuthorized = allowedList.includes(targetProviderId);

      if (!isAuthorized) {
        // Also check if caller has a valid hospital role for this provider
        const { data: hospRole } = await (supabaseAdmin.rpc as any)('hospital_role', {
          p_provider_id: targetProviderId,
          p_user_id: caller.id,
        });
        if (hospRole && ['admin', 'front_desk', 'consultant'].includes(hospRole)) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        return NextResponse.json(
          { success: false, error: 'UNAUTHORIZED', message: 'You are not authorized for this clinic or hospital' },
          { status: 403 }
        );
      }
    }

    // Fetch the booking
    const { data: booking, error: bErr } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, resource_id, slot_start, slot_end, status, is_present, checked_in_at')
      .eq('id', codeRecord.booking_id)
      .single();

    if (bErr || !booking) {
      return NextResponse.json(
        { success: false, error: 'INVALID_CODE', message: 'Associated appointment not found' },
        { status: 404 }
      );
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

    // Update the booking status to CHECKED_IN
    const { error: updateErr } = await supabaseAdmin
      .from('bookings')
      .update({
        status: 'CHECKED_IN',
        is_present: true,
        checked_in_at: now.toISOString(),
        checked_in_by: caller.id,
        checked_in_method: 'code',
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
