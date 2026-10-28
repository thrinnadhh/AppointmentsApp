// Supabase Edge Function: whatsapp-sender
// Autonomous queue worker for Meta WhatsApp Business Platform.
// Claims up to 20 rows, validates registry contracts, calls Graph API,
// handles exponential retry backoff (1m, 5m, 15m), and updates notification_logs.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

/** Mask all but last 4 digits of phone number for safe logging */
function maskPhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/.(?=.{4})/g, '*');
}

/** Meta Template Parameter Registry Contract */
const TEMPLATE_PARAM_COUNTS: Record<string, number> = {
  booking_confirmed: 4,
  reminder_1h: 3,
  booking_cancelled: 3,
  refund_processed: 2,
  auth_code: 1,
};

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ success: false, error: 'Database service configuration missing' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. Claim up to 20 queued notifications using FOR UPDATE SKIP LOCKED RPC
    const { data: rows, error: claimError } = await supabase.rpc(
      'claim_queued_notifications',
      { p_limit: 20 }
    );

    if (claimError) {
      console.error('[whatsapp-sender] Error claiming queued notifications:', claimError.message);
      return new Response(
        JSON.stringify({ success: false, error: claimError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No queued notifications found' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[whatsapp-sender] Claimed ${rows.length} notifications for dispatch.`);

    const waAccessToken = Deno.env.get('WA_ACCESS_TOKEN');
    const waPhoneId = Deno.env.get('WA_PHONE_NUMBER_ID');
    const graphApiVersion = Deno.env.get('GRAPH_API_VERSION') || 'v21.0';

    const results = [];

    for (const row of rows) {
      const masked = maskPhone(row.recipient_phone || '');
      const templateName = row.template_name;
      const templateParams = Array.isArray(row.template_params)
        ? row.template_params
        : [];

      // ── Step A: Phone Number Validation ──────────────────────────────────
      const normalizedDigits = (row.recipient_phone || '').replace(/\D/g, '');
      if (!normalizedDigits || !/^91\d{10}$/.test(normalizedDigits)) {
        console.warn(`[whatsapp-sender] Invalid phone format for notification ${row.id}: ${masked}`);
        await supabase
          .from('notification_logs')
          .update({
            status: 'FAILED',
            last_error: 'Invalid recipient phone format: must be 91XXXXXXXXXX',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'FAILED', error: 'Invalid phone format' });
        continue;
      }

      // ── Step B: Template Registry Parameter Count Check ──────────────────
      const expectedCount = TEMPLATE_PARAM_COUNTS[templateName];
      if (expectedCount === undefined) {
        console.warn(`[whatsapp-sender] Unknown template name '${templateName}' for notification ${row.id}`);
        await supabase
          .from('notification_logs')
          .update({
            status: 'FAILED',
            last_error: `Unknown template: ${templateName}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'FAILED', error: 'Unknown template' });
        continue;
      }

      if (templateParams.length !== expectedCount) {
        const errMsg = `Parameter count mismatch for ${templateName}: expected ${expectedCount}, received ${templateParams.length}`;
        console.warn(`[whatsapp-sender] ${errMsg} for notification ${row.id}`);
        await supabase
          .from('notification_logs')
          .update({
            status: 'FAILED',
            last_error: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'FAILED', error: errMsg });
        continue;
      }

      // ── Step C: Check Missing or Empty Parameters ────────────────────────
      const hasEmptyParam = templateParams.some(
        (p: unknown) => typeof p !== 'string' || p.trim() === ''
      );
      if (hasEmptyParam) {
        const errMsg = `Template parameters contain empty or invalid string for ${templateName}`;
        console.warn(`[whatsapp-sender] ${errMsg} for notification ${row.id}`);
        await supabase
          .from('notification_logs')
          .update({
            status: 'FAILED',
            last_error: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'FAILED', error: errMsg });
        continue;
      }

      // ── Step D: Credential Verification ──────────────────────────────────
      if (!waAccessToken || !waPhoneId) {
        const notConfiguredMsg = 'NOT VERIFIED: needs WA_ACCESS_TOKEN and WA_PHONE_NUMBER_ID';
        console.warn(`[whatsapp-sender] Missing credentials: ${notConfiguredMsg}`);
        await supabase
          .from('notification_logs')
          .update({
            status: 'QUEUED',
            last_error: notConfiguredMsg,
            next_attempt_at: new Date(Date.now() + 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'SKIPPED_CREDENTIALS', error: notConfiguredMsg });
        continue;
      }

      // ── Step E: Meta Graph API Request ───────────────────────────────────
      const metaUrl = `https://graph.facebook.com/${graphApiVersion}/${waPhoneId}/messages`;
      const metaPayload = {
        messaging_product: 'whatsapp',
        to: normalizedDigits,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: templateParams.map((text: string) => ({
                type: 'text',
                text: String(text).slice(0, 100),
              })),
            },
          ],
        },
      };

      try {
        console.log(`[whatsapp-sender] Dispatching template '${templateName}' to ${masked}...`);
        const metaRes = await fetch(metaUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${waAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(metaPayload),
        });

        if (metaRes.ok) {
          const respData = await metaRes.json();
          const providerMsgId = respData?.messages?.[0]?.id || null;

          if (!providerMsgId) {
            throw new Error('Meta accepted message but returned no message id');
          }

          // Rule: Never mark a notification SENT unless Meta's API accepted it
          await supabase
            .from('notification_logs')
            .update({
              status: 'SENT',
              provider_message_id: providerMsgId,
              provider_response: respData,
              sent_at: new Date().toISOString(),
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);

          console.log(`[whatsapp-sender] Successfully sent ${row.id} with provider_message_id: ${providerMsgId}`);
          results.push({ id: row.id, status: 'SENT', provider_message_id: providerMsgId });
        } else {
          // Failure response from Meta API
          const errData = await metaRes.json().catch(() => ({ status: metaRes.status, statusText: metaRes.statusText }));
          const attempts = row.attempts || 1;
          const isFinalAttempt = attempts >= 3;

          console.warn(`[whatsapp-sender] Meta API error for ${row.id} (HTTP ${metaRes.status}, Attempt ${attempts}/3):`, JSON.stringify(errData));

          if (isFinalAttempt) {
            await supabase
              .from('notification_logs')
              .update({
                status: 'FAILED',
                last_error: JSON.stringify(errData),
                updated_at: new Date().toISOString(),
              })
              .eq('id', row.id);

            results.push({ id: row.id, status: 'FAILED', error: errData });
          } else {
            // Exponential backoff: 1 minute after attempt 1, 5 minutes after attempt 2, 15 minutes after attempt 3
            const backoffMinutes = [1, 5, 15][attempts - 1] ?? 15;
            const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

            await supabase
              .from('notification_logs')
              .update({
                status: 'QUEUED',
                next_attempt_at: nextAttemptAt,
                last_error: JSON.stringify(errData),
                updated_at: new Date().toISOString(),
              })
              .eq('id', row.id);

            results.push({ id: row.id, status: 'RETRY_QUEUED', next_attempt_at: nextAttemptAt, attempt: attempts });
          }
        }
      } catch (networkErr: unknown) {
        const errMessage = networkErr instanceof Error ? networkErr.message : 'Network fetch error';
        const attempts = row.attempts || 1;
        const isFinalAttempt = attempts >= 3;

        console.error(`[whatsapp-sender] Network exception dispatching ${row.id}:`, errMessage);

        if (isFinalAttempt) {
          await supabase
            .from('notification_logs')
            .update({
              status: 'FAILED',
              last_error: errMessage,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);

          results.push({ id: row.id, status: 'FAILED', error: errMessage });
        } else {
          const backoffMinutes = [1, 5, 15][attempts - 1] ?? 15;
          const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

          await supabase
            .from('notification_logs')
            .update({
              status: 'QUEUED',
              next_attempt_at: nextAttemptAt,
              last_error: errMessage,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);

          results.push({ id: row.id, status: 'RETRY_QUEUED', next_attempt_at: nextAttemptAt, attempt: attempts });
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, details: results }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Internal worker error';
    console.error('[whatsapp-sender] Unhandled worker failure:', errorMsg);
    return new Response(
      JSON.stringify({ success: false, error: errorMsg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
