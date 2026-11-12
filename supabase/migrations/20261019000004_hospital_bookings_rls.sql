-- =============================================================================
-- Migration: 20261019000004_hospital_bookings_rls.sql
-- Description:
--   Lock down public.bookings RLS:
--   1. Create helper public.is_hospital_provider(UUID).
--   2. Restrict allow_reading_bookings and allow_updating_bookings so they do NOT
--      apply to hospital providers (non-hospital providers remain unchanged).
--   3. Replace department-wide reading/updating policies with per-doctor accessible policies.
--   4. Customers retain full access to their own bookings.
-- =============================================================================

-- 1. Helper to determine if a provider is in the hospital/clinics category
CREATE OR REPLACE FUNCTION public.is_hospital_provider(p_provider_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.providers
    WHERE id = p_provider_id
      AND (
        category_id = 'clinics'
        OR category_id = 'hospital'
        OR category_id ILIKE '%clinic%'
        OR category_id ILIKE '%hospital%'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_hospital_provider(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_hospital_provider(UUID) TO authenticated, service_role;

-- 2. Restrict legacy allow_reading_bookings policy
DROP POLICY IF EXISTS "allow_reading_bookings" ON public.bookings;
CREATE POLICY "allow_reading_bookings"
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    -- Customers always read their own bookings
    (auth.uid() = customer_id)
    -- Platform super administrators always have read access
    OR public.is_admin(auth.uid())
    -- Non-hospital providers use the legacy merchant provider check
    OR (
      NOT public.is_hospital_provider(provider_id)
      AND provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    )
  );

-- 3. Restrict legacy allow_updating_bookings policy
DROP POLICY IF EXISTS "allow_updating_bookings" ON public.bookings;
CREATE POLICY "allow_updating_bookings"
  ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (
    -- Customers updating their own bookings
    (auth.uid() = customer_id)
    -- Platform super administrators always have write access
    OR public.is_admin(auth.uid())
    -- Non-hospital providers use legacy provider check
    OR (
      NOT public.is_hospital_provider(provider_id)
      AND provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    )
  )
  WITH CHECK (
    (auth.uid() = customer_id)
    OR public.is_admin(auth.uid())
    OR (
      NOT public.is_hospital_provider(provider_id)
      AND provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    )
  );

-- 4. Drop legacy department-wide permissive policies that leak cross-consultant bookings
DROP POLICY IF EXISTS "members_read_department_bookings" ON public.bookings;
DROP POLICY IF EXISTS "members_update_department_bookings" ON public.bookings;

-- 5. Hospital-specific SELECT policy using hospital_accessible_resource_ids
DROP POLICY IF EXISTS "hospital_members_read_accessible_bookings" ON public.bookings;
CREATE POLICY "hospital_members_read_accessible_bookings"
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    public.is_hospital_provider(provider_id)
    AND (
      -- Hospital Admin has full access to all bookings in the hospital
      public.hospital_role(provider_id) = 'admin'
      -- Front Desk and Consultants access ONLY their assigned/own doctors
      OR (
        resource_id IS NOT NULL
        AND resource_id IN (SELECT public.hospital_accessible_resource_ids(provider_id))
        AND (
          department_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.departments d
            WHERE d.id = bookings.department_id
              AND (
                'appointments' = ANY(d.allowed_modules)
                OR 'queue_schedule' = ANY(d.allowed_modules)
                OR 'check_in' = ANY(d.allowed_modules)
              )
          )
        )
      )
    )
  );

-- 6. Hospital-specific UPDATE policy
DROP POLICY IF EXISTS "hospital_members_update_accessible_bookings" ON public.bookings;
CREATE POLICY "hospital_members_update_accessible_bookings"
  ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (
    public.is_hospital_provider(provider_id)
    AND (
      public.hospital_role(provider_id) = 'admin'
      OR (
        resource_id IS NOT NULL
        AND resource_id IN (SELECT public.hospital_accessible_resource_ids(provider_id))
        AND (
          department_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.departments d
            WHERE d.id = bookings.department_id
              AND (
                'appointments' = ANY(d.allowed_modules)
                OR 'queue_schedule' = ANY(d.allowed_modules)
                OR 'check_in' = ANY(d.allowed_modules)
              )
          )
        )
      )
    )
  )
  WITH CHECK (
    public.is_hospital_provider(provider_id)
    AND (
      public.hospital_role(provider_id) = 'admin'
      OR (
        resource_id IS NOT NULL
        AND resource_id IN (SELECT public.hospital_accessible_resource_ids(provider_id))
      )
    )
  );
