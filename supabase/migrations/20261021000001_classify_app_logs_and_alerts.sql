-- =============================================================================
-- Migration: 20261021000001_classify_app_logs_and_alerts.sql
-- Description: Non-destructive enhancement of public.app_logs to support:
--              1. Standardized severity (DEBUG, INFO, WARN, ERROR, CRITICAL)
--              2. Standardized category (AUTH, BOOKING, PAYMENT, etc.)
--              3. Standardized source (customer-mobile, merchant-web, etc.)
--              4. Diagnostics: error_code, fingerprint, app_version, env, platform_os
--              5. Business context: role, city_id, vertical, appointment_id
--              6. Auto-classification of CRITICAL events in log_client_event
--              7. Alert deduplication table and tiered retention policy
-- =============================================================================

-- 1. Non-destructively add classification columns to public.app_logs
ALTER TABLE public.app_logs
  ADD COLUMN IF NOT EXISTS severity text DEFAULT 'INFO',
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'OTHER',
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'merchant-web',
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS city_id text,
  ADD COLUMN IF NOT EXISTS vertical text,
  ADD COLUMN IF NOT EXISTS appointment_id text,
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS platform_os text,
  ADD COLUMN IF NOT EXISTS device_model text,
  ADD COLUMN IF NOT EXISTS environment text DEFAULT 'dev',
  ADD COLUMN IF NOT EXISTS fingerprint text;

