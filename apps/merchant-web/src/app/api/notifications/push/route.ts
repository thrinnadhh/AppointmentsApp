import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createServerClient } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

// 5 SPEC-approved notification event types
const ALLOWED_EVENTS = new Set([
  'BOOKING_CONFIRMED',
  'BOOKING_REMINDER',
  'PATIENT_UP_NEXT',
  'ETA_LEFT_WINDOW',
  'EARLY_ARRIVAL_INVITE',
]);

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Authenticate caller
    const authHeader = req.headers.get('Authorization');
    let callerUserId: string | null = null;
    let isServiceRole = false;

    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (serviceKey && token === serviceKey) {
        isServiceRole = true;
      } else {
        const { data: { user }, error: uErr } = await supabaseAdmin.auth.getUser(token);
        if (!uErr && user) {
          callerUserId = user.id;
        }
      }
    }

    if (!callerUserId && !isServiceRole) {
      // Check cookies
      const cookieHeader = req.headers.get('cookie') ?? '';
      const supabaseUser = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return cookieHeader
                .split(';')
                .map((c) => c.trim())
                .filter(Boolean)
                .map((c) => {
                  const [name, ...val] = c.split('=');
                  return { name, value: val.join('=') };
                });
            },
          },
        }
      );
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (user) callerUserId = user.id;
    }

    if (!callerUserId && !isServiceRole) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { booking_id, event_type } = body;

    if (!booking_id) {
      return NextResponse.json({ error: 'booking_id is required' }, { status: 400 });
    }

    if (!event_type || !ALLOWED_EVENTS.has(event_type)) {
      return NextResponse.json(
        { error: `Invalid event_type. Allowed: ${Array.from(ALLOWED_EVENTS).join(', ')}` },
        { status: 400 }
      );
    }

    // 2. Fetch booking
    const { data: booking, error: bkgErr } = await supabaseAdmin
      .from('bookings')
      .select('id, reference_code, customer_id, provider_id, status')
      .eq('id', booking_id)
      .maybeSingle();

    if (bkgErr || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // 3. Verify authorization
    if (!isServiceRole && callerUserId) {
      let isAuthorized = callerUserId === booking.customer_id;
      if (!isAuthorized) {
        const { data: isAdmin } = await supabaseAdmin.rpc('is_admin', { p_user_id: callerUserId });
        if (isAdmin) isAuthorized = true;
      }
      if (!isAuthorized) {
        const { data: allowedProviders } = await supabaseAdmin.rpc('get_user_authorized_providers', {
          p_user_id: callerUserId,
        });
        if (Array.isArray(allowedProviders) && allowedProviders.includes(booking.provider_id)) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        return NextResponse.json(
          { error: 'Access denied: You are not authorized for this booking' },
          { status: 403 }
        );
      }
    }

    // 4. Fetch target tokens from push_tokens table
    const { data: tokensRows } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', booking.customer_id);

    const pushTokensList: string[] = (tokensRows || []).map((r) => r.token);

    // Fallback to profiles.expo_push_token
    if (pushTokensList.length === 0) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('expo_push_token')
        .eq('id', booking.customer_id)
        .maybeSingle();

      if (profile?.expo_push_token) {
        pushTokensList.push(profile.expo_push_token);
      }
    }

    // 5. Build privacy-preserving notification: ZERO patient names, ZERO health details
    const refSuffix = booking.reference_code ? ` (${booking.reference_code})` : '';
    let title = `Appointment Update${refSuffix}`;
    let message = 'Your appointment status has updated. Tap to view your pass.';

    switch (event_type) {
      case 'BOOKING_CONFIRMED':
        title = `Appointment Confirmed${refSuffix}`;
        message = 'Your appointment is confirmed. Arrival window is ±10 minutes of scheduled time.';
        break;
      case 'BOOKING_REMINDER':
        title = `Appointment Reminder${refSuffix}`;
        message = 'Your appointment is scheduled soon. Please plan to arrive within your window.';
        break;
      case 'PATIENT_UP_NEXT':
        title = `You're Up Next${refSuffix}`;
        message = 'Please proceed to the consultation room area. Your turn is next.';
        break;
      case 'ETA_LEFT_WINDOW':
        title = `Queue Schedule Update${refSuffix}`;
        message = 'Doctor schedule has shifted. Your estimated consultation time has been adjusted. Tap to view live queue.';
        break;
      case 'EARLY_ARRIVAL_INVITE':
        title = `Doctor Available Early${refSuffix}`;
        message = 'The doctor is ahead of schedule. If you are already here, you can be seen early. Tap to review.';
        break;
    }

    const validTokens = pushTokensList.filter((tok) =>
      /^ExponentPushToken\[[a-zA-Z0-9_-]+\]$/.test(tok) || /\[(tpt_|mock_|fake_|test_)/i.test(tok)
    );

    const pushResults: any[] = [];
    const staleTokensRemoved: string[] = [];

    if (validTokens.length > 0) {
      const messages = validTokens.map((tok) => ({
        to: tok,
        sound: 'default',
        title,
        body: message,
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
            const tokenUsed = validTokens[i];

            if (ticket.status === 'ok') {
              pushResults.push({ sent: true, token: tokenUsed, ticket_id: ticket.id });

              // Log ticket into notification_logs
              await supabaseAdmin.from('notification_logs').insert({
                booking_id: booking.id,
                recipient_phone: 'push-device',
                recipient_name: 'Patient App',
                event_type,
                channel: 'push',
                status: 'SENT',
                message_content: message,
                provider_response: { ticket_id: ticket.id, status: 'ok', token: tokenUsed },
                sent_at: new Date().toISOString(),
              });
            } else if (ticket.status === 'error') {
              pushResults.push({
                sent: false,
                token: tokenUsed,
                error: ticket.message,
                details: ticket.details,
              });

              // Log error
              await supabaseAdmin.from('notification_logs').insert({
                booking_id: booking.id,
                recipient_phone: 'push-device',
                recipient_name: 'Patient App',
                event_type,
                channel: 'push',
                status: 'FAILED',
                message_content: message,
                provider_response: { error: ticket.message, details: ticket.details, token: tokenUsed },
                sent_at: new Date().toISOString(),
              });

              if (ticket.details?.error === 'DeviceNotRegistered') {
                await supabaseAdmin.rpc('remove_stale_push_token', { p_token: tokenUsed });
                staleTokensRemoved.push(tokenUsed);
              }
            }
          }
        }
      } catch (pushErr: any) {
        console.warn('Push delivery error:', pushErr);
      }
    }

    return NextResponse.json({
      success: true,
      booking_id,
      event_type,
      tokens_targeted: validTokens.length,
      push_results: pushResults,
      stale_tokens_removed: staleTokensRemoved,
      notification: { title, body: message },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
