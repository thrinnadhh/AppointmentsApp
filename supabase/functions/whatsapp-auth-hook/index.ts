// Supabase Edge Function: whatsapp-auth-hook
// Handles Supabase Auth "Send SMS" webhook hook.
// Sends WhatsApp authentication code via Meta Graph API using template 'auth_code'.
// Hardened with Standard Webhooks signature verification, strict rate limiting,
// 60-second resend cooldown, phone masking, and sensitive data redaction.
// Feature Flag: Default OFF (controlled via ENABLE_WHATSAPP_AUTH_HOOK).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

/** Mask all but last 4 digits of phone number */
function maskPhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/.(?=.{4})/g, '*');
}

/** Verify Standard Webhook signature (webhook-id, webhook-timestamp, webhook-signature) */
async function verifyStandardWebhook(
  rawBody: string,
  headers: Headers,
  secret: string
): Promise<boolean> {
  const webhookId = headers.get('webhook-id');
  const webhookTimestamp = headers.get('webhook-timestamp');
  const webhookSignature = headers.get('webhook-signature');

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return false;
  }

  // Prevent replay attacks: check timestamp within 5-minute tolerance
  const timestampNum = parseInt(webhookTimestamp, 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (isNaN(timestampNum) || Math.abs(nowSeconds - timestampNum) > 300) {
    return false;
  }

  const toSign = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const encoder = new TextEncoder();

  let secretBytes: Uint8Array;
  try {
    if (secret.startsWith('whsec_')) {
      const b64 = secret.slice(6);
      const binStr = atob(b64);
      secretBytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) {
        secretBytes[i] = binStr.charCodeAt(i);
      }
    } else {
      secretBytes = encoder.encode(secret);
    }
  } catch {
    secretBytes = encoder.encode(secret);
  }

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(toSign));
  const base64Sig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

  // Parse signatures from header: e.g. "v1,abc v1,def"
  const signatures = webhookSignature.split(' ').map((s) => {
    const parts = s.split(',');
    return parts.length > 1 ? parts[1] : parts[0];
  });

  return signatures.some((sig) => {
    if (sig.length !== base64Sig.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) {
      diff |= sig.charCodeAt(i) ^ base64Sig.charCodeAt(i);
    }
    return diff === 0;
  });
}

