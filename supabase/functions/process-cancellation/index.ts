// Supabase Edge Function: process-cancellation
// Enforces 1-hour cancellation cutoff rule and triggers automated gateway refund.
// Authenticates caller (customer owner, authorized merchant, or admin).

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 0. Verify Authorization JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization header required' }), {
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

    const { booking_id, initiated_by = 'CUSTOMER', reason } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'booking_id is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // 1. Fetch booking to verify authorization
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, customer_id, provider_id, slot_start, deposit_amount, status, gateway_payment_id')
      .eq('id', booking_id)
      .single();

    if (fetchError || !booking) {
      return new Response(
        JSON.stringify({ success: false, error: 'Booking not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

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
        return new Response(
          JSON.stringify({ success: false, error: 'Access denied: You are not authorized to cancel this booking' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }
    }

    // 2. 1-Hour policy calculation
    const slotTime = new Date(booking.slot_start).getTime();
    const diffMinutes = Math.round((slotTime - Date.now()) / (1000 * 60));
    const isRefundEligible = initiated_by === 'MERCHANT' || diffMinutes > 60;
    const newPaymentStatus = isRefundEligible ? 'REFUNDED' : 'FORFEITED';

    // 3. Update booking status
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'CANCELLED',
        payment_status: newPaymentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking_id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    // 4. Update payment ledger
    if (booking.gateway_payment_id) {
      await supabase
        .from('payments')
        .update({
          status: newPaymentStatus,
          updated_at: new Date().toISOString(),
          metadata: {
            cancellation_reason: reason || 'Processed by Edge Function',
            initiated_by,
            refund_eligible: isRefundEligible,
            minutes_before_slot: diffMinutes,
          },
        })
        .eq('booking_id', booking_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        booking_id,
        status: 'CANCELLED',
        payment_status: newPaymentStatus,
        refund_eligible: isRefundEligible,
        refund_amount: isRefundEligible ? booking.deposit_amount : 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Cancellation error';
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
