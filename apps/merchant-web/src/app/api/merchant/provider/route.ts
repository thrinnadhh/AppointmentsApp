import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * Merchant Provider Info API Route
 * Allows the merchant web app to retrieve its own provider record (including status: ACTIVE, PENDING_APPROVAL, SUSPENDED)
 * via the server-side Supabase admin client, bypassing anon RLS restrictions on suspended venues.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const providerId = searchParams.get('id') || '11111111-1111-1111-1111-111111111111';

    const supabaseAdmin = getSupabaseAdmin();
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
