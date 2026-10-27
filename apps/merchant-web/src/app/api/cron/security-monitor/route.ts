import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';

function verifyCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Security Monitor Cron] CRON_SECRET is not configured');
    }
    return false;
  }

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!authHeader) return false;

  const expected = `Bearer ${cronSecret}`;
  const authBuffer = Buffer.from(authHeader);
  const expectedBuffer = Buffer.from(expected);

  if (authBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(authBuffer, expectedBuffer);
}

export async function GET(req: NextRequest) {
  return handleSecurityMonitor(req);
}

export async function POST(req: NextRequest) {
  return handleSecurityMonitor(req);
}

async function handleSecurityMonitor(req: NextRequest) {
  try {
    if (!verifyCronAuth(req)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid or missing cron secret' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin(req);

    // 1. Query contact_reveal_anomalies view
    const { data: anomalies, error: viewError } = await supabaseAdmin
      .from('contact_reveal_anomalies')
      .select('*');

    if (viewError) {
      console.error('[Security Monitor] Error reading anomalies view:', viewError);
      return NextResponse.json(
        { success: false, error: viewError.message },
        { status: 500 }
      );
    }

    const records = anomalies || [];
    const checkedAt = new Date().toISOString();

    // 2. If anomalies detected, write CRITICAL log to public.app_logs
    for (const item of records) {
      const staffName = item.staff_name || 'Unknown Staff';
      const reveals1h = item.reveals_last_1h || 0;
      const reveals24h = item.reveals_last_24h || 0;

      const logPayload = {
        level: 'error',
        component: 'security-monitor',
        platform: 'backend',
        message: `High velocity contact reveals detected: ${staffName} (${item.user_id}) performed ${reveals1h} reveals in last 1h (${reveals24h} in 24h).`,
        user_id: item.user_id,
        metadata: {
          severity: 'CRITICAL',
          category: 'SECURITY',
          source: 'server',
          environment: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
          staff_name: item.staff_name,
          staff_phone: item.staff_phone,
          venue_name: item.venue_name,
          reveals_last_1h: reveals1h,
          reveals_last_24h: reveals24h,
          last_revealed_at: item.last_revealed_at,
          detected_at: checkedAt,
        },
      };

      const { error: logErr } = await supabaseAdmin.from('app_logs').insert(logPayload);
      if (logErr) {
        console.error('[Security Monitor] Failed to write app_logs alert:', logErr);
      }

      // Optional webhook notification
      const webhookUrl = process.env.SECURITY_ALERT_WEBHOOK_URL;
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              alert: 'CONTACT_REVEAL_ANOMALY',
              ...logPayload,
            }),
            signal: AbortSignal.timeout(4000),
          });
        } catch (webhookErr) {
          console.warn('[Security Monitor] Webhook alert failed:', webhookErr);
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        checked_at: checkedAt,
        anomalies_detected: records.length,
        anomalies: records,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal security monitor error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
