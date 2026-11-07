-- Migration: 20261107000010_perf_multiple_permissive_policies.sql
-- Description: Fix Supabase Performance Advisor lint 0006 (multiple_permissive_policies).
-- Consolidate overlapping permissive policies so that each table has exactly one
-- permissive policy per (role, command), eliminating redundant RLS evaluations.
--
-- Note on public.cities: Per Rule 5 (Security Gate), work on public.cities is halted
-- because "Allow public read cities" has USING (true), conflicting with allow_read_active_cities.
-- This is flagged as a SECURITY FINDING under Open Questions for user decision.
--
-- Rollback SQL is documented at the bottom of this file.

BEGIN;

-- =============================================================================
-- 1. Table: public.bookings
-- =============================================================================

-- Drop old multiple permissive SELECT and UPDATE policies
DROP POLICY IF EXISTS "allow_reading_bookings" ON public.bookings;
DROP POLICY IF EXISTS "hospital_members_read_accessible_bookings" ON public.bookings;
DROP POLICY IF EXISTS "allow_updating_bookings" ON public.bookings;
DROP POLICY IF EXISTS "hospital_members_update_accessible_bookings" ON public.bookings;

-- Consolidated SELECT policy (authenticated)
CREATE POLICY "bookings_select_policy"
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    -- Customer own bookings, platform admin, or non-hospital merchant authorized provider
    (((SELECT auth.uid()) = customer_id)
      OR is_admin((SELECT auth.uid()))
      OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN (
        SELECT get_user_authorized_providers((SELECT auth.uid()))
      )))
    )
    OR
    -- Hospital members accessible bookings
    (is_hospital_provider(provider_id) AND (
      (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text)
      OR (
        (resource_id IS NOT NULL)
        AND (resource_id IN (
          SELECT hospital_accessible_resource_ids(bookings.provider_id, (SELECT auth.uid()))
        ))
        AND (
          (department_id IS NULL)
          OR (EXISTS (
            SELECT 1
            FROM public.departments d
            WHERE d.id = bookings.department_id
              AND (
                'appointments'::text = ANY (d.allowed_modules)
                OR 'queue_schedule'::text = ANY (d.allowed_modules)
                OR 'check_in'::text = ANY (d.allowed_modules)
              )
          ))
        )
      )
    ))
  );

-- Consolidated UPDATE policy (authenticated)
CREATE POLICY "bookings_update_policy"
  ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (
    (((SELECT auth.uid()) = customer_id)
      OR is_admin((SELECT auth.uid()))
      OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN (
        SELECT get_user_authorized_providers((SELECT auth.uid()))
      )))
    )
    OR
    (is_hospital_provider(provider_id) AND (
      (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text)
      OR (
        (resource_id IS NOT NULL)
        AND (resource_id IN (
          SELECT hospital_accessible_resource_ids(bookings.provider_id, (SELECT auth.uid()))
        ))
        AND (
          (department_id IS NULL)
          OR (EXISTS (
            SELECT 1
            FROM public.departments d
            WHERE d.id = bookings.department_id
              AND (
                'appointments'::text = ANY (d.allowed_modules)
                OR 'queue_schedule'::text = ANY (d.allowed_modules)
                OR 'check_in'::text = ANY (d.allowed_modules)
              )
          ))
        )
      )
    ))
  )
  WITH CHECK (
    (((SELECT auth.uid()) = customer_id)
      OR is_admin((SELECT auth.uid()))
      OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN (
        SELECT get_user_authorized_providers((SELECT auth.uid()))
      )))
    )
    OR
    (is_hospital_provider(provider_id) AND (
      (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text)
      OR (
        (resource_id IS NOT NULL)
        AND (resource_id IN (
          SELECT hospital_accessible_resource_ids(bookings.provider_id, (SELECT auth.uid()))
        ))
      )
    ))
  );

-- =============================================================================
-- 2. Table: public.city_settlements
-- =============================================================================

DROP POLICY IF EXISTS "Admins manage settlements" ON public.city_settlements;
DROP POLICY IF EXISTS "City directors view own settlement" ON public.city_settlements;

CREATE POLICY "city_settlements_select_policy"
  ON public.city_settlements
  FOR SELECT
  TO authenticated
  USING (
    is_admin((SELECT auth.uid()))
    OR is_admin()
    OR (EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND (profiles.role)::text = 'city_director'::text
        AND profiles.assigned_city_id = city_settlements.city_id
    ))
  );

