-- =============================================================================
-- Migration: 20261022000004_optimize_rls_policies_and_stability.sql
-- Description: Fix 5 - Mark RLS helper functions STABLE and wrap auth.uid()/auth.role()
--               with (SELECT auth.uid()) / (SELECT auth.role()) for per-query initplan caching.
-- =============================================================================

-- 1. Mark RLS helper functions STABLE
ALTER FUNCTION public.hospital_role(uuid, uuid) STABLE;
ALTER FUNCTION public.hospital_accessible_resource_ids(uuid, uuid) STABLE;
ALTER FUNCTION public.is_admin(uuid) STABLE;
ALTER FUNCTION public.is_hospital_provider(uuid) STABLE;

-- 2. Recreate policies with wrapped (SELECT auth.uid()) and (SELECT auth.role())
DROP POLICY IF EXISTS "Users see own deletion request" ON public.account_deletion_requests;
CREATE POLICY "Users see own deletion request"
  ON public.account_deletion_requests
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can view audit logs"
  ON public.admin_audit_logs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Only admins can view app logs" ON public.app_logs;
CREATE POLICY "Only admins can view app logs"
  ON public.app_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "customers_read_own_checkin_codes" ON public.appointment_checkin_codes;
CREATE POLICY "customers_read_own_checkin_codes"
  ON public.appointment_checkin_codes
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((customer_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "insert_audit_logs" ON public.audit_logs;
CREATE POLICY "insert_audit_logs"
  ON public.audit_logs
  AS PERMISSIVE
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK ((((SELECT auth.role()) = 'service_role'::text) OR ((SELECT auth.uid()) IS NOT NULL)));

DROP POLICY IF EXISTS "owner_read_audit_logs" ON public.audit_logs;
CREATE POLICY "owner_read_audit_logs"
  ON public.audit_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated, service_role
  USING ((((SELECT auth.role()) = 'service_role'::text) OR is_admin((SELECT auth.uid())) OR (merchant_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.owner_id = (SELECT auth.uid())))) OR (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text)));

DROP POLICY IF EXISTS "Customers can create bookings" ON public.bookings;
CREATE POLICY "Customers can create bookings"
  ON public.bookings
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = customer_id));

DROP POLICY IF EXISTS "allow_reading_bookings" ON public.bookings;
CREATE POLICY "allow_reading_bookings"
  ON public.bookings
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((((SELECT auth.uid()) = customer_id) OR is_admin((SELECT auth.uid())) OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)))));

DROP POLICY IF EXISTS "allow_updating_bookings" ON public.bookings;
CREATE POLICY "allow_updating_bookings"
  ON public.bookings
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((((SELECT auth.uid()) = customer_id) OR is_admin((SELECT auth.uid())) OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)))))
  WITH CHECK ((((SELECT auth.uid()) = customer_id) OR is_admin((SELECT auth.uid())) OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)))));

DROP POLICY IF EXISTS "hospital_members_read_accessible_bookings" ON public.bookings;
CREATE POLICY "hospital_members_read_accessible_bookings"
  ON public.bookings
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_hospital_provider(provider_id) AND ((hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text) OR ((resource_id IS NOT NULL) AND (resource_id IN ( SELECT hospital_accessible_resource_ids(bookings.provider_id, (SELECT auth.uid())) AS hospital_accessible_resource_ids)) AND ((department_id IS NULL) OR (EXISTS ( SELECT 1
   FROM departments d
  WHERE ((d.id = bookings.department_id) AND (('appointments'::text = ANY (d.allowed_modules)) OR ('queue_schedule'::text = ANY (d.allowed_modules)) OR ('check_in'::text = ANY (d.allowed_modules)))))))))));

