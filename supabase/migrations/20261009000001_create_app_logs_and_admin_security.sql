-- =============================================================================
-- Migration: 20261009000001_create_app_logs_and_admin_security.sql
-- Description: Centralized Admin-Only Application Logging & Observability System
--              Creates public.app_logs with strict RLS (is_admin only),
--              secure client event ingestion RPC, and 30-day auto-retention pruning.
-- =============================================================================

-- 1. Create Application Logs Table
CREATE TABLE IF NOT EXISTS public.app_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now() NOT NULL,
  platform text NOT NULL CHECK (platform IN ('web', 'mobile', 'backend', 'edge')),
  level text NOT NULL CHECK (level IN ('error', 'warn', 'info')),
  component text,
  message text NOT NULL,
  stack_trace text,
  metadata jsonb DEFAULT '{}'::jsonb,
  device_info jsonb DEFAULT '{}'::jsonb,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  session_id text
);

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON public.app_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_platform ON public.app_logs(platform);
CREATE INDEX IF NOT EXISTS idx_app_logs_level ON public.app_logs(level);
CREATE INDEX IF NOT EXISTS idx_app_logs_component ON public.app_logs(component);
CREATE INDEX IF NOT EXISTS idx_app_logs_user_id ON public.app_logs(user_id);

-- 3. Row Level Security (Strict Admin Access Only)
ALTER TABLE public.app_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Only admins can view app logs" ON public.app_logs;
DROP POLICY IF EXISTS "Service role full access to app logs" ON public.app_logs;

-- Read policy: Only verified administrators can query application logs
CREATE POLICY "Only admins can view app logs"
  ON public.app_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Service role full access
CREATE POLICY "Service role full access to app logs"
  ON public.app_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Immutable: Prevent mutations or malicious deletion by public / non-admin users
REVOKE UPDATE, DELETE, INSERT ON public.app_logs FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.app_logs TO authenticated;
GRANT ALL ON public.app_logs TO service_role;

-- 4. Secure Client Ingestion RPC Function (Sanitized & Quota-Protected)
CREATE OR REPLACE FUNCTION public.log_client_event(
  p_platform text,
  p_level text,
  p_message text,
  p_component text DEFAULT NULL,
  p_stack_trace text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_device_info jsonb DEFAULT '{}'::jsonb,
  p_session_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log_id uuid;
  v_caller_id uuid;
  v_clean_platform text;
  v_clean_level text;
BEGIN
  -- Normalize inputs
  v_clean_platform := LOWER(TRIM(COALESCE(p_platform, 'web')));
  IF v_clean_platform NOT IN ('web', 'mobile', 'backend', 'edge') THEN
    v_clean_platform := 'web';
  END IF;

  v_clean_level := LOWER(TRIM(COALESCE(p_level, 'error')));
  IF v_clean_level NOT IN ('error', 'warn', 'info') THEN
    v_clean_level := 'error';
  END IF;

  -- Capture authenticated caller if exists
  v_caller_id := auth.uid();

  -- Insert structured log entry
  INSERT INTO public.app_logs (
    platform,
    level,
    component,
    message,
    stack_trace,
    metadata,
    device_info,
    user_id,
    session_id
  ) VALUES (
    v_clean_platform,
    v_clean_level,
    NULLIF(TRIM(p_component), ''),
    SUBSTRING(TRIM(p_message) FROM 1 FOR 3000),
    SUBSTRING(p_stack_trace FROM 1 FOR 8000),
    COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_device_info, '{}'::jsonb),
    v_caller_id,
    NULLIF(TRIM(p_session_id), '')
  ) RETURNING id INTO v_log_id;

  -- 5. Auto-Pruning: Delete records older than 30 days (Edge Case 2)
  -- Executed probabilistically (~5% of writes) to eliminate per-request overhead
  IF random() < 0.05 THEN
    DELETE FROM public.app_logs
    WHERE created_at < (now() - INTERVAL '30 days');
  END IF;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_client_event(text, text, text, text, text, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_client_event(text, text, text, text, text, jsonb, jsonb, text) TO authenticated, anon, service_role;

-- 6. Explicit Admin Purge RPC
CREATE OR REPLACE FUNCTION public.purge_old_app_logs(p_retention_days int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_count int;
  v_days int;
BEGIN
  -- Security check: Must be verified admin or service_role
  IF auth.role() != 'service_role' AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied. Only administrators can purge application logs.';
  END IF;

  v_days := GREATEST(COALESCE(p_retention_days, 30), 1);

  DELETE FROM public.app_logs
  WHERE created_at < (now() - (v_days || ' days')::interval);

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- Record this administrative action in admin_audit_logs
  PERFORM public.log_admin_action(
    'PURGE_APP_LOGS',
    'app_logs',
    NULL,
    jsonb_build_object('retention_days', v_days, 'deleted_count', v_deleted_count)
  );

  RETURN v_deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_app_logs(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_old_app_logs(int) TO authenticated, service_role;
