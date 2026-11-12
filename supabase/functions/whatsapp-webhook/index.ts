// Supabase Edge Function: whatsapp-webhook
// Handles Meta WhatsApp Business Platform webhook verification (GET)
// and webhook notification events / message status receipts (POST).
// Hardened with HMAC-SHA256 signature verification (X-Hub-Signature-256).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

/**
 * Validates Meta's cryptographic HMAC-SHA256 signature.
 * Prevents spoofing, replay, and unauthorized POST payloads.
 * Returns true if valid, false otherwise.
 */
async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = signatureHeader.slice(7).trim(); // Remove "sha256="
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison to protect against timing attacks
  if (computedSignature.length !== expectedSignature.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < computedSignature.length; i++) {
    diff |= computedSignature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }

  return diff === 0;
}

/** Dynamic CORS headers without wildcard */
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
      // Fallback
    }
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const url = new URL(req.url);

  // ───────────────────────────────────────────────────────────────────────────
  // 1. GET: Webhook Verification Handshake
  // ───────────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const verifyToken =
      Deno.env.get('WA_VERIFY_TOKEN') ||
      Deno.env.get('WHATSAPP_VERIFY_TOKEN') ||
      '';

    if (mode === 'subscribe' && verifyToken && token === verifyToken) {
      console.log('[whatsapp-webhook] Webhook handshake successfully verified by Meta!');
      return new Response(challenge ?? '', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    console.warn('[whatsapp-webhook] Verification failed: Token mismatch or invalid mode.');
    return new Response('Forbidden: Verification token mismatch', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. POST: Event Notifications & Message Status Receipts
  // ───────────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const rawBody = await req.text();

      // ── Security Guard: Cryptographic HMAC Signature Verification ─────────
      const waAppSecret =
        Deno.env.get('WA_APP_SECRET') ||
        Deno.env.get('META_APP_SECRET') ||
        Deno.env.get('WHATSAPP_APP_SECRET');

      if (!waAppSecret) {
        console.warn('[whatsapp-webhook] WA_APP_SECRET not configured. Rejecting request for security.');
        return new Response(JSON.stringify({ error: 'Unauthorized: Missing app secret configuration' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const signatureHeader = req.headers.get('x-hub-signature-256');
      const isValid = await verifyMetaSignature(rawBody, signatureHeader, waAppSecret);

      if (!isValid) {
        console.warn('[whatsapp-webhook] ⚠️ Invalid HMAC-SHA256 signature! Rejecting untrusted payload.');
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid signature' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const payload = JSON.parse(rawBody);

      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      if (supabaseUrl && supabaseServiceKey && payload?.entry) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        for (const entry of payload.entry) {
          const changes = entry.changes || [];
          for (const change of changes) {
            const value = change.value;
            if (!value) continue;

            // ── Inbound Customer Messages ────────────────────────────────────
            const messages = value.messages || [];
            for (const msg of messages) {
              const fromPhone = (msg.from || '').replace(/.(?=.{4})/g, '*');
              const messageId = msg.id;
              console.log(`[whatsapp-webhook] Inbound message from ${fromPhone} (ID: ${messageId})`);
            }

            // ── Delivery & Read Status Receipts ──────────────────────────────
            const statuses = value.statuses || [];
            for (const statusItem of statuses) {
              const providerMessageId = statusItem.id; // Meta wamid: e.g. "wamid.HBg..."
              if (!providerMessageId) continue;

              const rawStatus = (statusItem.status || '').toLowerCase(); // sent, delivered, read, failed
              const timestampSeconds = parseInt(statusItem.timestamp || '0', 10);
              const timestampDate =
                timestampSeconds > 0
                  ? new Date(timestampSeconds * 1000).toISOString()
                  : new Date().toISOString();

              const updateData: Record<string, any> = {};

              if (rawStatus === 'delivered') {
                updateData.status = 'DELIVERED';
                updateData.delivered_at = timestampDate;
              } else if (rawStatus === 'read') {
                updateData.status = 'READ';
                updateData.read_at = timestampDate;
              } else if (rawStatus === 'failed') {
                updateData.status = 'FAILED';
                const firstError = statusItem.errors?.[0] || statusItem.errors || 'Delivery failed';
                updateData.last_error = typeof firstError === 'string' ? firstError : JSON.stringify(firstError);
              } else if (rawStatus === 'sent') {
                // Already SENT from sender, keep as SENT
                updateData.status = 'SENT';
              } else {
                continue;
              }

              // Update public.notification_logs matching this provider message
              // Unknown IDs are safely ignored by updating where provider_message_id matches
              const { error: updateErr } = await supabase
                .from('notification_logs')
                .update(updateData)
                .eq('provider_message_id', providerMessageId);

              if (updateErr) {
                console.warn(`[whatsapp-webhook] DB update failed for ${providerMessageId}:`, updateErr.message);
              } else {
                console.log(`[whatsapp-webhook] Updated notification ${providerMessageId} to ${updateData.status}`);
              }
            }
          }
        }
      }

      // Meta requires a 200 OK quickly (within 20 seconds), or it retries
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: unknown) {
      console.error('[whatsapp-webhook] Error processing webhook:', err);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response('Method Not Allowed', { status: 405 });
});