CREATE POLICY "city_settlements_insert_policy"
  ON public.city_settlements
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin((SELECT auth.uid())) OR is_admin());

CREATE POLICY "city_settlements_update_policy"
  ON public.city_settlements
  FOR UPDATE
  TO authenticated
  USING (is_admin((SELECT auth.uid())) OR is_admin())
  WITH CHECK (is_admin((SELECT auth.uid())) OR is_admin());

CREATE POLICY "city_settlements_delete_policy"
  ON public.city_settlements
  FOR DELETE
  TO authenticated
  USING (is_admin((SELECT auth.uid())) OR is_admin());

-- =============================================================================
-- 3. Table: public.city_waitlist
-- =============================================================================

DROP POLICY IF EXISTS "Admins only read city waitlist" ON public.city_waitlist;
DROP POLICY IF EXISTS "Allow admin manage city waitlist" ON public.city_waitlist;

CREATE POLICY "city_waitlist_select_policy"
  ON public.city_waitlist
  FOR SELECT
  TO authenticated
  USING (
    is_admin((SELECT auth.uid()))
    OR (EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = 'admin'::user_role
    ))
  );

CREATE POLICY "city_waitlist_insert_policy"
  ON public.city_waitlist
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_admin((SELECT auth.uid()))
    OR (EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = 'admin'::user_role
    ))
  );

CREATE POLICY "city_waitlist_update_policy"
  ON public.city_waitlist
  FOR UPDATE
  TO authenticated
  USING (
    is_admin((SELECT auth.uid()))
    OR (EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = 'admin'::user_role
    ))
  )
  WITH CHECK (
    is_admin((SELECT auth.uid()))
    OR (EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = 'admin'::user_role
    ))
  );

CREATE POLICY "city_waitlist_delete_policy"
  ON public.city_waitlist
  FOR DELETE
  TO authenticated
  USING (
    is_admin((SELECT auth.uid()))
    OR (EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = 'admin'::user_role
    ))
  );

-- =============================================================================
-- 4. Table: public.department_members
-- =============================================================================

DROP POLICY IF EXISTS "hospital_admin_manage_department_members" ON public.department_members;
DROP POLICY IF EXISTS "members_view_own_membership" ON public.department_members;

CREATE POLICY "department_members_select_policy"
  ON public.department_members
  FOR SELECT
  TO authenticated, service_role
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR (user_id = (SELECT auth.uid()))
    OR (lower(email) = lower(((SELECT auth.jwt()) ->> 'email'::text)))
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    )))
  );

CREATE POLICY "department_members_insert_policy"
  ON public.department_members
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    )))
  );

CREATE POLICY "department_members_update_policy"
  ON public.department_members
  FOR UPDATE
  TO authenticated, service_role
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    )))
  )
  WITH CHECK (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    )))
  );

CREATE POLICY "department_members_delete_policy"
  ON public.department_members
  FOR DELETE
  TO authenticated, service_role
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    )))
  );

-- =============================================================================
-- 5. Table: public.departments
-- =============================================================================

DROP POLICY IF EXISTS "hospital_admin_manage_departments" ON public.departments;
DROP POLICY IF EXISTS "members_view_own_department" ON public.departments;

CREATE POLICY "departments_select_policy"
  ON public.departments
  FOR SELECT
  TO authenticated, service_role
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    )))
    OR (id IN (
      SELECT dm.department_id
      FROM public.department_members dm
      WHERE dm.user_id = (SELECT auth.uid())
        AND dm.status = 'active'::text
        AND dm.merchant_id = departments.merchant_id
    ))
  );

CREATE POLICY "departments_insert_policy"
  ON public.departments
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    )))
  );

CREATE POLICY "departments_update_policy"
  ON public.departments
  FOR UPDATE
  TO authenticated, service_role
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    )))
  )
  WITH CHECK (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    )))
  );

CREATE POLICY "departments_delete_policy"
  ON public.departments
  FOR DELETE
  TO authenticated, service_role
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    )))
  );

-- =============================================================================
-- 6. Table: public.doctor_front_desk_assignments
-- =============================================================================

