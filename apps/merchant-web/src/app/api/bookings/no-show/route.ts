import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { RecordNoShowRequest, RecordNoShowResponse } from '@appointments/shared';

interface RpcNoShowResult {
  success: boolean;
  no_show_count?: number;
  flagged?: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<RecordNoShowRequest>;
    const { booking_id } = body;

    if (!booking_id) {
      return NextResponse.json<RecordNoShowResponse>(
        { success: false, error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc('record_no_show', {
      p_booking_id: booking_id,
    });

    if (error) {
      return NextResponse.json<RecordNoShowResponse>(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    const result = data as unknown as RpcNoShowResult;

    if (!result?.success) {
      return NextResponse.json<RecordNoShowResponse>(
        { success: false, error: result?.error || 'Failed to record no-show' },
        { status: 400 }
      );
    }

    return NextResponse.json<RecordNoShowResponse>(
      {
        success: true,
        booking_id,
        no_show_count: result.no_show_count,
        is_flagged: result.flagged,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json<RecordNoShowResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
