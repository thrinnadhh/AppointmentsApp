-- =============================================================================
-- Migration: 20261019000014_hospital_admin_writes_and_rls.sql
-- Description:
--   Subtask 8: Admin-only writes, escalation prevention, and revocation:
--   1. RLS on departments, department_members, doctor_front_desk_assignments, and resources:
--      Writes strictly restricted to Hospital Admin.
--      A user cannot change their own role, hospital, or assignments.
--   2. Protect id_card_number in doctor_front_desk_assignments so only Hospital Admin can read it.
--   3. Non-hospital providers behave exactly as before.
-- =============================================================================

-- 1. RESOURCES: Restrict writes on hospital resources to Hospital Admin only
DROP POLICY IF EXISTS merchants_insert_resources ON public.resources;
CREATE POLICY merchants_insert_resources ON public.resources
FOR INSERT WITH CHECK (
  NOT public.is_hospital_provider(provider_id)
  AND (
    provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    OR public.is_admin(auth.uid())
  )
);

DROP POLICY IF EXISTS merchants_update_resources ON public.resources;
CREATE POLICY merchants_update_resources ON public.resources
FOR UPDATE USING (
  NOT public.is_hospital_provider(provider_id)
  AND (
    provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    OR public.is_admin(auth.uid())
  )
);

DROP POLICY IF EXISTS merchants_delete_resources ON public.resources;
CREATE POLICY merchants_delete_resources ON public.resources
FOR DELETE USING (
  NOT public.is_hospital_provider(provider_id)
  AND (
    provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    OR public.is_admin(auth.uid())
  )
);

DROP POLICY IF EXISTS hospital_admin_manage_resources ON public.resources;
CREATE POLICY hospital_admin_manage_resources ON public.resources
FOR ALL TO authenticated, service_role
USING (
  auth.role() = 'service_role'
  OR public.is_admin(auth.uid())
  OR (
    public.is_hospital_provider(provider_id)
    AND public.hospital_role(provider_id, auth.uid()) = 'admin'
  )
)
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_admin(auth.uid())
  OR (
    public.is_hospital_provider(provider_id)
    AND public.hospital_role(provider_id, auth.uid()) = 'admin'
  )
);


-- 2. DOCTOR FRONT DESK ASSIGNMENTS: Protect id_card_number and writes
DROP POLICY IF EXISTS "Authorized members can read doctor assignments" ON public.doctor_front_desk_assignments;
DROP POLICY IF EXISTS "Provider owners can manage doctor assignments" ON public.doctor_front_desk_assignments;
DROP POLICY IF EXISTS hospital_admin_read_doctor_assignments ON public.doctor_front_desk_assignments;
DROP POLICY IF EXISTS hospital_admin_manage_doctor_assignments ON public.doctor_front_desk_assignments;

-- SELECT: Only Hospital Admin can read doctor assignments (protecting id_card_number from other staff)
CREATE POLICY hospital_admin_read_doctor_assignments
  ON public.doctor_front_desk_assignments
  FOR SELECT
  TO authenticated, service_role
  USING (
    auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
    OR (
      public.is_hospital_provider(provider_id)
      AND public.hospital_role(provider_id, auth.uid()) = 'admin'
    )
    OR (
      NOT public.is_hospital_provider(provider_id)
      AND provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    )
  );

-- WRITES: Only Hospital Admin can insert, update, or delete assignments
CREATE POLICY hospital_admin_manage_doctor_assignments
  ON public.doctor_front_desk_assignments
  FOR ALL
  TO authenticated, service_role
  USING (
    auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
    OR (
      public.is_hospital_provider(provider_id)
      AND public.hospital_role(provider_id, auth.uid()) = 'admin'
    )
    OR (
      NOT public.is_hospital_provider(provider_id)
      AND provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
    OR (
      public.is_hospital_provider(provider_id)
      AND public.hospital_role(provider_id, auth.uid()) = 'admin'
    )
    OR (
      NOT public.is_hospital_provider(provider_id)
      AND provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    )
  );


-- 3. DEPARTMENTS: Writes by Hospital Admin only
DROP POLICY IF EXISTS owner_manage_departments ON public.departments;
DROP POLICY IF EXISTS hospital_admin_manage_departments ON public.departments;

CREATE POLICY hospital_admin_manage_departments
  ON public.departments
  FOR ALL
  TO authenticated, service_role
  USING (
    auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
    OR (
      public.is_hospital_provider(merchant_id)
      AND public.hospital_role(merchant_id, auth.uid()) = 'admin'
    )
    OR (
      NOT public.is_hospital_provider(merchant_id)
      AND merchant_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid())
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
    OR (
      public.is_hospital_provider(merchant_id)
      AND public.hospital_role(merchant_id, auth.uid()) = 'admin'
    )
    OR (
      NOT public.is_hospital_provider(merchant_id)
      AND merchant_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid())
    )
  );


-- 4. DEPARTMENT MEMBERS: Writes by Hospital Admin only (prevent privilege escalation)
DROP POLICY IF EXISTS owner_manage_department_members ON public.department_members;
DROP POLICY IF EXISTS hospital_admin_manage_department_members ON public.department_members;

CREATE POLICY hospital_admin_manage_department_members
  ON public.department_members
  FOR ALL
  TO authenticated, service_role
  USING (
    auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
    OR (
      public.is_hospital_provider(merchant_id)
      AND public.hospital_role(merchant_id, auth.uid()) = 'admin'
    )
    OR (
      NOT public.is_hospital_provider(merchant_id)
      AND merchant_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid())
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
    OR (
      public.is_hospital_provider(merchant_id)
      AND public.hospital_role(merchant_id, auth.uid()) = 'admin'
    )
    OR (
      NOT public.is_hospital_provider(merchant_id)
      AND merchant_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid())
    )
  );