DROP POLICY IF EXISTS "hospital_admin_manage_doctor_assignments" ON public.doctor_front_desk_assignments;
DROP POLICY IF EXISTS "hospital_admin_read_doctor_assignments" ON public.doctor_front_desk_assignments;

CREATE POLICY "doctor_front_desk_assignments_select_policy"
  ON public.doctor_front_desk_assignments
  FOR SELECT
  TO authenticated, service_role
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN (
      SELECT get_user_authorized_providers((SELECT auth.uid()))
    )))
  );

CREATE POLICY "doctor_front_desk_assignments_insert_policy"
  ON public.doctor_front_desk_assignments
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN (
      SELECT get_user_authorized_providers((SELECT auth.uid()))
    )))
  );

CREATE POLICY "doctor_front_desk_assignments_update_policy"
  ON public.doctor_front_desk_assignments
  FOR UPDATE
  TO authenticated, service_role
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN (
      SELECT get_user_authorized_providers((SELECT auth.uid()))
    )))
  )
  WITH CHECK (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN (
      SELECT get_user_authorized_providers((SELECT auth.uid()))
    )))
  );

CREATE POLICY "doctor_front_desk_assignments_delete_policy"
  ON public.doctor_front_desk_assignments
  FOR DELETE
  TO authenticated, service_role
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))
    OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN (
      SELECT get_user_authorized_providers((SELECT auth.uid()))
    )))
  );

-- =============================================================================
-- 7. Table: public.merchant_memberships
-- =============================================================================

DROP POLICY IF EXISTS "members_view_own_memberships" ON public.merchant_memberships;
DROP POLICY IF EXISTS "store_owners_manage_memberships" ON public.merchant_memberships;

CREATE POLICY "merchant_memberships_select_policy"
  ON public.merchant_memberships
  FOR SELECT
  TO authenticated
  USING (
    (user_id = (SELECT auth.uid()))
    OR is_admin((SELECT auth.uid()))
    OR is_merchant_owner_or_admin(provider_id, (SELECT auth.uid()))
  );

CREATE POLICY "merchant_memberships_insert_policy"
  ON public.merchant_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (is_merchant_owner_or_admin(provider_id, (SELECT auth.uid())));

CREATE POLICY "merchant_memberships_update_policy"
  ON public.merchant_memberships
  FOR UPDATE
  TO authenticated
  USING (is_merchant_owner_or_admin(provider_id, (SELECT auth.uid())))
  WITH CHECK (is_merchant_owner_or_admin(provider_id, (SELECT auth.uid())));

CREATE POLICY "merchant_memberships_delete_policy"
  ON public.merchant_memberships
  FOR DELETE
  TO authenticated
  USING (is_merchant_owner_or_admin(provider_id, (SELECT auth.uid())));

-- =============================================================================
-- 8. Table: public.notification_logs
-- =============================================================================

-- Drop and recreate write policy restricted strictly to INSERT, UPDATE, DELETE
-- so it no longer overlaps with SELECT for authenticated users.
DROP POLICY IF EXISTS "Allow trusted and service role write to notification logs" ON public.notification_logs;
DROP POLICY IF EXISTS "Admins and customer owners read notification logs" ON public.notification_logs;

CREATE POLICY "notification_logs_select_policy"
  ON public.notification_logs
  FOR SELECT
  TO authenticated, service_role
  USING (
    is_admin((SELECT auth.uid()))
    OR (booking_id IN (
      SELECT b.id
      FROM public.bookings b
      WHERE b.customer_id = (SELECT auth.uid())
    ))
    OR ((SELECT auth.role()) = 'service_role'::text)
    OR ((SELECT current_setting('app.trusted_write'::text, true)) = 'true'::text)
  );

CREATE POLICY "notification_logs_insert_policy"
  ON public.notification_logs
  FOR INSERT
  TO public
  WITH CHECK (
    ((SELECT auth.role()) = 'service_role'::text)
    OR ((SELECT current_setting('app.trusted_write'::text, true)) = 'true'::text)
  );

CREATE POLICY "notification_logs_update_policy"
  ON public.notification_logs
  FOR UPDATE
  TO public
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR ((SELECT current_setting('app.trusted_write'::text, true)) = 'true'::text)
  )
  WITH CHECK (
    ((SELECT auth.role()) = 'service_role'::text)
    OR ((SELECT current_setting('app.trusted_write'::text, true)) = 'true'::text)
  );

