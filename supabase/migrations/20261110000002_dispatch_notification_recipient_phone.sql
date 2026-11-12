-- Migration: Return recipient_phone in dispatch_booking_notification result
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
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND (SESSION_USER = 'postgres' OR CURRENT_USER = 'postgres')) THEN
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
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not authorized for this booking');
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
$function$;

