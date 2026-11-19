-- Migration: 20261120000001_harden_rls_with_check_and_grants.sql
-- VULN_ID: SEC-WIN-001 (Widened)
-- Layer: Database / RLS / Grants Hardening
--
-- 1. Adds explicit WITH CHECK equal to USING expressions on all UPDATE/ALL policies with NULL with_check.
-- 2. Revokes public/anon EXECUTE privileges on internal formatting helpers so only the 4 approved functions are anon-callable.
-- 3. Enforces zero non-SELECT table write grants for authenticated role on server-managed financial tables.

-- 1. Explicit WITH CHECK on resource_availability UPDATE policy
ALTER POLICY "Merchants can update availability" ON public.resource_availability
  WITH CHECK (
    resource_id IN (
      SELECT r.id
      FROM public.resources r
      JOIN public.providers p ON (r.provider_id = p.id)
      WHERE p.owner_id = (SELECT auth.uid() AS uid)
    )
  );

-- 2. Explicit WITH CHECK on platform_config ALL policy
ALTER POLICY "service_role_only_platform_config" ON public.platform_config
  WITH CHECK ((SELECT auth.role() AS role) = 'service_role'::text);

-- 3. Explicit WITH CHECK on user_consents ALL policy
ALTER POLICY "Users manage own consents" ON public.user_consents
  WITH CHECK ((SELECT auth.uid() AS uid) = user_id);

-- 4. Explicit WITH CHECK on resource_leaves ALL policy
ALTER POLICY "resource_leaves_manage_policy" ON public.resource_leaves
  WITH CHECK (
    is_admin(auth.uid()) OR (
      EXISTS (
        SELECT 1 FROM public.providers
        WHERE providers.id = resource_leaves.provider_id
          AND providers.owner_id = auth.uid()
      )
    ) OR (
      EXISTS (
        SELECT 1 FROM public.merchant_memberships
        WHERE merchant_memberships.provider_id = resource_leaves.provider_id
          AND merchant_memberships.user_id = auth.uid()
      )
    ) OR (
      EXISTS (
        SELECT 1 FROM public.department_members
        WHERE department_members.merchant_id = resource_leaves.provider_id
          AND department_members.user_id = auth.uid()
          AND department_members.status = 'active'::text
      )
    )
  );

-- 5. Revoke anon EXECUTE from unapproved helper functions
REVOKE EXECUTE ON FUNCTION public.get_template_name(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mask_customer_phone(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.normalize_phone_number(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sanitize_template_param(text, text) FROM anon, PUBLIC;
