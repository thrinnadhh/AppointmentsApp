import { NextRequest, NextResponse } from 'next/server';
import { fetchAdminAuditLogs } from '@/lib/supabase';
import { verifyAdminRequest } from '@/lib/auth-admin';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const searchParams = request.nextUrl.searchParams;
    const limitParam = parseInt(searchParams.get('limit') || '50', 10);
    const limit = isNaN(limitParam) ? 50 : Math.min(Math.max(1, limitParam), 200);

    const logs = await fetchAdminAuditLogs(limit);

    return NextResponse.json({ logs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown audit log retrieval error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
