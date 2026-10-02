-- ==============================================================================
-- Migration: 20261002000001_strix_security_hardening.sql
-- Description: Comprehensive production security hardening based on Strix audit:
--   1. vuln-0004: Remove unauthenticated SELECT on payments table (RLS).
--   2. vuln-0009: Revoke test RPCs from PUBLIC, anon, and authenticated.
--   3. vuln-0014 & vuln-0022: Fix SECURITY DEFINER authorization checks, past-slot
--                             rejection, and 30-min customer late-window in reschedule_booking_slot
--                             and dispatch_booking_notification.
--   4. vuln-0021: Atomic record_no_show with FOR UPDATE row lock and state guards.
--   5. vuln-0017: Protect internal provider governance/financial columns from anon.
--   6. vuln-0025: Prevent self-perpetuating free cooling-period follow-up chaining.
--   7. vuln-0009 & vuln-0010: Fix cancel_booking initiator spoofing & refund claim deadlock.
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FIX PAYMENTS TABLE RLS (vuln-0004)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow reading payments" ON public.payments;
DROP POLICY IF EXISTS "Users can read own payments" ON public.payments;

CREATE POLICY "Users can read own payments" ON public.payments
FOR SELECT USING (
  auth.uid() IS NOT NULL AND (
    booking_id IN (
      SELECT b.id FROM public.bookings b
      WHERE b.customer_id = auth.uid()
    )
    OR booking_id IN (
      SELECT b.id FROM public.bookings b
      JOIN public.providers p ON b.provider_id = p.id
      WHERE p.owner_id = auth.uid()
         OR p.id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    )
    OR public.is_admin(auth.uid())
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REVOKE TEST-ONLY DESTRUCTIVE RPCS (vuln-0009)
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.reset_test_bookings(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_test_provider_strikes(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_test_customer_strikes(UUID, INTEGER) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reset_test_bookings(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_test_provider_strikes(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_test_customer_strikes(UUID, INTEGER) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FIX SECURITY DEFINER CALLER AUTHORIZATION BYPASS (vuln-0014)
-- ─────────────────────────────────────────────────────────────────────────────

-- 3a. reschedule_booking_slot
CREATE OR REPLACE FUNCTION public.reschedule_booking_slot(
  p_booking_id UUID,
  p_new_slot_start TIMESTAMPTZ,
  p_new_slot_end TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_conflict_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_target_status public.booking_status;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard:
  -- Only service_role or unauthenticated postgres superuser session can bypass.
  -- Authenticated user JWT sessions (v_caller_id IS NOT NULL) MUST be explicitly authorized.
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
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not authorized to reschedule this booking');
  END IF;

  IF v_booking.status IN ('CANCELLED', 'COMPLETED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  -- Prevent rescheduling to a slot in the past (vuln-0022)
  IF p_new_slot_start < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule to a slot in the past');
  END IF;

  -- Late-window enforcement: a customer must not be able to reset the cancellation
  -- cutoff by moving the appointment. Merchant/admin/service callers are unaffected (vuln-0022).
  IF v_caller_role <> 'service_role'
     AND v_caller_id IS NOT NULL
     AND v_caller_id = v_booking.customer_id
     AND v_booking.slot_start < NOW() + INTERVAL '30 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Late reschedule: appointments within 30 minutes of their slot cannot be rescheduled.');
  END IF;

  -- Range overlap check against other active bookings for the same resource
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND status IN ('HELD', 'CONFIRMED')
    AND id != p_booking_id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'The requested new slot is already booked or held');
  END IF;

  -- Financial State Machine: Prevent unauthorized transition from HELD to CONFIRMED without captured payment
  IF v_booking.status = 'HELD' THEN
    IF COALESCE(v_booking.deposit_amount, 0) > 0 AND (v_booking.payment_status != 'PAID' OR v_booking.gateway_payment_id IS NULL) THEN
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

  BEGIN
    UPDATE public.bookings
    SET slot_start = p_new_slot_start,
        slot_end = p_new_slot_end,
        status = v_target_status,
        updated_at = NOW()
    WHERE id = p_booking_id;
  EXCEPTION
    WHEN exclusion_violation OR unique_violation THEN
      RETURN jsonb_build_object('success', false, 'error', 'The requested new slot is already booked or held');
  END;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'slot_start', p_new_slot_start,
    'slot_end', p_new_slot_end,
    'status', v_target_status::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

-- 3b. dispatch_booking_notification
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
  v_name TEXT;
  v_ref TEXT;
  v_slot_formatted TEXT;
  v_msg_content TEXT;
  v_whatsapp_id UUID;
  v_sms_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  -- Validate event_type against strict allowlist to prevent log injection
  IF p_event_type NOT IN (
    'BOOKING_CONFIRMED',
    'BOOKING_REMINDER_1H',
    'BOOKING_REMINDER_30M',
    'BOOKING_CANCELLED',
    'RESOURCE_REASSIGNED',
    'REFUND_FAILED_ALERT'
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

  -- Caller authorization check: service_role, postgres, owning customer, provider staff/owner, or admin
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

  v_phone := COALESCE(v_booking.customer_phone, 'Unregistered Customer');
  v_name := COALESCE(v_booking.customer_name, 'Valued Customer');
  v_ref := COALESCE(v_booking.reference_code, p_booking_id::text);
  v_slot_formatted := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'Mon DD, YYYY at HH12:MI AM');

  -- Construct message text depending on event
  CASE p_event_type
    WHEN 'BOOKING_CONFIRMED' THEN
      v_msg_content := format(
        'Tirupati Appointments: Booking Confirmed! Ref: %s. Venue: %s. Specialist: %s (%s). Time: %s. Address: %s. Please arrive 10 mins early.',
        v_ref, v_booking.provider_name, v_booking.resource_name, COALESCE(v_booking.resource_dept, 'General'), v_slot_formatted, v_booking.provider_address
      );
    WHEN 'BOOKING_REMINDER_1H' THEN
      v_msg_content := format(
        'Tirupati Appointments Reminder: Your appointment at %s with %s starts in 1 hour (%s). Ref: %s. Address: %s.',
        v_booking.provider_name, v_booking.resource_name, to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), v_ref, v_booking.provider_address
      );
    WHEN 'BOOKING_REMINDER_30M' THEN
      v_msg_content := format(
        'Tirupati Appointments Urgent Reminder: Your appointment starts in 30 minutes (%s) at %s. Please proceed to the reception with Ref: %s.',
        to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), v_booking.provider_name, v_ref
      );
    WHEN 'BOOKING_CANCELLED' THEN
      v_msg_content := format(
        'Tirupati Appointments: Booking %s at %s has been cancelled. Payment Status: %s. If you have questions, please reach out to %s.',
        v_ref, v_booking.provider_name, v_booking.payment_status, COALESCE(v_booking.provider_phone, 'Support')
      );
    WHEN 'RESOURCE_REASSIGNED' THEN
      v_msg_content := format(
        'Tirupati Appointments: Staff re-assigned for booking %s at %s. Your new specialist is %s.',
        v_ref, v_booking.provider_name, v_booking.resource_name
      );
    WHEN 'REFUND_FAILED_ALERT' THEN
      v_msg_content := format(
        'Tirupati Appointments Alert: Refund processing for booking %s at %s is pending manual reconciliation.',
        v_ref, v_booking.provider_name
      );
    ELSE
      v_msg_content := format(
        'Tirupati Appointments Notification: Status update for booking %s at %s.',
        v_ref, v_booking.provider_name
      );
  END CASE;

  PERFORM set_config('app.trusted_write', 'true', true);

  -- Insert WhatsApp notification log
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
    v_phone,
    v_name,
    p_event_type,
    'whatsapp',
    'SENT',
    v_msg_content,
    jsonb_build_object('provider', 'mock-whatsapp', 'timestamp', now())
  ) RETURNING id INTO v_whatsapp_id;

  -- Insert SMS notification log
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
    v_phone,
    v_name,
    p_event_type,
    'sms',
    'SENT',
    v_msg_content,
    jsonb_build_object('provider', 'mock-sms', 'timestamp', now())
  ) RETURNING id INTO v_sms_id;

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
    'booking_id', p_booking_id,
    'event_type', p_event_type,
    'recipient_phone', v_phone,
    'recipient_name', v_name,
    'whatsapp_log_id', v_whatsapp_id,
    'sms_log_id', v_sms_id,
    'channel', 'whatsapp,sms',
    'status', 'SENT',
    'message', v_msg_content
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ATOMIC NO-SHOW WITH ROW LOCK AND TERMINAL STATE REJECTION (vuln-0021)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_no_show(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_current_count INT := 0;
    v_new_count INT := 1;
    v_payment_status public.payment_status;
    v_penalty BOOLEAN := FALSE;
    v_refund_amount NUMERIC(10, 2) := 0;
BEGIN
    -- Atomic single-winner row lock
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    -- Reject non-active terminal or already-refunded/forfeited states
    IF v_booking.status IN ('CANCELLED', 'NO_SHOW', 'COMPLETED') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot record a no-show for a booking in state: ' || v_booking.status::text
        );
    END IF;

    IF v_booking.payment_status IN ('REFUNDED', 'REFUND_PENDING', 'FORFEITED') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot record a no-show for a booking with payment status: ' || v_booking.payment_status::text
        );
    END IF;

    IF auth.role() = 'authenticated' THEN
      IF NOT (
        v_booking.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
        OR public.is_admin(auth.uid())
      ) THEN
        RAISE EXCEPTION 'Only the owning merchant or an admin can record a no-show';
      END IF;
    END IF;

    -- Read current strike count of customer
    SELECT COALESCE(no_show_count, 0) INTO v_current_count
    FROM public.profiles
    WHERE id = v_booking.customer_id;

    v_new_count := v_current_count + 1;

    -- 3-Strike Courtesy Policy:
    IF v_new_count <= 2 THEN
        v_payment_status := 'REFUND_PENDING'::public.payment_status;
        v_penalty := FALSE;
        v_refund_amount := COALESCE(v_booking.deposit_amount, 100.00);
    ELSE
        v_payment_status := 'FORFEITED'::public.payment_status;
        v_penalty := TRUE;
        v_refund_amount := 0;
    END IF;

    PERFORM set_config('app.trusted_write', 'true', true);

    -- Update customer profile strikes
    UPDATE public.profiles
    SET no_show_count = v_new_count,
        is_flagged = CASE WHEN v_new_count >= 3 THEN TRUE ELSE is_flagged END,
        updated_at = NOW()
    WHERE id = v_booking.customer_id;

    -- Update booking status and payment status atomically
    UPDATE public.bookings
    SET status = 'NO_SHOW',
        payment_status = v_payment_status,
        updated_at = NOW()
    WHERE id = p_booking_id;

    -- If forfeiture, update payment record and credit merchant penalty_balance
    IF v_penalty THEN
        UPDATE public.payments
        SET status = 'FORFEITED',
            updated_at = NOW()
        WHERE booking_id = p_booking_id;

        UPDATE public.providers
        SET penalty_balance = COALESCE(penalty_balance, 0) + COALESCE(v_booking.deposit_amount, 100.00),
            updated_at = NOW()
        WHERE id = v_booking.provider_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'no_show_count', v_new_count,
        'penalty_applied', v_penalty,
        'payment_status', v_payment_status::text,
        'refund_amount', v_refund_amount,
        'flagged', v_new_count >= 3,
        'is_flagged', v_new_count >= 3
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_no_show(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_no_show(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SECURE PROVIDERS TABLE INTERNAL COLUMNS (vuln-0017)
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE SELECT ON public.providers FROM anon;
GRANT SELECT (
  id, name, category_id, address, city, opening_time, closing_time,
  description, photos, latitude, longitude, status, phone, email,
  created_at, updated_at
) ON public.providers TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PREVENT SELF-PERPETUATING FREE COOLING PERIOD FOLLOW-UPS (vuln-0025)
-- ─────────────────────────────────────────────────────────────────────────────
-- Both create_booking_hold and check_cooling_period_eligibility must require
-- that an anchor booking is NOT itself a follow-up (is_followup = FALSE).
-- This strictly bounds the cooling window to the original paid visit.

CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id UUID,
    p_slot_start TIMESTAMPTZ,
    p_slot_end TIMESTAMPTZ,
    p_customer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_provider_id UUID;
    v_category_id TEXT;
    v_deposit_amount NUMERIC(10, 2);
    v_platform_fee NUMERIC(10, 2);
    v_total_amount NUMERIC(10, 2);
    v_is_active BOOLEAN;
    v_provider_status TEXT;
    v_existing_id UUID;
    v_new_booking_id UUID;
    v_reference_code TEXT;
    v_hold_expiry TIMESTAMPTZ;
    v_daily_booking_limit INTEGER;
    v_daily_count INTEGER;
    v_slot_date_ist DATE;
    v_cooling_period_days INTEGER := 0;
    v_is_followup BOOLEAN := FALSE;
    v_followup_original_booking_id UUID := NULL;
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

    -- Validate slot times
    IF p_slot_end <= p_slot_start THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: slot_end must be after slot_start');
    END IF;

    IF p_slot_start < (NOW() - INTERVAL '5 minutes') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: cannot book slots in the past');
    END IF;

    -- Auto-clean expired holds
    UPDATE public.bookings
    SET status = 'CANCELLED', updated_at = NOW()
    WHERE status = 'HELD' AND hold_expires_at < NOW();

    -- Fetch resource
    SELECT provider_id, deposit_amount, is_active
    INTO v_provider_id, v_deposit_amount, v_is_active
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

        PERFORM pg_advisory_xact_lock(hashtext('daily_limit:' || v_provider_id::text || ':' || v_slot_date_ist::text));

        SELECT COUNT(*) INTO v_daily_count
        FROM public.bookings
        WHERE provider_id = v_provider_id
          AND (slot_start AT TIME ZONE 'Asia/Kolkata')::date = v_slot_date_ist
          AND status IN ('HELD', 'CONFIRMED', 'COMPLETED');

        IF v_daily_count >= v_daily_booking_limit THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'This venue has reached its daily booking limit (' || v_daily_booking_limit || ') for this date. Please choose another day.'
            );
        END IF;
    END IF;

    -- =========================================================================
    -- COOLING PERIOD EVALUATION:
    -- Restrict qualifying anchor strictly to a genuine, non-followup visit (is_followup = FALSE)
    -- to prevent unbounded free chains that roll forward past the policy window (vuln-0025).
    -- =========================================================================
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
        END IF;
    END IF;

    IF NOT v_is_followup THEN
        -- Enforce ₹100 minimum deposit floor for regular paid bookings
        IF COALESCE(v_deposit_amount, 0) < 100 THEN
            v_deposit_amount := 100.00;
        END IF;

        -- Platform fee: ₹50 for Gaming & Turf, ₹10 for all others
        v_platform_fee := CASE WHEN v_category_id IN ('gaming', 'turf') THEN 50.00 ELSE 10.00 END;
        v_total_amount := v_deposit_amount + v_platform_fee;
    END IF;

    -- Overlap exclusion check with 3-second lock timeout
    SET LOCAL lock_timeout = '3s';
    SELECT id INTO v_existing_id
    FROM public.bookings
    WHERE resource_id = p_resource_id
      AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end)
      AND status IN ('HELD', 'CONFIRMED')
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
            disclaimer_version, is_followup, followup_original_booking_id
        ) VALUES (
            p_customer_id, v_provider_id, p_resource_id,
            p_slot_start, p_slot_end, 'HELD', 'PENDING',
            v_deposit_amount, v_platform_fee, v_total_amount, v_hold_expiry,
            'v1', v_is_followup, v_followup_original_booking_id
        )
        RETURNING id, reference_code INTO v_new_booking_id, v_reference_code;
    EXCEPTION
        WHEN exclusion_violation OR unique_violation THEN
            RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked');
    END;

    RETURN jsonb_build_object(
        'success',                      true,
        'booking_id',                   v_new_booking_id,
        'reference_code',               v_reference_code,
        'deposit_amount',               v_deposit_amount,
        'platform_fee',                 v_platform_fee,
        'total_amount',                 v_total_amount,
        'hold_expires_at',              v_hold_expiry,
        'is_followup',                  v_is_followup,
        'followup_original_booking_id', v_followup_original_booking_id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.check_cooling_period_eligibility(
    p_customer_id UUID,
    p_provider_id UUID,
    p_target_slot TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cooling_days INTEGER;
    v_orig_id      UUID;
    v_orig_slot    TIMESTAMPTZ;
    v_valid_until  TIMESTAMPTZ;
    v_days_left    NUMERIC;
BEGIN
    SELECT COALESCE(cooling_period_days, 0) INTO v_cooling_days
    FROM public.providers
    WHERE id = p_provider_id;

    IF v_cooling_days IS NULL OR v_cooling_days <= 0 THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'cooling_period_days', 0,
            'reason', 'Cooling period not configured or disabled'
        );
    END IF;

    -- Strict non-followup anchor lookup (is_followup = FALSE) (vuln-0025)
    SELECT id, slot_start, slot_start + (v_cooling_days || ' days')::INTERVAL
    INTO v_orig_id, v_orig_slot, v_valid_until
    FROM public.bookings
    WHERE customer_id = p_customer_id
      AND provider_id = p_provider_id
      AND status IN ('CONFIRMED', 'COMPLETED')
      AND is_followup = FALSE
      AND slot_start <= p_target_slot
      AND p_target_slot <= (slot_start + (v_cooling_days || ' days')::INTERVAL)
      AND NOW() <= (slot_start + (v_cooling_days || ' days')::INTERVAL)
    ORDER BY slot_start DESC
    LIMIT 1;

    IF v_orig_id IS NOT NULL THEN
        v_days_left := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_valid_until - NOW())) / 86400.0, 1));
        RETURN jsonb_build_object(
            'eligible', true,
            'cooling_period_days', v_cooling_days,
            'original_booking_id', v_orig_id,
            'original_slot_start', v_orig_slot,
            'valid_until', v_valid_until,
            'days_remaining', v_days_left,
            'reason', 'Target appointment date is within the ' || v_cooling_days || '-day cooling period'
        );
    END IF;

    -- Check if they had a previous appointment that expired or is past the cooling window
    SELECT id, slot_start, slot_start + (v_cooling_days || ' days')::INTERVAL
    INTO v_orig_id, v_orig_slot, v_valid_until
    FROM public.bookings
    WHERE customer_id = p_customer_id
      AND provider_id = p_provider_id
      AND status IN ('CONFIRMED', 'COMPLETED')
      AND is_followup = FALSE
    ORDER BY slot_start DESC
    LIMIT 1;

    IF v_orig_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'cooling_period_days', v_cooling_days,
            'original_booking_id', v_orig_id,
            'original_slot_start', v_orig_slot,
            'valid_until', v_valid_until,
            'days_remaining', 0,
            'reason', 'Cooling period of ' || v_cooling_days || ' days has expired for previous visit'
        );
    END IF;

    RETURN jsonb_build_object(
        'eligible', false,
        'cooling_period_days', v_cooling_days,
        'reason', 'No previous confirmed visit found at this hospital or clinic'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_cooling_period_eligibility(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_cooling_period_eligibility(UUID, UUID, TIMESTAMPTZ) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. FIX CANCEL_BOOKING AUTHORIZATION SPOOFING & REFUND CLAIM DEADLOCK (vuln-0009 & vuln-0010)
-- ─────────────────────────────────────────────────────────────────────────────

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

  IF v_booking.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking is already cancelled');
  END IF;

  -- Caller Authorization Guard: Caller must be the booking's customer, authorized merchant, admin, or service_role
  IF auth.role() = 'authenticated' THEN
    IF NOT (
      auth.uid() = v_booking.customer_id
      OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
      OR public.is_admin(auth.uid())
    ) THEN
      RAISE EXCEPTION 'Access denied: You are not authorized to cancel this booking';
    END IF;
  END IF;

  -- vuln-0009: The initiator type is a security decision and must never be taken from client input alone.
  -- 1. If caller is the customer, it is strictly a CUSTOMER cancellation (no merchant strikes or unwarranted refunds).
  -- 2. If caller is authorized venue staff/owner (and not the customer), it is strictly a MERCHANT cancellation (cannot evade venue accountability).
  -- 3. Superadmins or trusted service_role callers can specify either initiator via p_initiated_by.
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
    -- service_role or background system caller
    v_is_merchant := (upper(COALESCE(p_initiated_by, 'CUSTOMER')) = 'MERCHANT');
  END IF;

  -- Set trusted write context so internal provider strikes and booking transitions bypass guard triggers
  PERFORM set_config('app.trusted_write', 'true', true);

  v_minutes_to_slot := EXTRACT(EPOCH FROM (v_booking.slot_start - NOW())) / 60;

  IF v_is_merchant THEN
    -- Merchant cancellations ALWAYS fully refund customer: deposit + platform_fee + platform_fee_gst
    v_eligible := true;
    v_payment_status := 'REFUND_PENDING'::public.payment_status;
    v_refund_amount := COALESCE(v_booking.deposit_amount, 0.00) +
                       COALESCE(v_booking.platform_fee, 0.00) +
                       COALESCE(v_booking.platform_fee_gst, 0.00);

    -- Fallback if deposit/fees are null
    IF v_refund_amount = 0 THEN
      v_refund_amount := COALESCE(v_booking.total_amount, 100.00);
    END IF;

    -- Load provider details
    SELECT * INTO v_provider
    FROM public.providers
    WHERE id = v_booking.provider_id
    FOR UPDATE;

    IF FOUND THEN
      -- Check rolling 30-day window reset
      IF NOW() > v_provider.strike_reset_date THEN
        v_provider.cancellation_strikes := 0;
        v_provider.strike_reset_date := NOW() + INTERVAL '30 days';
      END IF;

      -- Last-minute penalty multiplier: cancellations <= 30 minutes before slot incur 2 strikes
      IF v_minutes_to_slot <= 30 THEN
        v_strike_increment := 2;
      ELSE
        v_strike_increment := 1;
      END IF;

      v_new_merchant_strikes := v_provider.cancellation_strikes + v_strike_increment;

      -- Strike 1 & 2: Courtesy Grace Period (no monetary penalty to merchant)
      -- Strike 3+: ₹100 penalty debited to merchant payout / penalty_balance
      IF v_new_merchant_strikes >= 3 THEN
        v_penalty_applied := TRUE;
        v_penalty_amount := 100.00;
      ELSE
        v_penalty_applied := FALSE;
        v_penalty_amount := 0.00;
      END IF;

      -- At 5 strikes: Booking Freeze (requires admin review)
      IF v_new_merchant_strikes >= 5 THEN
        v_is_frozen := TRUE;
      ELSE
        v_is_frozen := v_provider.is_booking_frozen;
      END IF;

      -- Update provider record
      UPDATE public.providers
      SET cancellation_strikes = v_new_merchant_strikes,
          penalty_balance = penalty_balance + v_penalty_amount,
          is_booking_frozen = v_is_frozen,
          strike_reset_date = v_provider.strike_reset_date,
          updated_at = NOW()
      WHERE id = v_booking.provider_id;
    END IF;

  ELSE
    -- Customer cancellation: 30-minute cutoff policy (> 30m = full deposit refund, <= 30m = forfeited)
    -- Ensures cancellation at 45 minutes before slot yields a 100% full refund
    v_eligible := (v_minutes_to_slot > 30);
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
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- vuln-0010: Only write the payment ledger directly for terminal, non-refundable outcomes (FORFEITED).
  -- Refund-eligible cancellations must leave the payment row in 'CAPTURED' so that the
  -- API route's single-winner claim (payments.status 'CAPTURED' -> 'REFUND_PENDING')
  -- can own the transition and actually reach the payment gateway.
  IF v_booking.gateway_payment_id IS NOT NULL AND v_payment_status <> 'REFUND_PENDING' THEN
    UPDATE public.payments
    SET status = v_payment_status,
        updated_at = NOW(),
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

  -- If merchant cancelled, log an alert notification for the customer
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
      COALESCE(v_customer_phone, '+919848000000'),
      COALESCE(v_customer_name, 'Valued Customer'),
      'MERCHANT_CANCELLED',
      'SMS_WHATSAPP',
      'SENT',
      format('Your appointment has been cancelled by the venue due to an emergency. A full 100%% refund of ₹%s has been issued.', v_refund_amount),
      jsonb_build_object(
        'initiated_by', 'MERCHANT',
        'reason', p_reason,
        'refund_amount', v_refund_amount,
        'merchant_strikes', v_new_merchant_strikes,
        'penalty_applied', v_penalty_applied,
        'penalty_amount', v_penalty_amount
      )
    );
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

-- Fix: merchant_update_cooling_period references merchant_memberships without non-existent status column
CREATE OR REPLACE FUNCTION public.merchant_update_cooling_period(
    p_provider_id UUID,
    p_cooling_period_days INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_role TEXT := auth.role();
    v_authorized BOOLEAN := FALSE;
BEGIN
    IF v_role = 'service_role' THEN
        v_authorized := TRUE;
    ELSIF v_caller_id IS NOT NULL THEN
        -- Check if caller is owner in providers table
        SELECT (owner_id = v_caller_id) INTO v_authorized
        FROM public.providers
        WHERE id = p_provider_id;

        IF NOT COALESCE(v_authorized, false) THEN
            -- Check if caller is active member/owner in merchant_memberships
            SELECT EXISTS (
                SELECT 1 FROM public.merchant_memberships
                WHERE provider_id = p_provider_id
                  AND user_id = v_caller_id
            ) INTO v_authorized;
        END IF;

        IF NOT COALESCE(v_authorized, false) THEN
            -- Check if caller is platform admin
            SELECT public.is_admin(v_caller_id) INTO v_authorized;
        END IF;
    END IF;

    IF NOT v_authorized THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized to modify this provider');
    END IF;

    IF p_cooling_period_days < 0 OR p_cooling_period_days > 365 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cooling period must be between 0 and 365 days');
    END IF;

    UPDATE public.providers
    SET cooling_period_days = p_cooling_period_days,
        updated_at = NOW()
    WHERE id = p_provider_id;

    RETURN jsonb_build_object(
        'success', true,
        'provider_id', p_provider_id,
        'cooling_period_days', p_cooling_period_days
    );
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_update_cooling_period(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_update_cooling_period(UUID, INTEGER) TO authenticated, service_role;



