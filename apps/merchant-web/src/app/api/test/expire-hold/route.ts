import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    // Strictly block this test helper in production
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
    }

    // Require CRON_SECRET or admin secret
    const cronSecret = process.env.CRON_SECRET;
    const adminSecret = process.env.ADMIN_SECRET || process.env.SUPERADMIN_E2E_TOKEN;
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    const bypassHeader = req.headers.get('x-admin-bypass-key');

    const isAuthorized =
      (cronSecret && token === cronSecret) ||
      (adminSecret && (token === adminSecret || bypassHeader === adminSecret));

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid CRON_SECRET or admin secret required' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { booking_id } = body;

    if (!booking_id) {
      return NextResponse.json({ error: 'booking_id is required' }, { status: 400 });
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof booking_id !== 'string' || !UUID_REGEX.test(booking_id)) {
      return NextResponse.json({ error: 'Invalid booking_id format: must be UUID' }, { status: 400 });
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