DROP POLICY IF EXISTS "hospital_members_update_accessible_bookings" ON public.bookings;
CREATE POLICY "hospital_members_update_accessible_bookings"
  ON public.bookings
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((is_hospital_provider(provider_id) AND ((hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text) OR ((resource_id IS NOT NULL) AND (resource_id IN ( SELECT hospital_accessible_resource_ids(bookings.provider_id, (SELECT auth.uid())) AS hospital_accessible_resource_ids)) AND ((department_id IS NULL) OR (EXISTS ( SELECT 1
   FROM departments d
  WHERE ((d.id = bookings.department_id) AND (('appointments'::text = ANY (d.allowed_modules)) OR ('queue_schedule'::text = ANY (d.allowed_modules)) OR ('check_in'::text = ANY (d.allowed_modules)))))))))))
  WITH CHECK ((is_hospital_provider(provider_id) AND ((hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text) OR ((resource_id IS NOT NULL) AND (resource_id IN ( SELECT hospital_accessible_resource_ids(bookings.provider_id, (SELECT auth.uid())) AS hospital_accessible_resource_ids))))));

DROP POLICY IF EXISTS "Allow admin full manage cities" ON public.cities;
CREATE POLICY "Allow admin full manage cities"
  ON public.cities
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = 'admin'::user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = 'admin'::user_role)))));

DROP POLICY IF EXISTS "City directors view own settlement" ON public.city_settlements;
CREATE POLICY "City directors view own settlement"
  ON public.city_settlements
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND ((profiles.role)::text = 'city_director'::text) AND (profiles.assigned_city_id = city_settlements.city_id)))));

DROP POLICY IF EXISTS "Admins only read city waitlist" ON public.city_waitlist;
CREATE POLICY "Admins only read city waitlist"
  ON public.city_waitlist
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Allow admin manage city waitlist" ON public.city_waitlist;
CREATE POLICY "Allow admin manage city waitlist"
  ON public.city_waitlist
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = 'admin'::user_role)))));

DROP POLICY IF EXISTS "Admins only read reveal audits" ON public.contact_reveal_audit;
CREATE POLICY "Admins only read reveal audits"
  ON public.contact_reveal_audit
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins and service role view dedup" ON public.crash_alert_dedup;
CREATE POLICY "Admins and service role view dedup"
  ON public.crash_alert_dedup
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "hospital_admin_manage_department_members" ON public.department_members;
CREATE POLICY "hospital_admin_manage_department_members"
  ON public.department_members
  AS PERMISSIVE
  FOR ALL
  TO authenticated, service_role
  USING ((((SELECT auth.role()) = 'service_role'::text) OR is_admin((SELECT auth.uid())) OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text)) OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.owner_id = (SELECT auth.uid())))))))
  WITH CHECK ((((SELECT auth.role()) = 'service_role'::text) OR is_admin((SELECT auth.uid())) OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text)) OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.owner_id = (SELECT auth.uid())))))));

DROP POLICY IF EXISTS "members_view_own_membership" ON public.department_members;
CREATE POLICY "members_view_own_membership"
  ON public.department_members
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((user_id = (SELECT auth.uid())) OR (lower(email) = lower((auth.jwt() ->> 'email'::text)))));

DROP POLICY IF EXISTS "hospital_admin_manage_departments" ON public.departments;
CREATE POLICY "hospital_admin_manage_departments"
  ON public.departments
  AS PERMISSIVE
  FOR ALL
  TO authenticated, service_role
  USING ((((SELECT auth.role()) = 'service_role'::text) OR is_admin((SELECT auth.uid())) OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text)) OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.owner_id = (SELECT auth.uid())))))))
  WITH CHECK ((((SELECT auth.role()) = 'service_role'::text) OR is_admin((SELECT auth.uid())) OR (is_hospital_provider(merchant_id) AND (hospital_role(merchant_id, (SELECT auth.uid())) = 'admin'::text)) OR ((NOT is_hospital_provider(merchant_id)) AND (merchant_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.owner_id = (SELECT auth.uid())))))));

DROP POLICY IF EXISTS "members_view_own_department" ON public.departments;
CREATE POLICY "members_view_own_department"
  ON public.departments
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((id IN ( SELECT department_members.department_id
   FROM department_members
  WHERE ((department_members.user_id = (SELECT auth.uid())) AND (department_members.status = 'active'::text) AND (department_members.merchant_id = departments.merchant_id)))));

