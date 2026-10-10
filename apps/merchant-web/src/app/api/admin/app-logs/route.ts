import { NextRequest, NextResponse } from 'next/server';
import { fetchAdminAppLogs, purgeAdminAppLogs } from '@/lib/supabase';
import { verifyAdminRequest } from '@/lib/auth-admin';
import { AppPlatform, AppLogLevel } from '@appointments/shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const searchParams = request.nextUrl.searchParams;
    const platform = (searchParams.get('platform') || 'all') as AppPlatform | 'all';
    const level = (searchParams.get('level') || 'all') as AppLogLevel | 'all';
    const component = searchParams.get('component') || undefined;
    const search = searchParams.get('search') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const logs = await fetchAdminAppLogs({
      platform,
      level,
      component,
      search,
      limit: isNaN(limit) ? 50 : limit,
      offset: isNaN(offset) ? 0 : offset,
    });

    return NextResponse.json({ logs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error retrieving app logs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const searchParams = request.nextUrl.searchParams;
    const retentionDays = parseInt(searchParams.get('retentionDays') || '30', 10);

    const result = await purgeAdminAppLogs(isNaN(retentionDays) ? 30 : retentionDays);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted_count: result.count });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error purging app logs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
