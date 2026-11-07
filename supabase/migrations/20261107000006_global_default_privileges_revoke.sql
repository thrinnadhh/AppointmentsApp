-- =============================================================================
-- Migration: 20261107000006_global_default_privileges_revoke.sql
-- Description: Revoke global default EXECUTE on functions from PUBLIC so that
--              any future functions created by postgres or current role fail closed.
-- =============================================================================

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
