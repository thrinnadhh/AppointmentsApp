/**
 * generate-invoice/index.ts
 *
 * Supabase Edge Function — generates a booking receipt/invoice after payment confirmation.
 * Triggered by handle-payment-webhook after a booking is marked CONFIRMED.
 *
 * Returns JSON invoice data and optionally dispatches receipt via the
 * send-booking-notification function.
 *
 * Compliance:
 *  - Consumer Protection (E-Commerce) Rules 2020: receipt must include itemised charges
 *  - GST: platform_fee_gst column included; GSTIN shown once registered
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InvoicePayload {
  booking_id: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const payload: InvoicePayload = await req.json();
    const { booking_id } = payload;

    if (!booking_id) {
      return new Response(JSON.stringify({ error: 'booking_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 1. Generate invoice number (idempotent) ───────────────────────────────
    const { data: invoiceNum, error: invErr } = await supabase
      .rpc('generate_invoice_number', { p_booking_id: booking_id });

    if (invErr) {
      console.error('[generate-invoice] invoice RPC error:', invErr);
      return new Response(JSON.stringify({ error: 'Invoice number generation failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 2. Compute GST (no-op if gst_active = false) ─────────────────────────
    await supabase.rpc('compute_gst_for_booking', { p_booking_id: booking_id });

    // ── 3. Fetch full booking details for receipt ─────────────────────────────
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select(`
        id,
        invoice_number,
        deposit_amount,
        platform_fee,
        platform_fee_gst,
        total_amount,
        status,
        payment_status,
        created_at,
        resources ( name, deposit_amount ),
        providers ( name, address, category_id ),
        profiles ( full_name, phone )
      `)
      .eq('id', booking_id)
      .single();

    if (bErr || !booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 4. Fetch platform config (GSTIN, platform name, etc.) ────────────────
    const { data: configs } = await supabase
      .from('platform_config')
      .select('key, value')
      .in('key', ['gstin', 'gst_active', 'platform_name', 'support_email']);

    const config: Record<string, string> = {};
    (configs ?? []).forEach((c: { key: string; value: string }) => { config[c.key] = c.value; });

    const gstActive = config['gst_active'] === 'true';

    // ── 5. Build invoice object ───────────────────────────────────────────────
    const depositAmount    = Number(booking.deposit_amount ?? 0);
    const platformFee      = Number(booking.platform_fee ?? 0);
    const platformFeeGst   = Number(booking.platform_fee_gst ?? 0);
    const totalCharged     = depositAmount + platformFee + platformFeeGst;

    const invoice = {
      invoice_number:   booking.invoice_number ?? invoiceNum,
      platform:         config['platform_name'] ?? 'Appointments4u',
      support_email:    config['support_email'] ?? 'support@appointments4u.in',
      gstin:            gstActive ? (config['gstin'] ?? null) : null,
      gst_note:         gstActive ? null : 'GST not applicable (pending registration)',
      issued_at:        new Date().toISOString(),
      booking: {
        id:             booking.id,
        status:         booking.status,
        payment_status: booking.payment_status,
        resource:       (booking.resources as any)?.name ?? 'Service',
        provider:       (booking.providers as any)?.name ?? 'Provider',
        provider_address: (booking.providers as any)?.address ?? '',
        booked_at:      booking.created_at,
      },
      customer: {
        name:  (booking.profiles as any)?.full_name ?? 'Customer',
        phone: (booking.profiles as any)?.phone ?? '',
      },
      charges: {
        deposit_amount:  depositAmount,
        deposit_note:    'Refundable — see Refund Policy at appointments4u.in/refund-policy',
        platform_fee:    platformFee,
        platform_fee_gst: platformFeeGst,
        gst_rate:        gstActive ? '18%' : 'N/A',
        total_charged:   totalCharged,
      },
      refund_policy_url: 'https://appointments4u.in/refund-policy',
      privacy_policy_url: 'https://appointments4u.in/privacy',
    };

    console.log(`[generate-invoice] Invoice ${invoice.invoice_number} generated for booking ${booking_id}`);

    return new Response(JSON.stringify({ success: true, invoice }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[generate-invoice] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
