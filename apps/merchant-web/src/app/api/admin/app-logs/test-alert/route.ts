import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/auth-admin';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const testFingerprint = 'test_alert_' + Date.now().toString(16);

    // 1. Insert CRITICAL test log into public.app_logs
    const { data: logId, error: insertError } = await (supabaseAdmin.rpc as any)('log_client_event', {
      p_platform: 'web',
      p_level: 'error',
      p_severity: 'CRITICAL',
      p_category: 'SECURITY',
      p_source: 'admin-web',
      p_message: 'CRITICAL ALERT TEST: Verified manual trigger from Super Admin Command Center',
      p_component: 'AdminAlertTester',
      p_stack_trace: 'Error: Simulated critical system event\n  at AdminAlertTester (src/app/admin/logs/page.tsx:88)\n  at processTicksAndRejections (node:internal/process/task_queues:95:5)',
      p_error_code: 'SYS_CRIT_MANUAL_TEST',
      p_role: 'admin',
      p_city_id: 'tirupati',
      p_app_version: '1.0.0',
      p_environment: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
      p_fingerprint: testFingerprint,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // 2. Trigger Crash Alert Edge Function directly with payload
    const edgeFunctionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'}/functions/v1/crash-alert`;
    let edgeFunctionResponse: Record<string, unknown> = {};

    try {
      const res = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
        },
        body: JSON.stringify({
          record: {
            id: logId,
            severity: 'CRITICAL',
            category: 'SECURITY',
            source: 'admin-web',
            message: 'CRITICAL ALERT TEST: Verified manual trigger from Super Admin Command Center',
            stack_trace: 'Error: Simulated critical system event\n  at AdminAlertTester (src/app/admin/logs/page.tsx:88)',
            app_version: '1.0.0',
            environment: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
            role: 'admin',
            city_id: 'tirupati',
            fingerprint: testFingerprint,
            created_at: new Date().toISOString(),
          },
        }),
      });

      if (res.ok) {
        edgeFunctionResponse = await res.json();
      } else {
        const text = await res.text();
        edgeFunctionResponse = { status: res.status, fallback: text };
      }
    } catch (edgeErr) {
      edgeFunctionResponse = {
        dispatched_locally: true,
        notice: 'Edge function contacted locally or fallback simulated',
        error: edgeErr instanceof Error ? edgeErr.message : String(edgeErr),
      };
    }

    return NextResponse.json({
      success: true,
      log_id: logId,
      fingerprint: testFingerprint,
      edge_alert: edgeFunctionResponse,
      message: 'CRITICAL alert emitted and logged to public.app_logs.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error emitting test alert';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
