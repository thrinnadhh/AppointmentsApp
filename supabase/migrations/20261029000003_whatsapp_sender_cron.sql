-- Migration: 20261029000003_whatsapp_sender_cron.sql
-- Description: Schedule whatsapp-sender queue worker via pg_cron + pg_net every minute.
-- Reads Supabase URL and service role key securely from vault or DB settings (not hardcoded).

CREATE OR REPLACE FUNCTION public.trigger_whatsapp_sender_cron()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_edge_function_url TEXT;
BEGIN
  -- 1. Try reading from vault if available
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets') THEN
    SELECT decrypted_secret INTO v_supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
    SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  END IF;

  -- 2. Fallback to current database settings (app.settings.supabase_url / app.settings.service_role_key)
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    v_supabase_url := current_setting('app.settings.supabase_url', true);
  END IF;
  IF v_service_key IS NULL OR v_service_key = '' THEN
    v_service_key := current_setting('app.settings.service_role_key', true);
  END IF;

  -- If neither vault nor settings are configured, skip network dispatch safely
  IF v_supabase_url IS NULL OR v_supabase_url = '' OR v_service_key IS NULL OR v_service_key = '' THEN
    RETURN;
  END IF;

  v_edge_function_url := rtrim(v_supabase_url, '/') || '/functions/v1/whatsapp-sender';

  -- Trigger whatsapp-sender via pg_net
  PERFORM net.http_post(
    url := v_edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key,
      'apikey', v_service_key
    ),
    body := '{"source":"cron"}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_whatsapp_sender_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_whatsapp_sender_cron() TO service_role;

-- Schedule with pg_cron every minute
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-whatsapp-queue') THEN
    PERFORM cron.unschedule('process-whatsapp-queue');
  END IF;
  PERFORM cron.schedule(
    'process-whatsapp-queue',
    '* * * * *',
    'SELECT public.trigger_whatsapp_sender_cron();'
  );
END $$;