-- Add check constraints if not present (handled safely)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_app_logs_severity'
  ) THEN
    ALTER TABLE public.app_logs
      ADD CONSTRAINT check_app_logs_severity
      CHECK (severity IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_app_logs_category'
  ) THEN
    ALTER TABLE public.app_logs
      ADD CONSTRAINT check_app_logs_category
      CHECK (category IN ('AUTH', 'BOOKING', 'PAYMENT', 'HOSPITAL_QUEUE', 'NOTIFICATION', 'DATABASE', 'NETWORK', 'UI_CRASH', 'SECURITY', 'OTHER'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_app_logs_environment'
  ) THEN
    ALTER TABLE public.app_logs
      ADD CONSTRAINT check_app_logs_environment
      CHECK (environment IN ('dev', 'test', 'prod'));
  END IF;
END $$;

-- 2. Performance and Query Indexes
CREATE INDEX IF NOT EXISTS idx_app_logs_severity ON public.app_logs(severity);
CREATE INDEX IF NOT EXISTS idx_app_logs_category ON public.app_logs(category);
CREATE INDEX IF NOT EXISTS idx_app_logs_source ON public.app_logs(source);
CREATE INDEX IF NOT EXISTS idx_app_logs_fingerprint ON public.app_logs(fingerprint);
CREATE INDEX IF NOT EXISTS idx_app_logs_appointment_id ON public.app_logs(appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_logs_city_id ON public.app_logs(city_id) WHERE city_id IS NOT NULL;

-- 3. Alert Deduplication Table (Protects Admin from Email Storms)
CREATE TABLE IF NOT EXISTS public.crash_alert_dedup (
  fingerprint text PRIMARY KEY,
  severity text NOT NULL,
  last_alerted_at timestamptz NOT NULL DEFAULT now(),
  occurrence_count int NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_message text,
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.crash_alert_dedup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins and service role view dedup" ON public.crash_alert_dedup;
CREATE POLICY "Admins and service role view dedup"
  ON public.crash_alert_dedup
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Service role full access dedup"
  ON public.crash_alert_dedup
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Enhanced Client Ingestion RPC Function (With Classification & Auto-CRITICAL Elevation)
-- Drop legacy 8-parameter overload to prevent PostgREST ambiguity error (PGRST203)
DROP FUNCTION IF EXISTS public.log_client_event(text, text, text, text, text, jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION public.log_client_event(
  p_platform text,
  p_level text,
  p_message text,
  p_component text DEFAULT NULL,
  p_stack_trace text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_device_info jsonb DEFAULT '{}'::jsonb,
  p_session_id text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_city_id text DEFAULT NULL,
  p_vertical text DEFAULT NULL,
  p_appointment_id text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_platform_os text DEFAULT NULL,
  p_device_model text DEFAULT NULL,
  p_environment text DEFAULT 'dev',
  p_fingerprint text DEFAULT NULL
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
  v_clean_severity text;
  v_clean_category text;
  v_clean_source text;
  v_computed_fingerprint text;
  v_top_stack text;
  v_clean_env text;
BEGIN
  -- Normalize legacy inputs
  v_clean_platform := LOWER(TRIM(COALESCE(p_platform, 'web')));
  IF v_clean_platform NOT IN ('web', 'mobile', 'backend', 'edge') THEN
    v_clean_platform := 'web';
  END IF;

  v_clean_level := LOWER(TRIM(COALESCE(p_level, 'info')));
  IF v_clean_level NOT IN ('error', 'warn', 'info') THEN
    v_clean_level := 'info';
  END IF;

  -- Normalize Severity
  v_clean_severity := UPPER(TRIM(COALESCE(p_severity, v_clean_level)));
  IF v_clean_severity NOT IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL') THEN
    IF v_clean_level = 'error' THEN v_clean_severity := 'ERROR';
    ELSIF v_clean_level = 'warn' THEN v_clean_severity := 'WARN';
    ELSE v_clean_severity := 'INFO';
    END IF;
  END IF;

  -- Normalize Category
  v_clean_category := UPPER(TRIM(COALESCE(p_category, 'OTHER')));
  IF v_clean_category NOT IN ('AUTH', 'BOOKING', 'PAYMENT', 'HOSPITAL_QUEUE', 'NOTIFICATION', 'DATABASE', 'NETWORK', 'UI_CRASH', 'SECURITY', 'OTHER') THEN
    v_clean_category := 'OTHER';
  END IF;

  -- Normalize Source
  v_clean_source := LOWER(TRIM(COALESCE(p_source, 
    CASE 
      WHEN v_clean_platform = 'mobile' THEN 'customer-mobile'
      WHEN v_clean_platform = 'web' THEN 'merchant-web'
      WHEN v_clean_platform = 'edge' THEN 'edge-function'
      ELSE 'merchant-web'
    END
  )));
  IF v_clean_source NOT IN ('customer-mobile', 'merchant-web', 'admin-web', 'edge-function', 'database') THEN
    v_clean_source := 'merchant-web';
  END IF;

  -- Normalize Environment
  v_clean_env := LOWER(TRIM(COALESCE(p_environment, 'dev')));
  IF v_clean_env NOT IN ('dev', 'test', 'prod') THEN
    v_clean_env := 'dev';
  END IF;

  -- Auto-assign CRITICAL Elevation
  -- Criteria: UI Crashes, Payment Failures, Deposit/Refund mismatches, RLS/Security Violations, Double-booking collisions, repeated Auth failures
  IF v_clean_category = 'UI_CRASH'
     OR v_clean_category = 'SECURITY'
     OR (v_clean_category = 'PAYMENT' AND v_clean_severity IN ('ERROR', 'WARN', 'CRITICAL'))
     OR (v_clean_category = 'BOOKING' AND (p_message ILIKE '%collision%' OR p_message ILIKE '%double-booking%' OR p_message ILIKE '%slot occupied%' OR p_message ILIKE '%concurrency%'))
     OR (v_clean_category = 'AUTH' AND (p_message ILIKE '%rate limit%' OR p_message ILIKE '%brute%' OR p_message ILIKE '%repeated%'))
     OR p_message ILIKE '%deposit%mismatch%'
     OR p_message ILIKE '%refund%mismatch%'
     OR p_message ILIKE '%RLS%denied%'
     OR p_message ILIKE '%security violation%'
     OR p_message ILIKE '%critical%' THEN
    v_clean_severity := 'CRITICAL';
    v_clean_level := 'error';
  END IF;

  -- Compute Fingerprint if missing: MD5(normalized_message + top_stack_frame)
  v_top_stack := SPLIT_PART(COALESCE(p_stack_trace, ''), E'\n', 1);
  v_computed_fingerprint := COALESCE(p_fingerprint, MD5(TRIM(p_message) || '::' || TRIM(v_top_stack)));

  -- Capture authenticated caller
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
    session_id,
    severity,
    category,
    source,
    error_code,
    role,
    city_id,
    vertical,
    appointment_id,
    app_version,
    platform_os,
    device_model,
    environment,
    fingerprint
  ) VALUES (
    v_clean_platform,
    v_clean_level,
    NULLIF(TRIM(p_component), ''),
    SUBSTRING(TRIM(p_message) FROM 1 FOR 3000),
    SUBSTRING(p_stack_trace FROM 1 FOR 8000),
    COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_device_info, '{}'::jsonb),
    COALESCE(p_metadata->>'user_id', v_caller_id::text)::uuid,
    NULLIF(TRIM(p_session_id), ''),
    v_clean_severity,
    v_clean_category,
    v_clean_source,
    NULLIF(TRIM(p_error_code), ''),
    NULLIF(TRIM(p_role), ''),
    NULLIF(TRIM(p_city_id), ''),
    NULLIF(TRIM(p_vertical), ''),
    NULLIF(TRIM(p_appointment_id), ''),
    NULLIF(TRIM(p_app_version), ''),
    NULLIF(TRIM(p_platform_os), ''),
    NULLIF(TRIM(p_device_model), ''),
    v_clean_env,
    v_computed_fingerprint
  ) RETURNING id INTO v_log_id;

  -- 5. Tiered Retention Pruning (Probabilistic 5% on write)
  -- DEBUG/INFO: deleted after 30 days
  -- WARN: deleted after 60 days
  -- ERROR/CRITICAL: kept for 180 days
  IF random() < 0.05 THEN
    DELETE FROM public.app_logs
    WHERE (severity IN ('DEBUG', 'INFO') AND created_at < (now() - INTERVAL '30 days'))
       OR (severity = 'WARN' AND created_at < (now() - INTERVAL '60 days'))
       OR (severity IN ('ERROR', 'CRITICAL') AND created_at < (now() - INTERVAL '180 days'));
  END IF;

  RETURN v_log_id;
EXCEPTION
  WHEN OTHERS THEN
    -- Invariant: Logging must NEVER abort the caller's transaction
    RETURN gen_random_uuid();
END;
$$;

-- Grant execution to all clients (secure RPC with sanitized inserts)
REVOKE ALL ON FUNCTION public.log_client_event(text, text, text, text, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_client_event(text, text, text, text, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text) TO authenticated, anon, service_role;

-- 6. Updated Admin Retention Purge Function (Respects Tiered Retentions)
CREATE OR REPLACE FUNCTION public.purge_old_app_logs(p_retention_days int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_count int;
BEGIN
  IF auth.role() != 'service_role' AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied. Only administrators can purge application logs.';
  END IF;

  DELETE FROM public.app_logs
  WHERE (severity IN ('DEBUG', 'INFO') AND created_at < (now() - (GREATEST(p_retention_days, 1) || ' days')::interval))
     OR (severity = 'WARN' AND created_at < (now() - INTERVAL '60 days'))
     OR (severity IN ('ERROR', 'CRITICAL') AND created_at < (now() - INTERVAL '180 days'));

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- Table permissions for service_role and backend processes
GRANT ALL ON TABLE public.crash_alert_dedup TO postgres, service_role;
GRANT ALL ON TABLE public.app_logs TO postgres, service_role;

