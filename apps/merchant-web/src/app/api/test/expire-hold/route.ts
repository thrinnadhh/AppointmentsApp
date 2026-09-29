import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    // Strictly block this test helper in production
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const { booking_id } = body;

    if (!booking_id) {
      return NextResponse.json({ error: 'booking_id is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    // Backdate hold_expires_at to 10 minutes ago
    const expiredTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { error } = await supabaseAdmin
      .from('bookings')
      .update({ hold_expires_at: expiredTime, updated_at: new Date().toISOString() })
      .eq('id', booking_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, booking_id, expired_at: expiredTime });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
