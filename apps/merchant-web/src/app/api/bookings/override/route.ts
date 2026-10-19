import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { booking_id, override_position = 1, reason = 'Emergency priority override' } = body;

    if (!booking_id) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json(
        { success: false, error: 'Authentication required to override queue' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const targetPos = Math.max(1, parseInt(override_position, 10));

    const { data: rpcRes, error: rpcErr } = await (supabaseAdmin.rpc as any)('override_hospital_queue_position', {
      p_booking_id: booking_id,
      p_override_position: targetPos,
      p_caller_id: caller.id,
    });

    if (rpcErr || (rpcRes && !rpcRes.success)) {
      const errorMsg = rpcErr?.message || rpcRes?.error || 'Failed to override queue position';
      const isAuth = errorMsg.includes('Unauthorized') || errorMsg.includes('Forbidden');
      const isNotFound = errorMsg.includes('not found');
      return NextResponse.json(
        { success: false, error: errorMsg },
        { status: isNotFound ? 404 : isAuth ? 403 : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      booking_id,
      queue_position: targetPos,
      reason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
