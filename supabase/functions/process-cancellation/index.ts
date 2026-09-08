// Supabase Edge Function: process-cancellation
// Enforces 1-hour cancellation cutoff rule and triggers automated gateway refund.

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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { booking_id, initiated_by = 'CUSTOMER', reason } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'booking_id is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // 1. Fetch booking
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, slot_start, deposit_amount, status, gateway_payment_id')
      .eq('id', booking_id)
      .single();

    if (fetchError || !booking) {
      return new Response(
        JSON.stringify({ success: false, error: 'Booking not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
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
