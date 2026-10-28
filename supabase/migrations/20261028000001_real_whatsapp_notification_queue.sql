-- Migration: 20261028000001_real_whatsapp_notification_queue.sql
-- Description: Transition notification_logs to a genuine queue for real WhatsApp integration.
-- Stop fake 'SENT' logs, add provider tracking, idempotent unique index, and SKIP LOCKED claim queue.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PHONE NORMALIZATION HELPER FUNCTION
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_phone_number(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits TEXT;
BEGIN
  IF p_phone IS NULL THEN
    RETURN NULL;
  END IF;

  -- Strip all non-digit characters
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');

  IF length(v_digits) = 0 THEN
    RETURN NULL;
  END IF;

  -- 11 digits starting with 0 (e.g. 09876543210) -> 919876543210
  IF length(v_digits) = 11 AND v_digits LIKE '0%' THEN
    RETURN '91' || substring(v_digits FROM 2);
  END IF;

  -- Standard 10-digit Indian mobile number -> prepend 91
  IF length(v_digits) = 10 THEN
    RETURN '91' || v_digits;
  END IF;

  -- Already has 91 prefix with 12 or more digits
  IF v_digits LIKE '91%' AND length(v_digits) >= 12 THEN
    RETURN v_digits;
  END IF;

  -- Fallback: return raw digits
  RETURN v_digits;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. UPDATE user_consents CHECK CONSTRAINT TO ALLOW 'whatsapp_notifications'
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_consents DROP CONSTRAINT IF EXISTS user_consents_purpose_check;
ALTER TABLE public.user_consents ADD CONSTRAINT user_consents_purpose_check CHECK (
  purpose IN (
    'phone_otp',
    'location_detection',
    'booking_data',
    'clinical_booking',
    'marketing_notifications',
    'whatsapp_notifications'
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SCHEMA UPGRADES FOR public.notification_logs
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notification_logs
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS template_name TEXT,
  ADD COLUMN IF NOT EXISTS template_params JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ DEFAULT now();

-- Normalize existing statuses to uppercase and default any invalid values
UPDATE public.notification_logs
SET status = UPPER(status)
WHERE status != UPPER(status);

UPDATE public.notification_logs
SET status = 'QUEUED'
WHERE status NOT IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- Change default status to 'QUEUED'
ALTER TABLE public.notification_logs
  ALTER COLUMN status SET DEFAULT 'QUEUED';

-- Add status check constraint
ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS chk_notification_logs_status;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT chk_notification_logs_status
  CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'));

-- Safely clean duplicate (booking_id, event_type, channel) rows before creating unique index
DELETE FROM public.notification_logs a
USING public.notification_logs b
WHERE a.booking_id = b.booking_id
  AND a.event_type = b.event_type
  AND a.channel = b.channel
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));

-- Replace old non-unique index with unique index
DROP INDEX IF EXISTS public.idx_notification_logs_booking;
CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_notification_logs_booking_event_channel
  ON public.notification_logs(booking_id, event_type, channel);

-- Index for queue worker polling
CREATE INDEX IF NOT EXISTS idx_notification_logs_claim_queue
  ON public.notification_logs(next_attempt_at ASC, created_at ASC)
  WHERE status = 'QUEUED';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REWRITE dispatch_booking_notification (GENUINE QUEUE ONLY)
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
  v_phone TEXT;
  v_normalized_phone TEXT;
  v_name TEXT;
  v_ref TEXT;
  v_slot_datetime TEXT;
  v_slot_time TEXT;
  v_template_name TEXT;
  v_template_params JSONB;
  v_msg_content TEXT;
  v_whatsapp_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_has_consent BOOLEAN := FALSE;
BEGIN
  -- Strict allowlist
  IF p_event_type NOT IN (
    'BOOKING_CONFIRMED',
    'BOOKING_REMINDER_1H',
    'BOOKING_REMINDER_30M',
    'BOOKING_CANCELLED'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid event_type: not in allowed notification types');
  END IF;

  -- Fetch booking details with provider and resource info
  SELECT 
    b.id,
    b.reference_code,
    b.slot_start,
    b.slot_end,
    b.status,
    b.payment_status,
    b.customer_id,
    b.provider_id,
    p.name AS provider_name,
    p.address AS provider_address,
    p.phone AS provider_phone,
    r.name AS resource_name,
    r.department AS resource_dept,
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

  -- Authorization check: service_role, postgres, owning customer, provider staff/owner, or admin
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
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not authorized for this booking notification');
  END IF;

  -- Opt-in check: Verify customer has granted whatsapp_notifications consent
  IF v_booking.customer_id IS NOT NULL THEN
    SELECT granted INTO v_has_consent
    FROM public.user_consents
    WHERE user_id = v_booking.customer_id
      AND purpose = 'whatsapp_notifications'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_has_consent IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', true,
        'queued', false,
        'skipped', true,
        'reason', 'Customer has not granted whatsapp_notifications consent'
      );
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'success', true,
      'queued', false,
      'skipped', true,
      'reason', 'No customer account associated with booking'
    );
  END IF;

  v_phone := COALESCE(v_booking.customer_phone, '');
  v_normalized_phone := public.normalize_phone_number(v_phone);
  IF v_normalized_phone IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid recipient phone number');
  END IF;

  v_name := COALESCE(v_booking.customer_name, 'Valued Customer');
  v_ref := COALESCE(v_booking.reference_code, p_booking_id::text);
  v_slot_datetime := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'Mon DD, YYYY at HH12:MI AM');
  v_slot_time := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');

  -- Map template and params strictly per specification
  CASE p_event_type
    WHEN 'BOOKING_CONFIRMED' THEN
      v_template_name := 'booking_confirmed';
      v_template_params := jsonb_build_array(v_name, v_booking.provider_name, v_slot_datetime, v_ref);
      v_msg_content := format(
        'Tirupati Appointments: Booking Confirmed! Ref: %s. Venue: %s. Specialist: %s (%s). Time: %s. Address: %s. Please arrive 10 mins early.',
        v_ref, v_booking.provider_name, v_booking.resource_name, COALESCE(v_booking.resource_dept, 'General'), v_slot_datetime, v_booking.provider_address
      );
    WHEN 'BOOKING_REMINDER_1H' THEN
      v_template_name := 'reminder_1h';
      v_template_params := jsonb_build_array(v_booking.provider_name, v_slot_time, v_ref);
      v_msg_content := format(
        'Tirupati Appointments Reminder: Your appointment at %s with %s starts in 1 hour (%s). Ref: %s. Address: %s.',
        v_booking.provider_name, v_booking.resource_name, v_slot_time, v_ref, v_booking.provider_address
      );
    WHEN 'BOOKING_REMINDER_30M' THEN
      v_template_name := 'reminder_30m';
      v_template_params := jsonb_build_array(v_booking.provider_name, v_slot_time, v_ref);
      v_msg_content := format(
        'Tirupati Appointments Urgent Reminder: Your appointment starts in 30 minutes (%s) at %s. Please proceed to the reception with Ref: %s.',
        v_slot_time, v_booking.provider_name, v_ref
      );
    WHEN 'BOOKING_CANCELLED' THEN
      v_template_name := 'booking_cancelled';
      v_template_params := jsonb_build_array(v_booking.provider_name, v_slot_datetime, v_ref);
      v_msg_content := format(
        'Tirupati Appointments: Booking %s at %s has been cancelled. Payment Status: %s. If you have questions, please reach out to %s.',
        v_ref, v_booking.provider_name, v_booking.payment_status, COALESCE(v_booking.provider_phone, 'Support')
      );
  END CASE;

  PERFORM set_config('app.trusted_write', 'true', true);

  -- Insert QUEUED WhatsApp notification log (idempotent ON CONFLICT DO NOTHING)
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
    v_name,
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

  -- Update reminder timestamp on booking if this was a reminder
  IF p_event_type = 'BOOKING_REMINDER_1H' THEN
    UPDATE public.bookings
    SET reminder_1h_sent_at = NOW(),
        updated_at = NOW()
    WHERE id = p_booking_id;
  ELSIF p_event_type = 'BOOKING_REMINDER_30M' THEN
    UPDATE public.bookings
    SET reminder_30m_sent_at = NOW(),
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

