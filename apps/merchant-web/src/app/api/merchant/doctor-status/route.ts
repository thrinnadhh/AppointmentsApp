import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForProvider } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider_id, resource_id, doctor_left } = body;

    if (!provider_id || !resource_id || typeof doctor_left !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: provider_id, resource_id, doctor_left' },
        { status: 400 }
      );
    }

    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const isAuthorized = await isCallerAuthorizedForProvider(caller.id, provider_id);
    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Not staff or admin for this hospital' },
        { status: 403 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: resource, error: fetchErr } = await supabaseAdmin
      .from('resources')
      .select('id, name, attributes')
      .eq('id', resource_id)
      .eq('provider_id', provider_id)
      .maybeSingle();

    if (fetchErr || !resource) {
      return NextResponse.json(
        { success: false, error: 'Resource/doctor not found' },
        { status: 404 }
      );
    }

    const currentAttrs = (resource.attributes as Record<string, unknown>) || {};
    const updatedAttrs = {
      ...currentAttrs,
      doctor_left,
      doctor_left_at: doctor_left ? new Date().toISOString() : null,
      updated_by: caller.id,
    };

    const { error: updateErr } = await supabaseAdmin
      .from('resources')
      .update({
        attributes: updatedAttrs,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resource_id);

    if (updateErr) {
      return NextResponse.json(
        { success: false, error: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      resource_id,
      doctor_name: resource.name,
      doctor_left,
      doctor_left_at: updatedAttrs.doctor_left_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
