import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bookingId = body.booking_id || body.bookingId;

    if (!bookingId) {
      return NextResponse.json(
        { success: false, error: 'MISSING_PARAM', message: 'Booking ID is required' },
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

    const { data: booking, error: fetchError } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, resource_id, status, is_present, slot_start, slot_end, version, updated_at')
      .eq('id', bookingId)
      .maybeSingle();

    if (fetchError || !booking) {
      return NextResponse.json(
        { success: false, error: 'NOT_FOUND', message: 'Booking not found' },
        { status: 404 }
      );
    }

    const isAuthorized = await isCallerAuthorizedForBooking(caller.id, booking, false);
    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: 'FORBIDDEN', message: 'Unauthorized: Only authorized hospital reception staff or administrators can collect fees' },
        { status: 403 }
      );
    }

    const { data, error } = await supabaseAdmin.rpc('collect_consultation_fee', {
      p_booking_id: bookingId,
      p_collected_by: caller.id,
    });

    if (error) {
      console.error('Error collecting consultation fee:', error);
      return NextResponse.json(
        { success: false, error: 'RPC_ERROR', message: error.message },
        { status: 500 }
      );
    }

    const res = data as { success: boolean; error?: string; consultation_payment_status?: string; consultation_fee_amount?: number; consultation_collected_at?: string };
    if (!res?.success) {
      return NextResponse.json(
        { success: false, error: 'COLLECTION_FAILED', message: res?.error || 'Unable to collect fee' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      booking_id: bookingId,
      consultation_payment_status: res.consultation_payment_status || 'COLLECTED_AT_DESK',
      consultation_fee_amount: res.consultation_fee_amount,
      consultation_collected_at: res.consultation_collected_at || new Date().toISOString(),
      message: 'Consultation fee marked as collected at hospital reception',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error processing fee collection';
    console.error('Error in collect-fee route:', err);
    return NextResponse.json(
      { success: false, error: 'INTERNAL_ERROR', message },
      { status: 500 }
    );
  }
}
