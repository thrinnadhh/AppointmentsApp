import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const resourceId = searchParams.get('resource_id');
    const date = searchParams.get('date');

    if (!resourceId || !date) {
      return NextResponse.json({ error: 'Missing resource_id or date parameter' }, { status: 400 });
    }

    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('slot_start')
      .eq('resource_id', resourceId)
      .in('status', ['HELD', 'CONFIRMED', 'PENDING_PAYMENT'])
      .gte('slot_start', startOfDay.toISOString())
      .lte('slot_start', endOfDay.toISOString());

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const slots = (data || []).map((b: { slot_start: string }) => new Date(b.slot_start).toISOString());
    return NextResponse.json({ success: true, booked_slots: slots });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
