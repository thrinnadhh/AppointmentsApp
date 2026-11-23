-- Description: Restore multi-channel (WhatsApp and Email) notification logging and support BOOKING_COMPLETED notifications

-- 1. Update get_template_name to support BOOKING_COMPLETED
CREATE OR REPLACE FUNCTION public.get_template_name(p_event_type text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  CASE upper(p_event_type)
    WHEN 'BOOKING_CONFIRMED', 'CONFIRMED' THEN
      RETURN 'booking_confirmed';
    WHEN 'BOOKING_REMINDER_1H', 'REMINDER_1H' THEN
      RETURN 'reminder_1h';
    WHEN 'BOOKING_CANCELLED', 'CANCELLED' THEN
      RETURN 'booking_cancelled';
    WHEN 'BOOKING_COMPLETED', 'COMPLETED' THEN
      RETURN 'booking_completed';
    WHEN 'REFUND_PROCESSED', 'REFUNDED' THEN
      RETURN 'refund_processed';
    WHEN 'AUTH_CODE', 'LOGIN_CODE' THEN
      RETURN 'auth_code';
    ELSE
      RETURN lower(p_event_type);
  END CASE;
END;
$function$;

-- 2. Update build_template_params to support booking_completed
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
    'Patient'
  );
  v_customer_first_name := split_part(trim(v_raw_name), ' ', 1);
  v_customer_first_name := public.sanitize_template_param(v_customer_first_name, 'Patient');

  v_provider_name := public.sanitize_template_param(
    p_booking->>'provider_name',
    'Clinic'
  );

  IF p_booking ? 'slot_start' THEN
    BEGIN
      v_slot_start := (p_booking->>'slot_start')::TIMESTAMPTZ;
      v_slot_datetime := to_char(v_slot_start AT TIME ZONE 'Asia/Kolkata', 'Mon DD, YYYY at HH12:MI AM');
      v_slot_time := to_char(v_slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');
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
        v_customer_first_name,
        v_provider_name,
        v_slot_time,
        v_reference
      );

    WHEN 'booking_cancelled' THEN
      RETURN jsonb_build_array(
        v_customer_first_name,
        v_provider_name,
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

-- 3. Update dispatch_booking_notification to log to both WhatsApp and Email
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

-- 4. Update trigger to dispatch on BOOKING_COMPLETED
CREATE OR REPLACE FUNCTION public.handle_booking_notification_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- When booking becomes CONFIRMED
  IF NEW.status = 'CONFIRMED' AND (TG_OP = 'INSERT' OR OLD.status != 'CONFIRMED') THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'BOOKING_CONFIRMED');
  END IF;

  -- When booking becomes COMPLETED
  IF NEW.status = 'COMPLETED' AND (TG_OP = 'UPDATE' AND OLD.status != 'COMPLETED') THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'BOOKING_COMPLETED');
  END IF;

  -- When booking becomes CANCELLED (skip unpaid HELD holds)
  IF NEW.status = 'CANCELLED' AND (TG_OP = 'UPDATE' AND OLD.status != 'CANCELLED' AND OLD.status != 'HELD') THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'BOOKING_CANCELLED');
  END IF;

  -- When refund is processed (payment_status transitions to REFUNDED)
  IF NEW.payment_status = 'REFUNDED' AND (TG_OP = 'UPDATE' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'REFUNDED')) THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'REFUND_PROCESSED');
  END IF;

  RETURN NEW;
END;
$function$;

-- 5. Update set_booking_slot_for_reminder to safely backdate created_at for deterministic reminder testing
CREATE OR REPLACE FUNCTION public.set_booking_slot_for_reminder(p_booking_id uuid, p_minutes_from_now integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_slot_start TIMESTAMPTZ;
BEGIN
  v_slot_start := NOW() + (p_minutes_from_now || ' minutes')::interval;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET slot_start = v_slot_start,
      slot_end = v_slot_start + INTERVAL '30 minutes',
      created_at = v_slot_start - INTERVAL '2 hours',
      reminder_1h_sent_at = NULL,
      reminder_30m_sent_at = NULL,
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'slot_start', v_slot_start
  );
END;
$function$;