DROP POLICY IF EXISTS "hospital_admin_manage_doctor_assignments" ON public.doctor_front_desk_assignments;
CREATE POLICY "hospital_admin_manage_doctor_assignments"
  ON public.doctor_front_desk_assignments
  AS PERMISSIVE
  FOR ALL
  TO authenticated, service_role
  USING ((((SELECT auth.role()) = 'service_role'::text) OR is_admin((SELECT auth.uid())) OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text)) OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)))))
  WITH CHECK ((((SELECT auth.role()) = 'service_role'::text) OR is_admin((SELECT auth.uid())) OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text)) OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)))));

DROP POLICY IF EXISTS "hospital_admin_read_doctor_assignments" ON public.doctor_front_desk_assignments;
CREATE POLICY "hospital_admin_read_doctor_assignments"
  ON public.doctor_front_desk_assignments
  AS PERMISSIVE
  FOR SELECT
  TO authenticated, service_role
  USING ((((SELECT auth.role()) = 'service_role'::text) OR is_admin((SELECT auth.uid())) OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text)) OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)))));

DROP POLICY IF EXISTS "members_view_own_memberships" ON public.merchant_memberships;
CREATE POLICY "members_view_own_memberships"
  ON public.merchant_memberships
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((user_id = (SELECT auth.uid())) OR is_admin((SELECT auth.uid()))));

DROP POLICY IF EXISTS "store_owners_manage_memberships" ON public.merchant_memberships;
CREATE POLICY "store_owners_manage_memberships"
  ON public.merchant_memberships
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (is_merchant_owner_or_admin(provider_id, (SELECT auth.uid())))
  WITH CHECK (is_merchant_owner_or_admin(provider_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Allow trusted and service role write to notification logs" ON public.notification_logs;
CREATE POLICY "Allow trusted and service role write to notification logs"
  ON public.notification_logs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((((SELECT auth.role()) = 'service_role'::text) OR (current_setting('app.trusted_write'::text, true) = 'true'::text)));

DROP POLICY IF EXISTS "Merchants and customers read own booking notification logs" ON public.notification_logs;
CREATE POLICY "Merchants and customers read own booking notification logs"
  ON public.notification_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_admin((SELECT auth.uid())) OR (booking_id IN ( SELECT bookings.id
   FROM bookings
  WHERE ((bookings.customer_id = (SELECT auth.uid())) OR (bookings.provider_id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)))))));

DROP POLICY IF EXISTS "Users can read own payments" ON public.payments;
CREATE POLICY "Users can read own payments"
  ON public.payments
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((((SELECT auth.uid()) IS NOT NULL) AND ((booking_id IN ( SELECT b.id
   FROM bookings b
  WHERE (b.customer_id = (SELECT auth.uid())))) OR (booking_id IN ( SELECT b.id
   FROM (bookings b
     JOIN providers p ON ((b.provider_id = p.id)))
  WHERE ((p.owner_id = (SELECT auth.uid())) OR (p.id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers))))) OR is_admin((SELECT auth.uid())))));

DROP POLICY IF EXISTS "service_role_only_platform_config" ON public.platform_config;
CREATE POLICY "service_role_only_platform_config"
  ON public.platform_config
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'service_role'::text));

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = id));

DROP POLICY IF EXISTS "users_read_own_profile" ON public.profiles;
CREATE POLICY "users_read_own_profile"
  ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((((SELECT auth.uid()) = id) OR is_admin((SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM merchant_memberships mm
  WHERE ((mm.user_id = profiles.id) AND (mm.provider_id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)))))));

DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;
CREATE POLICY "users_update_own_profile"
  ON public.profiles
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((SELECT auth.uid()) = id))
  WITH CHECK (((SELECT auth.uid()) = id));

DROP POLICY IF EXISTS "Active providers are readable by everyone" ON public.providers;
CREATE POLICY "Active providers are readable by everyone"
  ON public.providers
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((status = 'ACTIVE'::provider_status) OR ((SELECT auth.uid()) = owner_id)));

DROP POLICY IF EXISTS "Merchants can insert own provider" ON public.providers;
CREATE POLICY "Merchants can insert own provider"
  ON public.providers
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = owner_id));

