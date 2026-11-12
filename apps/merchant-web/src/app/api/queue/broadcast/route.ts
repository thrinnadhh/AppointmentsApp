import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';
import { authorizeHospitalResourceOrMerchant } from '@/lib/hospital-access';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    const isServiceRole = 
      Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && 
      authHeader === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`);

    let isAuthorized = isServiceRole;
    const caller = isAuthorized ? null : await verifyAuthenticatedUser(req);
    if (!isAuthorized && !caller) {
      return NextResponse.json({ error: 'Unauthorized: Session required' }, { status: 401 });
    }

    const body = await req.json();
    const { doctor_id, date, currently_serving_token, waiting_count } = body;

    if (!doctor_id || !UUID_REGEX.test(doctor_id) || !date) {
      return NextResponse.json(
        { error: 'Invalid or missing doctor_id or date' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (!isAuthorized && caller) {
      const { data: resource } = await supabaseAdmin
        .from('resources')
        .select('id, provider_id')
        .eq('id', doctor_id)
        .maybeSingle();

      if (!resource) {
        return NextResponse.json({ error: 'Doctor resource not found' }, { status: 404 });
      }

      const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id });
      const authCheck = await authorizeHospitalResourceOrMerchant(req, caller.id, resource.provider_id, doctor_id);

      if (!isAdmin && !authCheck.authorized) {
        return NextResponse.json({ error: 'Forbidden: Caller not authorized for this doctor' }, { status: 403 });
      }
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
