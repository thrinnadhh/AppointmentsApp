-- =============================================================================
-- Migration: 20261019000013_hospital_admin_grants.sql
-- Description:
--   Grant table-level permissions to authenticated for doctor_front_desk_assignments,
--   resources, departments, and department_members so RLS policies can govern access.
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_front_desk_assignments TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resources TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.department_members TO authenticated, service_role;
