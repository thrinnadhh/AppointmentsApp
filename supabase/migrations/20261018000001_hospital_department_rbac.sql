-- =============================================================================
-- Migration: 20261018000001_hospital_department_rbac.sql
-- Description:
--   1. Create public.departments table with allowed_modules.
--   2. Create public.department_members table with 7-day invite and status tracking.
--   3. Create public.audit_logs table for HIPAA/DPDP team and patient access audit logs.
--   4. Add department_id to public.bookings and public.resources.
--   5. Enforce Max 3 members per department via concurrency-safe row-lock trigger.
--   6. Enforce hospital owner email exclusion trigger.
--   7. Seed preset departments for all existing hospital/clinic providers.
--   8. Backfill existing hospital bookings and resources to departments.
--   9. Configure strict RLS policies for departments, members, audit_logs, and bookings.
--   10. Update verify_checkin_code RPC for department-scoped verification.
--   11. Update public.merchant_bookings view with department_id and department_name.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DEPARTMENTS TABLE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_preset BOOLEAN NOT NULL DEFAULT FALSE,
    allowed_modules TEXT[] NOT NULL DEFAULT ARRAY['appointments', 'queue_schedule', 'check_in']::text[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT check_allowed_modules CHECK (
      allowed_modules <@ ARRAY['appointments', 'queue_schedule', 'check_in', 'patients']::text[]
    )
);

-- Case-insensitive unique name per hospital
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_merchant_lower_name 
  ON public.departments (merchant_id, lower(trim(name)));

CREATE INDEX IF NOT EXISTS idx_departments_merchant_id 
  ON public.departments (merchant_id);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DEPARTMENT MEMBERS TABLE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.department_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'revoked')),
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    invite_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- An email can belong to only one department in a hospital (active or invited)
CREATE UNIQUE INDEX IF NOT EXISTS idx_dept_members_unique_active_email 
  ON public.department_members (merchant_id, lower(trim(email))) 
  WHERE (status IN ('invited', 'active'));

CREATE INDEX IF NOT EXISTS idx_dept_members_department_id ON public.department_members (department_id);
CREATE INDEX IF NOT EXISTS idx_dept_members_merchant_id ON public.department_members (merchant_id);
CREATE INDEX IF NOT EXISTS idx_dept_members_user_id ON public.department_members (user_id);
CREATE INDEX IF NOT EXISTS idx_dept_members_email ON public.department_members (lower(trim(email)));