CREATE POLICY "notification_logs_delete_policy"
  ON public.notification_logs
  FOR DELETE
  TO public
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR ((SELECT current_setting('app.trusted_write'::text, true)) = 'true'::text)
  );

-- =============================================================================
-- 9. Table: public.providers
-- =============================================================================

DROP POLICY IF EXISTS "Merchants can update own provider" ON public.providers;
DROP POLICY IF EXISTS "merchants_update_own_provider" ON public.providers;
DROP POLICY IF EXISTS "Merchants can insert own provider" ON public.providers;

CREATE POLICY "merchants_insert_provider"
  ON public.providers
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id);

CREATE POLICY "merchants_update_provider"
  ON public.providers
  FOR UPDATE
  TO authenticated
  USING (
    (id IN (SELECT get_user_authorized_providers((SELECT auth.uid()))))
    OR is_admin((SELECT auth.uid()))
    OR ((SELECT auth.uid()) = owner_id)
  )
  WITH CHECK (
    (id IN (SELECT get_user_authorized_providers((SELECT auth.uid()))))
    OR is_admin((SELECT auth.uid()))
    OR ((SELECT auth.uid()) = owner_id)
  );

-- =============================================================================
-- 10. Table: public.resources
-- =============================================================================

DROP POLICY IF EXISTS "Active resources are readable by everyone" ON public.resources;
DROP POLICY IF EXISTS "hospital_admin_manage_resources" ON public.resources;
DROP POLICY IF EXISTS "Merchants can insert resources" ON public.resources;
DROP POLICY IF EXISTS "merchants_insert_resources" ON public.resources;
DROP POLICY IF EXISTS "Merchants can update resources" ON public.resources;
DROP POLICY IF EXISTS "merchants_update_resources" ON public.resources;
DROP POLICY IF EXISTS "Merchants can delete resources" ON public.resources;
DROP POLICY IF EXISTS "merchants_delete_resources" ON public.resources;

CREATE POLICY "resources_select_policy"
  ON public.resources
  FOR SELECT
  TO public
  USING (
    (is_active = true)
    OR (provider_id IN (
      SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())
    ))
    OR ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))
  );

CREATE POLICY "resources_insert_policy"
  ON public.resources
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))
    OR (
      (NOT is_hospital_provider(provider_id))
      AND (
        (provider_id IN (SELECT get_user_authorized_providers((SELECT auth.uid()))))
        OR is_admin((SELECT auth.uid()))
      )
    )
    OR (provider_id IN (SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())))
  );

CREATE POLICY "resources_update_policy"
  ON public.resources
  FOR UPDATE
  TO authenticated, service_role
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))
    OR (
      (NOT is_hospital_provider(provider_id))
      AND (
        (provider_id IN (SELECT get_user_authorized_providers((SELECT auth.uid()))))
        OR is_admin((SELECT auth.uid()))
      )
    )
    OR (provider_id IN (SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())))
  )
  WITH CHECK (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))
    OR (
      (NOT is_hospital_provider(provider_id))
      AND (
        (provider_id IN (SELECT get_user_authorized_providers((SELECT auth.uid()))))
        OR is_admin((SELECT auth.uid()))
      )
    )
    OR (provider_id IN (SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())))
  );

CREATE POLICY "resources_delete_policy"
  ON public.resources
  FOR DELETE
  TO authenticated, service_role
  USING (
    ((SELECT auth.role()) = 'service_role'::text)
    OR is_admin((SELECT auth.uid()))
    OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))
    OR (
      (NOT is_hospital_provider(provider_id))
      AND (
        (provider_id IN (SELECT get_user_authorized_providers((SELECT auth.uid()))))
        OR is_admin((SELECT auth.uid()))
      )
    )
    OR (provider_id IN (SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())))
  );

COMMIT;

-- =============================================================================
-- ROLLBACK INSTRUCTIONS
-- =============================================================================
-- To revert Phase 3 consolidations back to the original policies, run the DROP POLICY
-- on the newly created policies above, and re-apply migrations 20261107000001 / 20261107000009
-- policy definitions for public.bookings, public.city_settlements, public.city_waitlist,
-- public.department_members, public.departments, public.doctor_front_desk_assignments,
-- public.merchant_memberships, public.notification_logs, public.providers, and public.resources.
