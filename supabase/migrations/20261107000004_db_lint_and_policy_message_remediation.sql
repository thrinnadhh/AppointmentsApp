-- Migration: 20261107000004_db_lint_and_policy_message_remediation.sql
-- Description: Fix plpgsql lint errors in replay_dlq_message and dispatch_booking_notification,
-- and harmonize patient gap error message in create_booking_hold.

-- 1. Harmonize patient gap error message in create_booking_hold
CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id uuid,
    p_slot_start timestamp with time zone,
    p_slot_end timestamp with time zone,
    p_customer_id uuid,
    p_booking_for_someone_else boolean DEFAULT false,
    p_patient_name text DEFAULT NULL,
    p_patient_phone text DEFAULT NULL,
    p_patient_relationship text DEFAULT NULL,
    p_booked_for text DEFAULT 'self',
    p_patient_age smallint DEFAULT NULL,
    p_booking_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_provider_id UUID;
    v_category_id TEXT;
    v_deposit_amount NUMERIC(10, 2);
    v_platform_fee NUMERIC(10, 2);
    v_total_amount NUMERIC(10, 2);
    v_consultation_fee NUMERIC(10, 2);
    v_is_active BOOLEAN;
    v_provider_status TEXT;
    v_existing_id UUID;
    v_new_booking_id UUID;
    v_reference_code TEXT;
    v_hold_expiry TIMESTAMPTZ;
    v_daily_booking_limit INTEGER;
    v_daily_count INTEGER;
    v_slot_date_ist DATE;
    v_day_start TIMESTAMPTZ;
    v_day_end TIMESTAMPTZ;
    v_cooling_period_days INTEGER := 0;
    v_is_followup BOOLEAN := FALSE;
    v_followup_original_booking_id UUID := NULL;
    v_customer_blocked_until TIMESTAMPTZ := NULL;
    v_target_phone TEXT;
    v_target_name TEXT;
    v_gap_conflict_id UUID;
    v_booked_for TEXT;
    v_is_minor BOOLEAN;
