import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ReassignResourceRequest, ReassignResourceResponse } from '@appointments/shared';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ReassignResourceRequest>;
    const { booking_id, new_resource_id, reason = 'Emergency staff reassignment' } = body;

    if (!booking_id || !new_resource_id) {
      return NextResponse.json<ReassignResourceResponse>(
        { success: false, error: 'Missing required parameters: booking_id, new_resource_id' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('reassign_booking_resource', {
      p_booking_id: booking_id,
      p_new_resource_id: new_resource_id,
      p_reason: reason,
    });

    if (rpcError) {
      return NextResponse.json<ReassignResourceResponse>(
        { success: false, error: rpcError.message },
        { status: 500 }
      );
    }

    const result = rpcData as {
      success: boolean;
      error?: string;
      booking_id?: string;
      old_resource_id?: string;
      old_resource_name?: string;
      new_resource_id?: string;
      new_resource_name?: string;
      slot_start?: string;
      slot_end?: string;
      status?: string;
    };

    if (!result?.success) {
      const isNotFound = result?.error === 'Booking not found' || result?.error === 'Target resource not found';
      const isConflict = result?.error === 'The target resource already has a booking during this slot';
      const status = isNotFound ? 404 : isConflict ? 409 : 400;
      return NextResponse.json<ReassignResourceResponse>(
        { success: false, error: result?.error || 'Failed to reassign staff resource' },
        { status }
      );
    }

    return NextResponse.json<ReassignResourceResponse>(
      {
        success: true,
        booking_id: result.booking_id || booking_id,
        old_resource_id: result.old_resource_id,
        old_resource_name: result.old_resource_name,
        new_resource_id: result.new_resource_id,
        new_resource_name: result.new_resource_name,
        slot_start: result.slot_start,
        slot_end: result.slot_end,
        status: result.status || 'CONFIRMED',
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json<ReassignResourceResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
