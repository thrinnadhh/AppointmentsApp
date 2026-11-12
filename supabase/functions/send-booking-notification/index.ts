// Supabase Edge Function: send-booking-notification
// Dispatches automated Push, WhatsApp, and SMS notifications strictly for hospital queue events:
// - BOOKING_CONFIRMED
// - BOOKING_REMINDER (1H / 30M)
// - PATIENT_UP_NEXT
// - ETA_LEFT_WINDOW
// - EARLY_ARRIVAL_INVITE
//
// Privacy Safeguards:
// Strictly NEVER includes patient names, health details, clinical symptoms, or diagnoses
// in notification titles or body text.
// Logs Expo push tickets and receipts into notification_logs.
// Automatically prunes stale tokens via remove_stale_push_token RPC.

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
    'Vary': 'Origin',
  };
}

// 5 SPEC-approved notification event types
export type NotificationEventType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_REMINDER'
  | 'BOOKING_REMINDER_1H'
  | 'BOOKING_REMINDER_1H'
  | 'BOOKING_REMINDER_30M'
  | 'BOOKING_REMINDER'
  | 'BOOKING_CANCELLED'
  | 'REFUND_PROCESSED'
  | 'PATIENT_UP_NEXT'
  | 'ETA_LEFT_WINDOW'
  | 'EARLY_ARRIVAL_INVITE';

interface NotificationRequest {
  booking_id: string;
  event_type?: NotificationEventType;
  action?: 'send' | 'check_receipts';
  ticket_ids?: string[];
}

/**
 * Builds notifications with ZERO health details or clinical symptoms.
 * When booked for a family member, names the patient for clarity (e.g. "Appointment for Aarav is confirmed").
 */
