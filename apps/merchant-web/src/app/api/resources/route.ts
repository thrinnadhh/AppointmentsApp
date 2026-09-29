import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const providerId = searchParams.get('provider_id') || searchParams.get('providerId');

    if (!providerId) {
      return NextResponse.json(
        { error: 'Missing provider_id parameter. Provider scoping is required.' },
        { status: 400 }
      );
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerId)) {
      return NextResponse.json(
        { error: 'Invalid provider_id format' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('resources')
      .select('*, providers(id, name, category_id)')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, resources: data || [] }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