-- Restrict execution to service_role only per instructions
REVOKE ALL ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC claim_queued_notifications(p_limit int) (FOR UPDATE SKIP LOCKED)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_queued_notifications(
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  booking_id UUID,
  recipient_phone TEXT,
  recipient_name TEXT,
  event_type TEXT,
  channel TEXT,
  status TEXT,
  template_name TEXT,
  template_params JSONB,
  attempts INT,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ,
  message_content TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Strict security check: service_role or postgres only
  IF auth.role() != 'service_role' AND SESSION_USER != 'postgres' AND CURRENT_USER != 'postgres' THEN
    RAISE EXCEPTION 'Access denied: claim_queued_notifications is service_role only'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  RETURN QUERY
  WITH claimed AS (
    SELECT nl.id
    FROM public.notification_logs nl
    WHERE nl.status = 'QUEUED'
      AND nl.channel = 'whatsapp'
      AND nl.next_attempt_at <= NOW()
    ORDER BY nl.next_attempt_at ASC, nl.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_logs nl
  SET status = 'SENDING',
      attempts = nl.attempts + 1
  FROM claimed
  WHERE nl.id = claimed.id
  RETURNING
    nl.id,
    nl.booking_id,
    nl.recipient_phone,
    nl.recipient_name,
    nl.event_type,
    nl.channel,
    nl.status,
    nl.template_name,
    nl.template_params,
    nl.attempts,
    nl.last_error,
    nl.next_attempt_at,
    nl.message_content,
    nl.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_queued_notifications(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_queued_notifications(INT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. UPDATE OTHER DATABASE WRITERS SO NONE INSERTS 'SENT' WITHOUT REAL SEND
-- ─────────────────────────────────────────────────────────────────────────────

-- 6a. cancel_booking: Ensure any notification inserted is 'QUEUED'
CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id UUID,
  p_reason TEXT DEFAULT 'Standard cancellation',
  p_initiated_by TEXT DEFAULT 'CUSTOMER'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_provider public.providers%ROWTYPE;
  v_minutes_to_slot NUMERIC;
  v_eligible BOOLEAN;
  v_payment_status public.payment_status;
  v_refund_amount NUMERIC(10, 2) := 0;
  v_now TIMESTAMPTZ;
  
  -- Merchant strike variables
  v_is_merchant BOOLEAN := FALSE;
  v_strike_increment INT := 1;
  v_new_merchant_strikes INT := 0;
  v_penalty_applied BOOLEAN := FALSE;
  v_penalty_amount NUMERIC(10, 2) := 0.00;
  v_is_frozen BOOLEAN := FALSE;
  v_customer_name TEXT;
  v_customer_phone TEXT;
BEGIN
  -- Atomic row lock to serialize concurrent cancellation requests
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- 1. Rejection of already cancelled bookings
  IF v_booking.status = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Booking is already cancelled',
      'message', 'Booking is already cancelled'
    );
  END IF;

  -- 2. Strict rejection of checked-in, in-progress, or terminal booking statuses
  IF v_booking.status::text IN ('CHECKED_IN', 'WAITING', 'UP_NEXT', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW')
     OR v_booking.is_present = TRUE
     OR v_booking.status::text NOT IN ('CONFIRMED', 'HELD') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot cancel booking in status ' || v_booking.status::text,
      'message', 'Bookings in status ' || v_booking.status::text || ' cannot be cancelled'
    );
  END IF;

  -- Caller Authorization Guard
  IF auth.role() = 'authenticated' THEN
    IF NOT (
      auth.uid() = v_booking.customer_id
      OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
      OR public.is_admin(auth.uid())
    ) THEN
      RAISE EXCEPTION 'Access denied: You are not authorized to cancel this booking';
    END IF;
  END IF;

  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
    IF public.is_admin(auth.uid()) THEN
      v_is_merchant := (upper(COALESCE(p_initiated_by, 'CUSTOMER')) = 'MERCHANT');
    ELSIF auth.uid() = v_booking.customer_id THEN
      v_is_merchant := FALSE;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid())) THEN
      v_is_merchant := TRUE;
    ELSE
      v_is_merchant := FALSE;
    END IF;
  ELSE
    v_is_merchant := (upper(COALESCE(p_initiated_by, 'CUSTOMER')) = 'MERCHANT');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);

  PERFORM set_config('app.trusted_write', 'true', true);

  v_minutes_to_slot := EXTRACT(EPOCH FROM (v_booking.slot_start - v_now)) / 60;

  IF v_is_merchant THEN
    -- Merchant cancellations ALWAYS fully refund customer: deposit + platform fee + GST
    v_eligible := true;
    v_payment_status := 'REFUND_PENDING'::public.payment_status;
    v_refund_amount := COALESCE(v_booking.deposit_amount, 0.00) +
                       COALESCE(v_booking.platform_fee, 0.00) +
                       COALESCE(v_booking.platform_fee_gst, 0.00);

    IF v_refund_amount = 0 THEN
      v_refund_amount := COALESCE(v_booking.total_amount, 100.00);
    END IF;

    SELECT * INTO v_provider
    FROM public.providers
    WHERE id = v_booking.provider_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_now > v_provider.strike_reset_date THEN
        v_provider.cancellation_strikes := 0;
        v_provider.strike_reset_date := v_now + INTERVAL '30 days';
      END IF;

      IF v_minutes_to_slot <= 30 THEN
        v_strike_increment := 2;
      ELSE
        v_strike_increment := 1;
      END IF;

      v_new_merchant_strikes := v_provider.cancellation_strikes + v_strike_increment;

      IF v_new_merchant_strikes >= 3 THEN
        v_penalty_applied := TRUE;
        v_penalty_amount := 100.00;
      ELSE
        v_penalty_applied := FALSE;
        v_penalty_amount := 0.00;
      END IF;

      IF v_new_merchant_strikes >= 5 THEN
        v_is_frozen := TRUE;
      ELSE
        v_is_frozen := v_provider.is_booking_frozen;
      END IF;

      UPDATE public.providers
      SET cancellation_strikes = v_new_merchant_strikes,
          penalty_balance = penalty_balance + v_penalty_amount,
          is_booking_frozen = v_is_frozen,
          strike_reset_date = v_provider.strike_reset_date,
          updated_at = v_now
      WHERE id = v_booking.provider_id;
    END IF;

  ELSE
    -- Customer cancellation: 60-minute cutoff policy
    -- >= 60 minutes before slot: full deposit refund
    -- < 60 minutes before slot (59:59 or less): deposit forfeited
    v_eligible := (v_minutes_to_slot >= 60.0);
    IF v_eligible THEN
      v_payment_status := 'REFUND_PENDING'::public.payment_status;
      v_refund_amount := COALESCE(v_booking.deposit_amount, 100.00);
    ELSE
      v_payment_status := 'FORFEITED'::public.payment_status;
      v_refund_amount := 0.00;
    END IF;
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CANCELLED',
      payment_status = v_payment_status,
      updated_at = v_now
  WHERE id = p_booking_id;

  IF v_booking.gateway_payment_id IS NOT NULL AND v_payment_status <> 'REFUND_PENDING' THEN
    UPDATE public.payments
    SET status = v_payment_status,
        updated_at = v_now,
        metadata = jsonb_build_object(
          'cancellation_reason', p_reason,
          'initiated_by', CASE WHEN v_is_merchant THEN 'MERCHANT' ELSE 'CUSTOMER' END,
          'refund_amount', v_refund_amount,
          'minutes_before_slot', v_minutes_to_slot,
          'merchant_strikes', v_new_merchant_strikes,
          'merchant_penalty', v_penalty_amount
        )
    WHERE booking_id = p_booking_id;
  END IF;

  IF v_is_merchant THEN
    SELECT full_name, phone INTO v_customer_name, v_customer_phone
    FROM public.profiles
    WHERE id = v_booking.customer_id;

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
      'MERCHANT_CANCELLED',
      'whatsapp',
      'QUEUED',
      format('Your appointment has been cancelled by the venue due to an emergency. A full 100%% refund of ₹%s has been issued.', v_refund_amount),
      jsonb_build_object(
        'initiated_by', 'MERCHANT',
        'reason', p_reason,
        'refund_amount', v_refund_amount,
        'merchant_strikes', v_new_merchant_strikes,
        'penalty_applied', v_penalty_applied,
        'penalty_amount', v_penalty_amount
      )
    )
    ON CONFLICT (booking_id, event_type, channel) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'CANCELLED',
    'payment_status', v_payment_status,
    'refund_eligible', v_eligible,
    'refund_amount', v_refund_amount,
    'merchant_strikes', v_new_merchant_strikes,
    'penalty_applied', v_penalty_applied,
    'penalty_amount', v_penalty_amount,
    'is_booking_frozen', v_is_frozen
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_booking(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 6b. reassign_booking_resource: Ensure notification is 'QUEUED'
CREATE OR REPLACE FUNCTION public.reassign_booking_resource(
  p_booking_id UUID,
  p_new_resource_id UUID,
  p_reason TEXT DEFAULT 'Emergency re-allocation'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- 2. Caller Authorization Guard
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND (SESSION_USER = 'postgres' OR CURRENT_USER = 'postgres')) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Caller is not permitted to reassign resources for this booking'
    );
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
    AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
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
$$;

