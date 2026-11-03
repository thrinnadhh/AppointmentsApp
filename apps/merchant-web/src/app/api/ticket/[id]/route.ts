import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string' || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid booking ID parameter' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Fetch booking
    const { data: booking, error: bErr } = await supabaseAdmin
      .from('bookings')
      .select('id, reference_code, slot_start, slot_end, status, payment_status, deposit_amount, total_amount, is_present, queue_position, checked_in_at, checked_in_method, customer_id, provider_id, resource_id')
      .eq('id', id)
      .maybeSingle();

    if (bErr || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // 2. Determine authorization level
    const caller = await verifyAuthenticatedUser(req);
    const isBookingOwner = Boolean(caller && caller.id === booking.customer_id);
    const isAuthorized = caller ? await isCallerAuthorizedForBooking(caller.id, booking, true) : false;

    if (!isAuthorized) {
      const { data: publicResource } = await supabaseAdmin
        .from('resources')
        .select('id, duration_minutes')
        .eq('id', booking.resource_id)
        .maybeSingle();

      return NextResponse.json({
        success: true,
        booking: {
          id: booking.id,
          resource_id: booking.resource_id,
          slot_start: booking.slot_start,
          slot_end: booking.slot_end,
          status: booking.status,
          is_present: booking.is_present,
          queue_position: booking.queue_position ?? null,
          reference_code: null,
          payment_status: null,
          deposit_amount: null,
          checked_in_at: null,
          checked_in_method: null,
        },
        customer: null,
        hospital: null,
        doctor: {
          id: publicResource?.id || booking.resource_id,
          duration_minutes: publicResource?.duration_minutes || 2,
        },
        checkin_code: null,
      });
    }

    // 3. Fetch customer profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email, phone')
      .eq('id', booking.customer_id)
      .maybeSingle();

    // 4. Fetch provider
    const { data: provider } = await supabaseAdmin
      .from('providers')
      .select('name, address, phone')
      .eq('id', booking.provider_id)
      .maybeSingle();

    // 5. Fetch resource / doctor
    const { data: resource } = await supabaseAdmin
      .from('resources')
      .select('id, name, department, duration_minutes, price')
      .eq('id', booking.resource_id)
      .maybeSingle();

    // 6. Fetch check-in code ONLY if caller is the booking owner (staff should never see the patient's secret PIN)
    let checkinCode: string | null = null;
    if (isBookingOwner) {
      const { data: checkinCodeRecord } = await supabaseAdmin
        .from('appointment_checkin_codes')
        .select('code, appointment_date')
        .eq('booking_id', booking.id)
        .maybeSingle();
      checkinCode = checkinCodeRecord?.code || null;
    }

    return NextResponse.json({
      success: true,
      booking: {
        id: booking.id,
        resource_id: booking.resource_id,
        provider_id: booking.provider_id,
        reference_code: booking.reference_code,
        slot_start: booking.slot_start,
        slot_end: booking.slot_end,
        status: booking.status,
        payment_status: booking.payment_status,
        deposit_amount: booking.deposit_amount,
        is_present: booking.is_present,
        queue_position: booking.queue_position ?? null,
        checked_in_at: booking.checked_in_at,
        checked_in_method: booking.checked_in_method
      },
      customer: {
        name: profile?.full_name || 'Valued Patient',
        email: profile?.email || '',
        phone: profile?.phone || ''
      },
      hospital: {
        name: provider?.name || 'Hospital',
        address: provider?.address || 'Tirupati, AP',
        phone: provider?.phone || ''
      },
      doctor: {
        id: resource?.id || booking.resource_id,
        name: resource?.name || 'Consultant Doctor',
        department: resource?.department || 'General',
        duration_minutes: resource?.duration_minutes || 2,
        price: resource?.price || 500
      },
      checkin_code: isBookingOwner ? checkinCode : null
    });
  } catch (error) {
    console.error('Error fetching ticket data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
