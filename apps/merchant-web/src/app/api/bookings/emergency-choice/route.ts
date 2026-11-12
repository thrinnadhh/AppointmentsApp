import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from '@/lib/auth-admin';

export interface EmergencyChoiceRequest {
  booking_id: string;
  choice: 'WAIT' | 'RESCHEDULE' | 'REFUND';
  reschedule_slot_start?: string;
  reschedule_slot_end?: string;
}

export interface EmergencyChoiceResponse {
  success: boolean;
  booking_id?: string;
  status?: string;
  choice?: string;
  refund_amount?: number;
  message?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json<EmergencyChoiceResponse>(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    const body = (await req.json()) as EmergencyChoiceRequest;
    const { booking_id, choice, reschedule_slot_start, reschedule_slot_end } = body;

    if (!booking_id || !choice) {
      return NextResponse.json<EmergencyChoiceResponse>(
        { success: false, error: 'Missing required parameters: booking_id, choice' },
        { status: 400 }
      );
    }

    if (!['WAIT', 'RESCHEDULE', 'REFUND'].includes(choice)) {
      return NextResponse.json<EmergencyChoiceResponse>(
        { success: false, error: 'Invalid choice. Must be WAIT, RESCHEDULE, or REFUND' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    let targetBooking: any = null;
    const { data: booking, error: bErr } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, resource_id, emergency_cancelled, deposit_amount, platform_fee, total_charged')
      .eq('id', booking_id)
      .maybeSingle();

    if (bErr || !booking) {
      return NextResponse.json<EmergencyChoiceResponse>(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }
    targetBooking = booking;

    // Verify booking ownership: customer who owns booking or authorized staff/admin
    const isOwner = caller.id === booking.customer_id;
    if (!isOwner) {
      const isAuthorized = await isCallerAuthorizedForBooking(caller.id, booking, true);
      if (!isAuthorized) {
        return NextResponse.json<EmergencyChoiceResponse>(
          { success: false, error: 'Unauthorized to modify this appointment' },
          { status: 403 }
        );
      }
    }

    // Call choose_emergency_option RPC
    const { data: rpcData, error: rpcErr } = await (supabaseAdmin.rpc as any)('choose_emergency_option', {
      p_booking_id: booking_id,
      p_choice: choice,
      p_new_slot_start: reschedule_slot_start || null,
      p_new_slot_end: reschedule_slot_end || null,
    });

    if (rpcErr) {
      return NextResponse.json<EmergencyChoiceResponse>(
        { success: false, error: rpcErr.message },
        { status: 500 }
      );
    }

    const calculatedRefund = choice === 'REFUND'
      ? Number(targetBooking?.total_charged || ((targetBooking?.deposit_amount || 100) + (targetBooking?.platform_fee || 10)))
      : undefined;

    const result = {
      ...(rpcData as Record<string, unknown>),
      ...(calculatedRefund !== undefined ? { refund_amount: calculatedRefund } : {}),
    } as EmergencyChoiceResponse;

    return NextResponse.json<EmergencyChoiceResponse>(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json<EmergencyChoiceResponse>(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
