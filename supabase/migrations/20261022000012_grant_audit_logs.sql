-- Migration: 20261022000012_grant_audit_logs.sql
-- Description: Grant table-level SELECT and INSERT on public.audit_logs to authenticated and service_role.
-- RLS policies owner_read_audit_logs and insert_audit_logs guard row-level access.

GRANT SELECT, INSERT ON public.audit_logs TO authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated, anon, PUBLIC;
