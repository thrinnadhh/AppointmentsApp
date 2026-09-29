import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyStaffManagerRequest } from '@/lib/auth-admin';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await verifyStaffManagerRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { id } = await context.params;
    const body = await request.json();
    const { is_active } = body;

    if (typeof is_active !== 'boolean') {
      return NextResponse.json({ error: 'is_active (boolean) is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: resource, error: resError } = await supabaseAdmin
      .from('resources')
      .select('id, provider_id, name')
      .eq('id', id)
      .maybeSingle();

    if (resError || !resource) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    // Verify merchant authorization if caller is not platform admin
    if (authResult.profile.role === 'merchant') {
      const { data: authProviders } = await (supabaseAdmin.rpc as any)('get_user_authorized_providers', {
        p_user_id: authResult.user.id,
      });
      const authorizedList = Array.isArray(authProviders) ? authProviders : [];
      if (!authorizedList.includes(resource.provider_id)) {
        return NextResponse.json(
          { error: 'Forbidden: You do not have permission to manage this resource' },
          { status: 403 }
        );
      }
    }

    // Prevent deactivation if there are upcoming active confirmed bookings
    if (is_active === false) {
      const { count } = await supabaseAdmin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('resource_id', id)
        .eq('status', 'CONFIRMED')
        .gt('slot_start', new Date().toISOString());

      if (count && count > 0) {
        return NextResponse.json(
          { error: 'Conflict: Cannot deactivate resource with confirmed bookings' },
          { status: 409 }
        );
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('resources')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, id, is_active });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
