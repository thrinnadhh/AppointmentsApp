-- =============================================================================
-- Migration: 20261022000007_ignore_expired_holds_in_daily_limit_and_availability.sql
-- Description:
--   1. Make create_booking_hold daily limit count ignore HELD bookings whose hold_expires_at has passed.
--   2. In create_booking_hold overlap check, ensure only active (non-expired) holds block slots.
--   3. In reschedule_booking_slot, clean up stale holds and ignore expired holds on the target slot.
-- =============================================================================

-- 1. Update create_booking_hold RPC
CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id uuid,
    p_slot_start timestamp with time zone,
    p_slot_end timestamp with time zone,
    p_customer_id uuid
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

    -- Auto-clean expired holds scoped STRICTLY to the requested resource and overlapping slot range
    PERFORM set_config('app.trusted_write', 'true', true);
    UPDATE public.bookings
    SET status = 'CANCELLED', payment_status = 'FORFEITED', updated_at = NOW()
    WHERE resource_id = p_resource_id
      AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end)
      AND status = 'HELD'
      AND hold_expires_at < NOW();

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

    -- Daily Booking Limit Concurrency Guard with Sargable Range Predicate
    -- Ignores HELD bookings whose hold_expires_at has passed
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

    -- COOLING PERIOD EVALUATION
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
    -- Excludes holds that are already expired
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

-- 2. Update reschedule_booking_slot RPC to ignore expired holds on target slot
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
  v_booking RECORD;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_conflict_id UUID;
  v_target_status public.booking_status;
  v_now TIMESTAMPTZ;
BEGIN
  -- Strict input validation
  IF p_booking_id IS NULL OR p_new_slot_start IS NULL OR p_new_slot_end IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid parameters: booking_id, new_slot_start, and new_slot_end are required');
  END IF;

  IF p_new_slot_end <= p_new_slot_start THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid slot duration: end time must be after start time');
  END IF;

  -- Row lock the booking
  SELECT id, customer_id, provider_id, resource_id, status, payment_status, deposit_amount, slot_start, slot_end, gateway_payment_id, is_present
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

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
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not authorized to reschedule this booking');
  END IF;

  -- Reject non-cancellable/non-reschedulable statuses
  IF v_booking.status::text IN ('CHECKED_IN', 'WAITING', 'UP_NEXT', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW', 'CANCELLED')
     OR v_booking.is_present = TRUE
     OR v_booking.status::text NOT IN ('CONFIRMED', 'HELD') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);

  -- Prevent rescheduling to a slot in the past
  IF p_new_slot_start < v_now THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule to a slot in the past');
  END IF;

  -- Late-window enforcement: customer cannot reset cancellation cutoff by rescheduling
  IF v_caller_role <> 'service_role'
     AND v_caller_id IS NOT NULL
     AND v_caller_id = v_booking.customer_id
     AND v_booking.slot_start < v_now + INTERVAL '30 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Late reschedule: appointments within 30 minutes of their slot cannot be rescheduled.');
  END IF;

  -- Clean up any expired holds on the target slot range
  PERFORM set_config('app.trusted_write', 'true', true);
  UPDATE public.bookings
  SET status = 'CANCELLED', payment_status = 'FORFEITED', updated_at = v_now
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND status = 'HELD'
    AND hold_expires_at < v_now;

  -- Range overlap check against other active bookings for the same resource
  -- Exclude expired holds
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND (
      status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
      OR (status = 'HELD' AND hold_expires_at >= v_now)
    )
    AND id != p_booking_id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'The requested new slot is already booked or held');
  END IF;

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
$$;

REVOKE ALL ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
