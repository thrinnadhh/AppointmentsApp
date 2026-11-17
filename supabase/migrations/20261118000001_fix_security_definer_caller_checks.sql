-- =============================================================================
-- Migration: 20261118000001_fix_security_definer_caller_checks.sql
-- Description: Harden SECURITY DEFINER RPCs against authorization bypass / BOLA (DB-01, DB-04).
--
-- Replaces defective CURRENT_USER checks with:
--   (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
-- or auth.role() = 'service_role' and validates caller via auth.uid().
-- Unauthorized invocations raise SQLSTATE 42501.
-- =============================================================================

BEGIN;

-- 1. private.reassign_booking_resource
CREATE OR REPLACE FUNCTION private.reassign_booking_resource(
  p_booking_id uuid,
  p_new_resource_id uuid,
  p_reason text DEFAULT 'Emergency re-allocation'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_old_resource public.resources%ROWTYPE;
  v_new_resource public.resources%ROWTYPE;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_conflict_id UUID;
  v_customer_name TEXT;
  v_customer_phone TEXT;
BEGIN
  -- 1. Fetch booking with row lock
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- 2. Caller Authorization Guard: only service_role, DB superuser without JWT, or authorized staff/admin
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to reassign resource for this booking' USING ERRCODE = '42501';
  END IF;

  IF v_booking.status IN ('CANCELLED', 'COMPLETED', 'NO_SHOW') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot reassign a ' || lower(v_booking.status::text) || ' booking'
    );
  END IF;

  -- 3. Fetch current resource
  SELECT * INTO v_old_resource
  FROM public.resources
  WHERE id = v_booking.resource_id;

  -- 4. Fetch target resource
  SELECT * INTO v_new_resource
  FROM public.resources
  WHERE id = p_new_resource_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target resource not found');
  END IF;

  -- 5. Verify target resource belongs to same provider
  IF v_new_resource.provider_id != v_booking.provider_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target resource belongs to a different business/provider');
  END IF;

  -- 6. Verify target resource is active
  IF NOT v_new_resource.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target resource is not currently active');
  END IF;

  -- 7. Check slot conflict for new resource
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = p_new_resource_id
    AND slot_start = v_booking.slot_start
    AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING', 'UP_NEXT')
    AND id != p_booking_id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'The target resource already has a booking during this slot');
  END IF;

  -- 8. Perform update
  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET resource_id = p_new_resource_id,
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- 9. Fetch customer details for notification
  SELECT full_name, phone INTO v_customer_name, v_customer_phone
  FROM public.profiles
  WHERE id = v_booking.customer_id;

  -- 10. Log notification event (QUEUED)
  INSERT INTO public.notification_logs (
    booking_id,
    recipient_phone,
    recipient_name,
    event_type,
    channel,
    status,
    message_content,
    provider_response
  ) VALUES (
    p_booking_id,
    COALESCE(public.normalize_phone_number(v_customer_phone), '919848000000'),
    COALESCE(v_customer_name, 'Valued Customer'),
    'RESOURCE_REASSIGNED',
    'whatsapp',
    'QUEUED',
    format('Staff reassigned: Your appointment has been transferred from %s to %s due to an emergency.', COALESCE(v_old_resource.name, 'Staff'), v_new_resource.name),
    jsonb_build_object(
      'old_resource_id', v_booking.resource_id,
      'old_resource_name', v_old_resource.name,
      'new_resource_id', p_new_resource_id,
      'new_resource_name', v_new_resource.name,
      'reason', p_reason
    )
  )
  ON CONFLICT (booking_id, event_type, channel) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'old_resource_id', v_booking.resource_id,
    'old_resource_name', v_old_resource.name,
    'new_resource_id', p_new_resource_id,
    'new_resource_name', v_new_resource.name,
    'slot_start', v_booking.slot_start,
    'slot_end', v_booking.slot_end,
    'status', v_booking.status
  );
END;
$function$;

