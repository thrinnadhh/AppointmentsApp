-- Migration: 20261027190000_harden_override_hospital_queue_position.sql
-- Description: Harden override_hospital_queue_position against caller impersonation (vuln-0005)
-- Prevents authenticated users from passing arbitrary p_caller_id to bypass hospital RBAC.

CREATE OR REPLACE FUNCTION public.override_hospital_queue_position(
  p_booking_id uuid,
  p_override_position integer,
  p_caller_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := CASE
    WHEN auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN auth.uid()
    ELSE COALESCE(p_caller_id, auth.uid())
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
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
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
$function$;
