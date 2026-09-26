// Supabase Edge Function: send-booking-notification
// Dispatches automated WhatsApp, SMS, and Push notifications for booking confirmations,
// 1-hour and 30-minute pre-slot reminders, and cancellations.
// Strictly authenticates caller and derives recipient details from booking & profile records,
// rejecting client-supplied arbitrary phone numbers.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type NotificationEventType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_REMINDER_1H'
  | 'BOOKING_REMINDER_30M'
  | 'BOOKING_CANCELLED';

interface NotificationRequest {
  booking_id: string;
  event_type?: NotificationEventType;
}

serve(async (req: Request) => {
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
          'BOOKING_REMINDER_30M',
          'BOOKING_CANCELLED',
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
    let isInternalServiceRole = token === supabaseServiceKey;

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

    // ── 3. Derive push token strictly from customer profile in database ──────
    let pushResult = { sent: false, channel: 'expo-push' };
    if (booking.customer_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('expo_push_token')
        .eq('id', booking.customer_id)
        .maybeSingle();

      if (profile?.expo_push_token?.startsWith('ExponentPushToken')) {
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
          if (pushRes.ok) {
            pushResult = { sent: true, channel: 'expo-push' };
          }
        } catch (pushErr) {
          console.warn('[send-booking-notification] Push dispatch error:', pushErr);
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
