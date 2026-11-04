-- =============================================================================
-- Migration: 20261020000002_resolve_overloads_and_search_path_audit.sql
-- Description:
--   1. Drop duplicate overloaded queue RPC signatures that cause PostgREST ambiguity (PGRST203).
--   2. Ensure hospital member policies use 2-arg hospital_role & hospital_accessible_resource_ids.
--   3. Drop legacy 1-arg hospital_role(UUID) and hospital_accessible_resource_ids(UUID).
--   4. Explicitly configure search_path on _handle_ddl_setup and auto_ensure_booking_customer.
-- =============================================================================

-- 1. Drop ambiguous older 2-argument and 3-argument overloads
DROP FUNCTION IF EXISTS public.override_hospital_queue_position(UUID, INT);
DROP FUNCTION IF EXISTS public.reorder_hospital_queue(UUID, UUID, UUID[]);

-- 2. Update policies on bookings to ensure explicit 2-argument calls
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'hospital_members_read_accessible_bookings' AND polrelid = 'public.bookings'::regclass) THEN
    DROP POLICY "hospital_members_read_accessible_bookings" ON public.bookings;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'hospital_members_update_accessible_bookings' AND polrelid = 'public.bookings'::regclass) THEN
    DROP POLICY "hospital_members_update_accessible_bookings" ON public.bookings;
  END IF;
END $$;

CREATE POLICY "hospital_members_read_accessible_bookings"
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    is_hospital_provider(provider_id)
    AND (
      hospital_role(provider_id, auth.uid()) = 'admin'
      OR (
        resource_id IS NOT NULL
        AND resource_id IN (
          SELECT hospital_accessible_resource_ids(provider_id, auth.uid())
        )
        AND (
          department_id IS NULL
          OR EXISTS (
            SELECT 1 FROM departments d
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

CREATE POLICY "hospital_members_update_accessible_bookings"
  ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (
    is_hospital_provider(provider_id)
    AND (
      hospital_role(provider_id, auth.uid()) = 'admin'
      OR (
        resource_id IS NOT NULL
        AND resource_id IN (
          SELECT hospital_accessible_resource_ids(provider_id, auth.uid())
        )
        AND (
          department_id IS NULL
          OR EXISTS (
            SELECT 1 FROM departments d
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
    is_hospital_provider(provider_id)
    AND (
      hospital_role(provider_id, auth.uid()) = 'admin'
      OR (
        resource_id IS NOT NULL
        AND resource_id IN (
          SELECT hospital_accessible_resource_ids(provider_id, auth.uid())
        )
      )
    )
  );

-- 3. Drop legacy 1-arg functions now that policies use (provider_id, auth.uid())
DROP FUNCTION IF EXISTS public.hospital_role(UUID);
DROP FUNCTION IF EXISTS public.hospital_accessible_resource_ids(UUID);

-- 4. Lock down search_path on internal setup and trigger functions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_handle_ddl_setup' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public._handle_ddl_setup() SET search_path = public, auth, pg_temp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auto_ensure_booking_customer' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.auto_ensure_booking_customer() SET search_path = public, auth, pg_temp;
  END IF;
END $$;

-- 5. Add unique constraint on payments(gateway_payment_id) for reliable ON CONFLICT upsert in webhook ledger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_gateway_payment_id_key' AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_gateway_payment_id_key UNIQUE (gateway_payment_id);
  END IF;
END $$;

