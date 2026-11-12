-- Migration: 20261030000002_harden_queue_and_rpc_security.sql
-- Security Hardening:
-- 1. Defeat p_caller_id impersonation in override_hospital_queue_position and reorder_hospital_queue
-- 2. Restrict generate_appointment_checkin_code_for_booking to service_role and verify customer/staff ownership
-- 3. Restrict get_user_authorized_providers to authenticated callers and prevent inspecting other users
-- 4. Revoke is_admin execute permission from anon
-- 5. Revoke set_test_clock and advance_test_clock from anon and authenticated (service_role only)
-- 6. Revoke sync_customer_profile from anon

-- 1. Defeat p_caller_id spoofing in reorder_hospital_queue
CREATE OR REPLACE FUNCTION public.reorder_hospital_queue(
  p_provider_id UUID,
  p_doctor_id UUID,
  p_booking_ids UUID[],
  p_caller_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := CASE
    WHEN auth.role() = 'service_role' OR auth.uid() IS NULL THEN COALESCE(p_caller_id, auth.uid())
    ELSE auth.uid()
  END;
  v_role TEXT;
  v_accessible_ids UUID[];
  v_id UUID;
  v_pos INT := 1;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Authorization check
  v_role := public.hospital_role(p_provider_id, v_caller_id);
  IF v_role NOT IN ('admin', 'front_desk', 'consultant') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT ARRAY_AGG(id) INTO v_accessible_ids
  FROM public.hospital_accessible_resource_ids(p_provider_id, v_caller_id) id;

  IF NOT (p_doctor_id = ANY(v_accessible_ids)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden: Doctor queue not accessible');
  END IF;

  -- Lock all active bookings for this doctor to serialize queue updates
  PERFORM id
  FROM public.bookings
  WHERE provider_id = p_provider_id
    AND resource_id = p_doctor_id
    AND status IN ('CONFIRMED', 'CHECKED_IN')
  FOR UPDATE;

  -- Assign positions 1..N gap-free
  FOREACH v_id IN ARRAY p_booking_ids
  LOOP
    UPDATE public.bookings
    SET queue_position = v_pos,
        updated_at = v_now
    WHERE id = v_id
      AND provider_id = p_provider_id
      AND resource_id = p_doctor_id;

    v_pos := v_pos + 1;
  END LOOP;

  -- Record audit log entry for queue reorder
  INSERT INTO public.audit_logs (
    merchant_id,
    actor_id,
    action,
    target,
    booking_id,
    role,
    metadata,
    created_at
  ) VALUES (
    p_provider_id,
    v_caller_id,
    'QUEUE_REORDER',
    'queue',
    NULL,
    v_role,
    jsonb_build_object(
      'actor', v_caller_id,
      'role', v_role,
      'doctor_id', p_doctor_id,
      'action', 'QUEUE_REORDER',
      'before', null,
      'after', jsonb_build_object('booking_ids', p_booking_ids),
      'time', v_now
    ),
    v_now
  );

  RETURN jsonb_build_object('success', true, 'reordered_count', array_length(p_booking_ids, 1));
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_hospital_queue(UUID, UUID, UUID[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_hospital_queue(UUID, UUID, UUID[], UUID) TO authenticated, service_role;

-- 2. Defeat p_caller_id spoofing in override_hospital_queue_position
CREATE OR REPLACE FUNCTION public.override_hospital_queue_position(
  p_booking_id UUID,
  p_override_position INT,
  p_caller_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := CASE
    WHEN auth.role() = 'service_role' OR auth.uid() IS NULL THEN COALESCE(p_caller_id, auth.uid())
    ELSE auth.uid()
  END;
  v_booking RECORD;
  v_role TEXT;
  v_accessible_ids UUID[];
  v_target_pos INT := GREATEST(1, COALESCE(p_override_position, 1));
  b RECORD;
  v_curr_pos INT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Fetch target booking with row lock
  SELECT id, provider_id, resource_id, status, queue_position
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Verify access
  v_role := public.hospital_role(v_booking.provider_id, v_caller_id);
  IF v_role NOT IN ('admin', 'front_desk', 'consultant') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT ARRAY_AGG(id) INTO v_accessible_ids
  FROM public.hospital_accessible_resource_ids(v_booking.provider_id, v_caller_id) id;

  IF NOT (v_booking.resource_id = ANY(v_accessible_ids)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden: Doctor queue not accessible');
  END IF;

  -- Lock all active queue bookings for this doctor
  PERFORM id
  FROM public.bookings
  WHERE provider_id = v_booking.provider_id
    AND resource_id = v_booking.resource_id
    AND status IN ('CONFIRMED', 'CHECKED_IN')
  FOR UPDATE;

  -- Temporarily clear target position
  UPDATE public.bookings
  SET queue_position = NULL
  WHERE id = p_booking_id;

  -- Re-number all active bookings for this doctor ordered by current position
  -- leaving the slot open at v_target_pos
  v_curr_pos := 1;
  FOR b IN
    SELECT id
    FROM public.bookings
    WHERE provider_id = v_booking.provider_id
      AND resource_id = v_booking.resource_id
      AND status IN ('CONFIRMED', 'CHECKED_IN')
      AND id <> p_booking_id
    ORDER BY COALESCE(queue_position, 9999), slot_start ASC
  LOOP
    IF v_curr_pos = v_target_pos THEN
      v_curr_pos := v_curr_pos + 1;
    END IF;

    UPDATE public.bookings
    SET queue_position = v_curr_pos
    WHERE id = b.id;

    v_curr_pos := v_curr_pos + 1;
  END LOOP;

  -- Place the target booking at exactly v_target_pos
  UPDATE public.bookings
  SET queue_position = v_target_pos,
      updated_at = v_now
  WHERE id = p_booking_id;

  -- Record audit log entry for queue override
  INSERT INTO public.audit_logs (
    merchant_id,
    actor_id,
    action,
    target,
    booking_id,
    role,
    metadata,
    created_at
  ) VALUES (
    v_booking.provider_id,
    v_caller_id,
    'QUEUE_OVERRIDE',
    'booking',
    p_booking_id,
    v_role,
    jsonb_build_object(
      'actor', v_caller_id,
      'role', v_role,
      'booking_id', p_booking_id,
      'action', 'QUEUE_OVERRIDE',
      'before', jsonb_build_object('queue_position', v_booking.queue_position),
      'after', jsonb_build_object('queue_position', v_target_pos),
      'time', v_now
    ),
    v_now
  );

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'queue_position', v_target_pos);
END;
$$;

REVOKE ALL ON FUNCTION public.override_hospital_queue_position(UUID, INT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.override_hospital_queue_position(UUID, INT, UUID) TO authenticated, service_role;

-- 3. Restrict generate_appointment_checkin_code_for_booking
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
  -- Fetch booking first
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Check caller authorization if invoked in an authenticated context
  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
    IF auth.uid() <> v_booking.customer_id AND NOT public.is_admin(auth.uid()) THEN
      IF NOT (
        v_booking.provider_id IN (SELECT provider_id FROM public.merchant_memberships WHERE user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.providers WHERE id = v_booking.provider_id AND owner_id = auth.uid())
      ) THEN
        RAISE EXCEPTION 'Forbidden: Not authorized to access check-in code for this booking' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF auth.role() = 'anon' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Check if code already exists
  SELECT code INTO v_existing_code
  FROM public.appointment_checkin_codes
  WHERE booking_id = p_booking_id;

  IF v_existing_code IS NOT NULL THEN
    RETURN v_existing_code;
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
    
    v_rand_val := (
      (get_byte(v_bytes, 0)::bigint << 24) |
      (get_byte(v_bytes, 1)::bigint << 16) |
      (get_byte(v_bytes, 2)::bigint << 8)  |
      (get_byte(v_bytes, 3)::bigint)
    ) & 2147483647;

    v_candidate_code := lpad((v_rand_val % v_mod)::text, v_code_len, '0');

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
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_appointment_checkin_code_for_booking(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_appointment_checkin_code_for_booking(UUID) TO service_role;

-- 4. Harden get_user_authorized_providers
CREATE OR REPLACE FUNCTION public.get_user_authorized_providers(p_user_id UUID DEFAULT auth.uid())
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
    IF auth.uid() <> p_user_id AND NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Forbidden: Cannot inspect permissions of another user' USING ERRCODE = '42501';
    END IF;
  ELSIF auth.role() = 'anon' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF public.is_admin(p_user_id) THEN
    RETURN QUERY SELECT id FROM public.providers;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT provider_id FROM public.merchant_memberships WHERE user_id = p_user_id
    UNION
    SELECT id FROM public.providers WHERE owner_id = p_user_id
    UNION
    SELECT p.id FROM public.providers p
    JOIN auth.users u ON lower(trim(u.email)) = lower(trim(p.email))
    WHERE u.id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_authorized_providers(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_authorized_providers(UUID) TO authenticated, service_role;

-- 5. Revoke is_admin execute from anon
REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated, service_role;

-- 6. Revoke test clock mutation from public/anon/authenticated
REVOKE ALL ON FUNCTION public.set_test_clock(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_test_clock(TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.advance_test_clock(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_test_clock(TEXT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.get_test_clock_for_prefix(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_test_clock_for_prefix(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_test_clock(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_test_clock(UUID) TO authenticated, service_role;

-- 7. Revoke sync_customer_profile from anon
REVOKE ALL ON FUNCTION public.sync_customer_profile(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_customer_profile(TEXT, TEXT, TEXT) TO authenticated, service_role;
