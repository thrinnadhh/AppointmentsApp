-- =============================================================================
-- Migration: 20261019000003_hospital_access_helpers.sql
-- Description:
--   Single source of truth for hospital access control:
--   1. Add user_id column to public.resources to bind Consultants to resources.
--   2. Implement hospital_role(p_provider_id UUID) SECURITY DEFINER helper.
--   3. Implement hospital_accessible_resource_ids(p_provider_id UUID) helper.
--   4. Enforce email confirmation when binding via email.
-- =============================================================================

-- 1. Ensure user_id column on public.resources
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_resources_user_id ON public.resources(user_id);

-- Backfill user_id from attributes->>'user_id' if present
UPDATE public.resources
SET user_id = (attributes->>'user_id')::uuid
WHERE user_id IS NULL
  AND attributes->>'user_id' IS NOT NULL
  AND (attributes->>'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Trigger to keep attributes->>'user_id' and resources.user_id synchronized
CREATE OR REPLACE FUNCTION public.sync_resource_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    IF NEW.attributes IS NULL THEN
      NEW.attributes := jsonb_build_object('user_id', NEW.user_id);
    ELSE
      NEW.attributes := NEW.attributes || jsonb_build_object('user_id', NEW.user_id);
    END IF;
  ELSIF NEW.attributes IS NOT NULL AND (NEW.attributes->>'user_id') IS NOT NULL THEN
    IF (NEW.attributes->>'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      NEW.user_id := (NEW.attributes->>'user_id')::uuid;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_resource_user_id ON public.resources;
CREATE TRIGGER trg_sync_resource_user_id
  BEFORE INSERT OR UPDATE ON public.resources
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_resource_user_id();

-- 2. Helper: hospital_role(provider_id)
CREATE OR REPLACE FUNCTION public.hospital_role(p_provider_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_category TEXT;
  v_dept_status TEXT;
  v_has_assignment BOOLEAN;
  v_is_consultant BOOLEAN := FALSE;
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
  -- Platform SuperAdmin, direct hospital owner, or manager/admin in merchant_memberships
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
  -- A revoked department member loses all hospital access immediately
  SELECT status INTO v_dept_status
  FROM public.department_members
  WHERE merchant_id = p_provider_id
    AND user_id = v_caller_id
  ORDER BY (status = 'active') DESC, created_at DESC
  LIMIT 1;

  IF v_dept_status = 'revoked' THEN
    RETURN 'none';
  END IF;

  -- 4. Consultant Check
  -- Must be bound to a doctor resource in this hospital by user_id
  -- (or email ONLY if email is confirmed in auth.users)
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
        AND lower(trim(r.attributes->>'email')) = lower(trim(auth.jwt()->>'email'))
        AND EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = v_caller_id
            AND u.email_confirmed_at IS NOT NULL
        )
      )
    )
  LIMIT 1;

  IF v_is_consultant IS TRUE THEN
    RETURN 'consultant';
  END IF;

  -- 5. Front Desk Check
  -- Must be an active member of department_members AND have at least one doctor assignment
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

REVOKE ALL ON FUNCTION public.hospital_role(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_role(UUID) TO authenticated, service_role;

-- 3. Helper: hospital_accessible_resource_ids(provider_id)
CREATE OR REPLACE FUNCTION public.hospital_accessible_resource_ids(p_provider_id UUID)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_role TEXT;
BEGIN
  IF v_caller_id IS NULL OR p_provider_id IS NULL THEN
    RETURN;
  END IF;

  v_role := public.hospital_role(p_provider_id);

  IF v_role = 'admin' THEN
    -- Admin has access to all hospital resources
    RETURN QUERY
      SELECT r.id
      FROM public.resources r
      WHERE r.provider_id = p_provider_id;

  ELSIF v_role = 'front_desk' THEN
    -- Front Desk has access ONLY to assigned doctors
    RETURN QUERY
      SELECT dfda.doctor_id
      FROM public.doctor_front_desk_assignments dfda
      JOIN public.resources r ON r.id = dfda.doctor_id
      WHERE dfda.provider_id = p_provider_id
        AND dfda.user_id = v_caller_id
        AND r.provider_id = p_provider_id;

  ELSIF v_role = 'consultant' THEN
    -- Consultant has access ONLY to their own resource
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
            AND lower(trim(r.attributes->>'email')) = lower(trim(auth.jwt()->>'email'))
            AND EXISTS (
              SELECT 1 FROM auth.users u
              WHERE u.id = v_caller_id
                AND u.email_confirmed_at IS NOT NULL
            )
          )
        );

  ELSE
    -- none: no resources accessible
    RETURN;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.hospital_accessible_resource_ids(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_accessible_resource_ids(UUID) TO authenticated, service_role;
