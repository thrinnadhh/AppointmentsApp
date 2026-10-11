-- =============================================================================
-- Migration: 20261011000001_reception_checkin_code_system.sql
-- Description:
--   1. Add 'CHECKED_IN' to booking_status ENUM.
--   2. Extend no_overlapping_active_bookings exclusion constraint on public.bookings.
--   3. Add checked_in_at, checked_in_by, and checked_in_method columns to public.bookings.
--   4. Create public.appointment_checkin_codes with RLS (customer-only direct read).
--   5. Create public.staff_checkin_rate_limits for 60s lockout after 5 failed attempts.
--   6. Config constant in platform_config for code length (default 4, configurable to 6).
--   7. Server-side CSPRNG code generation trigger for CONFIRMED appointments.
--   8. Create verify_checkin_code RPC with shop authorization, IST time window, and rate limiting.
--   9. Create mark_present_manually RPC for emergency manual reception fallback.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EXTEND booking_status ENUM & CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'CHECKED_IN';

-- Range exclusion constraint: keep slot reserved for HELD, CONFIRMED, and CHECKED_IN
ALTER TABLE public.bookings
DROP CONSTRAINT IF EXISTS no_overlapping_active_bookings;

ALTER TABLE public.bookings 
ADD CONSTRAINT no_overlapping_active_bookings 
EXCLUDE USING gist (
  resource_id WITH =,
  tstzrange(slot_start, slot_end) WITH &&
) WHERE (status IN ('HELD', 'CONFIRMED', 'CHECKED_IN'));

-- Add check-in audit columns to public.bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS checked_in_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checked_in_method TEXT CHECK (checked_in_method IN ('code', 'manual'));

CREATE INDEX IF NOT EXISTS idx_bookings_checked_in_at 
  ON public.bookings(provider_id, checked_in_at) 
  WHERE checked_in_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CREATE appointment_checkin_codes TABLE & RLS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.appointment_checkin_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    appointment_date DATE NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_shop_date_checkin_code UNIQUE (provider_id, appointment_date, code)
);

CREATE INDEX IF NOT EXISTS idx_checkin_codes_booking_id ON public.appointment_checkin_codes(booking_id);
CREATE INDEX IF NOT EXISTS idx_checkin_codes_lookup ON public.appointment_checkin_codes(provider_id, appointment_date, code);
CREATE INDEX IF NOT EXISTS idx_checkin_codes_customer_id ON public.appointment_checkin_codes(customer_id);

-- Enable RLS: Customers can only select their own code; merchant staff have NO direct read access
ALTER TABLE public.appointment_checkin_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_read_own_checkin_codes ON public.appointment_checkin_codes;
CREATE POLICY customers_read_own_checkin_codes ON public.appointment_checkin_codes
    FOR SELECT TO authenticated
    USING (customer_id = auth.uid());

