-- =============================================================================
-- Migration: 20260923000003_tighten_anon_table_grants.sql
-- Description:
--   Defense-in-depth permission hardening:
--   1. Fully revoke ALL table grants on contact_reveal_audit from anon.
--   2. Fully revoke ALL table grants on merchant_bookings from anon.
--   3. Strip unneeded TRIGGER and REFERENCES grants from authenticated on both.
--   Result:
--     - anon has ZERO grants on contact_reveal_audit and merchant_bookings.
--     - authenticated has ONLY SELECT on merchant_bookings and contact_reveal_audit.
-- =============================================================================

-- 1. Strip all privileges from anon
REVOKE ALL ON public.contact_reveal_audit FROM anon;
REVOKE ALL ON public.merchant_bookings FROM anon;

-- 2. Strip superfluous privileges from authenticated (keep only SELECT)
REVOKE TRIGGER, REFERENCES ON public.contact_reveal_audit FROM authenticated;
REVOKE TRIGGER, REFERENCES ON public.merchant_bookings FROM authenticated;
