// Supabase Edge Function: release-expired-holds
// Cron-triggered function to sweep and release holds older than 5 minutes.
// Internal-only function: restricted to service_role or internal cron secret.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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
    'Vary': 'Origin',
  };
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    // Require CRON_SECRET or service_role key in Authorization header
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    const cronSecret = Deno.env.get('CRON_SECRET');

    const isAuthorized =
      (token && token === supabaseServiceKey) ||
      (cronSecret && token === cronSecret);

    if (!token || !isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Valid CRON_SECRET or service role key required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase.rpc('release_expired_holds');

    if (error) {
      throw new Error(error.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        result: data,
        executed_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Release holds error';
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
