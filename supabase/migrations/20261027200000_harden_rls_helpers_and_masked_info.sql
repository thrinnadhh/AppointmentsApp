-- Migration: 20261027200000_harden_rls_helpers_and_masked_info.sql
-- Description: Enforce caller-binding on RLS helper functions, restrict get_masked_customer_info to authorized viewers, and restrict check_user_exists_by_phone to service_role.

-- 1. is_admin: When caller is authenticated, ignore p_user_id and force check against auth.uid()
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target_id UUID := CASE 
    WHEN auth.role() = 'authenticated' THEN auth.uid() 
    ELSE COALESCE(p_user_id, auth.uid()) 
  END;
BEGIN
  IF v_target_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = v_target_id AND role = 'admin'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

-- 2. hospital_role: When caller is authenticated, ignore p_user_id and force check against auth.uid()
CREATE OR REPLACE FUNCTION public.hospital_role(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := CASE 
    WHEN auth.role() = 'authenticated' THEN auth.uid() 
    ELSE COALESCE(p_user_id, auth.uid()) 
  END;
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
$function$;

REVOKE EXECUTE ON FUNCTION public.hospital_role(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_role(uuid, uuid) TO authenticated, service_role;

-- 3. is_merchant_owner_or_admin: When caller is authenticated, ignore p_user_id and force check against auth.uid()
CREATE OR REPLACE FUNCTION public.is_merchant_owner_or_admin(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target_id UUID := CASE 
    WHEN auth.role() = 'authenticated' THEN auth.uid() 
    ELSE COALESCE(p_user_id, auth.uid()) 
  END;
BEGIN
  IF v_target_id IS NULL OR p_provider_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN (
    public.is_admin(v_target_id) OR EXISTS (
      SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = v_target_id
      UNION
      SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = v_target_id AND role = 'owner'
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.is_merchant_owner_or_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_merchant_owner_or_admin(uuid, uuid) TO authenticated, service_role;

-- 4. hospital_accessible_resource_ids: When caller is authenticated, ignore p_user_id and force check against auth.uid()
CREATE OR REPLACE FUNCTION public.hospital_accessible_resource_ids(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := CASE 
    WHEN auth.role() = 'authenticated' THEN auth.uid() 
    ELSE COALESCE(p_user_id, auth.uid()) 
  END;
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
$function$;

REVOKE EXECUTE ON FUNCTION public.hospital_accessible_resource_ids(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_accessible_resource_ids(uuid, uuid) TO authenticated, service_role;

-- 5. get_user_authorized_providers: When caller is authenticated, ignore p_user_id and force check against auth.uid()
CREATE OR REPLACE FUNCTION public.get_user_authorized_providers(p_user_id uuid DEFAULT auth.uid())
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target_id UUID := CASE 
    WHEN auth.role() = 'authenticated' THEN auth.uid() 
    ELSE COALESCE(p_user_id, auth.uid()) 
  END;
BEGIN
  IF v_target_id IS NULL THEN
    RETURN;
  END IF;

  IF public.is_admin(v_target_id) THEN
    RETURN QUERY SELECT id FROM public.providers;
    RETURN;
  END IF;

  RETURN QUERY 
    SELECT provider_id FROM public.merchant_memberships WHERE user_id = v_target_id
    UNION
    SELECT id FROM public.providers WHERE owner_id = v_target_id
    UNION
    SELECT p.id FROM public.providers p
    JOIN auth.users u ON lower(trim(u.email)) = lower(trim(p.email))
    WHERE u.id = v_target_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_user_authorized_providers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_authorized_providers(uuid) TO authenticated, service_role;

-- 6. get_masked_customer_info: Strictly verify caller can see this customer
CREATE OR REPLACE FUNCTION public.get_masked_customer_info(p_customer_id uuid)
 RETURNS TABLE(customer_name text, customer_phone text, no_show_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF v_caller_role = 'service_role' THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = p_customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.customer_id = p_customer_id
        AND b.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id))
    ) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      COALESCE(pr.full_name, 'Walk-in / Guest')::text AS customer_name,
      public.mask_customer_phone(pr.phone)::text AS customer_phone,
      COALESCE(pr.no_show_count, 0)::integer AS no_show_count
    FROM public.profiles pr
    WHERE pr.id = p_customer_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_masked_customer_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_masked_customer_info(uuid) TO authenticated, service_role;

-- 7. check_user_exists_by_phone: Server / service_role only function
CREATE OR REPLACE FUNCTION public.check_user_exists_by_phone(p_phone text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Access denied: phone verification restricted to service role' USING ERRCODE = '42501';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.profiles WHERE phone = p_phone
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.check_user_exists_by_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_exists_by_phone(text) TO service_role;