DROP POLICY IF EXISTS "Merchants can update own provider" ON public.providers;
CREATE POLICY "Merchants can update own provider"
  ON public.providers
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((SELECT auth.uid()) = owner_id));

DROP POLICY IF EXISTS "merchants_update_own_provider" ON public.providers;
CREATE POLICY "merchants_update_own_provider"
  ON public.providers
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)) OR is_admin((SELECT auth.uid()))));

DROP POLICY IF EXISTS "Merchants can delete availability" ON public.resource_availability;
CREATE POLICY "Merchants can delete availability"
  ON public.resource_availability
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((resource_id IN ( SELECT r.id
   FROM (resources r
     JOIN providers p ON ((r.provider_id = p.id)))
  WHERE (p.owner_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "Merchants can insert availability" ON public.resource_availability;
CREATE POLICY "Merchants can insert availability"
  ON public.resource_availability
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((resource_id IN ( SELECT r.id
   FROM (resources r
     JOIN providers p ON ((r.provider_id = p.id)))
  WHERE (p.owner_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "Merchants can update availability" ON public.resource_availability;
CREATE POLICY "Merchants can update availability"
  ON public.resource_availability
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((resource_id IN ( SELECT r.id
   FROM (resources r
     JOIN providers p ON ((r.provider_id = p.id)))
  WHERE (p.owner_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "Active resources are readable by everyone" ON public.resources;
CREATE POLICY "Active resources are readable by everyone"
  ON public.resources
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((is_active = true) OR (provider_id IN ( SELECT p.id
   FROM providers p
  WHERE (p.owner_id = (SELECT auth.uid()))))));

DROP POLICY IF EXISTS "Merchants can delete resources" ON public.resources;
CREATE POLICY "Merchants can delete resources"
  ON public.resources
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((provider_id IN ( SELECT p.id
   FROM providers p
  WHERE (p.owner_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "Merchants can insert resources" ON public.resources;
CREATE POLICY "Merchants can insert resources"
  ON public.resources
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((provider_id IN ( SELECT p.id
   FROM providers p
  WHERE (p.owner_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "Merchants can update resources" ON public.resources;
CREATE POLICY "Merchants can update resources"
  ON public.resources
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((provider_id IN ( SELECT p.id
   FROM providers p
  WHERE (p.owner_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "hospital_admin_manage_resources" ON public.resources;
CREATE POLICY "hospital_admin_manage_resources"
  ON public.resources
  AS PERMISSIVE
  FOR ALL
  TO authenticated, service_role
  USING ((((SELECT auth.role()) = 'service_role'::text) OR is_admin((SELECT auth.uid())) OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))))
  WITH CHECK ((((SELECT auth.role()) = 'service_role'::text) OR is_admin((SELECT auth.uid())) OR (is_hospital_provider(provider_id) AND (hospital_role(provider_id, (SELECT auth.uid())) = 'admin'::text))));

DROP POLICY IF EXISTS "merchants_delete_resources" ON public.resources;
CREATE POLICY "merchants_delete_resources"
  ON public.resources
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (((NOT is_hospital_provider(provider_id)) AND ((provider_id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)) OR is_admin((SELECT auth.uid())))));

DROP POLICY IF EXISTS "merchants_insert_resources" ON public.resources;
CREATE POLICY "merchants_insert_resources"
  ON public.resources
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((NOT is_hospital_provider(provider_id)) AND ((provider_id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)) OR is_admin((SELECT auth.uid())))));

DROP POLICY IF EXISTS "merchants_update_resources" ON public.resources;
CREATE POLICY "merchants_update_resources"
  ON public.resources
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((NOT is_hospital_provider(provider_id)) AND ((provider_id IN ( SELECT get_user_authorized_providers((SELECT auth.uid())) AS get_user_authorized_providers)) OR is_admin((SELECT auth.uid())))));

DROP POLICY IF EXISTS "Users manage own consents" ON public.user_consents;
CREATE POLICY "Users manage own consents"
  ON public.user_consents
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.uid()) = user_id));
