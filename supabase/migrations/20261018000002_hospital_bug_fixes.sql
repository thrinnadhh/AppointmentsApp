-- =============================================================================
-- Migration: 20261018000002_hospital_bug_fixes.sql
-- Description:
--   1. [BUG-HOSP-03] Add is_active column to public.departments for soft-deletion and consistency.
--   2. [BUG-HOSP-02] Add role column to public.department_members ('consultant' | 'front_desk').
--   3. [BUG-HOSP-01] Enhance verify_checkin_code RPC: distinguish future-date appointments
--      (APPOINTMENT_FUTURE) from expired (EXPIRED) and non-existent (INVALID_CODE).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ADD is_active TO public.departments
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_departments_is_active ON public.departments (merchant_id, is_active);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ADD role TO public.department_members
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.department_members
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'consultant'
  CHECK (role IN ('consultant', 'front_desk'));

CREATE INDEX IF NOT EXISTS idx_dept_members_role ON public.department_members (department_id, role);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ENHANCE verify_checkin_code RPC WITH APPOINTMENT_FUTURE DETECTION
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
    -- Check if this code belongs to another shop
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

    -- Check if code belongs to this shop on a different date (future vs expired)
    SELECT * INTO v_checkin_record
    FROM public.appointment_checkin_codes
    WHERE provider_id = p_shop_id
      AND code = v_clean_code
    ORDER BY appointment_date DESC
    LIMIT 1;

    IF FOUND THEN
      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      IF v_checkin_record.appointment_date > v_today_ist THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'APPOINTMENT_FUTURE',
          'message', 'This check-in code is scheduled for a future date: ' || to_char(v_checkin_record.appointment_date, 'YYYY-MM-DD') || '. Check-in opens on the scheduled appointment date.',
          'appointment_date', v_checkin_record.appointment_date
        );
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'error', 'EXPIRED',
          'message', 'This check-in code was for ' || to_char(v_checkin_record.appointment_date, 'YYYY-MM-DD') || ' and has expired',
          'appointment_date', v_checkin_record.appointment_date
        );
      END IF;
    END IF;

    -- Neither today, another shop, nor another date
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
