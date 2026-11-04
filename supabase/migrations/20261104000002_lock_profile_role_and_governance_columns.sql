-- Migration: Lock down role and governance columns on public.profiles
-- Prevents authenticated clients from reading or modifying role, assigned_city_id, and governance fields directly.

-- 1. Revoke table-level permissions
REVOKE ALL ON public.profiles FROM authenticated;
REVOKE ALL ON public.profiles FROM anon;

-- 2. Grant SELECT only on permitted customer/profile fields
GRANT SELECT (
    id,
    full_name,
    email,
    phone,
    expo_push_token,
    blocked_until,
    no_show_count,
    is_flagged,
    permanent_checkin_pin,
    created_at,
    updated_at
) ON public.profiles TO authenticated;

-- 3. Grant UPDATE only on permitted self-service fields
GRANT UPDATE (
    full_name,
    phone,
    expo_push_token,
    updated_at
) ON public.profiles TO authenticated;

-- 4. Retain full access for backend service_role
GRANT ALL ON public.profiles TO service_role;

-- 5. Enforce Audited Public SECURITY DEFINER Allowlist
-- Revoke execution of internal and administrative procedures from public roles.
DO $$
DECLARE
  r RECORD;
  fn_names TEXT[] := ARRAY[
    'admin_create_resource',
    'admin_create_user',
    'admin_create_venue',
    'assert_booking_actor',
    'auto_link_merchant_by_email',
    'get_provider_details',
    'get_test_clock',
    'get_test_clock_for_prefix',
    'get_user_department_id',
    'is_caller_authorized_for_resource',
    'is_hospital_owner',
    'merchant_update_cooling_period',
    'search_directory_public'
  ];
BEGIN
  FOR r IN 
    SELECT p.oid::regprocedure AS proc_sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = ANY(fn_names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated;', r.proc_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', r.proc_sig);
  END LOOP;
END;
$$;

-- Grant EXECUTE on override_hospital_queue_position to authenticated (enforces in-procedure staff check)
GRANT EXECUTE ON FUNCTION public.override_hospital_queue_position(UUID, INTEGER, UUID) TO authenticated;


