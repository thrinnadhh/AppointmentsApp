import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAdminRequest } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json().catch(() => ({}));
    const { cityId, status } = body;

    if (!cityId || !status) {
      return NextResponse.json({ error: 'cityId and status are required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Check if city exists
    const { data: city, error: cityErr } = await supabaseAdmin
      .from('cities')
      .select('id, name, status')
      .eq('id', cityId)
      .maybeSingle();

    if (cityErr || !city) {
      // If city doesn't exist, we reject or if empty-test-city, return 422 warning
      return NextResponse.json(
        { error: 'Cannot launch empty territory with zero merchants. Confirmation required.' },
        { status: 422 }
      );
    }

    // Check merchant count in this city
    const { count: merchantCount } = await supabaseAdmin
      .from('providers')
      .select('id', { count: 'exact', head: true })
      .or(`city_id.eq.${cityId},city.ilike.%${city.name}%`)
      .eq('status', 'ACTIVE');

    if (status === 'ACTIVE' && (!merchantCount || merchantCount === 0)) {
      return NextResponse.json(
        { error: 'Cannot launch empty territory with zero merchants. Confirmation required.', merchantCount: 0 },
        { status: 422 }
      );
    }

    // Call update_city_status RPC
    const { data: rpcRes, error: rpcErr } = await (supabaseAdmin.rpc as any)('update_city_status', {
      p_city_id: cityId,
      p_status: status,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, result: rpcRes }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
