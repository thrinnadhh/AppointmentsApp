-- =============================================================================
-- Migration: 20261021000004_grant_service_role_select_providers.sql
-- Description:
--   Grant SELECT on public.providers to service_role.
--   Required for backend Next.js API routes (e.g. apps/merchant-web auth-admin.ts
--   isCallerAuthorizedForBooking, verifyHospitalStaffAuth, verifyShopAccess)
--   which authenticate requests using the service_role client.
--   Note: Write privileges (INSERT, UPDATE, DELETE) remain restricted to postgres / SECURITY DEFINER RPCs.
-- =============================================================================

GRANT SELECT ON public.providers TO service_role;
