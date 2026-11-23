-- ============================================================================
-- Migration: 20261121000003_remove_department_member_limit.sql
-- Description: Remove the 3-member ceiling per department so that any number
--              of doctors and staff can belong to the same department.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_department_member_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_owner_id UUID;
  v_owner_email TEXT;
BEGIN
  -- Normalize email
  NEW.email := lower(trim(NEW.email));

  IF NEW.status IN ('invited', 'active') THEN
    -- Rule: The owner's own email cannot be added as a member
    SELECT owner_id INTO v_owner_id FROM public.providers WHERE id = NEW.merchant_id;
    IF v_owner_id IS NOT NULL THEN
      SELECT lower(trim(email)) INTO v_owner_email FROM public.profiles WHERE id = v_owner_id;
      IF v_owner_email IS NOT NULL AND v_owner_email = NEW.email THEN
        RAISE EXCEPTION 'Hospital owner cannot be added as a department member.';
      END IF;
    END IF;

    -- Concurrency-safe: lock the parent department row to serialize concurrent member additions
    PERFORM 1 FROM public.departments WHERE id = NEW.department_id FOR UPDATE;

    -- NOTE: The former 3-member limit is removed per user specification.
    -- Any number of doctors/staff can be assigned to the same department.
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_department_member_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_department_member_limit() TO service_role;
