import { NextRequest, NextResponse } from 'next/server';
import { fetchAdminVelocity, TimeWindowFilter } from '@/lib/supabase';
import { verifyAdminOrCityDirectorRequest } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminOrCityDirectorRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const searchParams = request.nextUrl.searchParams;
    const windowParam = (searchParams.get('window') || '7days') as TimeWindowFilter;
    const requestedCityId = searchParams.get('cityId');

    let effectiveCityId = requestedCityId || undefined;

    // Enforce strict city boundary for City Directors
    if (authResult.profile.role === 'city_director') {
      const assignedCity = authResult.profile.assigned_city_id;
      if (!assignedCity) {
        return NextResponse.json(
          { error: 'Forbidden: City Director profile has no assigned city' },
          { status: 403 }
        );
      }
      if (requestedCityId && requestedCityId !== 'all' && requestedCityId !== assignedCity) {
        return NextResponse.json(
          { error: 'Forbidden: City Director access restricted to assigned city' },
          { status: 403 }
        );
      }
      effectiveCityId = assignedCity;
    }

    const validWindows: TimeWindowFilter[] = ['today', '3days', '7days', '30days', 'all'];
    const timeWindow = validWindows.includes(windowParam) ? windowParam : '7days';

    const analytics = await fetchAdminVelocity(timeWindow, effectiveCityId);

    if (!analytics) {
      return NextResponse.json(
        { error: 'Failed to aggregate velocity analytics' },
        { status: 500 }
      );
    }

    return NextResponse.json({ analytics });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown analytics error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

