-- =============================================================================
-- Migration: 20261118000006_realtime_replica_identity_full.sql
-- Description: Fix DB-07: Set REPLICA IDENTITY FULL on public.bookings and
--              public.payments for Supabase Realtime CDC row-level security.
-- =============================================================================

BEGIN;

ALTER TABLE public.bookings REPLICA IDENTITY FULL;
ALTER TABLE public.payments REPLICA IDENTITY FULL;

COMMIT;
