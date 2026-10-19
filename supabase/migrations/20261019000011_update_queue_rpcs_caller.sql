-- =============================================================================
-- Migration: 20261019000011_update_queue_rpcs_caller.sql
-- Description:
--   Allow reorder_hospital_queue and override_hospital_queue_position
--   to accept an optional p_caller_id parameter for service_role API routes.
-- =============================================================================

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
  v_caller_id UUID := COALESCE(p_caller_id, auth.uid());
  v_role TEXT;
  v_accessible_ids UUID[];
  v_id UUID;
  v_pos INT := 1;
BEGIN
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
        updated_at = clock_timestamp()
    WHERE id = v_id
      AND provider_id = p_provider_id
      AND resource_id = p_doctor_id;

    v_pos := v_pos + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reordered_count', array_length(p_booking_ids, 1));
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_hospital_queue(UUID, UUID, UUID[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_hospital_queue(UUID, UUID, UUID[], UUID) TO authenticated, service_role;


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
  v_caller_id UUID := COALESCE(p_caller_id, auth.uid());
  v_booking RECORD;
  v_role TEXT;
  v_accessible_ids UUID[];
  v_target_pos INT := GREATEST(1, COALESCE(p_override_position, 1));
  b RECORD;
  v_curr_pos INT;
BEGIN
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
      updated_at = clock_timestamp()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'queue_position', v_target_pos);
END;
$$;

REVOKE ALL ON FUNCTION public.override_hospital_queue_position(UUID, INT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.override_hospital_queue_position(UUID, INT, UUID) TO authenticated, service_role;
