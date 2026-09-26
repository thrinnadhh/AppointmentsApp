-- =============================================================================
-- Migration: 20260926000001_harden_prescriptions_storage_rls.sql
-- Description:
--   1. Harden storage.objects RLS policies for private 'prescriptions-and-records':
--      - Drop unauthenticated/overly permissive legacy policies.
--      - SELECT: Scoped TO authenticated. Allows:
--          a) File owner matching folder prefix: (storage.foldername(name))[1] = auth.uid()::text
--          b) Merchant authorized for the venue tied to the booking referencing this file
--          c) Platform admin via public.is_admin(auth.uid())
--      - INSERT: Scoped TO authenticated. Enforces that customers may ONLY upload
--          under their own auth.uid() path prefix: (storage.foldername(name))[1] = auth.uid()::text
--      - UPDATE & DELETE: Scoped TO authenticated. Restricts file mutation/removal
--          to the owning user's path prefix.
--   2. Defense-in-depth table-grant hardening:
--      - Revoke ALL table privileges on storage.objects from anon.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. DROP LEGACY / PERMISSIVE POLICIES ON storage.objects
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow upload to prescriptions and records" ON storage.objects;
DROP POLICY IF EXISTS "Allow read prescriptions and records" ON storage.objects;
DROP POLICY IF EXISTS prescriptions_owner_select ON storage.objects;
DROP POLICY IF EXISTS prescriptions_owner_insert ON storage.objects;
DROP POLICY IF EXISTS prescriptions_owner_update ON storage.objects;
DROP POLICY IF EXISTS prescriptions_owner_delete ON storage.objects;

-- -----------------------------------------------------------------------------
-- 2. CREATE HARDENED RLS POLICIES FOR prescriptions-and-records
-- -----------------------------------------------------------------------------

-- SELECT: Owner (path prefix matches auth.uid()), Authorized Merchant for attached booking, or Admin
CREATE POLICY "Allow read prescriptions and records"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'prescriptions-and-records'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE (b.attachment_url = name OR b.attachment_url = 'prescriptions-and-records/' || name)
        AND b.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    )
  )
);

-- INSERT: Only allow authenticated customer to upload under their own auth.uid() path prefix
CREATE POLICY "Allow upload to prescriptions and records"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'prescriptions-and-records'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- UPDATE: Only allow authenticated customer to overwrite/update under their own auth.uid() path prefix
CREATE POLICY "Allow update prescriptions and records"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'prescriptions-and-records'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'prescriptions-and-records'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- DELETE: Only allow authenticated customer to remove files under their own auth.uid() path prefix
CREATE POLICY "Allow delete prescriptions and records"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'prescriptions-and-records'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- -----------------------------------------------------------------------------
-- 3. DEFENSE-IN-DEPTH: REVOKE TABLE-LEVEL PRIVILEGES FROM anon ON storage.objects
-- -----------------------------------------------------------------------------
REVOKE ALL ON storage.objects FROM anon;
