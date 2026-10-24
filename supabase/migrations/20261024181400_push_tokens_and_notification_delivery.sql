-- Migration: 20261024181400_push_tokens_and_notification_delivery.sql
-- Description: Creates dedicated push_tokens table with strict user isolation,
--              removal of stale tokens on delivery errors, and grants.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DEDICATED PUSH TOKENS TABLE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_push_token UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id 
  ON public.push_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_push_tokens_token 
  ON public.push_tokens(token);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.trg_push_tokens_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_push_tokens_updated_at ON public.push_tokens;
CREATE TRIGGER trg_set_push_tokens_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_push_tokens_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY: USERS CAN ONLY ACCESS OWN TOKENS (STAFF BLOCKED)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_tokens_select_own ON public.push_tokens;
CREATE POLICY push_tokens_select_own
  ON public.push_tokens
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS push_tokens_insert_own ON public.push_tokens;
CREATE POLICY push_tokens_insert_own
  ON public.push_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_tokens_update_own ON public.push_tokens;
CREATE POLICY push_tokens_update_own
  ON public.push_tokens
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_tokens_delete_own ON public.push_tokens;
CREATE POLICY push_tokens_delete_own
  ON public.push_tokens
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Explicitly revoke and grant permissions
REVOKE ALL ON public.push_tokens FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;
GRANT ALL ON public.push_tokens TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. STALE TOKEN REMOVAL PROCEDURE (e.g., DeviceNotRegistered)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.remove_stale_push_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_count INTEGER := 0;
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token is required');
  END IF;

  -- 1. Delete from dedicated push_tokens table
  DELETE FROM public.push_tokens
  WHERE token = trim(p_token);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- 2. Clear legacy profile token if matching
  UPDATE public.profiles
  SET expo_push_token = NULL,
      updated_at = NOW()
  WHERE expo_push_token = trim(p_token);

  RETURN jsonb_build_object(
    'success', true,
    'token', trim(p_token),
    'deleted_count', v_deleted_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_stale_push_token(TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.remove_stale_push_token(TEXT) TO authenticated, service_role;