BEGIN
    -- Only authenticated users or service_role can create holds
    IF auth.role() = 'anon' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required to create a booking hold');
    END IF;

    -- Verify customer ownership if authenticated
    IF auth.role() = 'authenticated' AND auth.uid() != p_customer_id THEN
        IF NOT (
            public.is_admin(auth.uid()) OR
            EXISTS (
                SELECT 1 FROM public.providers p
                JOIN public.resources r ON r.provider_id = p.id
                WHERE r.id = p_resource_id
                  AND (p.owner_id = auth.uid() OR p.id IN (SELECT public.get_user_authorized_providers(auth.uid())))
            )
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You cannot book on behalf of another user');
        END IF;
    END IF;

    -- Resolve booked_for value
    v_booked_for := COALESCE(NULLIF(trim(p_booked_for), ''), 'self');
    IF COALESCE(p_booking_for_someone_else, false) AND v_booked_for = 'self' THEN
        v_booked_for := 'family';
    END IF;

    IF v_booked_for NOT IN ('self', 'family') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid booked_for parameter: must be "self" or "family"');
    END IF;

    -- Strict validation for family booking
    IF v_booked_for = 'family' THEN
        v_target_name := NULLIF(trim(COALESCE(p_patient_name, '')), '');
        IF v_target_name IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Patient name is required when booking for family / minor'
            );
        END IF;

        IF length(v_target_name) > 100 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Patient name must not exceed 100 characters'
            );
        END IF;

        IF p_patient_age IS NOT NULL THEN
            IF p_patient_age < 0 OR p_patient_age > 120 THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Patient age must be between 0 and 120'
                );
            END IF;
        END IF;

        IF p_patient_relationship IS NOT NULL THEN
            IF lower(trim(p_patient_relationship)) IN ('child', 'spouse', 'parent', 'sibling', 'other') THEN
                p_patient_relationship := lower(trim(p_patient_relationship));
            ELSE
                p_patient_relationship := 'other';
            END IF;
        END IF;

        IF p_booking_note IS NOT NULL AND length(p_booking_note) > 200 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Booking note must not exceed 200 characters'
            );
        END IF;
    ELSE
        p_patient_name := NULL;
        p_patient_phone := NULL;
        p_patient_relationship := NULL;
        p_patient_age := NULL;
        p_booking_note := NULL;
        v_target_name := NULL;
        v_target_phone := NULL;
    END IF;

    -- ACCOUNT BLOCK ENFORCEMENT
    SELECT blocked_until
    INTO v_customer_blocked_until
    FROM public.profiles
    WHERE id = p_customer_id;

    IF v_customer_blocked_until IS NOT NULL AND v_customer_blocked_until > NOW() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Your account is blocked for 7 days due to excessive no-shows',
            'blocked_until', v_customer_blocked_until
        );
    END IF;

    -- Validate slot times
    IF p_slot_end <= p_slot_start THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: slot_end must be after slot_start');
    END IF;

    IF p_slot_start < (NOW() - INTERVAL '5 minutes') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: cannot book slots in the past');
    END IF;

    -- 1-HOUR TIME GAP ENFORCEMENT
    IF v_booked_for = 'family' THEN
        v_target_phone := NULLIF(trim(COALESCE(p_patient_phone, '')), '');

        -- For family, check collision only if phone or identical name is provided
        IF v_target_phone IS NOT NULL OR v_target_name IS NOT NULL THEN
            SELECT b.id INTO v_gap_conflict_id
            FROM public.bookings b
            WHERE b.customer_id = p_customer_id
              AND (b.booked_for = 'family' OR b.booking_for_someone_else = TRUE)
              AND (
                (v_target_phone IS NOT NULL AND b.patient_phone = v_target_phone)
                OR (v_target_name IS NOT NULL AND LOWER(TRIM(b.patient_name)) = LOWER(TRIM(v_target_name)))
              )
              AND (
                b.status = 'CONFIRMED'
                OR (b.status = 'HELD' AND b.hold_expires_at >= NOW())
              )
              AND (p_slot_start < b.slot_end + INTERVAL '60 minutes')
              AND (b.slot_start < p_slot_end + INTERVAL '60 minutes')
            LIMIT 1;

            IF v_gap_conflict_id IS NOT NULL THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Appointments for the same patient must be at least 1 hour apart.'
                );
            END IF;
        END IF;
    ELSE
        SELECT b.id INTO v_gap_conflict_id
        FROM public.bookings b
        WHERE b.customer_id = p_customer_id
          AND b.booked_for = 'self'
          AND b.booking_for_someone_else = FALSE
          AND (
            b.status = 'CONFIRMED'
            OR (b.status = 'HELD' AND b.hold_expires_at >= NOW())
          )
          AND (p_slot_start < b.slot_end + INTERVAL '60 minutes')
          AND (b.slot_start < p_slot_end + INTERVAL '60 minutes')
        LIMIT 1;

        IF v_gap_conflict_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Appointments for the same patient must be at least 1 hour apart. To book for a family member or friend, select ''Booking for someone else'' (or select ''Booking for family / minor'').'
            );
        END IF;
    END IF;

    -- Auto-clean expired holds scoped to requested resource & slot
    PERFORM set_config('app.trusted_write', 'true', true);
    UPDATE public.bookings
    SET status = 'CANCELLED', payment_status = 'FORFEITED', updated_at = NOW()
    WHERE resource_id = p_resource_id
      AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end)
      AND status = 'HELD'
      AND hold_expires_at < NOW();

    -- Fetch resource
    SELECT provider_id, deposit_amount, is_active, price
    INTO v_provider_id, v_deposit_amount, v_is_active, v_consultation_fee
    FROM public.resources
    WHERE id = p_resource_id;

    IF NOT FOUND OR NOT v_is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Resource not found or inactive');
    END IF;

    -- Fetch provider status, category, operational daily booking limit, and cooling period
    SELECT status, category_id, daily_booking_limit, COALESCE(cooling_period_days, 0)
    INTO v_provider_status, v_category_id, v_daily_booking_limit, v_cooling_period_days
    FROM public.providers 
    WHERE id = v_provider_id;

    IF v_provider_status = 'SUSPENDED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Merchant provider is suspended');
    END IF;

    -- Daily Booking Limit Concurrency Guard
    IF v_daily_booking_limit IS NOT NULL AND v_daily_booking_limit > 0 THEN
        v_slot_date_ist := (p_slot_start AT TIME ZONE 'Asia/Kolkata')::date;
        v_day_start := (v_slot_date_ist::timestamp AT TIME ZONE 'Asia/Kolkata');
        v_day_end := v_day_start + INTERVAL '1 day';

        PERFORM pg_advisory_xact_lock(hashtext('daily_limit:' || v_provider_id::text || ':' || v_slot_date_ist::text));

        SELECT COUNT(*) INTO v_daily_count
        FROM public.bookings
        WHERE provider_id = v_provider_id
          AND slot_start >= v_day_start
          AND slot_start < v_day_end
          AND (
            status IN ('CONFIRMED', 'COMPLETED')
            OR (status = 'HELD' AND hold_expires_at >= NOW())
          );

        IF v_daily_count >= v_daily_booking_limit THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'This venue has reached its daily booking limit (' || v_daily_booking_limit || ') for this date. Please choose another day.'
            );
        END IF;
    END IF;

    -- Cooling period evaluation
    IF v_cooling_period_days IS NOT NULL AND v_cooling_period_days > 0 THEN
        SELECT id INTO v_followup_original_booking_id
        FROM public.bookings
        WHERE customer_id = p_customer_id
          AND provider_id = v_provider_id
          AND status IN ('CONFIRMED', 'COMPLETED')
          AND is_followup = FALSE
          AND slot_start <= p_slot_start
          AND p_slot_start <= (slot_start + (v_cooling_period_days || ' days')::INTERVAL)
          AND NOW() <= (slot_start + (v_cooling_period_days || ' days')::INTERVAL)
        ORDER BY slot_start DESC
        LIMIT 1;

        IF v_followup_original_booking_id IS NOT NULL THEN
            v_is_followup := TRUE;
            v_deposit_amount := 0.00;
            v_platform_fee := 0.00;
            v_total_amount := 0.00;
            v_consultation_fee := 0.00;
        END IF;
    END IF;

    -- SPLIT PAYMENT LOGIC:
    -- Platform fee is paid online now to reserve slot.
    -- Consultation fee is paid directly at hospital desk.
    IF NOT v_is_followup THEN
        v_platform_fee := CASE WHEN v_category_id IN ('gaming', 'turf') THEN 50.00 ELSE 10.00 END;
        v_deposit_amount := v_platform_fee;
        v_total_amount := v_platform_fee;
        v_consultation_fee := COALESCE(v_consultation_fee, 500.00);
    END IF;

    -- Overlap exclusion check
    SET LOCAL lock_timeout = '3s';
    SELECT id INTO v_existing_id
    FROM public.bookings
    WHERE resource_id = p_resource_id
      AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end)
      AND (
        status = 'CONFIRMED'
        OR (status = 'HELD' AND hold_expires_at >= NOW())
      )
      FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked');
    END IF;

    v_hold_expiry := NOW() + INTERVAL '5 minutes';

    BEGIN
        INSERT INTO public.bookings (
            customer_id, provider_id, resource_id,
            slot_start, slot_end, status, payment_status,
            deposit_amount, platform_fee, total_amount, hold_expires_at,
            disclaimer_version, is_followup, followup_original_booking_id,
            booking_for_someone_else, booked_for, patient_name, patient_phone, patient_relationship,
            patient_age, booking_note,
            platform_fee_amount, consultation_fee_amount,
            platform_payment_status, consultation_payment_status
        ) VALUES (
            p_customer_id, v_provider_id, p_resource_id,
            p_slot_start, p_slot_end, 'HELD', 'PENDING',
            v_deposit_amount, v_platform_fee, v_total_amount, v_hold_expiry,
            'v1', v_is_followup, v_followup_original_booking_id,
            (v_booked_for = 'family'),
            v_booked_for,
            v_target_name,
            v_target_phone,
            p_patient_relationship,
            p_patient_age,
            p_booking_note,
            v_platform_fee,
            v_consultation_fee,
            'PENDING',
            'PENDING_OFFLINE'
        )
        RETURNING id, reference_code INTO v_new_booking_id, v_reference_code;
    EXCEPTION
        WHEN exclusion_violation OR unique_violation THEN
            RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked');
    END;

    v_is_minor := (p_patient_age IS NOT NULL AND p_patient_age < 18);

    RETURN jsonb_build_object(
        'success',                      true,
        'booking_id',                   v_new_booking_id,
        'reference_code',               v_reference_code,
        'deposit_amount',               v_deposit_amount,
        'platform_fee',                 v_platform_fee,
        'total_amount',                 v_total_amount,
        'platform_fee_amount',          v_platform_fee,
        'consultation_fee_amount',      v_consultation_fee,
        'platform_payment_status',      'PENDING',
        'consultation_payment_status',  'PENDING_OFFLINE',
        'hold_expires_at',              v_hold_expiry,
        'is_followup',                  v_is_followup,
        'followup_original_booking_id', v_followup_original_booking_id,
        'booking_for_someone_else',      (v_booked_for = 'family'),
        'booked_for',                   v_booked_for,
        'patient_name',                 v_target_name,
        'patient_age',                  p_patient_age,
        'patient_relationship',         p_patient_relationship,
        'is_minor',                     v_is_minor,
        'booking_note',                 p_booking_note
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, TEXT, TEXT, TEXT, TEXT, SMALLINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, TEXT, TEXT, TEXT, TEXT, SMALLINT, TEXT) TO authenticated, service_role;


-- 2. Fix replay_dlq_message PL/pgSQL variable typing (eliminate unassigned record error)
CREATE OR REPLACE FUNCTION public.replay_dlq_message(
  p_dlq text,
  p_target_queue text,
  p_dlq_msg_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pgmq', 'pg_temp'
AS $$
DECLARE
  v_msg_id bigint;
  v_message jsonb;
  v_clean_payload jsonb;
  v_new_msg_id bigint;
BEGIN
  IF auth.role() <> 'service_role' AND CURRENT_USER <> 'postgres' AND SESSION_USER <> 'postgres' THEN
    RAISE EXCEPTION 'Access denied: only service_role can replay DLQ messages';
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
$$;


-- 3. Fix dispatch_booking_notification to queue strictly into public.notification_logs
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
      'reason', 'Consent not granted'
    );
  END IF;

  -- Enqueue notification directly into public.notification_logs
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
  RETURNING id INTO v_whatsapp_id;

  RETURN jsonb_build_object(
    'success', true,
    'whatsapp_id', v_whatsapp_id,
    'status', 'QUEUED',
    'template_name', v_template_name
  );
END;
$$;