Deno.serve(async (req: Request) => {
  // Feature flag check: default OFF
  const isEnabled = Deno.env.get('ENABLE_WHATSAPP_AUTH_HOOK') === 'true';

  if (!isEnabled) {
    console.log('[whatsapp-auth-hook] Feature flag ENABLE_WHATSAPP_AUTH_HOOK is OFF. Hook execution disabled.');
    return new Response(
      JSON.stringify({ error: "We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again." }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const rawBody = await req.text();

  // ── 1. Standard Webhooks Signature Verification ───────────────────────────
  const hookSecret = Deno.env.get('SEND_SMS_HOOK_SECRET');
  if (hookSecret) {
    const isValid = await verifyStandardWebhook(rawBody, req.headers, hookSecret);
    if (!isValid) {
      console.warn('[whatsapp-auth-hook] ⚠️ Invalid Standard Webhooks signature. Rejecting payload.');
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid webhook signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    console.warn('[whatsapp-auth-hook] Notice: SEND_SMS_HOOK_SECRET not set in environment.');
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Supabase Auth Send SMS hook schema: user.phone and sms.otp
  const rawPhone = payload?.user?.phone;
  const otpCode = payload?.sms?.otp;

  if (!rawPhone || !otpCode) {
    return new Response(
      JSON.stringify({ error: "We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again." }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Phone normalization: 91XXXXXXXXXX
  const normalizedDigits = String(rawPhone).replace(/\D/g, '');
  let phone = normalizedDigits;
  if (phone.length === 10) {
    phone = '91' + phone;
  } else if (phone.length === 11 && phone.startsWith('0')) {
    phone = '91' + phone.slice(1);
  }

  const maskedPhone = maskPhone(phone);

  if (!/^91\d{10}$/.test(phone)) {
    console.warn(`[whatsapp-auth-hook] Invalid phone format: ${maskedPhone}`);
    return new Response(
      JSON.stringify({ error: "We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again." }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[whatsapp-auth-hook] Database configuration missing.');
    return new Response(
      JSON.stringify({ error: "We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again." }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ── 2. Resend Cooldown Enforcement (60 seconds) ───────────────────────────
  const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: recentAttempts } = await supabase
    .from('notification_logs')
    .select('id')
    .eq('recipient_phone', phone)
    .eq('event_type', 'AUTH_CODE')
    .gt('created_at', sixtySecondsAgo)
    .limit(1);

  if (recentAttempts && recentAttempts.length > 0) {
    console.warn(`[whatsapp-auth-hook] Cooldown triggered for ${maskedPhone}`);
    return new Response(
      JSON.stringify({ error: 'Please wait 60 seconds before requesting another code.' }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } }
    );
  }

  // ── 3. Meta API Dispatch (UNVERIFIED Meta authentication template shape) ─
  const waAccessToken = Deno.env.get('WA_ACCESS_TOKEN');
  const waPhoneId = Deno.env.get('WA_PHONE_NUMBER_ID');
  const graphApiVersion = Deno.env.get('GRAPH_API_VERSION') || 'v21.0';

  if (!waAccessToken || !waPhoneId) {
    console.warn('[whatsapp-auth-hook] Meta WhatsApp credentials missing.');
    return new Response(
      JSON.stringify({ error: "We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again." }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const metaUrl = `https://graph.facebook.com/${graphApiVersion}/${waPhoneId}/messages`;
  // Shape: Authentication template with body and URL button parameters
  const metaPayload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: 'auth_code',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: otpCode }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: otpCode }],
        },
      ],
    },
  };

  try {
    console.log(`[whatsapp-auth-hook] Sending authentication code to ${maskedPhone}...`);
    const metaRes = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${waAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metaPayload),
    });

    if (!metaRes.ok) {
      const errBody = await metaRes.json().catch(() => ({}));
      console.warn('[whatsapp-auth-hook] Meta API error:', JSON.stringify(errBody));

      // Record failure audit (REDACT code)
      await supabase.from('notification_logs').insert({
        booking_id: null,
        recipient_phone: phone,
        recipient_name: 'Customer',
        event_type: 'AUTH_CODE',
        channel: 'whatsapp',
        status: 'FAILED',
        template_name: 'auth_code',
        template_params: ['[redacted]'],
        last_error: JSON.stringify(errBody),
        message_content: 'WhatsApp authentication code dispatch failed [redacted]',
        attempts: 1,
      });

      return new Response(
        JSON.stringify({ error: "We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again." }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const respData = await metaRes.json();
    const messageId = respData?.messages?.[0]?.id || `wa_auth_${Date.now()}`;

    // Record success audit (REDACT code)
    await supabase.from('notification_logs').insert({
      booking_id: null,
      recipient_phone: phone,
      recipient_name: 'Customer',
      event_type: 'AUTH_CODE',
      channel: 'whatsapp',
      status: 'SENT',
      provider_message_id: messageId,
      template_name: 'auth_code',
      template_params: ['[redacted]'],
      message_content: 'WhatsApp authentication code successfully sent [redacted]',
      sent_at: new Date().toISOString(),
      attempts: 1,
    });

    console.log(`[whatsapp-auth-hook] Successfully delivered code to ${maskedPhone} (ID: ${messageId})`);

    // Supabase Auth expects 200 with {} on success
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Meta dispatch exception';
    console.error('[whatsapp-auth-hook] Exception:', errorMsg);

    return new Response(
      JSON.stringify({ error: "We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again." }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
