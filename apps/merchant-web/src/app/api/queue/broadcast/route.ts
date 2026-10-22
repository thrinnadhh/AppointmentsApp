import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { doctor_id, date, currently_serving_token, waiting_count } = body;

    if (!doctor_id || !date) {
      return NextResponse.json(
        { error: 'Missing doctor_id or date' },
        { status: 400 }
      );
    }

    const channelName = `doctor-queue-${doctor_id}-${date}`;
    const channel = supabase.channel(channelName);

    // Send broadcast to all listening clients (logged in and link-only viewers)
    await channel.send({
      type: 'broadcast',
      event: 'queue_update',
      payload: {
        doctor_id,
        date,
        currently_serving_token: currently_serving_token ?? null,
        waiting_count: waiting_count ?? 0,
        last_advanced_at: new Date().toISOString(),
      },
    });

    // Clean up channel handle
    setTimeout(() => {
      supabase.removeChannel(channel);
    }, 1000);

    return NextResponse.json({
      success: true,
      channel: channelName,
      broadcast_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Broadcast failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
