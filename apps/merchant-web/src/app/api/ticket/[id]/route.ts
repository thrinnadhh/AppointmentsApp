import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function maskPhone(phone?: string | null): string {
  if (!phone) return '';
  const digits = phone.trim();
  if (digits.length <= 4) return '••••';
  return `${digits.slice(0, 3)}••••${digits.slice(-4)}`;
}

function maskEmail(email?: string | null): string {
  if (!email) return '';
  const parts = email.split('@');
  if (parts.length !== 2) return '••••@••••';
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length <= 2 ? `${name[0]}*` : `${name.slice(0, 2)}•••${name.slice(-1)}`;
  return `${maskedName}@${domain}`;
}

function maskName(name?: string | null): string {
  if (!name) return 'Valued Patient';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].length <= 2 ? parts[0] : `${parts[0][0]}***`;
  }
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

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
      .select('id, reference_code, slot_start, slot_end, status, payment_status, deposit_amount, total_amount, is_present, checked_in_at, checked_in_method, customer_id, provider_id, resource_id')
      .eq('id', id)
      .maybeSingle();

    if (bErr || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // 2. Determine authorization level
    const caller = await verifyAuthenticatedUser(req);
    const isAuthorized = caller ? await isCallerAuthorizedForBooking(caller.id, booking, true) : false;

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

    // 6. Fetch check-in code if authorized
    let checkinCode = '••••';
    if (isAuthorized) {
      const { data: checkinCodeRecord } = await supabaseAdmin
        .from('appointment_checkin_codes')
        .select('code, appointment_date')
        .eq('booking_id', booking.id)
        .maybeSingle();
      checkinCode = checkinCodeRecord?.code || '----';
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
        checked_in_at: booking.checked_in_at,
        checked_in_method: booking.checked_in_method
      },
      customer: {
        name: isAuthorized ? (profile?.full_name || 'Valued Patient') : maskName(profile?.full_name),
        email: isAuthorized ? (profile?.email || '') : maskEmail(profile?.email),
        phone: isAuthorized ? (profile?.phone || '') : maskPhone(profile?.phone)
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
      checkin_code: checkinCode
    });
  } catch (error) {
    console.error('Error fetching ticket data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
