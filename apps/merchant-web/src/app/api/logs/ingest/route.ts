import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { sanitizeLogData } from '@appointments/shared';

export const dynamic = 'force-dynamic';

// Rate limiter: Max 60 log submissions per minute per IP
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_LOGS_PER_WINDOW = 60;
const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipRequestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_LOGS_PER_WINDOW) {
    return false;
  }
  entry.count++;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Ingestion Rate Limiting
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = (forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1') || 'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded: Too many log submissions. Please try again later.' },
        { status: 429 }
      );
    }

    // 2. Read raw body with length check (max 64KB)
    const rawText = await request.text();
    if (rawText.length > 65536) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const payload = JSON.parse(rawText);
    const sanitized = sanitizeLogData(payload) as Record<string, unknown>;

    const platform = typeof sanitized.platform === 'string' ? sanitized.platform : 'web';
    const level = typeof sanitized.level === 'string' ? sanitized.level : 'info';
    const message = typeof sanitized.message === 'string' ? sanitized.message : 'Unknown client event';
    const component = typeof sanitized.component === 'string' ? sanitized.component : null;
    const stackTrace = typeof sanitized.stack_trace === 'string' ? sanitized.stack_trace : null;
    const metadata = typeof sanitized.metadata === 'object' && sanitized.metadata !== null ? sanitized.metadata : {};
    const deviceInfo = typeof sanitized.device_info === 'object' && sanitized.device_info !== null ? sanitized.device_info : {};
    const sessionId = typeof sanitized.session_id === 'string' ? sanitized.session_id : null;

    const severity = typeof sanitized.severity === 'string' ? sanitized.severity : null;
    const category = typeof sanitized.category === 'string' ? sanitized.category : 'OTHER';
    const source = typeof sanitized.source === 'string' ? sanitized.source : 'merchant-web';
    const errorCode = typeof sanitized.error_code === 'string' ? sanitized.error_code : null;
    const role = typeof sanitized.role === 'string' ? sanitized.role : null;
    const cityId = typeof sanitized.city_id === 'string' ? sanitized.city_id : null;
    const vertical = typeof sanitized.vertical === 'string' ? sanitized.vertical : null;
    const appointmentId = typeof sanitized.appointment_id === 'string' ? sanitized.appointment_id : null;
    const appVersion = typeof sanitized.app_version === 'string' ? sanitized.app_version : '1.0.0';
    const platformOs = typeof sanitized.platform_os === 'string' ? sanitized.platform_os : null;
    const deviceModel = typeof sanitized.device_model === 'string' ? sanitized.device_model : null;
    const environment = typeof sanitized.environment === 'string' ? sanitized.environment : 'dev';
    const fingerprint = typeof sanitized.fingerprint === 'string' ? sanitized.fingerprint : null;

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
      p_severity: severity,
      p_category: category,
      p_source: source,
      p_error_code: errorCode,
      p_role: role,
      p_city_id: cityId,
      p_vertical: vertical,
      p_appointment_id: appointmentId,
      p_app_version: appVersion,
      p_platform_os: platformOs,
      p_device_model: deviceModel,
      p_environment: environment,
      p_fingerprint: fingerprint,
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