-- Update public wrapper for reassign_booking_resource
CREATE OR REPLACE FUNCTION public.reassign_booking_resource(
  p_booking_id uuid,
  p_new_resource_id uuid,
  p_reason text DEFAULT 'Emergency re-allocation'::text
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT private.reassign_booking_resource(p_booking_id, p_new_resource_id, p_reason);
$function$;

REVOKE ALL ON FUNCTION private.reassign_booking_resource(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.reassign_booking_resource(uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reassign_booking_resource(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_booking_resource(uuid, uuid, text) TO authenticated, service_role;


-- 2. private.reschedule_booking_slot
CREATE OR REPLACE FUNCTION private.reschedule_booking_slot(
  p_booking_id uuid,
  p_new_slot_start timestamp with time zone,
  p_new_slot_end timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_conflict_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_target_status public.booking_status;
  v_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_caller_id) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to reschedule this booking' USING ERRCODE = '42501';
  END IF;

  IF v_booking.status::text IN ('CHECKED_IN', 'WAITING', 'UP_NEXT', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW', 'CANCELLED')
     OR v_booking.is_present = TRUE
     OR v_booking.status::text NOT IN ('CONFIRMED', 'HELD') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);

  IF p_new_slot_start < v_now THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule to a slot in the past');
  END IF;

  IF v_caller_role <> 'service_role'
     AND v_caller_id IS NOT NULL
     AND v_caller_id = v_booking.customer_id
     AND v_booking.slot_start < v_now + INTERVAL '60 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Late reschedule: appointments within 60 minutes of their slot cannot be rescheduled.');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);
  UPDATE public.bookings
  SET status = 'CANCELLED', payment_status = 'FORFEITED', updated_at = v_now
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND status = 'HELD'
    AND hold_expires_at < v_now;

  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND (
      status IN ('CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING', 'UP_NEXT', 'PENDING_PAYMENT')
      OR (status = 'HELD' AND (hold_expires_at IS NULL OR hold_expires_at >= v_now))
    )
    AND id != p_booking_id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'The requested new slot is already booked or held');
  END IF;

  IF v_booking.status = 'HELD' THEN
    IF COALESCE(v_booking.deposit_amount, 0) > 0 AND (v_booking.payment_status != 'CAPTURED' OR v_booking.gateway_payment_id IS NULL) THEN
      v_target_status := 'HELD'::public.booking_status;
    ELSE
      v_target_status := 'CONFIRMED'::public.booking_status;
    END IF;
  ELSIF v_booking.status = 'CONFIRMED' THEN
    v_target_status := 'CONFIRMED'::public.booking_status;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET slot_start = p_new_slot_start,
      slot_end = p_new_slot_end,
      status = v_target_status,
      updated_at = v_now
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'slot_start', p_new_slot_start,
    'slot_end', p_new_slot_end,
    'status', v_target_status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_booking_slot(
  p_booking_id uuid,
  p_new_slot_start timestamp with time zone,
  p_new_slot_end timestamp with time zone
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT private.reschedule_booking_slot(p_booking_id, p_new_slot_start, p_new_slot_end);
$function$;

REVOKE ALL ON FUNCTION private.reschedule_booking_slot(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.reschedule_booking_slot(uuid, timestamptz, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reschedule_booking_slot(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_slot(uuid, timestamptz, timestamptz) TO authenticated, service_role;


-- 3. public.dispatch_booking_notification
CREATE OR REPLACE FUNCTION public.dispatch_booking_notification(p_booking_id uuid, p_event_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking RECORD;
  v_normalized_phone TEXT;
  v_template_name TEXT;
  v_template_params JSONB;
  v_msg_content TEXT;
  v_whatsapp_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_has_consent BOOLEAN := FALSE;
  v_booking_json JSONB;
  v_display_name TEXT;
BEGIN
  -- Strict allowlist of event types
  IF p_event_type NOT IN (
    'BOOKING_CONFIRMED',
    'BOOKING_REMINDER_1H',
    'BOOKING_CANCELLED',
    'REFUND_PROCESSED'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid event_type for WhatsApp notifications');
  END IF;

  -- Fetch booking details with provider and resource info
  SELECT 
    b.id,
    b.reference_code,
    b.slot_start,
    b.slot_end,
    b.status,
    b.payment_status,
    b.deposit_amount,
    b.total_amount,
    b.customer_id,
    b.provider_id,
    b.booked_for,
    b.patient_name,
    p.name AS provider_name,
    p.address AS provider_address,
    p.phone AS provider_phone,
    r.name AS resource_name,
    prof.phone AS customer_phone,
    prof.full_name AS customer_name
  INTO v_booking
  FROM public.bookings b
  JOIN public.providers p ON b.provider_id = p.id
  JOIN public.resources r ON b.resource_id = r.id
  LEFT JOIN public.profiles prof ON b.customer_id = prof.id
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to dispatch notifications for this booking' USING ERRCODE = '42501';
  END IF;

  -- Phone normalization (always sends to booker's account phone)
  v_normalized_phone := public.normalize_phone_number(v_booking.customer_phone);
  IF v_normalized_phone IS NULL THEN
    PERFORM set_config('app.trusted_write', 'true', true);
    INSERT INTO public.notification_logs (
      booking_id,
      recipient_phone,
      recipient_name,
      event_type,
      channel,
      status,
      last_error,
      message_content
    ) VALUES (
      p_booking_id,
      COALESCE(v_booking.customer_phone, 'unknown'),
      COALESCE(v_booking.customer_name, 'there'),
      p_event_type,
      'whatsapp',
      'FAILED',
      'Invalid or missing recipient phone number',
      'Phone normalization failed'
    )
    ON CONFLICT (booking_id, event_type, channel) DO NOTHING;

    RETURN jsonb_build_object('success', false, 'error', 'Invalid recipient phone number');
  END IF;

  -- If booked for family, name the patient in the message copy
  IF v_booking.booked_for = 'family' AND v_booking.patient_name IS NOT NULL AND trim(v_booking.patient_name) <> '' THEN
    v_display_name := trim(v_booking.patient_name);
  ELSE
    v_display_name := v_booking.customer_name;
  END IF;

  -- Prepare booking JSON for build_template_params
  v_booking_json := jsonb_build_object(
    'id', v_booking.id,
    'reference_code', v_booking.reference_code,
    'provider_name', v_booking.provider_name,
    'customer_name', v_display_name,
    'slot_start', v_booking.slot_start,
    'amount', COALESCE(v_booking.deposit_amount, 0)::text
  );

  v_template_name := public.get_template_name(p_event_type);
  v_template_params := public.build_template_params(p_event_type, v_booking_json);

  -- Standard message description for audit
  v_msg_content := format(
    'WhatsApp notification [%s] for %s at %s (Ref: %s)',
    v_template_name,
    COALESCE(v_display_name, 'there'),
    v_booking.provider_name,
    COALESCE(v_booking.reference_code, p_booking_id::text)
  );

  -- Opt-in check: Verify customer has granted whatsapp_notifications consent
  IF v_booking.customer_id IS NOT NULL THEN
    SELECT granted INTO v_has_consent
    FROM public.user_consents
    WHERE user_id = v_booking.customer_id
      AND purpose = 'whatsapp_notifications'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- If no consent recorded, log as SKIPPED
  IF NOT COALESCE(v_has_consent, false) THEN
    PERFORM set_config('app.trusted_write', 'true', true);
    INSERT INTO public.notification_logs (
      booking_id,
      recipient_phone,
      recipient_name,
      event_type,
      channel,
      status,
      last_error,
      message_content
    ) VALUES (
      p_booking_id,
      v_normalized_phone,
      COALESCE(v_display_name, 'there'),
      p_event_type,
      'whatsapp',
      'SKIPPED',
      'User has not consented to WhatsApp notifications',
      v_msg_content
    )
    ON CONFLICT (booking_id, event_type, channel) DO NOTHING;

    RETURN jsonb_build_object(
      'success', true,
      'channel', 'whatsapp',
      'status', 'SKIPPED',
      'queued', false,
      'skipped', true,
      'reason', 'Consent not granted'
    );
  END IF;

  -- Enqueue notification directly into public.notification_logs (idempotent ON CONFLICT DO NOTHING)
  PERFORM set_config('app.trusted_write', 'true', true);

  INSERT INTO public.notification_logs (
    booking_id,
    recipient_phone,
    recipient_name,
    event_type,
    channel,
    status,
    template_name,
    template_params,
    attempts,
    next_attempt_at,
    message_content,
    provider_response
  ) VALUES (
    p_booking_id,
    v_normalized_phone,
    COALESCE(v_display_name, 'there'),
    p_event_type,
    'whatsapp',
    'QUEUED',
    v_template_name,
    v_template_params,
    0,
    NOW(),
    v_msg_content,
    '{}'::jsonb
  )
  ON CONFLICT (booking_id, event_type, channel) DO NOTHING
  RETURNING id INTO v_whatsapp_id;

  -- If duplicate was ignored, fetch the existing row id
  IF v_whatsapp_id IS NULL THEN
    SELECT id INTO v_whatsapp_id
    FROM public.notification_logs
    WHERE booking_id = p_booking_id
      AND event_type = p_event_type
      AND channel = 'whatsapp';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'whatsapp_id', v_whatsapp_id,
    'whatsapp_log_id', v_whatsapp_id,
    'queued', true,
    'skipped', false,
    'channel', 'whatsapp',
    'status', 'QUEUED',
    'template_name', v_template_name,
    'recipient_phone', v_normalized_phone
  );
END;
$function$

;

REVOKE ALL ON FUNCTION public.dispatch_booking_notification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(uuid, text) TO authenticated, service_role;


-- 4. public.mask_old_notification_logs
CREATE OR REPLACE FUNCTION public.mask_old_notification_logs(p_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count int;
BEGIN
  IF NOT (
    (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
    OR auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only service_role or admin can execute notification log masking' USING ERRCODE = '42501';
  END IF;

  WITH updated AS (
    UPDATE public.notification_logs
    SET recipient_phone = public.mask_customer_phone(recipient_phone),
        recipient_name = 'Customer'
    WHERE created_at < (NOW() - (p_days || ' days')::interval)
      AND recipient_phone IS NOT NULL
      AND recipient_phone NOT LIKE '*%'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.mask_old_notification_logs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mask_old_notification_logs(integer) TO authenticated, service_role;


-- 5. public.get_vault_secret_by_name
CREATE OR REPLACE FUNCTION public.get_vault_secret_by_name(p_secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_secret text;
BEGIN
  -- Security Guard: Caller must be service_role or superuser/postgres without JWT
  IF NOT (
    (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Access denied: only service_role can read vault secrets' USING ERRCODE = '42501';
  END IF;

  -- Security Guard: Strict allowlist of secret names to prevent arbitrary secret dumping
  IF p_secret_name NOT IN (
    'razorpay_key_secret',
    'razorpay_webhook_secret',
    'internal_webhook_secret',
    'expo_push_access_token',
    'edge_functions_base_url'
  ) THEN
    RAISE EXCEPTION 'Access denied: secret name "%" is not in the allowed vault access list', p_secret_name USING ERRCODE = '42501';
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = p_secret_name
  LIMIT 1;

  RETURN v_secret;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_vault_secret_by_name(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vault_secret_by_name(text) TO service_role;


-- 6. public.advance_test_clock & public.set_test_clock
CREATE OR REPLACE FUNCTION public.advance_test_clock(p_prefix text, p_minutes integer)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current TIMESTAMPTZ;
  v_new TIMESTAMPTZ;
BEGIN
  -- Restrict to service_role and postgres superuser without JWT
  IF NOT (
    (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Forbidden: Only service_role or postgres may modify test clocks' USING ERRCODE = '42501';
  END IF;

  SELECT simulated_time INTO v_current
  FROM public.test_tenant_clocks
  WHERE tenant_prefix = p_prefix;

  IF NOT FOUND THEN
    v_current := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata');
  END IF;

  v_new := v_current + (p_minutes || ' minutes')::interval;

  INSERT INTO public.test_tenant_clocks (tenant_prefix, simulated_time, updated_at)
  VALUES (p_prefix, v_new, clock_timestamp())
  ON CONFLICT (tenant_prefix)
  DO UPDATE SET simulated_time = EXCLUDED.simulated_time, updated_at = clock_timestamp();

  RETURN v_new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_test_clock(p_prefix text, p_time timestamp with time zone)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Restrict to service_role and postgres superuser without JWT
  IF NOT (
    (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Forbidden: Only service_role or postgres may modify test clocks' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.test_tenant_clocks (tenant_prefix, simulated_time, updated_at)
  VALUES (p_prefix, p_time, clock_timestamp())
  ON CONFLICT (tenant_prefix)
  DO UPDATE SET simulated_time = EXCLUDED.simulated_time, updated_at = clock_timestamp();

  RETURN p_time;
END;
$function$;

REVOKE ALL ON FUNCTION public.advance_test_clock(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_test_clock(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.set_test_clock(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_test_clock(text, timestamptz) TO service_role;


-- 7. public.claim_queued_notifications
CREATE OR REPLACE FUNCTION public.claim_queued_notifications(p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, booking_id uuid, recipient_phone text, recipient_name text, event_type text, channel text, status text, template_name text, template_params jsonb, attempts integer, last_error text, next_attempt_at timestamp with time zone, message_content text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Strict security check: service_role or superuser without JWT only
  IF NOT (
    (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Access denied: claim_queued_notifications is service_role only'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  RETURN QUERY
  WITH claimed AS (
    SELECT nl.id
    FROM public.notification_logs nl
    WHERE nl.status IN ('QUEUED', 'RETRY')
      AND (nl.next_attempt_at IS NULL OR nl.next_attempt_at <= NOW())
      AND nl.attempts < 3
    ORDER BY nl.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_logs target
  SET status = 'PROCESSING',
      attempts = target.attempts + 1,
      next_attempt_at = NOW() + (POWER(2, target.attempts) || ' minutes')::interval
  FROM claimed
  WHERE target.id = claimed.id
  RETURNING
    target.id,
    target.booking_id,
    target.recipient_phone,
    target.recipient_name,
    target.event_type,
    target.channel,
    target.status,
    target.template_name,
    target.template_params,
    target.attempts,
    target.last_error,
    target.next_attempt_at,
    target.message_content,
    target.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_queued_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_queued_notifications(integer) TO service_role;


-- 8. public.replay_dlq_message
CREATE OR REPLACE FUNCTION public.replay_dlq_message(p_dlq text, p_target_queue text, p_dlq_msg_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pgmq', 'pg_temp'
AS $function$
DECLARE
  v_msg_id bigint;
  v_message jsonb;
  v_clean_payload jsonb;
  v_new_msg_id bigint;
BEGIN
  IF NOT (
    (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Access denied: only service_role can replay DLQ messages' USING ERRCODE = '42501';
  END IF;

  IF p_dlq NOT IN ('notifications_dlq', 'refunds_dlq') OR p_target_queue NOT IN ('notifications', 'refunds') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source DLQ or target queue name');
  END IF;

  -- Lock and fetch DLQ record with explicit column assignments
  EXECUTE format('SELECT msg_id, message FROM pgmq.q_%I WHERE msg_id = $1 FOR UPDATE', p_dlq)
  INTO v_msg_id, v_message
  USING p_dlq_msg_id;

  IF v_msg_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'DLQ message not found');
  END IF;

  -- Strip diagnostic DLQ metadata
  v_clean_payload := v_message - '_dlq_reason' - '_original_msg_id' - '_read_ct' - '_moved_at';

  -- Re-enqueue to active queue
  SELECT pgmq.send(p_target_queue, v_clean_payload) INTO v_new_msg_id;

  -- Delete from DLQ
  EXECUTE format('DELETE FROM pgmq.q_%I WHERE msg_id = $1', p_dlq)
  USING p_dlq_msg_id;

  -- If replaying refund, restore booking and payment status to REFUND_PENDING
  IF p_target_queue = 'refunds' AND (v_clean_payload->>'appointment_id') IS NOT NULL THEN
    PERFORM set_config('app.trusted_write', 'true', true);

    UPDATE public.bookings
    SET payment_status = 'REFUND_PENDING',
        updated_at = NOW()
    WHERE id = (v_clean_payload->>'appointment_id')::uuid
      AND payment_status = 'REFUND_FAILED';

    UPDATE public.payments
    SET status = 'REFUND_PENDING',
        updated_at = NOW()
    WHERE booking_id = (v_clean_payload->>'appointment_id')::uuid
      AND status = 'REFUND_FAILED';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'source_dlq', p_dlq,
    'target_queue', p_target_queue,
    'old_msg_id', p_dlq_msg_id,
    'new_msg_id', v_new_msg_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.replay_dlq_message(text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replay_dlq_message(text, text, bigint) TO service_role;


-- 9. public.enqueue_refund_request
CREATE OR REPLACE FUNCTION public.enqueue_refund_request(
  p_booking_id uuid,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_reason text DEFAULT 'Refund requested'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking record;
  v_refund_amount numeric(10, 2);
  v_caller_id uuid := COALESCE(p_actor_id, auth.uid());
  v_caller_role text := auth.role();
  v_is_authorized boolean := false;
  v_enqueued_msg_id bigint;
  v_payload jsonb;
BEGIN
  -- Row lock booking
  SELECT 
    id, provider_id, customer_id, gateway_payment_id,
    deposit_amount, total_amount,
    status, payment_status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := true;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := true;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized to request refund for this booking' USING ERRCODE = '42501';
  END IF;

  -- Validate refund eligibility (reject if already refunded, in progress, or already queued as pending)
  IF v_booking.payment_status IN ('REFUNDED', 'REFUND_IN_PROGRESS', 'REFUND_PENDING') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Booking is not eligible for refund: current status is ' || v_booking.payment_status
    );
  END IF;

  -- Calculate refund amount: deposit if available, else total
  v_refund_amount := COALESCE(v_booking.deposit_amount, v_booking.total_amount, 0);

  IF v_refund_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No refundable amount found on booking'
    );
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  -- Mark booking payment_status as REFUND_PENDING
  UPDATE public.bookings
  SET payment_status = 'REFUND_PENDING',
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- Build privacy-safe payload (IDs and numbers only, NO PII)
  v_payload := jsonb_build_object(
    'appointment_id', v_booking.id,
    'tenant_id', v_booking.provider_id,
    'user_id', v_booking.customer_id,
    'type', 'REFUND_REQUESTED',
    'amount', v_refund_amount,
    'reason', p_reason,
    'gateway_payment_id', v_booking.gateway_payment_id
  );

  -- Enqueue into pgmq refunds queue
  SELECT pgmq.send('refunds', v_payload) INTO v_enqueued_msg_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'payment_status', 'REFUND_PENDING',
    'refund_amount', v_refund_amount,
    'queue_msg_id', v_enqueued_msg_id
  );
EXCEPTION
  WHEN sqlstate '42501' THEN
    RAISE;
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) TO authenticated, service_role;


-- 10. private.get_masked_customer_info
CREATE OR REPLACE FUNCTION private.get_masked_customer_info(p_customer_id uuid)
RETURNS TABLE(customer_name text, customer_phone text, no_show_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF v_caller_role = 'service_role' OR (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = p_customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.customer_id = p_customer_id
        AND b.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id))
    ) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      COALESCE(pr.full_name, 'Walk-in / Guest')::TEXT AS customer_name,
      public.mask_customer_phone(pr.phone)::TEXT AS customer_phone,
      COALESCE(pr.no_show_count, 0)::INTEGER AS no_show_count
    FROM public.profiles pr
    WHERE pr.id = p_customer_id;
END;
$function$;

COMMIT;
