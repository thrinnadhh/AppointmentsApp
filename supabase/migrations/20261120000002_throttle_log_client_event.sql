-- Migration: 20261120000002_throttle_log_client_event.sql
-- Vulnerability: SEC-WIN-012 (Medium)
-- Purpose: Throttle anon log_client_event calls and tighten payload length caps to prevent DB flooding

CREATE OR REPLACE FUNCTION private.log_client_event(
  p_platform text,
  p_level text,
  p_message text,
  p_component text DEFAULT NULL::text,
  p_stack_trace text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT NULL::jsonb,
  p_device_info jsonb DEFAULT NULL::jsonb,
  p_session_id text DEFAULT NULL::text,
  p_severity text DEFAULT NULL::text,
  p_category text DEFAULT NULL::text,
  p_source text DEFAULT NULL::text,
  p_error_code text DEFAULT NULL::text,
  p_role text DEFAULT NULL::text,
  p_city_id text DEFAULT NULL::text,
  p_vertical text DEFAULT NULL::text,
  p_appointment_id text DEFAULT NULL::text,
  p_app_version text DEFAULT NULL::text,
  p_platform_os text DEFAULT NULL::text,
  p_device_model text DEFAULT NULL::text,
  p_environment text DEFAULT NULL::text,
  p_fingerprint text DEFAULT NULL::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_actual_role text;
  v_capped_msg text;
  v_capped_stack text;
  v_capped_meta jsonb;
  v_new_id uuid;
  v_anon_count int;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_actual_role FROM public.profiles WHERE id = auth.uid();
    v_capped_msg := substr(COALESCE(p_message, 'No message provided'), 1, 2000);
    IF p_stack_trace IS NOT NULL THEN
      v_capped_stack := substr(p_stack_trace, 1, 8192);
    END IF;
    IF p_metadata IS NOT NULL THEN
      IF length(p_metadata::text) > 8192 THEN
        v_capped_meta := jsonb_build_object(
          '_truncated', true,
          'summary', substr(p_metadata::text, 1, 8000)
        );
      ELSE
        v_capped_meta := p_metadata;
      END IF;
    ELSE
      v_capped_meta := '{}'::jsonb;
    END IF;
  ELSE
    v_actual_role := 'anon';

    -- Rate limiting for unauthenticated anon log calls (max 30 events / minute per session or fingerprint)
    IF p_session_id IS NOT NULL OR p_fingerprint IS NOT NULL THEN
      SELECT count(*) INTO v_anon_count
      FROM public.app_logs
      WHERE created_at > (now() - interval '1 minute')
        AND role = 'anon'
        AND (
          (p_session_id IS NOT NULL AND session_id = p_session_id)
          OR
          (p_fingerprint IS NOT NULL AND fingerprint = p_fingerprint)
        );

      IF v_anon_count >= 30 THEN
        RAISE EXCEPTION 'Anon client logging rate limit exceeded (max 30/min)'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- Tighter caps for anonymous logs
    v_capped_msg := substr(COALESCE(p_message, 'No message provided'), 1, 500);
    IF p_stack_trace IS NOT NULL THEN
      v_capped_stack := substr(p_stack_trace, 1, 1024);
    END IF;
    IF p_metadata IS NOT NULL THEN
      IF length(p_metadata::text) > 1024 THEN
        v_capped_meta := jsonb_build_object(
          '_truncated', true,
          'summary', substr(p_metadata::text, 1, 1000)
        );
      ELSE
        v_capped_meta := p_metadata;
      END IF;
    ELSE
      v_capped_meta := '{}'::jsonb;
    END IF;
  END IF;

  INSERT INTO public.app_logs (
    platform,
    level,
    message,
    component,
    stack_trace,
    metadata,
    device_info,
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
    fingerprint,
    user_id
  ) VALUES (
    COALESCE(p_platform, 'unknown'),
    COALESCE(p_level, 'info'),
    v_capped_msg,
    substr(p_component, 1, 200),
    v_capped_stack,
    v_capped_meta,
    p_device_info,
    substr(p_session_id, 1, 100),
    COALESCE(p_severity, 'INFO'),
    COALESCE(p_category, 'OTHER'),
    substr(p_source, 1, 100),
    substr(p_error_code, 1, 100),
    v_actual_role,
    substr(p_city_id, 1, 50),
    substr(p_vertical, 1, 50),
    substr(p_appointment_id, 1, 100),
    substr(p_app_version, 1, 50),
    substr(p_platform_os, 1, 50),
    substr(p_device_model, 1, 100),
    substr(p_environment, 1, 50),
    substr(p_fingerprint, 1, 100),
    auth.uid()
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RAISE;
  WHEN OTHERS THEN
    RETURN NULL;
END;
$function$;
