import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NotificationLog } from '@appointments/shared';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookingId = searchParams.get('bookingId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const supabaseAdmin = getSupabaseAdmin();
    let query = supabaseAdmin
      .from('notification_logs')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (bookingId) {
      query = query.eq('booking_id', bookingId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        success: true,
        count: data?.length || 0,
        notifications: (data || []) as NotificationLog[],
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, booking_id, event_type = 'BOOKING_CONFIRMED' } = body;
    const supabaseAdmin = getSupabaseAdmin();

    if (action === 'check_reminders') {
      const { data, error } = await supabaseAdmin.rpc('check_and_send_booking_reminders');
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, result: data }, { status: 200 });
    }

    if (action === 'set_slot_time' && booking_id) {
      const minutesFromNow = body.minutes_from_now ?? 60;
      const { data, error: rpcErr } = await supabaseAdmin.rpc('set_booking_slot_for_reminder', {
        p_booking_id: booking_id,
        p_minutes_from_now: minutesFromNow,
      });

      if (rpcErr) {
        return NextResponse.json({ error: rpcErr.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, result: data }, { status: 200 });
    }

    if (!booking_id) {
      return NextResponse.json(
        { error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin.rpc('dispatch_booking_notification', {
      p_booking_id: booking_id,
      p_event_type: event_type,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, dispatch: data }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
