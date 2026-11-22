-- Migration: 20261122000003_harmonize_notification_contracts.sql
-- Description: Harmonize build_template_params and dispatch_booking_notification contracts:
-- 1. Format slot date-time as 'DD Mon YYYY, FMHH12:MI AM' (e.g. '30 Oct 2026, 3:30 PM') and slot time as 'FMHH12:MI AM' (e.g. '3:30 PM').
-- 2. Preserve exact template param signatures:
--    - booking_confirmed: [customer first name, provider name, slot date-time, reference code]
--    - reminder_1h: [provider name, slot time, reference code]
--    - booking_cancelled: [provider name, slot date-time, reference code]
--    - booking_completed: [customer first name, provider name, reference code]
--    - refund_processed: [amount, reference code]
--    - auth_code: [code]
-- 3. Return explicit 'status' ('QUEUED' or 'SKIPPED') and 'channel' ('whatsapp') in dispatch_booking_notification
--    and record 'last_error' when consent is absent.
-- 4. Preserve consultant resource authorization and trigger support for BOOKING_COMPLETED.

-- 1. Update build_template_params
CREATE OR REPLACE FUNCTION public.build_template_params(p_event_type text, p_booking jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_template_name TEXT;
  v_customer_first_name TEXT;
  v_raw_name TEXT;
  v_provider_name TEXT;
  v_slot_datetime TEXT;
  v_slot_time TEXT;
  v_reference TEXT;
  v_amount_formatted TEXT;
  v_code TEXT;
  v_slot_start TIMESTAMPTZ;
  v_booking_record RECORD;
  v_raw_amount TEXT;
  v_cleaned_amount TEXT;
  v_numeric_amount NUMERIC;
BEGIN
  v_template_name := public.get_template_name(p_event_type);

  IF p_booking ? 'id' AND (
    NOT (p_booking ? 'provider_name') OR
    NOT (p_booking ? 'slot_start') OR
    NOT (p_booking ? 'reference_code')
  ) THEN
    SELECT
      b.id,
      b.reference_code,
      b.slot_start,
      b.deposit_amount,
      p.name AS provider_name,
      prof.full_name AS customer_name
    INTO v_booking_record
    FROM public.bookings b
    LEFT JOIN public.providers p ON b.provider_id = p.id
    LEFT JOIN public.profiles prof ON b.customer_id = prof.id
    WHERE b.id = (p_booking->>'id')::UUID;

    IF FOUND THEN
      p_booking := p_booking || jsonb_build_object(
        'provider_name', COALESCE(p_booking->>'provider_name', v_booking_record.provider_name),
        'slot_start', COALESCE(p_booking->>'slot_start', v_booking_record.slot_start::text),
        'reference_code', COALESCE(p_booking->>'reference_code', v_booking_record.reference_code),
        'amount', COALESCE(p_booking->>'amount', v_booking_record.deposit_amount::text),
        'customer_name', COALESCE(p_booking->>'customer_name', v_booking_record.customer_name)
      );
    END IF;
  END IF;

  v_raw_name := COALESCE(
    p_booking->>'customer_name',
    p_booking->>'name',
    p_booking->>'recipient_name'
  );
  IF v_raw_name IS NOT NULL AND trim(v_raw_name) <> '' THEN
    v_customer_first_name := split_part(trim(v_raw_name), ' ', 1);
  ELSE
    v_customer_first_name := 'there';
  END IF;
  v_customer_first_name := public.sanitize_template_param(v_customer_first_name, 'there');

  v_provider_name := public.sanitize_template_param(
    COALESCE(p_booking->>'provider_name', p_booking->>'provider'),
    'Clinic'
  );

  IF p_booking ? 'slot_start' AND p_booking->>'slot_start' IS NOT NULL THEN
    BEGIN
      v_slot_start := (p_booking->>'slot_start')::TIMESTAMPTZ;
      v_slot_datetime := to_char(v_slot_start AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, FMHH12:MI AM');
      v_slot_time := to_char(v_slot_start AT TIME ZONE 'Asia/Kolkata', 'FMHH12:MI AM');
    EXCEPTION WHEN OTHERS THEN
      v_slot_datetime := COALESCE(p_booking->>'slot_start', 'Scheduled Time');
      v_slot_time := 'Scheduled Time';
    END;
  ELSE
    v_slot_datetime := 'Scheduled Time';
    v_slot_time := 'Scheduled Time';
  END IF;

  v_reference := public.sanitize_template_param(
    COALESCE(p_booking->>'reference_code', p_booking->>'reference', p_booking->>'id'),
    'TPT-000000'
  );

  CASE v_template_name
    WHEN 'booking_confirmed' THEN
      RETURN jsonb_build_array(
        v_customer_first_name,
        v_provider_name,
        v_slot_datetime,
        v_reference
      );

    WHEN 'reminder_1h' THEN
      RETURN jsonb_build_array(
        v_provider_name,
        v_slot_time,
        v_reference
      );

    WHEN 'booking_cancelled' THEN
      RETURN jsonb_build_array(
        v_provider_name,
        v_slot_datetime,
        v_reference
      );

    WHEN 'booking_completed' THEN
      RETURN jsonb_build_array(
        v_customer_first_name,
        v_provider_name,
        v_reference
      );

    WHEN 'refund_processed' THEN
      v_raw_amount := COALESCE(
        p_booking->>'amount',
        p_booking->>'refund_amount',
        p_booking->>'deposit_amount',
        '0'
      );
      v_cleaned_amount := regexp_replace(v_raw_amount, '[^0-9.]', '', 'g');
      IF v_cleaned_amount = '' THEN
        v_cleaned_amount := '0';
      END IF;
      v_numeric_amount := v_cleaned_amount::numeric;
      IF (p_booking->>'is_paise')::boolean IS TRUE OR (p_booking->>'in_paise')::boolean IS TRUE THEN
        v_numeric_amount := v_numeric_amount / 100.0;
      END IF;
      IF v_numeric_amount = trunc(v_numeric_amount) THEN
        v_amount_formatted := v_numeric_amount::bigint::text;
      ELSE
        v_amount_formatted := trim(to_char(v_numeric_amount, 'FM999999990.00'));
      END IF;
      RETURN jsonb_build_array(
        v_amount_formatted,
        v_reference
      );

    WHEN 'auth_code' THEN
      v_code := public.sanitize_template_param(
        COALESCE(p_booking->>'code', p_booking->>'otp', p_booking->>'auth_code'),
        '000000'
      );
      RETURN jsonb_build_array(v_code);

    ELSE
      RETURN jsonb_build_array(v_customer_first_name, v_reference);
  END CASE;
END;
$function$;

REVOKE ALL ON FUNCTION public.build_template_params(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_template_params(text, jsonb) TO authenticated, service_role;

-- 2. Update dispatch_booking_notification
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
  ELSE
    v_has_consent := FALSE;
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  -- If no consent recorded, log as SKIPPED
  IF NOT COALESCE(v_has_consent, false) THEN
    INSERT INTO public.notification_logs (
      booking_id,
      recipient_phone,
      recipient_name,
      event_type,
      channel,
      status,
      template_name,
      template_params,
      last_error,
      message_content,
      attempts
    ) VALUES (
      p_booking_id,
      v_normalized_phone,
      COALESCE(v_display_name, 'there'),
      p_event_type,
      'whatsapp',
      'SKIPPED',
      v_template_name,
      v_template_params,
      'Customer has not granted whatsapp_notifications consent',
      v_msg_content,
      0
    )
    ON CONFLICT (booking_id, event_type, channel) DO UPDATE
    SET status = 'SKIPPED',
        last_error = 'Customer has not granted whatsapp_notifications consent',
        template_name = EXCLUDED.template_name,
        template_params = EXCLUDED.template_params,
        message_content = EXCLUDED.message_content
    RETURNING id INTO v_whatsapp_id;

    IF v_whatsapp_id IS NULL THEN
      SELECT id INTO v_whatsapp_id
      FROM public.notification_logs
      WHERE booking_id = p_booking_id
        AND event_type = p_event_type
        AND channel = 'whatsapp';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'channel', 'whatsapp',
      'status', 'SKIPPED',
      'queued', false,
      'skipped', true,
      'reason', 'Consent not granted',
      'whatsapp_id', v_whatsapp_id,
      'whatsapp_log_id', v_whatsapp_id,
      'event_type', p_event_type
    );
  END IF;

  -- Enqueue notification directly into public.notification_logs (idempotent ON CONFLICT DO UPDATE)
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
    last_error,
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
    NULL,
    '{}'::jsonb
  )
  ON CONFLICT (booking_id, event_type, channel) DO UPDATE
  SET status = 'QUEUED',
      template_name = EXCLUDED.template_name,
      template_params = EXCLUDED.template_params,
      message_content = EXCLUDED.message_content,
      last_error = NULL
  RETURNING id INTO v_whatsapp_id;

  IF v_whatsapp_id IS NULL THEN
    SELECT id INTO v_whatsapp_id
    FROM public.notification_logs
    WHERE booking_id = p_booking_id
      AND event_type = p_event_type
      AND channel = 'whatsapp';
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
    'channel', 'whatsapp',
    'status', 'QUEUED',
    'queued', true,
    'skipped', false,
    'whatsapp_id', v_whatsapp_id,
    'whatsapp_log_id', v_whatsapp_id,
    'event_type', p_event_type,
    'template_name', v_template_name,
    'recipient_phone', v_normalized_phone
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_booking_notification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(uuid, text) TO authenticated, service_role;
