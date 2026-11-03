import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';
import { checkRateLimit } from '@/lib/redis';
import { getAccessContext, canAccessDoctor, authorizeHospitalResourceOrMerchant } from '@/lib/hospital-access';
import { toClinicDateString } from '@/lib/queue-scheduler';
import { ON_TIME_GRACE_MS } from '@appointments/shared/queue-engine';

export const dynamic = 'force-dynamic';

const getIstDateString = toClinicDateString;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const code = (body.code || '').trim();
    let shopId = body.shopId || body.shop_id || body.provider_id || null;

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

    const provider_id = shopId || 'global';
    const rl = await checkRateLimit(`checkin:${caller.id}:${provider_id}`, 10, 300);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'RATE_LIMITED', message: 'Too many check-in attempts. Please wait before trying again.' },
        { status: 429 }
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

    let { data: codeRecords, error: codeErr } = await query;

    // Fallback: If not found for the given shopId, check if it belongs to any shop the user is authorized for
    if ((!codeRecords || codeRecords.length === 0) && shopId) {
      const { data: fallbackRecords } = await supabaseAdmin
        .from('appointment_checkin_codes')
        .select('id, booking_id, provider_id, customer_id, code, appointment_date')
        .eq('code', code)
        .order('created_at', { ascending: false })
        .limit(1);

      if (fallbackRecords && fallbackRecords.length > 0) {
        codeRecords = fallbackRecords;
        shopId = fallbackRecords[0].provider_id;
      }
    }

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
      if (!allowedList.includes(targetProviderId)) {
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

    // Enforce per-consultant access for hospital front-desk/consultant staff
    if (!isAdmin) {
      const accessCtx = await getAccessContext(req, targetProviderId);
      const resourceAuth = await authorizeHospitalResourceOrMerchant(
        req,
        caller.id,
        targetProviderId,
        booking.resource_id
      );
      if (!canAccessDoctor(accessCtx, booking.resource_id) && !resourceAuth.authorized) {
        return NextResponse.json(
          { success: false, error: 'FORBIDDEN', message: 'You are not authorized to check in patients for this doctor' },
          { status: 403 }
        );
      }
      if (!resourceAuth.authorized) {
        return NextResponse.json(
          { success: false, error: 'FORBIDDEN', message: 'You are not authorized to check in patients for this doctor' },
          { status: 403 }
        );
      }
    }

    const now = new Date();
    if (getIstDateString(new Date(booking.slot_start)) !== getIstDateString(now)) {
      return NextResponse.json(
        { success: false, error: 'INVALID_DATE', message: 'Check-in is only allowed on the scheduled appointment date (IST)' },
        { status: 409 }
      );
    }

    const isLate = now.getTime() > (new Date(booking.slot_start).getTime() + ON_TIME_GRACE_MS);

    // If already checked in — do not leak patient PII in 409 error response
    if (booking.status === 'CHECKED_IN' || booking.is_present) {
      return NextResponse.json(
        {
          success: false,
          error: 'ALREADY_CHECKED_IN',
          message: 'This appointment has already been checked in',
          is_late: isLate,
          checked_in_at: booking.checked_in_at || now.toISOString(),
        },
        { status: 409 }
      );
    }

    if (booking.status !== 'CONFIRMED') {
      return NextResponse.json(
        { success: false, error: 'INVALID_STATUS', message: `Cannot check in. Appointment status is ${booking.status}` },
        { status: 409 }
      );
    }

    // Fetch patient name & doctor name only after valid check-in verification
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
