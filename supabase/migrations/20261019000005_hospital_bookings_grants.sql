-- =============================================================================
-- Migration: 20261019000005_hospital_bookings_grants.sql
-- Description:
--   1. Harden is_hospital_provider as plpgsql SECURITY DEFINER to prevent
--      inlining and guarantee consistent evaluation across RLS policies.
--   2. Grant SELECT and UPDATE on public.bookings to authenticated role so
--      that RLS policies can evaluate updates without table-level permission errors.
--   3. Grant SELECT on supporting RBAC tables (departments, department_members,
--      doctor_front_desk_assignments, resources, providers) to authenticated.
--   4. Fix validate_booking_update() to prevent false-positive rejection of
--      legitimate updates due to generated total_charged column being NULL in BEFORE triggers.
-- =============================================================================

-- 1. plpgsql implementation of is_hospital_provider
CREATE OR REPLACE FUNCTION public.is_hospital_provider(p_provider_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.providers
    WHERE id = p_provider_id
      AND (
        category_id = 'clinics'
        OR category_id = 'hospital'
        OR category_id ILIKE '%clinic%'
        OR category_id ILIKE '%hospital%'
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_hospital_provider(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_hospital_provider(UUID) TO authenticated, service_role;

-- 2. Table and column grants for RLS evaluation
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, UPDATE ON public.bookings TO authenticated;
GRANT SELECT ON public.bookings TO anon;

GRANT SELECT ON public.providers TO authenticated, anon;
GRANT SELECT ON public.resources TO authenticated, anon;
GRANT SELECT ON public.departments TO authenticated;
GRANT SELECT ON public.department_members TO authenticated;
GRANT SELECT ON public.doctor_front_desk_assignments TO authenticated;

-- 3. Fix validate_booking_update() trigger
CREATE OR REPLACE FUNCTION public.validate_booking_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
BEGIN
  -- Allow service_role or trusted internal execution context
  IF auth.role() = 'service_role' OR current_setting('app.trusted_write', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Platform admins are exempt
  IF public.is_admin(v_caller_id) THEN
    RETURN NEW;
  END IF;

  -- Financial columns cannot be modified directly via REST
  IF NEW.platform_fee IS DISTINCT FROM OLD.platform_fee
     OR NEW.platform_fee_gst IS DISTINCT FROM OLD.platform_fee_gst
     OR NEW.deposit_amount IS DISTINCT FROM OLD.deposit_amount
     OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR (NEW.total_charged IS NOT NULL AND NEW.total_charged IS DISTINCT FROM OLD.total_charged)
     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.gstin_platform IS DISTINCT FROM OLD.gstin_platform
     OR NEW.gateway_payment_id IS DISTINCT FROM OLD.gateway_payment_id
     OR NEW.gateway_order_id IS DISTINCT FROM OLD.gateway_order_id
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    RAISE EXCEPTION 'Financial and payment fields are read-only and managed by the payment gateway'
      USING ERRCODE = '42501';
  END IF;

  -- Status transitions must go through authorized RPCs
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Booking status cannot be updated directly. Use authorized RPCs (complete_booking, cancel_booking, record_no_show).'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
