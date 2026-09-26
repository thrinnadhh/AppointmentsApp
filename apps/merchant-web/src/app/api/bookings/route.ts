import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customer_id');

    if (!customerId) {
      return NextResponse.json({ error: 'Missing customer_id parameter' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select(`
        *,
        providers ( name ),
        resources ( name )
      `)
      .eq('customer_id', customerId)
      .order('slot_start', { ascending: false });

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
