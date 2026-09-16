import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

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

    const supabaseAdmin = getSupabaseAdmin();
    const { data: booking, error: fetchError } = await supabaseAdmin
      .from('bookings')
      .select('id, provider_id, status, payment_status')
      .eq('id', booking_id)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Multitenancy guard: check if merchant header is passed and matches owning provider
    const merchantHeader = req.headers.get('x-merchant-provider-id');
    if (merchantHeader && merchantHeader !== booking.provider_id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Booking belongs to a different provider' },
        { status: 403 }
      );
    }

    // Edge check: cannot complete a cancelled or no-show booking
    if (booking.status === 'CANCELLED') {
      return NextResponse.json(
        { success: false, error: 'Invalid transition: Booking is already cancelled' },
        { status: 409 }
      );
    }

    if (booking.status === 'NO_SHOW') {
      return NextResponse.json(
        { success: false, error: 'Invalid transition: Booking is marked as no-show' },
        { status: 409 }
      );
    }

    // Mark completed
    const { error: updateError } = await supabaseAdmin
      .from('bookings')
      .update({
        status: 'COMPLETED',
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
      status: 'COMPLETED',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
