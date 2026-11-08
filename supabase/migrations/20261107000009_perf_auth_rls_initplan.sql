-- Migration: 20261107000009_perf_auth_rls_initplan.sql
-- Description: Fix Supabase Performance Advisor lint 0003 (auth_rls_initplan).
-- Wrap all unwrapped auth.uid(), auth.role(), auth.jwt(), and current_setting() calls
-- in (SELECT ...) subqueries across public and storage RLS policies.
--
-- This ensures Postgres plans the auth expression as an InitPlan (evaluated once per query)
-- rather than evaluating per row, which drastically improves RLS evaluation performance.
--
-- Rollback SQL is documented at the bottom of this file.

BEGIN;

-- =============================================================================
-- 1. Table: public.notification_logs
-- =============================================================================

-- 1.1 "Allow trusted and service role write to notification logs"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notification_logs' AND policyname = 'Allow trusted and service role write to notification logs'
  ) THEN
    ALTER POLICY "Allow trusted and service role write to notification logs"
      ON public.notification_logs
      USING (
        ((SELECT auth.role()) = 'service_role'::text)
        OR ((SELECT current_setting('app.trusted_write'::text, true)) = 'true'::text)
      );
  END IF;
END $$;

-- 1.2 "Admins and customer owners read notification logs"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notification_logs' AND policyname = 'Admins and customer owners read notification logs'
  ) THEN
    ALTER POLICY "Admins and customer owners read notification logs"
      ON public.notification_logs
      USING (
        is_admin((SELECT auth.uid()))
        OR (booking_id IN (
          SELECT b.id
          FROM public.bookings b
          WHERE b.customer_id = (SELECT auth.uid())
        ))
      );
  END IF;
END $$;

-- =============================================================================
-- 2. Table: public.push_tokens
-- =============================================================================

-- 2.1 "push_tokens_select_own"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_tokens' AND policyname = 'push_tokens_select_own'
  ) THEN
    ALTER POLICY "push_tokens_select_own"
      ON public.push_tokens
      USING (user_id = (SELECT auth.uid()));
  END IF;
END $$;

-- 2.2 "push_tokens_insert_own"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_tokens' AND policyname = 'push_tokens_insert_own'
  ) THEN
    ALTER POLICY "push_tokens_insert_own"
      ON public.push_tokens
      WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
END $$;

-- 2.3 "push_tokens_update_own"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_tokens' AND policyname = 'push_tokens_update_own'
  ) THEN
    ALTER POLICY "push_tokens_update_own"
      ON public.push_tokens
      USING (user_id = (SELECT auth.uid()))
      WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
END $$;

-- 2.4 "push_tokens_delete_own"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_tokens' AND policyname = 'push_tokens_delete_own'
  ) THEN
    ALTER POLICY "push_tokens_delete_own"
      ON public.push_tokens
      USING (user_id = (SELECT auth.uid()));
  END IF;
END $$;

-- =============================================================================
-- 3. Table: public.department_members
-- =============================================================================

-- 3.1 "members_view_own_membership"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'department_members' AND policyname = 'members_view_own_membership'
  ) THEN
    ALTER POLICY "members_view_own_membership"
      ON public.department_members
      USING (
        (user_id = (SELECT auth.uid()))
        OR (lower(email) = lower(((SELECT auth.jwt()) ->> 'email'::text)))
      );
  END IF;
END $$;

-- =============================================================================
-- 4. Table: public.profiles
-- =============================================================================

-- 4.1 "users_read_own_profile"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'users_read_own_profile'
  ) THEN
    ALTER POLICY "users_read_own_profile"
      ON public.profiles
      USING (
        (id = (SELECT auth.uid()))
        OR is_admin((SELECT auth.uid()))
        OR (EXISTS (
          SELECT 1
          FROM public.merchant_memberships mm
          WHERE mm.user_id = profiles.id
            AND mm.provider_id IN (
              SELECT get_user_authorized_providers((SELECT auth.uid()))
            )
        ))
      );
  END IF;
END $$;

-- 4.2 "users_update_own_profile"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'users_update_own_profile'
  ) THEN
    ALTER POLICY "users_update_own_profile"
      ON public.profiles
      USING (id = (SELECT auth.uid()))
      WITH CHECK (id = (SELECT auth.uid()));
  END IF;
END $$;

-- =============================================================================
-- 5. Storage Policies (storage.objects)
-- =============================================================================

-- 5.1 "Allow delete prescriptions and records"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow delete prescriptions and records'
  ) THEN
    ALTER POLICY "Allow delete prescriptions and records"
      ON storage.objects
      USING (
        bucket_id = 'prescriptions-and-records'::text
        AND (storage.foldername(name))[1] = ((SELECT auth.uid()))::text
      );
  END IF;
END $$;

-- 5.2 "Allow delete venue assets"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow delete venue assets'
  ) THEN
    ALTER POLICY "Allow delete venue assets"
      ON storage.objects
      USING (
        bucket_id = 'venue-assets'::text
        AND (
          ((SELECT auth.role()) = 'service_role'::text)
          OR is_admin((SELECT auth.uid()))
          OR (
            storage.foldername(name) IS NOT NULL
            AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text
            AND ((storage.foldername(name))[1])::uuid IN (
              SELECT get_user_authorized_providers((SELECT auth.uid()))
            )
          )
        )
      );
  END IF;
END $$;