ALTER TABLE public.department_members ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AUDIT LOGS TABLE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_merchant_created ON public.audit_logs (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs (actor_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ADD department_id TO BOOKINGS AND RESOURCES
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings 
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_department_id ON public.bookings (department_id);

ALTER TABLE public.resources 
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_resources_department_id ON public.resources (department_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CONCURRENCY-SAFE TRIGGER: MAX 3 MEMBERS PER DEPARTMENT & OWNER EXCLUSION
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_department_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
  v_owner_id UUID;
  v_owner_email TEXT;
BEGIN
  -- Normalize email
  NEW.email := lower(trim(NEW.email));

  IF NEW.status IN ('invited', 'active') THEN
    -- Rule: The owner's own email cannot be added as a member
    SELECT owner_id INTO v_owner_id FROM public.providers WHERE id = NEW.merchant_id;
    IF v_owner_id IS NOT NULL THEN
      SELECT lower(trim(email)) INTO v_owner_email FROM public.profiles WHERE id = v_owner_id;
      IF v_owner_email IS NOT NULL AND v_owner_email = NEW.email THEN
        RAISE EXCEPTION 'Hospital owner cannot be added as a department member.';
      END IF;
    END IF;

    -- Concurrency-safe: lock the parent department row to serialize concurrent member additions
    PERFORM 1 FROM public.departments WHERE id = NEW.department_id FOR UPDATE;

    -- Count existing active and invited members (revoked do not count)
    SELECT COUNT(*) INTO v_count
    FROM public.department_members
    WHERE department_id = NEW.department_id
      AND status IN ('invited', 'active')
      AND (TG_OP = 'INSERT' OR id != NEW.id);

    IF v_count >= 3 THEN
      RAISE EXCEPTION 'This department already has 3 members.';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_department_member_limit ON public.department_members;
CREATE TRIGGER trg_check_department_member_limit
  BEFORE INSERT OR UPDATE ON public.department_members
  FOR EACH ROW
  EXECUTE FUNCTION public.check_department_member_limit();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SEED PRESET DEPARTMENTS & BACKFILL EXISTING HOSPITAL DATA
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_prov RECORD;
  v_dept_id UUID;
  v_default_dept_id UUID;
  v_preset TEXT;
  v_presets TEXT[] := ARRAY[
    'Neurology',
    'Neurosurgery',
    'Dermatology',
    'Dentistry',
    'Cardiology',
    'Orthopedics',
    'Pediatrics',
    'General Medicine',
    'ENT',
    'Ophthalmology',
    'Gynecology'
  ];
BEGIN
  -- Enable trusted write context for schema backfill
  PERFORM set_config('app.trusted_write', 'true', true);

  -- Iterate through all hospital/clinic providers
  FOR v_prov IN 
    SELECT id FROM public.providers 
    WHERE category_id IN ('clinics', 'hospital') OR category_id ILIKE '%clinic%' OR category_id ILIKE '%hospital%'
  LOOP
    -- Insert presets for this hospital
    FOREACH v_preset IN ARRAY v_presets
    LOOP
      INSERT INTO public.departments (merchant_id, name, is_preset, allowed_modules)
      VALUES (v_prov.id, v_preset, TRUE, ARRAY['appointments', 'queue_schedule', 'check_in']::text[])
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- Retrieve General Medicine as default
    SELECT id INTO v_default_dept_id 
    FROM public.departments 
    WHERE merchant_id = v_prov.id AND lower(trim(name)) = 'general medicine'
    LIMIT 1;

    -- Map existing resources based on department name text if matching
    UPDATE public.resources r
    SET department_id = d.id
    FROM public.departments d
    WHERE r.provider_id = v_prov.id
      AND d.merchant_id = v_prov.id
      AND (
        lower(trim(r.department)) = lower(trim(d.name))
        OR (lower(r.department) LIKE '%cardio%' AND d.name = 'Cardiology')
        OR (lower(r.department) LIKE '%dental%' AND d.name = 'Dentistry')
        OR (lower(r.department) LIKE '%derma%' AND d.name = 'Dermatology')
        OR (lower(r.department) LIKE '%neuro%' AND d.name = 'Neurology')
        OR (lower(r.department) LIKE '%ortho%' AND d.name = 'Orthopedics')
        OR (lower(r.department) LIKE '%pedia%' AND d.name = 'Pediatrics')
        OR (lower(r.department) LIKE '%ent%' AND d.name = 'ENT')
        OR (lower(r.department) LIKE '%eye%' AND d.name = 'Ophthalmology')
        OR (lower(r.department) LIKE '%general%' AND d.name = 'General Medicine')
      )
      AND r.department_id IS NULL;

    -- Any unassigned resources get the default General Medicine department
    IF v_default_dept_id IS NOT NULL THEN
      UPDATE public.resources
      SET department_id = v_default_dept_id
      WHERE provider_id = v_prov.id AND department_id IS NULL;

      -- Backfill existing bookings: match resource's department, or fall back to default
      UPDATE public.bookings b
      SET department_id = COALESCE(r.department_id, v_default_dept_id)
      FROM public.resources r
      WHERE b.provider_id = v_prov.id
        AND b.resource_id = r.id
        AND b.department_id IS NULL;

      UPDATE public.bookings
      SET department_id = v_default_dept_id
      WHERE provider_id = v_prov.id AND department_id IS NULL;
    END IF;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. HELPER FUNCTIONS FOR RBAC & CONTEXT
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_department_id(p_user_id UUID, p_merchant_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT department_id
  FROM public.department_members
  WHERE user_id = p_user_id
    AND merchant_id = p_merchant_id
    AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_hospital_owner(p_user_id UUID, p_merchant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.providers 
    WHERE id = p_merchant_id AND owner_id = p_user_id
  ) OR public.is_admin(p_user_id);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ROW LEVEL SECURITY POLICIES
-- ─────────────────────────────────────────────────────────────────────────────

-- DEPARTMENTS RLS
DROP POLICY IF EXISTS owner_manage_departments ON public.departments;
CREATE POLICY owner_manage_departments ON public.departments
FOR ALL TO authenticated, service_role
USING (
  auth.role() = 'service_role'
  OR public.is_admin(auth.uid())
  OR merchant_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid())
);

DROP POLICY IF EXISTS members_view_own_department ON public.departments;
CREATE POLICY members_view_own_department ON public.departments
FOR SELECT TO authenticated
USING (
  id IN (
    SELECT department_id 
    FROM public.department_members 
    WHERE user_id = auth.uid() 
      AND status = 'active'
      AND merchant_id = departments.merchant_id
  )
);

-- DEPARTMENT MEMBERS RLS
DROP POLICY IF EXISTS owner_manage_department_members ON public.department_members;
CREATE POLICY owner_manage_department_members ON public.department_members
FOR ALL TO authenticated, service_role
USING (
  auth.role() = 'service_role'
  OR public.is_admin(auth.uid())
  OR merchant_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid())
);

DROP POLICY IF EXISTS members_view_own_membership ON public.department_members;
CREATE POLICY members_view_own_membership ON public.department_members
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR lower(email) = lower(auth.jwt()->>'email')
);

-- AUDIT LOGS RLS
DROP POLICY IF EXISTS owner_read_audit_logs ON public.audit_logs;
CREATE POLICY owner_read_audit_logs ON public.audit_logs
FOR SELECT TO authenticated, service_role
USING (
  auth.role() = 'service_role'
  OR public.is_admin(auth.uid())
  OR merchant_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid())
);

