// Supabase Edge Function: send-booking-notification
// Dispatches automated WhatsApp queue insertion and Expo push notifications.
// Strictly authenticates caller and derives recipient details from booking & profile records.

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

type NotificationEventType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_REMINDER_1H'
  | 'BOOKING_CANCELLED'
  | 'REFUND_PROCESSED';

interface NotificationRequest {
  booking_id: string;
  event_type?: NotificationEventType;
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
          'BOOKING_REMINDER_1H',
          'BOOKING_CANCELLED',
          'REFUND_PROCESSED',
        ],
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
    const { booking_id, event_type = 'BOOKING_CONFIRMED' } = body;

    const ALLOWED_EVENT_TYPES = new Set([
      'BOOKING_CONFIRMED',
      'BOOKING_REMINDER_1H',
      'BOOKING_CANCELLED',
      'REFUND_PROCESSED',
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

    // ── 1. Fetch booking to verify ownership and derive recipient ────────────
    const { data: booking, error: bkgErr } = await supabase
      .from('bookings')
      .select('id, reference_code, customer_id, provider_id, status')
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
    // Queues WhatsApp notification into notification_logs table (channel: 'whatsapp')
    const { data: dispatchResult, error: dispatchError } = await supabase.rpc(
      'dispatch_booking_notification',
      {
        p_booking_id: booking_id,
        p_event_type: event_type,
      }
    );

    if (dispatchError) {
      throw new Error(`Dispatch failed: ${dispatchError.message}`);
    }

    // ── 3. Handle Expo Push Notification & Log Result with Channel 'push' ────
    let pushResult = { sent: false, channel: 'push', message_id: null as string | null };
    if (booking.customer_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('expo_push_token, full_name, phone')
        .eq('id', booking.customer_id)
        .maybeSingle();

      if (profile?.expo_push_token?.startsWith('ExponentPushToken')) {
        const isMockToken = /\[(tpt_|mock_|fake_|test_)/i.test(profile.expo_push_token);
        const isProductionEnv =
          Deno.env.get('ENVIRONMENT') === 'production' ||
          Deno.env.get('NODE_ENV') === 'production';

        if (isProductionEnv && isMockToken) {
          console.warn('[send-booking-notification] Skipping mock push token in production:', profile.expo_push_token);
          pushResult = { sent: false, channel: 'push', message_id: null };
        } else {
          try {
            const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                to: profile.expo_push_token,
                sound: 'default',
                title: `Appointment Update (${booking.reference_code || 'Tirupati'})`,
                body: `Your appointment status has updated: ${event_type}`,
                data: { booking_id, event_type },
              }),
            });

            const pushBody = await pushRes.json().catch(() => ({}));
            const pushTicketId = pushBody?.data?.id || `push_${Date.now()}`;

            if (pushRes.ok) {
              pushResult = { sent: true, channel: 'push', message_id: pushTicketId };

              // Log genuine push result in notification_logs table
              await supabase.from('notification_logs').insert({
                booking_id,
                recipient_phone: profile.phone || 'push-device',
                recipient_name: profile.full_name || 'Customer',
                event_type,
                channel: 'push',
                status: 'SENT',
                provider_message_id: pushTicketId,
                provider_response: pushBody,
                sent_at: new Date().toISOString(),
                message_content: `Push notification dispatched for ${event_type}`,
              });
            } else {
              pushResult = { sent: false, channel: 'push', message_id: null };
              await supabase.from('notification_logs').insert({
                booking_id,
                recipient_phone: profile.phone || 'push-device',
                recipient_name: profile.full_name || 'Customer',
                event_type,
                channel: 'push',
                status: 'FAILED',
                last_error: JSON.stringify(pushBody),
                message_content: `Failed push notification for ${event_type}`,
              });
            }
          } catch (pushErr: unknown) {
            const errMsg = pushErr instanceof Error ? pushErr.message : 'Push exception';
            console.warn('[send-booking-notification] Push dispatch error:', errMsg);
            await supabase.from('notification_logs').insert({
              booking_id,
              recipient_phone: profile.phone || 'push-device',
              recipient_name: profile.full_name || 'Customer',
              event_type,
              channel: 'push',
              status: 'FAILED',
              last_error: errMsg,
              message_content: `Exception in push dispatch: ${errMsg}`,
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        booking_id,
        event_type,
        dispatch: dispatchResult,
        push_notification: pushResult,
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