-- 5.3 "Allow read prescriptions and records"
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
          (storage.foldername(name))[1] = ((SELECT auth.uid()))::text
          OR is_admin((SELECT auth.uid()))
          OR (EXISTS (
            SELECT 1
            FROM public.bookings b
            WHERE (b.attachment_url = objects.name OR b.attachment_url = ('prescriptions-and-records/'::text || objects.name))
              AND b.provider_id IN (
                SELECT get_user_authorized_providers((SELECT auth.uid()))
              )
          ))
        )
      );
  END IF;
END $$;

-- 5.4 "Allow update prescriptions and records"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow update prescriptions and records'
  ) THEN
    ALTER POLICY "Allow update prescriptions and records"
      ON storage.objects
      USING (
        bucket_id = 'prescriptions-and-records'::text
        AND (storage.foldername(name))[1] = ((SELECT auth.uid()))::text
      )
      WITH CHECK (
        bucket_id = 'prescriptions-and-records'::text
        AND (storage.foldername(name))[1] = ((SELECT auth.uid()))::text
      );
  END IF;
END $$;

-- 5.5 "Allow update venue assets"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow update venue assets'
  ) THEN
    ALTER POLICY "Allow update venue assets"
      ON storage.objects
      USING (
        bucket_id = 'venue-assets'::text
        AND (
          ((SELECT auth.role()) = 'service_role'::text)
          OR is_admin((SELECT auth.uid()))
          OR (
            storage.foldername(name) IS NOT NULL
            AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text
            AND ((storage.foldername(name))[1])::uuid IN (
              SELECT get_user_authorized_providers((SELECT auth.uid()))
            )
          )
        )
      )
      WITH CHECK (
        bucket_id = 'venue-assets'::text
        AND (
          ((SELECT auth.role()) = 'service_role'::text)
          OR is_admin((SELECT auth.uid()))
          OR (
            storage.foldername(name) IS NOT NULL
            AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text
            AND ((storage.foldername(name))[1])::uuid IN (
              SELECT get_user_authorized_providers((SELECT auth.uid()))
            )
          )
        )
      );
  END IF;
END $$;

-- 5.6 "Allow upload to prescriptions and records"
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
        AND (storage.foldername(name))[1] = ((SELECT auth.uid()))::text
      );
  END IF;
END $$;

-- 5.7 "Allow upload to venue assets"
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
          ((SELECT auth.role()) = 'service_role'::text)
          OR is_admin((SELECT auth.uid()))
          OR (
            storage.foldername(name) IS NOT NULL
            AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text
            AND ((storage.foldername(name))[1])::uuid IN (
              SELECT get_user_authorized_providers((SELECT auth.uid()))
            )
          )
        )
      );
  END IF;
END $$;

-- 5.8 "venue_assets_merchant_delete"
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
          WHERE p.owner_id = (SELECT auth.uid())
            AND (storage.foldername(p.name))[1] = (p.id)::text
        ))
      );
  END IF;
END $$;

-- 5.9 "venue_assets_merchant_insert"
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
          WHERE p.owner_id = (SELECT auth.uid())
            AND (storage.foldername(p.name))[1] = (p.id)::text
        ))
      );
  END IF;
END $$;

-- 5.10 "venue_assets_merchant_update"
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
          WHERE p.owner_id = (SELECT auth.uid())
            AND (storage.foldername(p.name))[1] = (p.id)::text
        ))
      )
      WITH CHECK (
        bucket_id = 'venue-assets'::text
        AND (EXISTS (
          SELECT 1
          FROM public.providers p
          WHERE p.owner_id = (SELECT auth.uid())
            AND (storage.foldername(p.name))[1] = (p.id)::text
        ))
      );
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- ROLLBACK INSTRUCTIONS
-- =============================================================================
-- To revert these changes back to the pre-20261107000009 unwrapped calls:
--
-- ALTER POLICY "Allow trusted and service role write to notification logs" ON public.notification_logs USING (((( SELECT auth.role() AS role) = 'service_role'::text) OR (current_setting('app.trusted_write'::text, true) = 'true'::text)));
-- ALTER POLICY "Admins and customer owners read notification logs" ON public.notification_logs USING ((is_admin(auth.uid()) OR (booking_id IN ( SELECT bookings.id FROM bookings WHERE (bookings.customer_id = auth.uid())))));
-- ALTER POLICY "push_tokens_select_own" ON public.push_tokens USING ((auth.uid() = user_id));
-- ALTER POLICY "push_tokens_insert_own" ON public.push_tokens WITH CHECK ((auth.uid() = user_id));
-- ALTER POLICY "push_tokens_update_own" ON public.push_tokens USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
-- ALTER POLICY "push_tokens_delete_own" ON public.push_tokens USING ((auth.uid() = user_id));
-- ALTER POLICY "members_view_own_membership" ON public.department_members USING (((user_id = ( SELECT auth.uid() AS uid)) OR (lower(email) = lower((auth.jwt() ->> 'email'::text)))));
-- ALTER POLICY "users_read_own_profile" ON public.profiles USING (((auth.uid() = id) OR is_admin(auth.uid()) OR (EXISTS ( SELECT 1 FROM merchant_memberships mm WHERE ((mm.user_id = profiles.id) AND (mm.provider_id IN ( SELECT get_user_authorized_providers(auth.uid()) AS get_user_authorized_providers)))))));
-- ALTER POLICY "users_update_own_profile" ON public.profiles USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
-- (and revert the 10 storage.objects policies using unwrapped auth.uid(), auth.role()).
