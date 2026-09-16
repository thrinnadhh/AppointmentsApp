import { NextRequest, NextResponse } from 'next/server';
import { fetchAdminVelocity, TimeWindowFilter } from '@/lib/supabase';
import { verifyAdminRequest } from '@/lib/auth-admin';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const searchParams = request.nextUrl.searchParams;
    const windowParam = (searchParams.get('window') || '7days') as TimeWindowFilter;
    const cityId = searchParams.get('cityId');

    const validWindows: TimeWindowFilter[] = ['today', '3days', '7days', '30days', 'all'];
    const timeWindow = validWindows.includes(windowParam) ? windowParam : '7days';

    const analytics = await fetchAdminVelocity(timeWindow, cityId);

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

