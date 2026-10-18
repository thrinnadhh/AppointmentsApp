import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing booking ID parameter' }, { status: 400 });
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

    // 2. Fetch customer profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email, phone')
      .eq('id', booking.customer_id)
      .maybeSingle();

    // 3. Fetch provider
    const { data: provider } = await supabaseAdmin
      .from('providers')
      .select('name, address, phone')
      .eq('id', booking.provider_id)
      .maybeSingle();

    // 4. Fetch resource / doctor
    const { data: resource } = await supabaseAdmin
      .from('resources')
      .select('name, department, duration_minutes, price')
      .eq('id', booking.resource_id)
      .maybeSingle();

    // 5. Fetch check-in code
    const { data: checkinCodeRecord } = await supabaseAdmin
      .from('appointment_checkin_codes')
      .select('code, appointment_date')
      .eq('booking_id', booking.id)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      booking: {
        id: booking.id,
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
        name: resource?.name || 'Consultant Doctor',
        department: resource?.department || 'General',
        duration_minutes: resource?.duration_minutes || 2,
        price: resource?.price || 500
      },
      checkin_code: checkinCodeRecord?.code || '----'
    });
  } catch (error) {
    console.error('Error fetching ticket data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
