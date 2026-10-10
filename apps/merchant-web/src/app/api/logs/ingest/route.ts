import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { sanitizeLogData } from '@appointments/shared';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Read raw body with length check (max 64KB)
    const rawText = await request.text();
    if (rawText.length > 65536) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const payload = JSON.parse(rawText);
    const sanitized = sanitizeLogData(payload) as Record<string, unknown>;

    const platform = typeof sanitized.platform === 'string' ? sanitized.platform : 'web';
    const level = typeof sanitized.level === 'string' ? sanitized.level : 'error';
    const message = typeof sanitized.message === 'string' ? sanitized.message : 'Unknown client event';
    const component = typeof sanitized.component === 'string' ? sanitized.component : null;
    const stackTrace = typeof sanitized.stack_trace === 'string' ? sanitized.stack_trace : null;
    const metadata = typeof sanitized.metadata === 'object' && sanitized.metadata !== null ? sanitized.metadata : {};
    const deviceInfo = typeof sanitized.device_info === 'object' && sanitized.device_info !== null ? sanitized.device_info : {};
    const sessionId = typeof sanitized.session_id === 'string' ? sanitized.session_id : null;

    const supabaseAdmin = getSupabaseAdmin();
    const { data: logId, error } = await (supabaseAdmin.rpc as any)('log_client_event', {
      p_platform: platform,
      p_level: level,
      p_message: message,
      p_component: component,
      p_stack_trace: stackTrace,
      p_metadata: metadata,
      p_device_info: deviceInfo,
      p_session_id: sessionId,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, log_id: logId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to ingest log';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
