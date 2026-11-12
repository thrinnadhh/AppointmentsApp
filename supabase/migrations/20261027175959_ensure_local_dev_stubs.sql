-- Migration: 20261027175959_ensure_local_dev_stubs.sql
-- Description: Creates stubs for local development event trigger & maintenance functions
--              (_handle_ddl_setup, auto_ensure_booking_customer) so that subsequent
--              migration 20261027180000 can configure search_path and execution privileges
--              without failing on cloud/remote databases where roles.sql is not executed.
-- Rollback: DROP FUNCTION IF EXISTS public._handle_ddl_setup() CASCADE;
--           DROP FUNCTION IF EXISTS public.auto_ensure_booking_customer() CASCADE;

CREATE OR REPLACE FUNCTION public._handle_ddl_setup()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_ensure_booking_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN NEW;
END;
$$;
