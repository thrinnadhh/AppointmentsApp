-- =============================================================================
-- Migration: 20261026000001_security_hardening_grants_and_clean_overloads.sql
-- Description:
--   1. Grant table privileges on public.payments to service_role and authenticated.
--      service_role needs SELECT, INSERT, UPDATE for webhook payment logging,
--      idempotency verification, and refund recording.
--      authenticated needs SELECT so users can read their own payments via RLS.
--   2. Clean up ambiguous custom function overloads for hospital_role and
--      hospital_accessible_resource_ids. Drops the 1-argument wrapper functions
--      and sets `p_user_id UUID DEFAULT auth.uid()` on the single canonical
--      functions, resolving PostgREST overload ambiguity while maintaining full
--      backward compatibility for both 1-argument and 2-argument callers.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table Grants on public.payments
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.payments TO service_role;
GRANT SELECT ON public.payments TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop 1-Argument Overload Wrappers
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.hospital_role(UUID);
DROP FUNCTION IF EXISTS public.hospital_accessible_resource_ids(UUID);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Canonical hospital_role with default p_user_id = auth.uid()
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hospital_role(
  p_provider_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := COALESCE(p_user_id, auth.uid());
  v_category TEXT;
  v_dept_status TEXT;
  v_has_assignment BOOLEAN;
  v_is_consultant BOOLEAN := FALSE;
  v_user_email TEXT;
  v_email_confirmed BOOLEAN := FALSE;
BEGIN
  IF v_caller_id IS NULL OR p_provider_id IS NULL THEN
    RETURN 'none';
  END IF;

  -- 1. Strictly verify hospital/clinic vertical
  SELECT category_id INTO v_category
  FROM public.providers
  WHERE id = p_provider_id;

  IF NOT FOUND OR v_category IS NULL THEN
    RETURN 'none';
  END IF;

  IF NOT (
    v_category = 'clinics'
    OR v_category = 'hospital'
    OR v_category ILIKE '%clinic%'
    OR v_category ILIKE '%hospital%'
  ) THEN
    RETURN 'none';
  END IF;

  -- 2. Hospital Administrator Check
  IF public.is_admin(v_caller_id) THEN
    RETURN 'admin';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.providers
    WHERE id = p_provider_id AND owner_id = v_caller_id
  ) THEN
    RETURN 'admin';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.merchant_memberships
    WHERE provider_id = p_provider_id
      AND user_id = v_caller_id
      AND role IN ('admin', 'owner')
  ) THEN
    RETURN 'admin';
  END IF;

  -- 3. Check Department Membership status (if registered in department_members)
  SELECT status INTO v_dept_status
  FROM public.department_members
  WHERE merchant_id = p_provider_id
    AND user_id = v_caller_id
  ORDER BY (status = 'active') DESC, created_at DESC
  LIMIT 1;

  IF v_dept_status = 'revoked' THEN
    RETURN 'none';
  END IF;

  -- Get email and confirmed status for v_caller_id
  SELECT email, (email_confirmed_at IS NOT NULL)
  INTO v_user_email, v_email_confirmed
  FROM auth.users
  WHERE id = v_caller_id;

  -- 4. Consultant Check
  SELECT TRUE INTO v_is_consultant
  FROM public.resources r
  WHERE r.provider_id = p_provider_id
    AND (
      r.user_id = v_caller_id
      OR (
        (r.attributes->>'user_id') IS NOT NULL
        AND (r.attributes->>'user_id')::uuid = v_caller_id
      )
      OR (
        r.attributes->>'email' IS NOT NULL
        AND v_user_email IS NOT NULL
        AND lower(trim(r.attributes->>'email')) = lower(trim(v_user_email))
        AND v_email_confirmed IS TRUE
      )
    )
  LIMIT 1;

  IF v_is_consultant IS TRUE THEN
    RETURN 'consultant';
  END IF;

  -- 5. Front Desk Check
  IF v_dept_status = 'active' THEN
    SELECT TRUE INTO v_has_assignment
    FROM public.doctor_front_desk_assignments
    WHERE provider_id = p_provider_id
      AND user_id = v_caller_id
    LIMIT 1;

    IF v_has_assignment IS TRUE THEN
      RETURN 'front_desk';
    END IF;
  END IF;

  RETURN 'none';
END;
$$;

REVOKE ALL ON FUNCTION public.hospital_role(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_role(UUID, UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Canonical hospital_accessible_resource_ids with default p_user_id = auth.uid()
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hospital_accessible_resource_ids(
  p_provider_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS SETOF UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := COALESCE(p_user_id, auth.uid());
  v_role TEXT;
  v_user_email TEXT;
  v_email_confirmed BOOLEAN := FALSE;
BEGIN
  IF v_caller_id IS NULL OR p_provider_id IS NULL THEN
    RETURN;
  END IF;

  v_role := public.hospital_role(p_provider_id, v_caller_id);

  IF v_role = 'admin' THEN
    RETURN QUERY
      SELECT r.id
      FROM public.resources r
      WHERE r.provider_id = p_provider_id;

  ELSIF v_role = 'front_desk' THEN
    RETURN QUERY
      SELECT dfda.doctor_id
      FROM public.doctor_front_desk_assignments dfda
      JOIN public.resources r ON r.id = dfda.doctor_id
      WHERE dfda.provider_id = p_provider_id
        AND dfda.user_id = v_caller_id
        AND r.provider_id = p_provider_id;

  ELSIF v_role = 'consultant' THEN
    SELECT email, (email_confirmed_at IS NOT NULL)
    INTO v_user_email, v_email_confirmed
    FROM auth.users
    WHERE id = v_caller_id;

    RETURN QUERY
      SELECT r.id
      FROM public.resources r
      WHERE r.provider_id = p_provider_id
        AND (
          r.user_id = v_caller_id
          OR (
            (r.attributes->>'user_id') IS NOT NULL
            AND (r.attributes->>'user_id')::uuid = v_caller_id
          )
          OR (
            r.attributes->>'email' IS NOT NULL
            AND v_user_email IS NOT NULL
            AND lower(trim(r.attributes->>'email')) = lower(trim(v_user_email))
            AND v_email_confirmed IS TRUE
          )
        );

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.hospital_accessible_resource_ids(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_accessible_resource_ids(UUID, UUID) TO authenticated, service_role;