DROP POLICY IF EXISTS insert_audit_logs ON public.audit_logs;
CREATE POLICY insert_audit_logs ON public.audit_logs
FOR INSERT TO authenticated, service_role
WITH CHECK (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL
);

-- BOOKINGS RLS FOR DEPARTMENT MEMBERS
DROP POLICY IF EXISTS members_read_department_bookings ON public.bookings;
CREATE POLICY members_read_department_bookings ON public.bookings
FOR SELECT TO authenticated
USING (
  -- Owner / Admin access is covered by existing allow_reading_bookings policy
  -- Department member check:
  provider_id IN (
    SELECT merchant_id 
    FROM public.department_members 
    WHERE user_id = auth.uid() AND status = 'active'
  )
  AND department_id IN (
    SELECT department_id 
    FROM public.department_members 
    WHERE user_id = auth.uid() AND status = 'active'
  )
  AND EXISTS (
    SELECT 1 
    FROM public.departments d 
    WHERE d.id = bookings.department_id 
      AND 'appointments' = ANY(d.allowed_modules)
  )
);

DROP POLICY IF EXISTS members_update_department_bookings ON public.bookings;
CREATE POLICY members_update_department_bookings ON public.bookings
FOR UPDATE TO authenticated
USING (
  provider_id IN (
    SELECT merchant_id 
    FROM public.department_members 
    WHERE user_id = auth.uid() AND status = 'active'
  )
  AND department_id IN (
    SELECT department_id 
    FROM public.department_members 
    WHERE user_id = auth.uid() AND status = 'active'
  )
  AND EXISTS (
    SELECT 1 
    FROM public.departments d 
    WHERE d.id = bookings.department_id 
      AND 'appointments' = ANY(d.allowed_modules)
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. UPDATE verify_checkin_code RPC TO ENFORCE DEPARTMENT BOUNDARY
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_checkin_code(
    p_shop_id UUID,
    p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_staff_id UUID := auth.uid();
  v_now TIMESTAMPTZ := clock_timestamp();
  v_today_ist DATE := (v_now AT TIME ZONE 'Asia/Kolkata')::date;
  v_clean_code TEXT := trim(p_code);
  v_rate_limit public.staff_checkin_rate_limits%ROWTYPE;
  v_checkin_record public.appointment_checkin_codes%ROWTYPE;
  v_other_shop_record public.appointment_checkin_codes%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_patient_name TEXT;
  v_service_doctor TEXT;
  v_slot_time_str TEXT;
  v_is_late BOOLEAN;
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
  v_is_owner BOOLEAN;
  v_dept_member RECORD;
  v_dept_modules TEXT[];
BEGIN
  -- 1. Authentication check
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Authentication required'
    );
  END IF;

  -- 2. Staff authorization check for this shop
  v_is_owner := (p_shop_id IN (SELECT public.get_user_authorized_providers(v_staff_id)))
                OR public.is_admin(v_staff_id);

  SELECT * INTO v_dept_member
  FROM public.department_members
  WHERE user_id = v_staff_id
    AND merchant_id = p_shop_id
    AND status = 'active'
  LIMIT 1;

  IF NOT v_is_owner AND v_dept_member IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Staff is not authorized for this shop'
    );
  END IF;

  -- If department member, verify check_in module is allowed
  IF NOT v_is_owner AND v_dept_member IS NOT NULL THEN
    SELECT allowed_modules INTO v_dept_modules
    FROM public.departments
    WHERE id = v_dept_member.department_id;

    IF NOT ('check_in' = ANY(v_dept_modules)) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'MODULE_DISABLED',
        'message', 'Check-in desk module is not enabled for your department'
      );
    END IF;
  END IF;

  -- 3. Rate limit check: 5 failed attempts locks staff for 60 seconds
  SELECT * INTO v_rate_limit
  FROM public.staff_checkin_rate_limits
  WHERE user_id = v_staff_id;

  IF FOUND THEN
    IF v_rate_limit.locked_until IS NOT NULL AND v_rate_limit.locked_until > v_now THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'RATE_LIMITED',
        'message', 'Too many failed attempts. Locked for 60 seconds.',
        'locked_until', v_rate_limit.locked_until
      );
    ELSIF v_rate_limit.locked_until IS NOT NULL AND v_rate_limit.locked_until <= v_now THEN
      UPDATE public.staff_checkin_rate_limits
      SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
      WHERE user_id = v_staff_id;
    END IF;
  ELSE
    INSERT INTO public.staff_checkin_rate_limits (user_id, failed_attempts, locked_until, updated_at)
    VALUES (v_staff_id, 0, NULL, v_now)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- 4. Lookup checkin code for this shop and today
  SELECT * INTO v_checkin_record
  FROM public.appointment_checkin_codes
  WHERE provider_id = p_shop_id
    AND appointment_date = v_today_ist
    AND code = v_clean_code;

  IF NOT FOUND THEN
    SELECT * INTO v_other_shop_record
    FROM public.appointment_checkin_codes
    WHERE appointment_date = v_today_ist
      AND code = v_clean_code
      AND provider_id != p_shop_id
    LIMIT 1;

    IF FOUND THEN
      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object(
        'success', false,
        'error', 'WRONG_SHOP',
        'message', 'This check-in code belongs to another clinic or venue'
      );
    END IF;

    SELECT * INTO v_checkin_record
    FROM public.appointment_checkin_codes
    WHERE provider_id = p_shop_id
      AND code = v_clean_code
    ORDER BY appointment_date DESC
    LIMIT 1;

    IF FOUND THEN
      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object(
        'success', false,
        'error', 'EXPIRED',
        'message', 'This check-in code was for ' || v_checkin_record.appointment_date::text || ' and has expired'
      );
    END IF;

    PERFORM public._record_checkin_failure(v_staff_id, v_now);
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_CODE',
      'message', 'Invalid check-in code'
    );
  END IF;

  -- 5. Fetch associated booking
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_checkin_record.booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'BOOKING_NOT_FOUND',
      'message', 'Associated appointment record not found'
    );
  END IF;

  -- 6. DEPARTMENT ISOLATION CHECK:
  -- If caller is a department member (not owner/admin), the appointment must belong to their department!
  IF NOT v_is_owner AND v_dept_member IS NOT NULL THEN
    IF v_booking.department_id IS NOT NULL AND v_booking.department_id != v_dept_member.department_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'UNAUTHORIZED_DEPARTMENT',
        'message', 'This appointment belongs to a different medical department'
      );
    END IF;
  END IF;

  IF v_booking.status = 'CHECKED_IN' OR v_booking.is_present = TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ALREADY_CHECKED_IN',
      'message', 'This appointment is already checked in'
    );
  END IF;

  IF v_booking.status != 'CONFIRMED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_STATUS',
      'message', 'Appointment is not in confirmed status (current: ' || v_booking.status || ')'
    );
  END IF;

  -- 7. Time Window Validation: max 60 minutes before slot_start
  v_window_start := v_booking.slot_start - interval '60 minutes';
  IF v_now < v_window_start THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TOO_EARLY',
      'message', 'Check-in opens 60 minutes before scheduled time (opens at ' || to_char(v_window_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') || ')'
    );
  END IF;

  -- Late check-in detection (>10m after slot_start)
  v_is_late := v_now > (v_booking.slot_start + interval '10 minutes');

  -- 8. Mark booking as CHECKED_IN
  UPDATE public.bookings
  SET status = 'CHECKED_IN',
      is_present = TRUE,
      checked_in_at = v_now,
      checked_in_by = v_staff_id,
      checked_in_method = 'code',
      customer_arrived_at = v_now,
      updated_at = v_now
  WHERE id = v_booking.id;

  -- Reset rate limit failure counter on success
  UPDATE public.staff_checkin_rate_limits
  SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
  WHERE user_id = v_staff_id;

  -- Fetch metadata for response
  SELECT COALESCE(full_name, 'Patient') INTO v_patient_name
  FROM public.profiles WHERE id = v_booking.customer_id;

  SELECT name INTO v_service_doctor
  FROM public.resources WHERE id = v_booking.resource_id;

  v_slot_time_str := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'patient_name', v_patient_name,
    'service_doctor', v_service_doctor,
    'slot_time', v_slot_time_str,
    'is_late', v_is_late,
    'checked_in_at', v_now
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. UPDATE merchant_bookings VIEW WITH DEPARTMENT FIELDS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.merchant_bookings
WITH (security_invoker = true)
AS
SELECT
  b.id,
  b.customer_id,
  b.provider_id,
  b.resource_id,
  b.slot_start,
  b.slot_end,
  b.status,
  b.payment_status,
  b.deposit_amount,
  b.platform_fee,
  b.total_amount,
  b.gateway_payment_id,
  b.hold_expires_at,
  b.reference_code,
  b.attachment_url,
  b.reminder_1h_sent_at,
  b.reminder_30m_sent_at,
  b.is_present,
  b.customer_arrived_at,
  b.platform_fee_gst,
  b.gstin_platform,
  b.invoice_number,
  b.created_at,
  b.updated_at,
  COALESCE(c.customer_name, 'Walk-in / Guest') AS customer_name,
  COALESCE(c.customer_phone, 'Not provided') AS customer_phone,
  COALESCE(c.no_show_count, 0) AS no_show_count,
  COALESCE(r.name, 'Standard Unit') AS resource_name,
  COALESCE(r.type, 'slot') AS resource_type,
  COALESCE(p.name, 'Merchant Venue') AS provider_name,
  b.department_id,
  COALESCE(dept.name, 'General Medicine') AS department_name
FROM public.bookings b
LEFT JOIN LATERAL public.get_masked_customer_info(b.customer_id) c ON true
LEFT JOIN public.resources r ON r.id = b.resource_id
LEFT JOIN public.providers p ON p.id = b.provider_id
LEFT JOIN public.departments dept ON dept.id = b.department_id
WHERE b.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
   OR b.provider_id IN (
        SELECT merchant_id 
        FROM public.department_members 
        WHERE user_id = auth.uid() AND status = 'active'
      )
   OR public.is_admin(auth.uid());

REVOKE ALL ON public.merchant_bookings FROM anon;
GRANT SELECT ON public.merchant_bookings TO authenticated, service_role;
