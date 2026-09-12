import { NextRequest, NextResponse } from 'next/server';
import { fetchAdminCityWaitlist, getSupabaseAdmin } from '@/lib/supabase';
import { verifyAdminRequest } from '@/lib/auth-admin';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const searchParams = request.nextUrl.searchParams;
    const cityId = searchParams.get('cityId') || undefined;

    const waitlist = await fetchAdminCityWaitlist(cityId);
    return NextResponse.json({ waitlist });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch waitlist';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cityId, contactInfo, roleInterest = 'customer', notes, userId } = body;

    if (!cityId || !contactInfo) {
      return NextResponse.json(
        { error: 'cityId and contactInfo are required' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('city_waitlist')
      .insert({
        city_id: cityId,
        contact_info: contactInfo.trim(),
        role_interest: roleInterest,
        notes: notes || null,
        user_id: userId || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to register waitlist interest';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
