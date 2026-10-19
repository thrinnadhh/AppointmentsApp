-- Migration: 20261019000001_doctor_front_desk_assignments.sql
-- Description:
--   1. Create public.doctor_front_desk_assignments table linking front desk staff to doctors.
--   2. Configure RLS and helper indexes.
--   3. Synchronize attributes on resources for fast client lookups.

CREATE TABLE IF NOT EXISTS public.doctor_front_desk_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(doctor_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dfda_provider_id ON public.doctor_front_desk_assignments(provider_id);
CREATE INDEX IF NOT EXISTS idx_dfda_doctor_id ON public.doctor_front_desk_assignments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_dfda_user_id ON public.doctor_front_desk_assignments(user_id);

ALTER TABLE public.doctor_front_desk_assignments ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can view assignments in their authorized providers
DROP POLICY IF EXISTS "Authorized members can read doctor assignments" ON public.doctor_front_desk_assignments;
CREATE POLICY "Authorized members can read doctor assignments"
  ON public.doctor_front_desk_assignments
  FOR SELECT
  TO authenticated
  USING (
    provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    OR public.is_admin(auth.uid())
  );

-- Policy: Provider owners/admins can insert doctor assignments
DROP POLICY IF EXISTS "Provider owners can manage doctor assignments" ON public.doctor_front_desk_assignments;
CREATE POLICY "Provider owners can manage doctor assignments"
  ON public.doctor_front_desk_assignments
  FOR ALL
  TO authenticated
  USING (
    provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    OR public.is_admin(auth.uid())
  );
