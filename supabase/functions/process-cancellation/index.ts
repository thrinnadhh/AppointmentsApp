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

    // 2. Delegate to cancel_booking RPC for atomic strike tracking and policy compliance
    const { data: rpcResult, error: rpcError } = await supabase.rpc('cancel_booking', {
      p_booking_id: booking_id,
      p_reason: reason || 'Processed by Edge Function',
      p_initiated_by: initiated_by,
    });

    if (rpcError) {
      throw new Error(rpcError.message);
    }

    if (!rpcResult?.success) {
      return new Response(
        JSON.stringify({ success: false, error: rpcResult?.error || 'Cancellation failed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    return new Response(
      JSON.stringify(rpcResult),
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
