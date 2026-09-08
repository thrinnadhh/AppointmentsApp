import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { CreateHoldRequest, CreateHoldResponse } from '@appointments/shared';

interface RpcHoldResult {
  success: boolean;
  booking_id?: string;
  deposit_amount?: number;
  hold_expires_at?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CreateHoldRequest>;
    const { resource_id, slot_start, slot_end, customer_id } = body;

    if (!resource_id || !slot_start || !slot_end || !customer_id) {
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: 'Missing required parameters: resource_id, slot_start, slot_end, customer_id',
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc('create_booking_hold', {
      p_resource_id: resource_id,
      p_slot_start: slot_start,
      p_slot_end: slot_end,
      p_customer_id: customer_id,
    });

    if (error) {
      console.error('Supabase RPC create_booking_hold error:', error);
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: error.message,
        },
        { status: 500 }
      );
    }

    const result = data as unknown as RpcHoldResult;

    if (!result?.success) {
      const isConflict = result?.error?.includes('already held') || result?.error?.includes('conflict');
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: result?.error || 'Unable to reserve slot',
        },
        { status: isConflict ? 409 : 400 }
      );
    }

    return NextResponse.json<CreateHoldResponse>(
      {
        success: true,
        booking_id: result.booking_id,
        deposit_amount: result.deposit_amount,
        hold_expires_at: result.hold_expires_at,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid request payload';
    return NextResponse.json<CreateHoldResponse>(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
