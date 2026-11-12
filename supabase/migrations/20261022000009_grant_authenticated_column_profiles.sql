-- Migration: 20261022000009_grant_authenticated_column_profiles.sql
-- Description:
-- Fix F-01: Grant least-privilege column SELECT and UPDATE on public.profiles to authenticated.
-- Restricts client access to non-governance columns (id, full_name, phone, email, expo_push_token, created_at, updated_at).
-- Governance columns (role, assigned_city_id, default_provider_id, is_flagged, no_show_count) are NOT granted for UPDATE.
-- Also grants SELECT on merchant_memberships to authenticated so that RLS policy subqueries evaluate cleanly.
-- Service role retains full administrative access.

REVOKE ALL ON public.profiles FROM anon, authenticated;

-- Column-level SELECT for authenticated users (own profile read via RLS users_read_own_profile)
GRANT SELECT (id, full_name, phone, email, expo_push_token, created_at, updated_at) ON public.profiles TO authenticated;

-- Column-level UPDATE for authenticated users (own profile update via RLS users_update_own_profile)
GRANT UPDATE (full_name, phone, expo_push_token) ON public.profiles TO authenticated;

-- Grant SELECT on merchant_memberships to authenticated so RLS subquery in users_read_own_profile evaluates
GRANT SELECT ON public.merchant_memberships TO authenticated;

-- Full access for service_role
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.merchant_memberships TO service_role;