REVOKE ALL ON public.appointment_checkin_codes FROM anon, PUBLIC;
GRANT SELECT ON public.appointment_checkin_codes TO authenticated;
GRANT ALL ON public.appointment_checkin_codes TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. STAFF RATE LIMIT TABLE & RLS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_checkin_rate_limits (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_checkin_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_checkin_rate_limits FROM anon, PUBLIC, authenticated;
GRANT ALL ON public.staff_checkin_rate_limits TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SEED CONFIGURATION
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.platform_config (key, value, note)
VALUES ('checkin_code_length', '4', 'Length of reception check-in code (default 4, switchable to 6)')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SERVER-SIDE CODE GENERATION (CSPRNG + RETRY ON COLLISION)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_appointment_checkin_code_for_booking(p_booking_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_code_len INT := 4;
  v_config_val TEXT;
  v_appt_date DATE;
  v_mod BIGINT;
  v_rand_val BIGINT;
  v_candidate_code TEXT;
  v_attempts INT := 0;
  v_inserted BOOLEAN := FALSE;
  v_bytes BYTEA;
  v_existing_code TEXT;
BEGIN
  -- Check if code already exists
  SELECT code INTO v_existing_code
  FROM public.appointment_checkin_codes
  WHERE booking_id = p_booking_id;

  IF v_existing_code IS NOT NULL THEN
    RETURN v_existing_code;
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Read configured length if available, default to 4
  SELECT value INTO v_config_val 
  FROM public.platform_config 
  WHERE key = 'checkin_code_length';

  IF v_config_val IS NOT NULL AND v_config_val ~ '^[0-9]+$' THEN
    v_code_len := v_config_val::INT;
    IF v_code_len < 4 OR v_code_len > 8 THEN
      v_code_len := 4;
    END IF;
  END IF;

  v_appt_date := (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date;
  v_mod := (10 ^ v_code_len)::BIGINT;

  -- Retry on collision up to 50 attempts using CSPRNG
  WHILE v_attempts < 50 AND NOT v_inserted LOOP
    v_attempts := v_attempts + 1;
    v_bytes := gen_random_bytes(4);
    
    -- Convert 4 random bytes to positive 31-bit integer
    v_rand_val := (
      (get_byte(v_bytes, 0)::bigint << 24) |
      (get_byte(v_bytes, 1)::bigint << 16) |
      (get_byte(v_bytes, 2)::bigint << 8)  |
      (get_byte(v_bytes, 3)::bigint)
    ) & 2147483647;

    v_candidate_code := lpad((v_rand_val % v_mod)::text, v_code_len, '0');

    -- Check if collision exists for this shop on this date
    IF NOT EXISTS (
      SELECT 1 FROM public.appointment_checkin_codes
      WHERE provider_id = v_booking.provider_id
        AND appointment_date = v_appt_date
        AND code = v_candidate_code
    ) THEN
      BEGIN
        INSERT INTO public.appointment_checkin_codes (
          booking_id,
          provider_id,
          customer_id,
          appointment_date,
          code
        ) VALUES (
          v_booking.id,
          v_booking.provider_id,
          v_booking.customer_id,
          v_appt_date,
          v_candidate_code
        );
        v_inserted := TRUE;
      EXCEPTION
        WHEN unique_violation THEN
          v_inserted := FALSE;
      END;
    END IF;
  END LOOP;

  IF v_inserted THEN
    RETURN v_candidate_code;
  ELSE
    RAISE WARNING 'Failed to generate unique checkin code for booking % after % attempts', p_booking_id, v_attempts;
    RETURN NULL;
  END IF;
END;
$$;

-- Trigger wrapper on public.bookings
CREATE OR REPLACE FUNCTION public.handle_booking_checkin_code_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.status = 'CONFIRMED' AND (TG_OP = 'INSERT' OR OLD.status != 'CONFIRMED') THEN
    PERFORM public.generate_appointment_checkin_code_for_booking(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_appointment_checkin_code ON public.bookings;
CREATE TRIGGER trg_generate_appointment_checkin_code
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_booking_checkin_code_trigger();

-- Backfill codes for existing confirmed appointments
DO $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN 
    SELECT id FROM public.bookings 
    WHERE status = 'CONFIRMED' 
      AND id NOT IN (SELECT booking_id FROM public.appointment_checkin_codes)
  LOOP
    PERFORM public.generate_appointment_checkin_code_for_booking(v_rec.id);
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RATE LIMIT HELPER FUNCTION
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._record_checkin_failure(p_user_id UUID, p_now TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.staff_checkin_rate_limits (user_id, failed_attempts, locked_until, updated_at)
  VALUES (p_user_id, 1, NULL, p_now)
  ON CONFLICT (user_id) DO UPDATE
  SET failed_attempts = staff_checkin_rate_limits.failed_attempts + 1,
      locked_until = CASE 
        WHEN staff_checkin_rate_limits.failed_attempts + 1 >= 5 
        THEN p_now + interval '60 seconds' 
        ELSE NULL 
      END,
      updated_at = p_now;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC: verify_checkin_code(shop_id, code)
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
  IF NOT (p_shop_id IN (SELECT public.get_user_authorized_providers(v_staff_id))) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Staff is not authorized for this shop'
    );
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
      -- Lock expired, reset failed attempts
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

  -- If not found for this shop today, check alternate error cases
  IF NOT FOUND THEN
    -- Check if code belongs to a DIFFERENT shop today (cross-shop attempt)
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

    -- Check if code is for this shop but on another date
    SELECT * INTO v_checkin_record
    FROM public.appointment_checkin_codes
    WHERE provider_id = p_shop_id
      AND code = v_clean_code
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      IF v_checkin_record.appointment_date < v_today_ist THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'EXPIRED',
          'message', 'This appointment date has passed'
        );
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'error', 'TOO_EARLY',
          'message', 'This appointment is scheduled for a future date'
        );
      END IF;
    END IF;

    -- Not found anywhere
    PERFORM public._record_checkin_failure(v_staff_id, v_now);
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_CODE',
      'message', 'Invalid check-in code'
    );
  END IF;

  -- 5. Code found! Fetch booking
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_checkin_record.booking_id;

  IF NOT FOUND THEN
    PERFORM public._record_checkin_failure(v_staff_id, v_now);
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'Booking not found');
  END IF;

  -- 6. Check if already checked in (Idempotent response)
  IF v_booking.status = 'CHECKED_IN' THEN
    SELECT COALESCE(p.full_name, 'Patient') INTO v_patient_name
    FROM public.profiles p WHERE p.id = v_booking.customer_id;

    SELECT r.name INTO v_service_doctor
    FROM public.resources r WHERE r.id = v_booking.resource_id;

    v_slot_time_str := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');
    v_is_late := v_booking.checked_in_at > (v_booking.slot_start + interval '10 minutes');

    RETURN jsonb_build_object(
      'success', false,
      'error', 'ALREADY_CHECKED_IN',
      'message', 'This appointment has already been checked in',
      'booking_id', v_booking.id,
      'patient_name', COALESCE(v_patient_name, 'Patient'),
      'service_doctor', COALESCE(v_service_doctor, 'General Appointment'),
      'slot_time', v_slot_time_str,
      'is_late', COALESCE(v_is_late, false),
      'checked_in_at', v_booking.checked_in_at
    );
  END IF;

  -- 7. Must be in CONFIRMED status
  IF v_booking.status != 'CONFIRMED' THEN
    PERFORM public._record_checkin_failure(v_staff_id, v_now);
    IF v_booking.status = 'CANCELLED' OR v_booking.status = 'NO_SHOW' THEN
      RETURN jsonb_build_object('success', false, 'error', 'EXPIRED', 'message', 'Appointment is ' || v_booking.status);
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'Appointment is not confirmed');
    END IF;
  END IF;

  -- 8. Check-in window validation:
  -- Allowed from 60 minutes before slot start until end of day in Asia/Kolkata
  v_window_start := v_booking.slot_start - interval '60 minutes';
  v_window_end := (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date + interval '1 day' - interval '1 millisecond';

  IF v_now < v_window_start THEN
    PERFORM public._record_checkin_failure(v_staff_id, v_now);
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TOO_EARLY',
      'message', 'Check-in is only allowed within 60 minutes before the scheduled slot'
    );
  END IF;

  IF v_now > v_window_end THEN
    PERFORM public._record_checkin_failure(v_staff_id, v_now);
    RETURN jsonb_build_object(
      'success', false,
      'error', 'EXPIRED',
      'message', 'Check-in window has expired for today'
    );
  END IF;

  -- 9. SUCCESS: Mark checked in & calculate is_late (> 10 mins after slot start)
  v_is_late := v_now > (v_booking.slot_start + interval '10 minutes');

  UPDATE public.bookings
  SET status = 'CHECKED_IN',
      is_present = true,
      checked_in_at = v_now,
      checked_in_by = v_staff_id,
      checked_in_method = 'code',
      customer_arrived_at = COALESCE(customer_arrived_at, v_now),
      updated_at = v_now
  WHERE id = v_booking.id;

  -- Reset rate limits on successful check-in
  UPDATE public.staff_checkin_rate_limits
  SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
  WHERE user_id = v_staff_id;

  -- Fetch metadata for response
  SELECT COALESCE(p.full_name, 'Patient') INTO v_patient_name
  FROM public.profiles p WHERE p.id = v_booking.customer_id;

  SELECT r.name INTO v_service_doctor
  FROM public.resources r WHERE r.id = v_booking.resource_id;

  v_slot_time_str := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'patient_name', COALESCE(v_patient_name, 'Patient'),
    'service_doctor', COALESCE(v_service_doctor, 'General Appointment'),
    'slot_time', v_slot_time_str,
    'is_late', v_is_late,
    'checked_in_at', v_now
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RPC: mark_present_manually(booking_id)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_present_manually(
    p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_staff_id UUID := auth.uid();
  v_now TIMESTAMPTZ := clock_timestamp();
  v_booking public.bookings%ROWTYPE;
  v_patient_name TEXT;
  v_service_doctor TEXT;
  v_slot_time_str TEXT;
  v_is_late BOOLEAN;
BEGIN
  -- 1. Authentication check
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Authentication required');
  END IF;

  -- 2. Lookup booking
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Booking not found');
  END IF;

  -- 3. Staff authorization check for this shop
  IF NOT (v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_staff_id))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Staff is not authorized for this shop');
  END IF;

  -- 4. Check already checked in
  IF v_booking.status = 'CHECKED_IN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'Booking is already checked in');
  END IF;

  -- 5. Only CONFIRMED bookings can be manually marked present
  IF v_booking.status != 'CONFIRMED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Only confirmed bookings can be marked present');
  END IF;

  -- 6. Set status and presence
  v_is_late := v_now > (v_booking.slot_start + interval '10 minutes');

  UPDATE public.bookings
  SET status = 'CHECKED_IN',
      is_present = true,
      checked_in_at = v_now,
      checked_in_by = v_staff_id,
      checked_in_method = 'manual',
      customer_arrived_at = COALESCE(customer_arrived_at, v_now),
      updated_at = v_now
  WHERE id = v_booking.id;

  -- 7. Fetch metadata
  SELECT COALESCE(p.full_name, 'Patient') INTO v_patient_name
  FROM public.profiles p WHERE p.id = v_booking.customer_id;

  SELECT r.name INTO v_service_doctor
  FROM public.resources r WHERE r.id = v_booking.resource_id;

  v_slot_time_str := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'patient_name', COALESCE(v_patient_name, 'Patient'),
    'service_doctor', COALESCE(v_service_doctor, 'General Appointment'),
    'slot_time', v_slot_time_str,
    'is_late', v_is_late,
    'checked_in_at', v_now
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. PERMISSIONS & GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.verify_checkin_code(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_checkin_code(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_present_manually(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_present_manually(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._record_checkin_failure(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._record_checkin_failure(UUID, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.generate_appointment_checkin_code_for_booking(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_appointment_checkin_code_for_booking(UUID) TO authenticated, service_role;
