-- Migration: 20261122000002_restore_consultant_notification_authorization.sql
-- Description: Restore consultant resource-level authorization in public.dispatch_booking_notification
-- so that doctors and consultants can complete appointments and trigger notification dispatches.

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
  v_email_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_has_consent BOOLEAN := FALSE;
  v_booking_json JSONB;
  v_display_name TEXT;
  v_recipient_email TEXT;
BEGIN
  -- Strict allowlist of event types
  IF p_event_type NOT IN (
    'BOOKING_CONFIRMED',
    'BOOKING_REMINDER_1H',
    'BOOKING_CANCELLED',
    'BOOKING_COMPLETED',
    'REFUND_PROCESSED'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid event_type for notifications');
  END IF;

  -- Fetch booking details with provider, resource and profile/user contact info
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
    b.resource_id,
    b.booked_for,
    b.patient_name,
    p.name AS provider_name,
    p.address AS provider_address,
    p.phone AS provider_phone,
    r.name AS resource_name,
    prof.phone AS customer_phone,
    prof.email AS customer_email,
    prof.full_name AS customer_name,
    u.email AS auth_email
  INTO v_booking
  FROM public.bookings b
  JOIN public.providers p ON b.provider_id = p.id
  JOIN public.resources r ON b.resource_id = r.id
  LEFT JOIN public.profiles prof ON b.customer_id = prof.id
  LEFT JOIN auth.users u ON b.customer_id = u.id
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
    ELSIF public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_caller_id) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to dispatch notifications for this booking' USING ERRCODE = '42501';
  END IF;

  -- Phone normalization (always sends to booker's account phone)
  v_normalized_phone := public.normalize_phone_number(v_booking.customer_phone);
  IF v_normalized_phone IS NULL THEN
    v_normalized_phone := COALESCE(v_booking.customer_phone, 'unknown');
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
  CASE p_event_type
    WHEN 'BOOKING_COMPLETED' THEN
      v_msg_content := format(
        'Tirupati Appointments: Consultation at %s with %s (Ref: %s) has been completed. Status: COMPLETED.',
        v_booking.provider_name,
        v_booking.resource_name,
        COALESCE(v_booking.reference_code, p_booking_id::text)
      );
    WHEN 'BOOKING_REMINDER_1H' THEN
      v_msg_content := format(
        'Tirupati Appointments 1 hour reminder for %s at %s (Ref: %s).',
        COALESCE(v_display_name, 'Patient'),
        v_booking.provider_name,
        COALESCE(v_booking.reference_code, p_booking_id::text)
      );
    ELSE
      v_msg_content := format(
        'WhatsApp notification [%s] for %s at %s (Ref: %s)',
        v_template_name,
        COALESCE(v_display_name, 'there'),
        v_booking.provider_name,
        COALESCE(v_booking.reference_code, p_booking_id::text)
      );
  END CASE;

  -- Opt-in check for WhatsApp
  IF v_booking.customer_id IS NOT NULL THEN
    SELECT granted INTO v_has_consent
    FROM public.user_consents
    WHERE user_id = v_booking.customer_id
      AND purpose = 'whatsapp_notifications'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  -- 1. WhatsApp Notification Log
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
    CASE WHEN COALESCE(v_has_consent, false) THEN 'QUEUED' ELSE 'SKIPPED' END,
    v_template_name,
    v_template_params,
    0,
    NOW(),
    v_msg_content,
    CASE WHEN COALESCE(v_has_consent, false) THEN '{}'::jsonb ELSE jsonb_build_object('reason', 'Consent not granted') END
  )
  ON CONFLICT (booking_id, event_type, channel) DO UPDATE
  SET message_content = EXCLUDED.message_content,
      template_name = EXCLUDED.template_name,
      template_params = EXCLUDED.template_params,
      sent_at = NOW()
  RETURNING id INTO v_whatsapp_id;

  -- 2. Email Notification Log (if customer has an email address)
  v_recipient_email := COALESCE(v_booking.customer_email, v_booking.auth_email);
  IF v_recipient_email IS NOT NULL AND trim(v_recipient_email) <> '' THEN
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
      v_recipient_email,
      COALESCE(v_display_name, 'there'),
      p_event_type,
      'email',
      'SENT',
      v_msg_content,
      jsonb_build_object('provider', 'mock-email', 'recipient_email', v_recipient_email, 'timestamp', NOW())
    )
    ON CONFLICT (booking_id, event_type, channel) DO UPDATE
    SET message_content = EXCLUDED.message_content,
        status = EXCLUDED.status,
        sent_at = NOW()
    RETURNING id INTO v_email_id;
  END IF;

  -- 3. Mark 1-hour reminder timestamp if this was a reminder event
  IF p_event_type = 'BOOKING_REMINDER_1H' THEN
    UPDATE public.bookings
    SET reminder_1h_sent_at = NOW(),
        updated_at = NOW()
    WHERE id = p_booking_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'whatsapp_id', v_whatsapp_id,
    'email_id', v_email_id,
    'event_type', p_event_type
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_booking_notification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(uuid, text) TO authenticated, service_role;

-- Restore authenticated grant on expire_stale_standby_queue so hospital admin in-function RBAC can execute
GRANT EXECUTE ON FUNCTION public.expire_stale_standby_queue(integer, uuid) TO authenticated;
