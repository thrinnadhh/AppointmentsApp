/**
 * generate-invoice/index.ts
 *
 * Supabase Edge Function — generates a booking receipt/invoice after payment confirmation.
 * Enforces caller authentication (JWT verification via auth.getUser) and ownership check
 * (customer, authorized venue merchant, or platform admin).
 *
 * Returns JSON invoice data and masks customer PII appropriately.
 *
 * Compliance:
 *  - Consumer Protection (E-Commerce) Rules 2020: receipt must include itemised charges
 *  - DPDP Act 2023: Strict caller authorization & PII minimization
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

function maskCustomerPhone(phone?: string | null): string {
  if (!phone || typeof phone !== 'string') return 'Not provided';
  const trimmed = phone.trim();
  if (!trimmed || trimmed.toLowerCase() === 'not provided') return 'Not provided';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6) return 'Not provided';
  return '*'.repeat(digits.length - 3) + digits.slice(-3);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── 0. Require & Verify Authorization JWT ──────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization header is required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    let isInternalServiceRole = token === supabaseServiceKey;
    let user: any = null;

    if (!isInternalServiceRole) {
      const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !authUser) {
        return new Response(JSON.stringify({ error: 'Invalid or expired session token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      user = authUser;
    }

    const payload: InvoicePayload = await req.json();
    const { booking_id } = payload;

    if (!booking_id) {
      return new Response(JSON.stringify({ error: 'booking_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 1. Authorization Ownership Check ──────────────────────────────────────
    const { data: bookingCheck, error: checkErr } = await supabase
      .from('bookings')
      .select('id, customer_id, provider_id')
      .eq('id', booking_id)
      .maybeSingle();

    if (checkErr || !bookingCheck) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller is customer, admin, authorized provider merchant, or service_role
    let isAuthorized = isInternalServiceRole || (user && user.id === bookingCheck.customer_id);

    if (!isAuthorized && user) {
      const { data: isAdmin } = await supabase.rpc('is_admin', { p_user_id: user.id });
      if (isAdmin) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized && user) {
      const { data: allowedProviders } = await supabase.rpc('get_user_authorized_providers', { p_user_id: user.id });
      if (Array.isArray(allowedProviders) && allowedProviders.includes(bookingCheck.provider_id)) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Access denied: You are not authorized to view invoices for this booking' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 2. Generate invoice number (idempotent) ───────────────────────────────
    const { data: invoiceNum, error: invErr } = await supabase
      .rpc('generate_invoice_number', { p_booking_id: booking_id });

    if (invErr) {
      console.error('[generate-invoice] invoice RPC error:', invErr);
      return new Response(JSON.stringify({ error: 'Invoice number generation failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 3. Compute GST (no-op if gst_active = false) ─────────────────────────
    await supabase.rpc('compute_gst_for_booking', { p_booking_id: booking_id });

    // ── 4. Fetch full booking details for receipt ─────────────────────────────
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

    // ── 5. Fetch platform config (GSTIN, platform name, etc.) ────────────────
    const { data: configs } = await supabase
      .from('platform_config')
      .select('key, value')
      .in('key', ['gstin', 'gst_active', 'platform_name', 'support_email']);

    const config: Record<string, string> = {};
    (configs ?? []).forEach((c: { key: string; value: string }) => { config[c.key] = c.value; });

    const gstActive = config['gst_active'] === 'true';

    // ── 6. Build invoice object ───────────────────────────────────────────────
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
        phone: maskCustomerPhone((booking.profiles as any)?.phone),
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
    const message = err instanceof Error ? err.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
