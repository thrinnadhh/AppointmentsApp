-- Migration: 20261024181300_patch_profile_governance_trigger.sql
-- Description: Patch guard_profile_governance trigger to strictly block client modifications
--              to role, assigned_city_id, no_show_count, is_flagged, blocked_until, and permanent_checkin_pin.

CREATE OR REPLACE FUNCTION public.guard_profile_governance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Allow service_role (backend), platform admins, direct superuser, or internal trusted writes
  IF (NULLIF(current_setting('request.jwt.claims', true), '')::json->>'role' = 'service_role')
     OR auth.role() = 'service_role'
     OR current_setting('app.trusted_write', true) = 'true'
     OR session_user = 'postgres'
     OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Block regular customers from modifying governance, location, and penalty fields
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.assigned_city_id IS DISTINCT FROM OLD.assigned_city_id
     OR NEW.no_show_count IS DISTINCT FROM OLD.no_show_count
     OR NEW.is_flagged IS DISTINCT FROM OLD.is_flagged
     OR NEW.blocked_until IS DISTINCT FROM OLD.blocked_until
     OR NEW.permanent_checkin_pin IS DISTINCT FROM OLD.permanent_checkin_pin THEN
    RAISE EXCEPTION 'Unauthorized profile modification: role, city, provider, and governance fields are protected'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
