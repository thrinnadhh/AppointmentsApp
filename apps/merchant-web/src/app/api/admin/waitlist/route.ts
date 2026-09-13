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
    const { cityId, contactInfo, roleInterest = 'customer', notes } = body;

    if (!cityId || !contactInfo) {
      return NextResponse.json(
        { error: 'cityId and contactInfo are required' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const cityNameFormatted = cityId.charAt(0).toUpperCase() + cityId.slice(1);
    const { error } = await supabaseAdmin
      .from('city_waitlist')
      .insert({
        city_name: cityNameFormatted,
        phone: contactInfo.trim(),
        vertical_interest: roleInterest || 'clinics',
        notes: notes || null,
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      entry: {
        id: `waitlist_${Date.now()}`,
        city_id: cityNameFormatted,
        contact_info: contactInfo.trim(),
        role_interest: roleInterest || 'clinics',
        notes: notes || null,
        created_at: new Date().toISOString(),
        cities: { name: cityNameFormatted },
      },
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to register waitlist interest';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