REVOKE ALL ON FUNCTION public.reassign_booking_resource(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_booking_resource(UUID, UUID, TEXT) TO authenticated, service_role;

-- 6c. expire_standby_bookings: Set status = 'QUEUED' instead of 'SENT'
CREATE OR REPLACE FUNCTION public.expire_standby_bookings(
  p_threshold_minutes INT DEFAULT 45
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
  v_clock TIMESTAMPTZ := NOW();
BEGIN
  PERFORM set_config('app.trusted_write', 'true', true);

  FOR v_rec IN
    SELECT b.id, b.customer_id, b.provider_id, prof.full_name AS customer_name, prof.phone AS customer_phone, p.name AS provider_name
    FROM public.bookings b
    LEFT JOIN public.profiles prof ON b.customer_id = prof.id
    LEFT JOIN public.providers p ON b.provider_id = p.id
    WHERE b.status = 'STANDBY'
      AND b.created_at <= (v_clock - (p_threshold_minutes || ' minutes')::INTERVAL)
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    UPDATE public.bookings
    SET status = 'NO_SHOW',
        is_present = FALSE,
        updated_at = v_clock
    WHERE id = v_rec.id;

    -- Enqueue notification with QUEUED status
    INSERT INTO public.notification_logs (
      booking_id,
      recipient_name,
      recipient_phone,
      event_type,
      channel,
      status,
      message_content,
      created_at
    ) VALUES (
      v_rec.id,
      COALESCE(v_rec.customer_name, 'Patient'),
      COALESCE(v_rec.customer_phone, '+919999999999'),
      'STANDBY_EXPIRED',
      'in_app',
      'QUEUED',
      format('Hello %s, your standby wait at %s has exceeded %s minutes. As no consultation slot opened, your standby status has expired. Please reschedule at your convenience.', 
             COALESCE(v_rec.customer_name, 'Patient'), 
             COALESCE(v_rec.provider_name, 'the clinic'), 
             p_threshold_minutes),
      v_clock
    )
    ON CONFLICT (booking_id, event_type, channel) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
