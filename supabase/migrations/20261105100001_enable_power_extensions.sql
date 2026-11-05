-- Migration: 20261105100001_enable_power_extensions.sql
-- Description: Enables core power extensions (pg_cron, pg_net, pgmq, supabase_vault)
--              and strictly locks down pgmq schema access from anon and authenticated roles.

-- 1. Create extensions idempotently
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- 2. Strict lockdown on pgmq schema, tables, routines, and sequences
-- Queue tables and the pgmq schema must NOT be readable or writable by anon/authenticated roles.
REVOKE ALL ON SCHEMA pgmq FROM anon, authenticated, public;
REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM anon, authenticated, public;
REVOKE ALL ON ALL ROUTINES IN SCHEMA pgmq FROM anon, authenticated, public;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq FROM anon, authenticated, public;

-- Default privileges lockdown for any future objects created in pgmq
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq REVOKE ALL ON TABLES FROM anon, authenticated, public;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq REVOKE ALL ON ROUTINES FROM anon, authenticated, public;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq REVOKE ALL ON SEQUENCES FROM anon, authenticated, public;

-- Ensure postgres and service_role retain management grants
GRANT USAGE ON SCHEMA pgmq TO postgres, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA pgmq TO postgres, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA pgmq TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA pgmq TO postgres, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq GRANT ALL ON ROUTINES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq GRANT ALL ON SEQUENCES TO postgres, service_role;
