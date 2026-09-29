-- =============================================================================
-- Migration: 20260923000002_drop_legacy_bookings_policies.sql
-- Description:
--   1. Drop permissive legacy quoted RLS policies ("Allow reading bookings", "Allow updating bookings")
--      that contained `(SELECT auth.uid()) IS NULL` allowing unauthenticated (anon) reads.
--   2. Ensure only hardened `allow_reading_bookings` and `allow_updating_bookings` govern bookings.
--   3. Revoke direct write operations on contact_reveal_audit from anon/authenticated (inserts must
--      occur exclusively via SECURITY DEFINER RPC reveal_customer_contact).
--   4. Revoke anon SELECT and all direct write privileges on the merchant_bookings view.
-- =============================================================================

-- 1. Drop permissive legacy quoted policies on bookings
DROP POLICY IF EXISTS "Allow reading bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow updating bookings" ON public.bookings;

-- 2. Revoke DML operations on contact_reveal_audit from public/client roles
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contact_reveal_audit FROM anon, authenticated;

-- 3. Revoke write operations on merchant_bookings view from client roles
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.merchant_bookings FROM anon, authenticated;
REVOKE SELECT ON public.merchant_bookings FROM anon;
