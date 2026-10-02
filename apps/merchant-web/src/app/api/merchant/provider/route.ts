import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';

/**
 * Merchant Provider Info API Route
 * Allows the merchant web app to retrieve its own provider record (including status: ACTIVE, PENDING_APPROVAL, SUSPENDED)
 * via the server-side Supabase admin client, bypassing anon RLS restrictions on suspended venues.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const caller = await verifyAuthenticatedUser(request);
    if (!caller) {
      return NextResponse.json(
        { error: 'Unauthorized: Authentication required to view provider details' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const providerId = searchParams.get('id') || '11111111-1111-1111-1111-111111111111';

    const supabaseAdmin = getSupabaseAdmin();

    // Verify tenant isolation / authorization
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle();

    const isSuperAdmin = profile?.role === 'admin';
    if (!isSuperAdmin) {
      const { data: memberships } = await supabaseAdmin
        .from('merchant_memberships')
        .select('provider_id')
        .eq('user_id', caller.id);

      const isMember = memberships?.some((m) => m.provider_id === providerId);
      if (!isMember) {
        const { data: prov } = await supabaseAdmin
          .from('providers')
          .select('owner_id')
          .eq('id', providerId)
          .maybeSingle();

        if (!prov || prov.owner_id !== caller.id) {
          return NextResponse.json(
            { error: 'Forbidden: You are not authorized to view this provider record' },
            { status: 403 }
          );
        }
      }
    }

    // Try SECURITY DEFINER RPC first so merchant can read its own provider record even when suspended
    const { data: rpcData, error: rpcError } = await (supabaseAdmin.rpc as any)('get_provider_details', {
      p_provider_id: providerId,
    });

    if (!rpcError && rpcData) {
      return NextResponse.json({ provider: rpcData });
    }

    const { data: provider, error } = await supabaseAdmin
      .from('providers')
      .select('*, resources(*)')
      .eq('id', providerId)
      .maybeSingle();

    if (error || !provider) {
      return NextResponse.json({ error: error?.message || 'Provider not found' }, { status: 404 });
    }

    return NextResponse.json({ provider });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch merchant provider';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const caller = await verifyAuthenticatedUser(request);
    if (!caller) {
      return NextResponse.json(
        { error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { provider_id, cooling_period_days } = body;

    if (!provider_id) {
      return NextResponse.json({ error: 'Missing provider_id' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify tenant authorization
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle();

    const isSuperAdmin = profile?.role === 'admin';
    if (!isSuperAdmin) {
      const { data: memberships } = await supabaseAdmin
        .from('merchant_memberships')
        .select('provider_id')
        .eq('user_id', caller.id);

      const isMember = memberships?.some((m) => m.provider_id === provider_id);
      if (!isMember) {
        const { data: prov } = await supabaseAdmin
          .from('providers')
          .select('owner_id')
          .eq('id', provider_id)
          .maybeSingle();

        if (!prov || prov.owner_id !== caller.id) {
          return NextResponse.json(
            { error: 'Forbidden: You are not authorized to update this provider' },
            { status: 403 }
          );
        }
      }
    }

    const updatePayload: {
      cooling_period_days?: number;
      updated_at?: string;
    } = { updated_at: new Date().toISOString() };
    if (cooling_period_days !== undefined) {
      const days = Number(cooling_period_days);
      if (isNaN(days) || days < 0 || days > 365) {
        return NextResponse.json({ error: 'Cooling period must be between 0 and 365 days' }, { status: 400 });
      }
      updatePayload.cooling_period_days = days;
    }

    const { data: updated, error } = await supabaseAdmin
      .from('providers')
      .update(updatePayload)
      .eq('id', provider_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, provider: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update merchant provider';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