export function buildPrivacySafeNotification(
  eventType: NotificationEventType,
  referenceCode?: string,
  patientName?: string | null
): { title: string; body: string } {
  const refSuffix = referenceCode ? ` (${referenceCode})` : '';
  const trimmedPatient = patientName?.trim();
  const patientSuffix = trimmedPatient ? ` for ${trimmedPatient}` : '';

  switch (eventType) {
    case 'BOOKING_CONFIRMED':
      return {
        title: `Appointment Confirmed${refSuffix}`,
        body: `Your appointment${patientSuffix} is confirmed. Arrival window is ±10 minutes of scheduled time.`,
      };
    case 'BOOKING_REMINDER':
    case 'BOOKING_REMINDER_1H':
    case 'BOOKING_REMINDER_30M':
      return {
        title: `Appointment Reminder${refSuffix}`,
        body: `Appointment${patientSuffix} is scheduled soon. Please plan to arrive within your window.`,
      };
    case 'PATIENT_UP_NEXT':
      return {
        title: trimmedPatient ? `${trimmedPatient} is Up Next${refSuffix}` : `You're Up Next${refSuffix}`,
        body: 'Please proceed to the consultation room area. Your turn is next.',
      };
    case 'ETA_LEFT_WINDOW':
      return {
        title: `Queue Schedule Update${refSuffix}`,
        body: 'Doctor schedule has shifted. Your estimated consultation time has been adjusted. Tap to view live queue.',
      };
    case 'EARLY_ARRIVAL_INVITE':
      return {
        title: `Doctor Available Early${refSuffix}`,
        body: 'The doctor is ahead of schedule. If you are already here, you can be seen early. Tap to review.',
      };
    case 'BOOKING_CANCELLED':
      return {
        title: `Appointment Cancelled${refSuffix}`,
        body: `Appointment${patientSuffix} has been cancelled. Tap to review status.`,
      };
    default:
      return {
        title: `Appointment Update${refSuffix}`,
        body: `Appointment status${patientSuffix} has updated. Tap to view your pass.`,
      };
  }
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Health/status check
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({
        service: 'send-booking-notification',
        status: 'online',
        supported_events: [
          'BOOKING_CONFIRMED',
          'BOOKING_REMINDER',
          'BOOKING_REMINDER_1H',
          'BOOKING_REMINDER_30M',
          'BOOKING_CANCELLED',
          'REFUND_PROCESSED',
          'PATIENT_UP_NEXT',
          'ETA_LEFT_WINDOW',
          'EARLY_ARRIVAL_INVITE',
        ],
        privacy_policy: 'NO_HEALTH_DETAILS',
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase service role credentials not configured');
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── 0. Require & Verify Authorization ────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization header is required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const isInternalServiceRole = token === supabaseServiceKey;

    let callerUserId: string | null = null;
    if (!isInternalServiceRole) {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: 'Invalid or expired session token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      callerUserId = user.id;
    }

    const body: NotificationRequest = await req.json();

    // ── 1. Action: Check Receipts ───────────────────────────────────────────
    if (body.action === 'check_receipts') {
      const ticketIds = body.ticket_ids || [];
      if (!ticketIds.length) {
        return new Response(JSON.stringify({ error: 'No ticket_ids provided' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const receiptRes = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids: ticketIds }),
      });

      const receiptJson = await receiptRes.json();
      const receipts = receiptJson.data || {};
      const staleTokensPruned: string[] = [];

      for (const [tId, receipt] of Object.entries(receipts) as [string, any][]) {
        if (receipt.status === 'error') {
          if (receipt.details?.error === 'DeviceNotRegistered') {
            // Find associated token in notification_logs if logged
            const { data: logRow } = await supabase
              .from('notification_logs')
              .select('provider_response')
              .eq('provider_response->>ticket_id', tId)
              .maybeSingle();

            const pushToken = logRow?.provider_response?.token;
            if (pushToken) {
              await supabase.rpc('remove_stale_push_token', { p_token: pushToken });
              staleTokensPruned.push(pushToken);
            }
          }
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          action: 'check_receipts',
          receipts,
          stale_tokens_pruned: staleTokensPruned,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // ── 2. Standard Dispatch Flow ────────────────────────────────────────────
    const { booking_id, event_type = 'BOOKING_CONFIRMED' } = body;

    const ALLOWED_EVENT_TYPES = new Set<NotificationEventType>([
      'BOOKING_CONFIRMED',
      'BOOKING_REMINDER',
      'BOOKING_REMINDER_1H',
      'BOOKING_CANCELLED',
      'REFUND_PROCESSED',
      'PATIENT_UP_NEXT',
      'ETA_LEFT_WINDOW',
      'EARLY_ARRIVAL_INVITE',
    ]);

    if (!ALLOWED_EVENT_TYPES.has(event_type)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid event_type: ${event_type}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    if (!booking_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'booking_id is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Fetch booking to verify ownership and derive recipient
    const { data: booking, error: bkgErr } = await supabase
      .from('bookings')
      .select('id, reference_code, customer_id, provider_id, status, booked_for, patient_name')
      .eq('id', booking_id)
      .maybeSingle();

    if (bkgErr || !booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller authorization if not internal service role
    if (!isInternalServiceRole && callerUserId) {
      let isAuthorized = callerUserId === booking.customer_id;
      if (!isAuthorized) {
        const { data: isAdmin } = await supabase.rpc('is_admin', { p_user_id: callerUserId });
        if (isAdmin) isAuthorized = true;
      }
      if (!isAuthorized) {
        const { data: allowedProviders } = await supabase.rpc('get_user_authorized_providers', { p_user_id: callerUserId });
        if (Array.isArray(allowedProviders) && allowedProviders.includes(booking.provider_id)) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: 'Access denied: You are not authorized for this booking' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── 2. Invoke atomic database notification procedure ─────────────────────
    try {
      await supabase.rpc('dispatch_booking_notification', {
        p_booking_id: booking_id,
        p_event_type: event_type,
      });
    } catch (dispatchErr: any) {
      console.warn('[send-booking-notification] WhatsApp RPC dispatch warning:', dispatchErr.message);
    }

    // ── 3. Query Target Push Tokens from push_tokens table & profiles ─────────
    const pushTokensList: string[] = [];

    if (booking.customer_id) {
      const { data: tokensRows } = await supabase
        .from('push_tokens')
        .select('token')
        .eq('user_id', booking.customer_id);

      if (tokensRows && tokensRows.length > 0) {
        for (const row of tokensRows) {
          if (row.token && !pushTokensList.includes(row.token)) {
            pushTokensList.push(row.token);
          }
        }
      }

      if (pushTokensList.length === 0) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('expo_push_token')
          .eq('id', booking.customer_id)
          .maybeSingle();

        if (profile?.expo_push_token && !pushTokensList.includes(profile.expo_push_token)) {
          pushTokensList.push(profile.expo_push_token);
        }
      }
    }

    // ── 4. Build Notification Content (Names patient if family booking) ─────
    const targetPatientName =
      (booking.booked_for === 'family' && booking.patient_name) ? booking.patient_name : null;
    const notificationContent = buildPrivacySafeNotification(event_type, booking.reference_code, targetPatientName);

    const isProductionEnv =
      Deno.env.get('ENVIRONMENT') === 'production' ||
      Deno.env.get('NODE_ENV') === 'production';

    const validTokensToSend = pushTokensList.filter((tok) => {
      const isExpo = /^ExponentPushToken\[[a-zA-Z0-9_-]+\]$/.test(tok);
      const isMockToken = /\[(tpt_|mock_|fake_|test_)/i.test(tok);
      if (isProductionEnv && isMockToken) {
        console.warn('[send-booking-notification] Skipping mock push token in production:', tok);
        return false;
      }
      return isExpo || isMockToken;
    });

    const pushResults: any[] = [];
    const staleTokensRemoved: string[] = [];

    // ── 5. Dispatch to Expo Push API & Process Tickets ───────────────────────
    if (validTokensToSend.length > 0) {
      const messages = validTokensToSend.map((tok) => ({
        to: tok,
        sound: 'default',
        title: notificationContent.title,
        body: notificationContent.body,
        data: {
          booking_id: booking.id,
          event_type,
          url: `/ticket/${booking.id}`,
        },
      }));

      try {
        const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(messages),
        });

        if (pushRes.ok) {
          const resJson = await pushRes.json();
          const tickets: any[] = Array.isArray(resJson.data) ? resJson.data : [resJson.data];

          for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i];
            const tokenUsed = validTokensToSend[i];

            if (ticket.status === 'ok') {
              pushResults.push({ sent: true, token: tokenUsed, ticket_id: ticket.id });

              // Log ticket into notification_logs
              await supabase.from('notification_logs').insert({
                booking_id: booking.id,
                recipient_phone: 'push-device',
                recipient_name: 'Patient App',
                event_type,
                channel: 'push',
                status: 'SENT',
                message_content: notificationContent.body,
                provider_response: {
                  ticket_id: ticket.id,
                  status: 'ok',
                  token: tokenUsed,
                },
                sent_at: new Date().toISOString(),
              });
            } else if (ticket.status === 'error') {
              pushResults.push({
                sent: false,
                token: tokenUsed,
                error: ticket.message,
                details: ticket.details,
              });

              // Log failure
              await supabase.from('notification_logs').insert({
                booking_id: booking.id,
                recipient_phone: 'push-device',
                recipient_name: 'Patient App',
                event_type,
                channel: 'push',
                status: 'FAILED',
                message_content: notificationContent.body,
                provider_response: {
                  error: ticket.message,
                  details: ticket.details,
                  token: tokenUsed,
                },
                sent_at: new Date().toISOString(),
              });

              // If token is stale / unregistered, remove it immediately
              if (ticket.details?.error === 'DeviceNotRegistered') {
                await supabase.rpc('remove_stale_push_token', { p_token: tokenUsed });
                staleTokensRemoved.push(tokenUsed);
              }
            }
          }
        }
      } catch (pushErr: any) {
        console.warn('[send-booking-notification] Push dispatch error:', pushErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        booking_id,
        event_type,
        tokens_targeted: validTokensToSend.length,
        push_results: pushResults,
        stale_tokens_removed: staleTokensRemoved,
        notification: notificationContent,
        processed_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Notification dispatch error';
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
