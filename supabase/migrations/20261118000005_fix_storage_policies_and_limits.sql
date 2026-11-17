-- =============================================================================
-- Migration: 20261118000005_fix_storage_policies_and_limits.sql
-- Description: Fix DB-06: storage.objects policies venue_assets_merchant_* to use
--              storage.foldername(objects.name) on storage.objects; tighten venue asset
--              uploads and add robust prescription / medical records RLS policies.
-- =============================================================================

BEGIN;

-- 1. Fix venue_assets_merchant_* policies to reference storage.foldername(objects.name)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'venue_assets_merchant_delete'
  ) THEN
    ALTER POLICY "venue_assets_merchant_delete"
      ON storage.objects
      USING (
        bucket_id = 'venue-assets'::text
        AND (EXISTS (
          SELECT 1
          FROM public.providers p
          WHERE (p.owner_id = (SELECT auth.uid()) OR p.id IN (SELECT public.get_user_authorized_providers((SELECT auth.uid()))) OR public.is_admin((SELECT auth.uid())))
            AND (storage.foldername(objects.name))[1] = p.id::text
        ))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'venue_assets_merchant_insert'
  ) THEN
    ALTER POLICY "venue_assets_merchant_insert"
      ON storage.objects
      WITH CHECK (
        bucket_id = 'venue-assets'::text
        AND (EXISTS (
          SELECT 1
          FROM public.providers p
          WHERE (p.owner_id = (SELECT auth.uid()) OR p.id IN (SELECT public.get_user_authorized_providers((SELECT auth.uid()))) OR public.is_admin((SELECT auth.uid())))
            AND (storage.foldername(objects.name))[1] = p.id::text
        ))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'venue_assets_merchant_update'
  ) THEN
    ALTER POLICY "venue_assets_merchant_update"
      ON storage.objects
      USING (
        bucket_id = 'venue-assets'::text
        AND (EXISTS (
          SELECT 1
          FROM public.providers p
          WHERE (p.owner_id = (SELECT auth.uid()) OR p.id IN (SELECT public.get_user_authorized_providers((SELECT auth.uid()))) OR public.is_admin((SELECT auth.uid())))
            AND (storage.foldername(objects.name))[1] = p.id::text
        ))
      )
      WITH CHECK (
        bucket_id = 'venue-assets'::text
        AND (EXISTS (
          SELECT 1
          FROM public.providers p
          WHERE (p.owner_id = (SELECT auth.uid()) OR p.id IN (SELECT public.get_user_authorized_providers((SELECT auth.uid()))) OR public.is_admin((SELECT auth.uid())))
            AND (storage.foldername(objects.name))[1] = p.id::text
        ))
      );
  END IF;
END $$;

-- 2. Tighten "Allow upload to venue assets" policy: remove unauthenticated / unowned 'common' and 'new-merchant' paths
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow upload to venue assets'
  ) THEN
    ALTER POLICY "Allow upload to venue assets"
      ON storage.objects
      WITH CHECK (
        bucket_id = 'venue-assets'::text
        AND (
          (SELECT auth.role()) = 'service_role'
          OR public.is_admin((SELECT auth.uid()))
          OR (
            (SELECT auth.uid()) IS NOT NULL
            AND (
              (storage.foldername(objects.name))[1] = (SELECT auth.uid())::text
              OR (storage.foldername(objects.name))[2] = (SELECT auth.uid())::text
            )
          )
          OR (
            storage.foldername(objects.name) IS NOT NULL
            AND (storage.foldername(objects.name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND ((storage.foldername(objects.name))[1])::uuid IN (SELECT public.get_user_authorized_providers((SELECT auth.uid())))
          )
        )
      );
  END IF;
END $$;

-- 3. Enhance prescription storage policies
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow upload to prescriptions and records'
  ) THEN
    ALTER POLICY "Allow upload to prescriptions and records"
      ON storage.objects
      WITH CHECK (
        bucket_id = 'prescriptions-and-records'::text
        AND (
          (SELECT auth.role()) = 'service_role'
          OR public.is_admin((SELECT auth.uid()))
          OR (storage.foldername(objects.name))[1] = ((SELECT auth.uid())::text)
          OR (
            (storage.foldername(objects.name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND EXISTS (
              SELECT 1 FROM public.bookings b
              WHERE b.customer_id = ((storage.foldername(objects.name))[1])::uuid
                AND b.provider_id IN (SELECT public.get_user_authorized_providers((SELECT auth.uid())))
            )
          )
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow read prescriptions and records'
  ) THEN
    ALTER POLICY "Allow read prescriptions and records"
      ON storage.objects
      USING (
        bucket_id = 'prescriptions-and-records'::text
        AND (
          (SELECT auth.role()) = 'service_role'
          OR public.is_admin((SELECT auth.uid()))
          OR (storage.foldername(objects.name))[1] = ((SELECT auth.uid())::text)
          OR EXISTS (
            SELECT 1
            FROM public.bookings b
            WHERE (
              b.attachment_url = objects.name
              OR b.attachment_url = ('prescriptions-and-records/' || objects.name)
              OR (
                (storage.foldername(objects.name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                AND b.customer_id = ((storage.foldername(objects.name))[1])::uuid
              )
            )
            AND b.provider_id IN (SELECT public.get_user_authorized_providers((SELECT auth.uid())))
          )
        )
      );
  END IF;
END $$;

COMMIT;
