import { NextRequest, NextResponse } from 'next/server';
import {
  fetchAdminCityStats,
  updateAdminCityStatus,
  getSupabaseAdmin,
  CityStatus,
} from '@/lib/supabase';
import { verifyAdminRequest } from '@/lib/auth-admin';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const stats = await fetchAdminCityStats();
    return NextResponse.json({ cities: stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch cities';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const {
      id,
      name,
      state = 'Andhra Pradesh',
      country = 'India',
      status = 'EXPANDING',
      latitude,
      longitude,
      radiusKm = 25,
      merchantTarget = 15,
    } = body;

    if (!id || !name || latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        { error: 'id, name, latitude, and longitude are required fields' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('cities')
      .insert({
        id: id.toLowerCase().trim(),
        name: name.trim(),
        state,
        country,
        status: status as CityStatus,
        latitude: Number(latitude),
        longitude: Number(longitude),
        radius_km: Number(radiusKm),
        merchant_target: Number(merchantTarget),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ city: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create city';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const { cityId, status, target } = body;

    if (!cityId || !status) {
      return NextResponse.json(
        { error: 'cityId and status are required' },
        { status: 400 }
      );
    }

    const validStatuses: CityStatus[] = ['ACTIVE', 'EXPANDING', 'PLANNED', 'PAUSED'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    const result = await updateAdminCityStatus(
      cityId,
      status,
      target !== undefined ? Number(target) : null
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Update failed' }, { status: 400 });
    }

    return NextResponse.json({ success: true, cityId, status, target });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update city';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

