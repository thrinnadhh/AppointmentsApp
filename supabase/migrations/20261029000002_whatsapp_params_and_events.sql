-- Migration: 20261029000002_whatsapp_params_and_events.sql
-- Description: Step 3: Single build_template_params function, sanitization,
-- dispatch_booking_notification using build_template_params & consent checking,
-- 1-hour reminder scheduler (55-65 min window, skips <60m created bookings),
-- and refund processed event trigger.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SANITIZATION HELPER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sanitize_template_param(
  p_val TEXT,
  p_default TEXT DEFAULT 'there'
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_cleaned TEXT;
BEGIN
  IF p_val IS NULL THEN
    RETURN p_default;
  END IF;

  -- Trim, replace newlines, tabs, and runs of spaces with a single space
  v_cleaned := trim(regexp_replace(p_val, '[[:space:]]+', ' ', 'g'));

  IF v_cleaned = '' THEN
    RETURN p_default;
  END IF;

  -- Truncate to 100 characters maximum
  IF length(v_cleaned) > 100 THEN
    v_cleaned := substring(v_cleaned FROM 1 FOR 100);
  END IF;

  RETURN v_cleaned;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TEMPLATE NAME REGISTRY MAPPER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_template_name(p_event_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE upper(p_event_type)
    WHEN 'BOOKING_CONFIRMED', 'CONFIRMED' THEN
      RETURN 'booking_confirmed';
    WHEN 'BOOKING_REMINDER_1H', 'REMINDER_1H' THEN
      RETURN 'reminder_1h';
    WHEN 'BOOKING_CANCELLED', 'CANCELLED' THEN
      RETURN 'booking_cancelled';
    WHEN 'REFUND_PROCESSED', 'REFUNDED' THEN
      RETURN 'refund_processed';
    WHEN 'AUTH_CODE', 'LOGIN_CODE' THEN
      RETURN 'auth_code';
    ELSE
      RETURN lower(p_event_type);
  END CASE;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE SINGLE build_template_params FUNCTION
-- Contract per Registry:
-- booking_confirmed: [1 customer first name, 2 provider name, 3 slot date-time, 4 reference]
-- reminder_1h:       [1 provider name, 2 slot time, 3 reference]
-- booking_cancelled: [1 provider name, 2 slot date-time, 3 reference]
-- refund_processed:  [1 amount, 2 reference]
-- auth_code:         [1 one-time code]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.build_template_params(
  p_event_type TEXT,
  p_booking JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- If p_booking has an 'id' and missing crucial details, fetch from DB
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
        'customer_name', COALESCE(p_booking->>'customer_name', v_booking_record.customer_name),
        'reference_code', COALESCE(p_booking->>'reference_code', v_booking_record.reference_code),
        'slot_start', COALESCE(p_booking->>'slot_start', v_booking_record.slot_start::text),
        'deposit_amount', COALESCE(p_booking->>'deposit_amount', v_booking_record.deposit_amount::text)
      );
    END IF;
  END IF;

  -- Extract and format slot start in Asia/Kolkata timezone
  IF p_booking ? 'slot_start' AND p_booking->>'slot_start' IS NOT NULL THEN
    v_slot_start := (p_booking->>'slot_start')::TIMESTAMPTZ;
    v_slot_datetime := to_char(v_slot_start AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, FMHH12:MI AM');
    v_slot_time := to_char(v_slot_start AT TIME ZONE 'Asia/Kolkata', 'FMHH12:MI AM');
  ELSE
    v_slot_datetime := 'Scheduled Time';
    v_slot_time := 'Scheduled Time';
  END IF;

  -- 1. Customer first name (first name only, empty -> "there")
  v_raw_name := COALESCE(p_booking->>'customer_name', p_booking->>'name', p_booking->>'recipient_name');
  IF v_raw_name IS NOT NULL AND trim(v_raw_name) <> '' THEN
    v_customer_first_name := split_part(trim(v_raw_name), ' ', 1);
  ELSE
    v_customer_first_name := 'there';
  END IF;
  v_customer_first_name := public.sanitize_template_param(v_customer_first_name, 'there');

  -- 2. Provider name
  v_provider_name := public.sanitize_template_param(
    COALESCE(p_booking->>'provider_name', p_booking->>'provider'),
    'Provider'
  );

  -- 3. Reference exactly as stored
  v_reference := public.sanitize_template_param(
    COALESCE(p_booking->>'reference_code', p_booking->>'reference', p_booking->>'id'),
    'REF'
  );

  -- Dispatch per exact template registry contract
  CASE v_template_name
    WHEN 'booking_confirmed' THEN
      -- [1 customer first name, 2 provider name, 3 slot date-time, 4 reference]
      RETURN jsonb_build_array(
        v_customer_first_name,
        v_provider_name,
        v_slot_datetime,
        v_reference
      );

    WHEN 'reminder_1h' THEN
      -- [1 provider name, 2 slot time, 3 reference]
      RETURN jsonb_build_array(
        v_provider_name,
        v_slot_time,
        v_reference
      );

    WHEN 'booking_cancelled' THEN
      -- [1 provider name, 2 slot date-time, 3 reference]
      RETURN jsonb_build_array(
        v_provider_name,
        v_slot_datetime,
        v_reference
      );

    WHEN 'refund_processed' THEN
      -- [1 amount, 2 reference]
      -- Plain number, no symbol/commas, convert from paise if stored so
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

      -- If explicitly flagged as paise, convert to standard currency units
      IF (p_booking->>'is_paise')::boolean IS TRUE OR (p_booking->>'in_paise')::boolean IS TRUE THEN
        v_numeric_amount := v_numeric_amount / 100.0;
      END IF;

      -- Format plain number without symbol or commas (omit trailing .00 if integer)
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
      -- [1 one-time code]
      v_code := public.sanitize_template_param(
        COALESCE(p_booking->>'code', p_booking->>'otp', p_booking->>'auth_code'),
        '000000'
      );
      RETURN jsonb_build_array(v_code);

    ELSE
      RAISE EXCEPTION 'Unknown template for event_type: %', p_event_type;
  END CASE;
END;
$$;

-- Overload allowing build_template_params(p_event_type TEXT, p_booking_id UUID)
CREATE OR REPLACE FUNCTION public.build_template_params(
  p_event_type TEXT,
  p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.build_template_params(p_event_type, jsonb_build_object('id', p_booking_id));
END;
$$;

REVOKE ALL ON FUNCTION public.build_template_params(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_template_params(TEXT, JSONB) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.build_template_params(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_template_params(TEXT, UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REWRITE dispatch_booking_notification
-- - Inserts ONLY channel 'whatsapp'
-- - Checks user_consents for 'whatsapp_notifications'
-- - If no consent: inserts row with status 'SKIPPED' and reason, ON CONFLICT DO NOTHING
-- - If consent: inserts row with status 'QUEUED', template_name, template_params
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispatch_booking_notification(
  p_booking_id UUID,
  p_event_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking RECORD;
  v_normalized_phone TEXT;
  v_customer_first_name TEXT;
  v_template_name TEXT;
  v_template_params JSONB;
  v_msg_content TEXT;
  v_whatsapp_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_has_consent BOOLEAN := FALSE;
  v_booking_json JSONB;
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

  -- Phone normalization
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

  -- Prepare booking JSON for build_template_params
  v_booking_json := jsonb_build_object(
    'id', v_booking.id,
    'reference_code', v_booking.reference_code,
    'provider_name', v_booking.provider_name,
    'customer_name', v_booking.customer_name,
    'slot_start', v_booking.slot_start,
    'amount', COALESCE(v_booking.deposit_amount, 0)::text
  );

  v_template_name := public.get_template_name(p_event_type);
  v_template_params := public.build_template_params(p_event_type, v_booking_json);

  -- Standard message description for audit
  v_msg_content := format(
    'WhatsApp notification [%s] for %s at %s (Ref: %s)',
    v_template_name,
    COALESCE(v_booking.customer_name, 'there'),
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
  ELSE
    v_has_consent := FALSE;
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  -- If customer has NOT consented, insert a row with status 'SKIPPED' and reason
  IF v_has_consent IS NOT TRUE THEN
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
      COALESCE(v_booking.customer_name, 'there'),
      p_event_type,
      'whatsapp',
      'SKIPPED',
      v_template_name,
      v_template_params,
      'Customer has not granted whatsapp_notifications consent',
      v_msg_content,
      0
    )
    ON CONFLICT (booking_id, event_type, channel) DO NOTHING
    RETURNING id INTO v_whatsapp_id;

    RETURN jsonb_build_object(
      'success', true,
      'queued', false,
      'skipped', true,
      'reason', 'Customer has not granted whatsapp_notifications consent'
    );
  END IF;

  -- Insert QUEUED notification log (idempotent ON CONFLICT DO NOTHING)
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
    COALESCE(v_booking.customer_name, 'there'),
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

  -- If duplicate, fetch existing row
  IF v_whatsapp_id IS NULL THEN
    SELECT id INTO v_whatsapp_id
    FROM public.notification_logs
    WHERE booking_id = p_booking_id
      AND event_type = p_event_type
      AND channel = 'whatsapp';
  END IF;

  -- If 1-hour reminder, update reminder_1h_sent_at on booking
  IF p_event_type = 'BOOKING_REMINDER_1H' THEN
    UPDATE public.bookings
    SET reminder_1h_sent_at = NOW(),
        updated_at = NOW()
    WHERE id = p_booking_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'queued', true,
    'booking_id', p_booking_id,
    'event_type', p_event_type,
    'channel', 'whatsapp',
    'status', 'QUEUED',
    'whatsapp_log_id', v_whatsapp_id,
    'template_name', v_template_name,
    'recipient_phone', v_normalized_phone
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. AUTOMATED 1-HOUR REMINDER SCHEDULER (55-65 min window, skips <60m created)
-- NO 30-MINUTE REMINDERS!
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_and_send_booking_reminders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_count_1h INTEGER := 0;
BEGIN
  -- Scan for 1-hour reminders:
  -- - status is CONFIRMED
  -- - reminder_1h_sent_at IS NULL
  -- - slot_start between 55 and 65 minutes from now
  -- - skip bookings created < 60 minutes before slot_start
  FOR v_rec IN
    SELECT b.id, b.slot_start, b.created_at
    FROM public.bookings b
    WHERE b.status = 'CONFIRMED'
      AND b.reminder_1h_sent_at IS NULL
      AND b.slot_start >= NOW() + INTERVAL '55 minutes'
      AND b.slot_start <= NOW() + INTERVAL '65 minutes'
      AND b.created_at <= (b.slot_start - INTERVAL '60 minutes')
  LOOP
    PERFORM public.dispatch_booking_notification(v_rec.id, 'BOOKING_REMINDER_1H');
    v_count_1h := v_count_1h + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reminders_1h_dispatched', v_count_1h,
    'executed_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_send_booking_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_and_send_booking_reminders() TO authenticated, service_role;

-- Update pg_cron schedule to run check-booking-reminders every minute
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-booking-reminders') THEN
    PERFORM cron.unschedule('check-booking-reminders');
  END IF;
  PERFORM cron.schedule(
    'check-booking-reminders',
    '* * * * *',
    'SELECT public.check_and_send_booking_reminders();'
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. TRIGGER ON public.bookings FOR AUTOMATIC EVENTS
-- CONFIRMED, CANCELLED, and REFUND_PROCESSED
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_booking_notification_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- When booking becomes CONFIRMED
  IF NEW.status = 'CONFIRMED' AND (TG_OP = 'INSERT' OR OLD.status != 'CONFIRMED') THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'BOOKING_CONFIRMED');
  END IF;

  -- When booking becomes CANCELLED
  IF NEW.status = 'CANCELLED' AND (TG_OP = 'UPDATE' AND OLD.status != 'CANCELLED') THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'BOOKING_CANCELLED');
  END IF;

  -- When refund is processed (payment_status transitions to REFUNDED)
  IF NEW.payment_status = 'REFUNDED' AND (TG_OP = 'UPDATE' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'REFUNDED')) THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'REFUND_PROCESSED');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_notification_events ON public.bookings;
CREATE TRIGGER trg_booking_notification_events
  AFTER INSERT OR UPDATE OF status, payment_status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_booking_notification_trigger();
