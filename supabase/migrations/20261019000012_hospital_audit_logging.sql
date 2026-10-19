-- =============================================================================
-- Migration: 20261019000012_hospital_audit_logging.sql
-- Description:
--   Subtask 7: Complete audit logging for hospital operations:
--   - code check-in (CHECKIN_CODE)
--   - manual check-in (CHECKIN_MANUAL)
--   - every status change (STATUS_CHANGE)
--   - queue reorder (QUEUE_REORDER)
--   - override (QUEUE_OVERRIDE)
--   - assignment changes (ASSIGNMENT_CHANGE)
--   - service edits (SERVICE_EDIT)
--   Guarantees exactly one entry per action even under races.
-- =============================================================================

-- 1. Ensure columns exist on public.audit_logs for fast indexing & queries
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS booking_id UUID,
  ADD COLUMN IF NOT EXISTS role TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_logs_booking_id ON public.audit_logs (booking_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs (action);

-- 2. Trigger for booking status changes and check-ins
CREATE OR REPLACE FUNCTION public.trg_audit_booking_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), NEW.checked_in_by);
  v_role TEXT := public.hospital_role(NEW.provider_id, v_actor_id);
  v_action TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Scope exclusively to hospital providers
  IF NOT public.is_hospital_provider(NEW.provider_id) THEN
    RETURN NEW;
  END IF;

  -- Only fire on actual status or check-in change
  IF (OLD.status IS NOT DISTINCT FROM NEW.status)
     AND (OLD.is_present IS NOT DISTINCT FROM NEW.is_present) THEN
    RETURN NEW;
  END IF;

  -- Determine action label
  IF NEW.status = 'CHECKED_IN' AND NEW.checked_in_method = 'code' THEN
    v_action := 'CHECKIN_CODE';
  ELSIF NEW.status = 'CHECKED_IN' AND NEW.checked_in_method = 'manual' THEN
    v_action := 'CHECKIN_MANUAL';
  ELSE
    v_action := 'STATUS_CHANGE';
  END IF;

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
    NEW.provider_id,
    v_actor_id,
    v_action,
    'booking',
    NEW.id,
    v_role,
    jsonb_build_object(
      'actor', v_actor_id,
      'role', v_role,
      'booking_id', NEW.id,
      'action', v_action,
      'before', jsonb_build_object('status', OLD.status, 'is_present', OLD.is_present),
      'after', jsonb_build_object('status', NEW.status, 'is_present', NEW.is_present, 'method', NEW.checked_in_method),
      'time', v_now
    ),
    v_now
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_booking_status ON public.bookings;
CREATE TRIGGER trg_audit_booking_status
  AFTER UPDATE OF status, is_present ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_audit_booking_status_change();


-- 3. Update queue reorder and override RPCs to write audit log entries
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
  v_now TIMESTAMPTZ := clock_timestamp();
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
  v_now TIMESTAMPTZ := clock_timestamp();
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


-- 4. Audit trigger for doctor_front_desk_assignments changes
CREATE OR REPLACE FUNCTION public.trg_audit_doctor_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_prov_id UUID := COALESCE(NEW.provider_id, OLD.provider_id);
  v_actor_id UUID := auth.uid();
  v_role TEXT := public.hospital_role(v_prov_id, v_actor_id);
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT public.is_hospital_provider(v_prov_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.audit_logs (
    merchant_id,
    actor_id,
    action,
    target,
    role,
    metadata,
    created_at
  ) VALUES (
    v_prov_id,
    v_actor_id,
    'ASSIGNMENT_CHANGE',
    'doctor_front_desk_assignments',
    v_role,
    jsonb_build_object(
      'actor', v_actor_id,
      'role', v_role,
      'action', 'ASSIGNMENT_CHANGE',
      'operation', TG_OP,
      'before', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE null END,
      'after', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE null END,
      'time', v_now
    ),
    v_now
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_doctor_assignments ON public.doctor_front_desk_assignments;
CREATE TRIGGER trg_audit_doctor_assignments
  AFTER INSERT OR UPDATE OR DELETE ON public.doctor_front_desk_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_audit_doctor_assignments();


-- 5. Audit trigger for service / resource edits
CREATE OR REPLACE FUNCTION public.trg_audit_resource_services()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
DECLARE
  v_prov_id UUID := COALESCE(NEW.provider_id, OLD.provider_id);
  v_actor_id UUID := auth.uid();
  v_role TEXT := public.hospital_role(v_prov_id, v_actor_id);
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT public.is_hospital_provider(v_prov_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.audit_logs (
    merchant_id,
    actor_id,
    action,
    target,
    role,
    metadata,
    created_at
  ) VALUES (
    v_prov_id,
    v_actor_id,
    'SERVICE_EDIT',
    'resources',
    v_role,
    jsonb_build_object(
      'actor', v_actor_id,
      'role', v_role,
      'action', 'SERVICE_EDIT',
      'operation', TG_OP,
      'before', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE null END,
      'after', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE null END,
      'time', v_now
    ),
    v_now
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_resource_services ON public.resources;
CREATE TRIGGER trg_audit_resource_services
  AFTER INSERT OR UPDATE OR DELETE ON public.resources
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_audit_resource_services();


-- 6. Ensure Hospital Admin can read audit logs via RLS
DROP POLICY IF EXISTS owner_read_audit_logs ON public.audit_logs;
CREATE POLICY owner_read_audit_logs ON public.audit_logs
FOR SELECT TO authenticated, service_role
USING (
  auth.role() = 'service_role'
  OR public.is_admin(auth.uid())
  OR merchant_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid())
  OR public.hospital_role(merchant_id, auth.uid()) = 'admin'
);
