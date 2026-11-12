-- Migration: 20261105100002_vault_secret_placeholders.sql
-- Description: Registers required secret placeholder names in Supabase Vault.
--              Each secret is created ONLY if absent, using 'REPLACE_ME' as placeholder.
--              NO real secret values are written to migrations or code.

DO $$
BEGIN
  -- 1. Razorpay API Key Secret (used for server-side refund initiation & signature verification)
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'razorpay_key_secret') THEN
    PERFORM vault.create_secret(
      'REPLACE_ME',
      'razorpay_key_secret',
      'Razorpay API Key Secret for server-side payment verification and refunds'
    );
  END IF;

  -- 2. Razorpay Webhook Secret (used for HMAC signature validation on gateway webhooks)
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'razorpay_webhook_secret') THEN
    PERFORM vault.create_secret(
      'REPLACE_ME',
      'razorpay_webhook_secret',
      'Razorpay Webhook HMAC signing secret'
    );
  END IF;

  -- 3. Internal Webhook Secret (used for DB pg_net triggers -> Edge Function authorization)
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'internal_webhook_secret') THEN
    PERFORM vault.create_secret(
      'REPLACE_ME',
      'internal_webhook_secret',
      'Shared secret for DB trigger -> edge function authorization header'
    );
  END IF;

  -- 4. Expo Push Access Token (used when Expo Enhanced Push Security is enabled)
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'expo_push_access_token') THEN
    PERFORM vault.create_secret(
      'REPLACE_ME',
      'expo_push_access_token',
      'Expo push notification enhanced security access token'
    );
  END IF;

  -- 5. Edge Functions Base URL (e.g. http://127.0.0.1:54321/functions/v1 or https://<ref>.supabase.co/functions/v1)
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'edge_functions_base_url') THEN
    PERFORM vault.create_secret(
      'REPLACE_ME',
      'edge_functions_base_url',
      'Base URL for Supabase Edge Functions invoked by pg_net database triggers'
    );
  END IF;
END $$;

-- 6. Helper function to allow service_role to securely query decrypted secret by name
CREATE OR REPLACE FUNCTION public.get_vault_secret_by_name(p_secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'pg_temp'
AS $$
DECLARE
  v_secret text;
BEGIN
  IF auth.role() <> 'service_role' AND CURRENT_USER <> 'postgres' AND SESSION_USER <> 'postgres' THEN
    RAISE EXCEPTION 'Access denied: only service_role can read vault secrets';
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = p_secret_name
  LIMIT 1;

  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vault_secret_by_name(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.get_vault_secret_by_name(text) TO service_role;

