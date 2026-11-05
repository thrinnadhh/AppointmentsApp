// Supabase Edge Function: process-notification-queue
// Consumes pgmq `notifications` queue, looks up user push tokens,
// dispatches privacy-safe alerts via Expo Push API, and handles DLQ after 5 failed attempts.
//
// Hard Rules:
// 1. Rejects any request without valid internal_webhook_secret header (401).
// 2. Operates on ID-only payloads (appointment_id, tenant_id, user_id, type) - NO PII.
// 3. Deletes processed messages from pgmq queue on success.
// 4. Routes messages with read_ct >= 5 to `notifications_dlq`.

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
    'Vary': 'Origin',
  };
}

function getNotificationMessage(eventType: string): { title: string; body: string } {
  switch (eventType) {
    case 'BOOKING_CONFIRMED':
      return {
        title: 'Appointment Confirmed',
        body: 'Your appointment has been confirmed. Tap to view your pass.',
      };
    case 'BOOKING_REMINDER_30M':
    case 'BOOKING_REMINDER':
      return {
        title: 'Upcoming Appointment',
        body: 'Your appointment is scheduled within the next 30 minutes. Tap for directions & live queue.',
      };
    case 'PATIENT_UP_NEXT':
      return {
        title: "You're Up Next",
        body: 'Please proceed to the consultation room area. Tap to open check-in pass.',
      };
    case 'QUEUE_CALLED':
      return {
        title: 'Queue Position Update',
        body: 'Your queue turn is approaching. Tap to view live status.',
      };
    case 'IN_CONSULTATION':
      return {
        title: 'In Consultation',
        body: 'Consultation session active. Tap to view summary.',
      };
    case 'BOOKING_COMPLETED':
      return {
        title: 'Consultation Concluded',
        body: 'Thank you for your visit. Tap to view prescription and receipt.',
      };
    case 'BOOKING_CANCELLED':
      return {
        title: 'Appointment Cancelled',
        body: 'Your appointment was cancelled. Tap to review details or reschedule.',
      };
    case 'REFUND_PROCESSED':
      return {
        title: 'Refund Processed',
        body: 'Your deposit refund has been credited to your original payment method.',
      };
    default:
      return {
        title: 'Appointment Update',
        body: 'Your booking status has changed. Tap to view your pass.',
      };
  }
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Health check
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({
        service: 'process-notification-queue',
        status: 'online',
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const configuredSecret = Deno.env.get('INTERNAL_WEBHOOK_SECRET') || '';

    if (!supabaseServiceKey) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration: missing service key' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Verify internal secret authorization header
    const incomingSecret =
      req.headers.get('x-internal-secret') ||
      req.headers.get('x-internal-webhook-secret') ||
      (req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');

    let authorized = false;

    // Check against env var first
    if (configuredSecret && configuredSecret !== 'REPLACE_ME' && incomingSecret === configuredSecret) {
      authorized = true;
    } else {
      // Fallback: query vault via get_vault_secret_by_name RPC
      const { data: vaultSecret } = await supabase.rpc('get_vault_secret_by_name', {
        p_secret_name: 'internal_webhook_secret',
      });

      if (vaultSecret && vaultSecret !== 'REPLACE_ME' && incomingSecret === vaultSecret) {
        authorized = true;
      }
    }

    if (!authorized) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: missing or invalid internal secret header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Fetch Expo Push Access Token if configured
    let expoAccessToken = Deno.env.get('EXPO_PUSH_ACCESS_TOKEN');
    if (!expoAccessToken) {
      const { data: expoSecret } = await supabase.rpc('get_vault_secret_by_name', {
        p_secret_name: 'expo_push_access_token',
      });
      if (expoSecret && expoSecret !== 'REPLACE_ME') {
        expoAccessToken = expoSecret;
      }
    }

    // 3. Read messages using read_queue_with_dlq helper (visibility timeout = 30s, qty = 10, max_reads = 5)
    const { data: messages, error: readErr } = await supabase.rpc('read_queue_with_dlq', {
      p_queue: 'notifications',
      p_dlq: 'notifications_dlq',
      p_vt: 30,
      p_qty: 10,
      p_max_reads: 5,
    });

    if (readErr) {
      return new Response(JSON.stringify({ error: `Queue read error: ${readErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const messageList = (messages as Array<{
      msg_id: number;
      read_ct: number;
      enqueued_at: string;
      vt: string;
      message: {
        appointment_id?: string;
        tenant_id?: string;
        user_id?: string;
        type?: string;
      };
    }>) || [];

    let processedCount = 0;
    const errors: Array<{ msg_id: number; error: string }> = [];

    for (const item of messageList) {
      const msgId = item.msg_id;
      const payload = item.message || {};
      const { appointment_id, user_id, type } = payload;

      try {
        if (user_id) {
          // Look up user push token strictly from public.push_tokens
          const { data: tokenRows } = await supabase
            .from('push_tokens')
            .select('token')
            .eq('user_id', user_id);

          const pushTokens = (tokenRows || [])
            .map((r: { token: string }) => r.token)
            .filter((t: string) => Boolean(t && t.startsWith('ExponentPushToken[')));

          if (pushTokens.length > 0) {
            const content = getNotificationMessage(type || 'BOOKING_UPDATED');
            const expoMessages = pushTokens.map((toToken: string) => ({
              to: toToken,
              sound: 'default',
              title: content.title,
              body: content.body,
              data: {
                booking_id: appointment_id,
                event_type: type,
              },
            }));

            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            };
            if (expoAccessToken) {
              headers['Authorization'] = `Bearer ${expoAccessToken}`;
            }

            // Post to Expo Push API
            await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers,
              body: JSON.stringify(expoMessages),
            }).catch((err) => {
              console.warn(`[process-notification-queue] Expo API network warning for msg ${msgId}:`, err);
            });
          }
        }

        // On success or delivery dispatch: delete message from queue
        await supabase.rpc('pgmq_delete' as any, {
          queue_name: 'notifications',
          msg_id: msgId,
        }).catch(async () => {
          // Fallback direct RPC if pgmq.delete is schema-qualified
          await supabase.from('q_notifications' as any).delete().eq('msg_id', msgId);
        });

        processedCount++;
      } catch (procErr: any) {
        errors.push({ msg_id: msgId, error: procErr?.message || String(procErr) });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        received: messageList.length,
        processed: processedCount,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
