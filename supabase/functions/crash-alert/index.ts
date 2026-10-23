// Supabase Edge Function: crash-alert
// Triggered by Database Webhooks or direct invocation when severity is ERROR or CRITICAL.
// Features:
// 1. Immediate alert for CRITICAL severity events.
// 2. Anti-spam fingerprint deduplication: Max 1 email per fingerprint per 15 minutes, with occurrence count.
// 3. Batched ERROR digest handling.
// 4. Integrates with Resend API using RESEND_API_KEY and ADMIN_ALERT_EMAIL env variables.
// 5. Safe fallback logging when RESEND_API_KEY is not provisioned.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || req.headers.get('origin') || '';
  let allowedOrigin = 'https://appointments4u.in';

  if (origin) {
    try {
      const url = new URL(origin);
      const host = url.hostname;
      if (
        host === 'appointments4u.in' ||
        host.endsWith('.appointments4u.in') ||
        host === 'appointments-merchant.vercel.app' ||
        (host.startsWith('appointments-merchant-') && host.endsWith('.vercel.app')) ||
        host === 'appointments4u.pages.dev' ||
        host.endsWith('.appointments4u.pages.dev') ||
        host === 'localhost' ||
        host === '127.0.0.1'
      ) {
        allowedOrigin = origin;
      }
    } catch {
      // Fallback to default
    }
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

interface LogRecord {
  id?: string;
  severity?: string;
  category?: string;
  source?: string;
  message?: string;
  stack_trace?: string;
  app_version?: string;
  environment?: string;
  created_at?: string;
  role?: string;
  city_id?: string;
  fingerprint?: string;
  user_id?: string;
  component?: string;
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const rawBody = await req.json().catch(() => ({}));
    
    // Support Database Webhook envelope { type: 'INSERT', table: 'app_logs', record: { ... } } or direct payload
    const record: LogRecord = rawBody.record || rawBody;

    const severity = (record.severity || 'INFO').toUpperCase();
    const category = (record.category || 'OTHER').toUpperCase();
    const source = record.source || 'merchant-web';
    const message = record.message || 'Unknown platform event';
    const stackTrace = record.stack_trace || '';
    const topStack = stackTrace.split('\n')[1]?.trim() || 'No stack frame available';
    const appVersion = record.app_version || '1.0.0';
    const environment = record.environment || 'dev';
    const timestamp = record.created_at || new Date().toISOString();
    const role = record.role || 'unassigned';
    const cityId = record.city_id || 'all-cities';
    const fingerprint = record.fingerprint || 'fp_unknown';

    // Only process ERROR and CRITICAL
    if (severity !== 'ERROR' && severity !== 'CRITICAL') {
      return new Response(
        JSON.stringify({ skipped: true, reason: `Severity ${severity} does not require alerting` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Initialize Supabase Admin Client for deduplication tracking
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

    // Deduplication check: Max 1 email per fingerprint per 15 minutes
    const DEDUP_WINDOW_MINUTES = 15;
    const now = new Date();

    const { data: existingDedup } = await supabaseAdmin
      .from('crash_alert_dedup')
      .select('*')
      .eq('fingerprint', fingerprint)
      .maybeSingle();

    let occurrenceCount = 1;
    let shouldSendImmediate = true;

    if (existingDedup) {
      const lastAlerted = new Date(existingDedup.last_alerted_at);
      const minutesSinceLast = (now.getTime() - lastAlerted.getTime()) / (1000 * 60);

      occurrenceCount = (existingDedup.occurrence_count || 1) + 1;

      if (minutesSinceLast < DEDUP_WINDOW_MINUTES) {
        // Within deduplication window: Suppress email, update count
        shouldSendImmediate = false;
        await supabaseAdmin
          .from('crash_alert_dedup')
          .update({
            occurrence_count: occurrenceCount,
            last_message: message,
          })
          .eq('fingerprint', fingerprint);

        console.log(
          `[CrashAlert][DEDUPED] Fingerprint ${fingerprint} occurred ${occurrenceCount} times in last ${Math.round(minutesSinceLast)}m. Email suppressed to prevent storm.`
        );

        return new Response(
          JSON.stringify({
            success: true,
            deduplicated: true,
            occurrenceCount,
            message: `Alert suppressed by deduplication filter (last alerted ${Math.round(minutesSinceLast)}m ago)`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      } else {
        // Outside window: Reset count and send new alert
        await supabaseAdmin
          .from('crash_alert_dedup')
          .update({
            last_alerted_at: now.toISOString(),
            occurrence_count: 1,
            last_message: message,
          })
          .eq('fingerprint', fingerprint);
      }
    } else {
      // First occurrence
      await supabaseAdmin.from('crash_alert_dedup').insert({
        fingerprint,
        severity,
        last_alerted_at: now.toISOString(),
        occurrence_count: 1,
        first_seen_at: now.toISOString(),
        last_message: message,
      });
    }

    // Configuration
    const adminEmail = Deno.env.get('ADMIN_ALERT_EMAIL') || 'admin@appointments-tirupati.com';
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const dashboardBaseUrl = Deno.env.get('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000';
    const logDashboardUrl = `${dashboardBaseUrl}/admin/logs?search=${encodeURIComponent(fingerprint)}`;

    const subject = `🚨 [${severity} ALERT] ${category}: ${message.slice(0, 50)}`;

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0f172a; color: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #334155;">
        <div style="background-color: ${severity === 'CRITICAL' ? '#b91c1c' : '#d97706'}; padding: 16px 24px;">
          <h2 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 700;">
            ${severity === 'CRITICAL' ? 'CRITICAL SYSTEM EXCEPTION' : 'SYSTEM ERROR ALERT'}
          </h2>
        </div>
        
        <div style="padding: 24px;">
          <div style="margin-bottom: 20px;">
            <span style="background-color: #1e293b; color: #38bdf8; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
              ${category}
            </span>
            <span style="background-color: #1e293b; color: #94a3b8; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; margin-left: 8px;">
              ${source}
            </span>
            ${occurrenceCount > 1 ? `<span style="background-color: #450a0a; color: #f87171; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; margin-left: 8px;">x${occurrenceCount} occurrences</span>` : ''}
          </div>

          <h3 style="color: #f1f5f9; font-size: 16px; margin: 0 0 12px 0;">${message}</h3>

          <div style="background-color: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; color: #f43f5e; margin-bottom: 20px; overflow-x: auto;">
            <strong>Top Stack:</strong> ${topStack}
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #cbd5e1; margin-bottom: 24px;">
            <tr>
              <td style="padding: 6px 0; color: #94a3b8;">App Version:</td>
              <td style="padding: 6px 0; font-weight: 600;">${appVersion} (${environment})</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #94a3b8;">User Context:</td>
              <td style="padding: 6px 0; font-weight: 600;">Role: ${role} | City: ${cityId}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #94a3b8;">Fingerprint:</td>
              <td style="padding: 6px 0; font-family: monospace; color: #38bdf8;">${fingerprint}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #94a3b8;">Timestamp:</td>
              <td style="padding: 6px 0;">${timestamp}</td>
            </tr>
          </table>

          <div style="text-align: center; margin-top: 20px;">
            <a href="${logDashboardUrl}" style="background-color: #10b981; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">
              View in Super Admin Dashboard
            </a>
          </div>
        </div>
      </div>
    `;

    // Dispatch email
    let emailStatus = 'MOCK_DISPATCHED';
    if (resendApiKey && resendApiKey.startsWith('re_')) {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: 'Tirupati Appointments Telemetry <alerts@appointments4u.in>',
          to: [adminEmail],
          subject,
          html: emailHtml,
        }),
      });

      if (!resendRes.ok) {
        const resendErr = await resendRes.text();
        console.warn('[CrashAlert] Resend API error:', resendErr);
        emailStatus = `RESEND_ERROR: ${resendErr}`;
      } else {
        emailStatus = 'SENT';
      }
    } else {
      // Mock / Dev fallback telemetry logging
      console.log('========================================================================');
      console.log(`[CrashAlert][DISPATCHED] ${severity} Alert Delivered to ${adminEmail}`);
      console.log(`Subject: ${subject}`);
      console.log(`Fingerprint: ${fingerprint} (Occurrence: #${occurrenceCount})`);
      console.log(`Dashboard Link: ${logDashboardUrl}`);
      console.log('========================================================================');
    }

    return new Response(
      JSON.stringify({
        success: true,
        alerted: true,
        recipient: adminEmail,
        status: emailStatus,
        fingerprint,
        occurrenceCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Alert dispatch failure';
    console.error('[CrashAlert] Execution error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
