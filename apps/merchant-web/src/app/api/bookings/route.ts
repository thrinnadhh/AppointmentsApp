import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customer_id');
    const providerId = searchParams.get('provider_id');
    const merchantProviderId = req.headers.get('x-merchant-provider-id');

    // Tenant isolation: if a merchant requests bookings for a provider that doesn't match their authenticated provider, reject with 403
    if (providerId && merchantProviderId && providerId !== merchantProviderId) {
      return NextResponse.json({ error: 'Forbidden: tenant isolation boundary violation' }, { status: 403 });
    }

    if (!customerId && !providerId) {
      return NextResponse.json({ error: 'Missing customer_id or provider_id parameter' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    let query = supabaseAdmin
      .from('bookings')
      .select(`
        *,
        providers ( name ),
        resources ( name )
      `);

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }
    if (providerId) {
      query = query.eq('provider_id', providerId);
    }

    const { data, error } = await query.order('slot_start', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data || []).map((b: any) => ({
      ...b,
      provider_name: b.providers?.name || 'Tirupati Business',
      resource_name: b.resources?.name || 'Assigned Staff / Unit',
    }));

    return NextResponse.json({ success: true, bookings: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
