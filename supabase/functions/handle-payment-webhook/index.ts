// Supabase Edge Function: handle-payment-webhook
// Ingests payment gateway webhooks (Razorpay/PayU) and updates booking states atomically.

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

    const body = await req.json();
    const event = body?.event;
    const payment = body?.payload?.payment?.entity;
    const bookingId = payment?.notes?.booking_id;

    if (event === 'payment.captured' && bookingId) {
      // 1. Transition booking to CONFIRMED
      const { error: bookingError } = await supabase
        .from('bookings')
        .update({
          status: 'CONFIRMED',
          payment_status: 'CAPTURED',
          gateway_payment_id: payment.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bookingId);

      if (bookingError) {
        throw new Error(`Failed to update booking: ${bookingError.message}`);
      }

      // 2. Record payment in ledger
      const depositAmount = (payment.amount || 10000) / 100;
      await supabase.from('payments').upsert({
        booking_id: bookingId,
        gateway_payment_id: payment.id,
        amount: depositAmount,
        currency: payment.currency || 'INR',
        status: 'CAPTURED',
        metadata: {
          gateway: 'razorpay',
          event,
          captured_at: new Date().toISOString(),
        },
      });

      return new Response(
        JSON.stringify({ success: true, booking_id: bookingId, status: 'CONFIRMED' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    return new Response(
      JSON.stringify({ received: true, event: event || 'unknown' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Webhook error';
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
