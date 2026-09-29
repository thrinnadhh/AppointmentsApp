-- Migration: 20260929000001_concurrency_and_financial_state_machine.sql
-- Description:
--   1. Critical: Enable btree_gist extension and add range exclusion constraint on public.bookings.
--   2. High: Disallow unearned transitions from HELD to CONFIRMED in reschedule_booking_slot RPC.
--   3. High: Enforce daily booking limits in Asia/Kolkata timezone with advisory lock in create_booking_hold RPC.
--   4. Range overlap conflict checks replacing point-in-time slot_start equality.

-- =============================================================================
-- 1. POSTGRESQL BTREE_GIST EXTENSION & RANGE EXCLUSION CONSTRAINT
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Drop legacy point-in-time unique index if present
DROP INDEX IF EXISTS public.idx_unique_active_resource_slot;

-- Drop existing constraint if it exists to allow idempotent re-runs
ALTER TABLE public.bookings
DROP CONSTRAINT IF EXISTS no_overlapping_active_bookings;

-- Range exclusion constraint preventing any overlapping intervals for active bookings of the same resource
ALTER TABLE public.bookings 
ADD CONSTRAINT no_overlapping_active_bookings 
EXCLUDE USING gist (
  resource_id WITH =,
  tstzrange(slot_start, slot_end) WITH &&
) WHERE (status IN ('HELD', 'CONFIRMED'));


-- =============================================================================
-- 2. HARDEN CREATE_BOOKING_HOLD (Range Overlap + IST Daily Limit + Advisory Lock)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id   UUID,
    p_slot_start    TIMESTAMPTZ,
    p_slot_end      TIMESTAMPTZ,
    p_customer_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_provider_id         UUID;
    v_deposit_amount      NUMERIC;
    v_platform_fee        NUMERIC;
    v_total_amount        NUMERIC;
    v_is_active           BOOLEAN;
    v_provider_status     TEXT;
    v_category_id         TEXT;
    v_daily_booking_limit INTEGER;
    v_daily_count         BIGINT;
    v_slot_date_ist       DATE;
    v_existing_id         UUID;
    v_new_booking_id      UUID;
    v_reference_code      TEXT;
    v_hold_expiry         TIMESTAMPTZ;
BEGIN
    -- Verify caller identity: Client callers cannot forge customer_id
    IF auth.role() != 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_customer_id THEN
            RAISE EXCEPTION 'Unauthorized: customer_id must match authenticated user' USING ERRCODE = '42501';
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

    -- Enforce ₹100 minimum deposit floor
    IF COALESCE(v_deposit_amount, 0) < 100 THEN
        v_deposit_amount := 100.00;
    END IF;

    -- Fetch provider status, category, and operational daily booking limit
    SELECT status, category_id, daily_booking_limit 
    INTO v_provider_status, v_category_id, v_daily_booking_limit
    FROM public.providers 
    WHERE id = v_provider_id;

    IF v_provider_status = 'SUSPENDED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Merchant provider is suspended');
    END IF;

    -- Daily Booking Limit Concurrency Guard:
    -- Evaluate in operational timezone (Asia/Kolkata) inside advisory-locked transaction to prevent TOCTOU race
    IF v_daily_booking_limit IS NOT NULL AND v_daily_booking_limit > 0 THEN
        v_slot_date_ist := (p_slot_start AT TIME ZONE 'Asia/Kolkata')::date;

        -- Transaction-level advisory lock on provider + IST calendar day
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

    -- Platform fee: ₹50 for Gaming & Turf, ₹10 for all others
    v_platform_fee := CASE WHEN v_category_id IN ('gaming', 'turf') THEN 50.00 ELSE 10.00 END;
    v_total_amount := v_deposit_amount + v_platform_fee;

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
            disclaimer_version
        ) VALUES (
            p_customer_id, v_provider_id, p_resource_id,
            p_slot_start, p_slot_end, 'HELD', 'PENDING',
            v_deposit_amount, v_platform_fee, v_total_amount, v_hold_expiry,
            'v1'
        )
        RETURNING id, reference_code INTO v_new_booking_id, v_reference_code;
    EXCEPTION
        WHEN exclusion_violation OR unique_violation THEN
            RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked');
    END;

    RETURN jsonb_build_object(
        'success',          true,
        'booking_id',       v_new_booking_id,
        'reference_code',   v_reference_code,
        'deposit_amount',   v_deposit_amount,
        'platform_fee',     v_platform_fee,
        'total_amount',     v_total_amount,
        'hold_expires_at',  v_hold_expiry
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated, service_role;


-- =============================================================================
-- 3. HARDEN RESCHEDULE_BOOKING_SLOT (State Machine + Overlap Exclusion)
-- =============================================================================
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
  v_target_status TEXT;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard:
  IF v_caller_role = 'service_role' THEN
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
      v_target_status := 'HELD';
    ELSE
      v_target_status := 'CONFIRMED';
    END IF;
  ELSIF v_booking.status = 'CONFIRMED' THEN
    v_target_status := 'CONFIRMED';
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
    'status', v_target_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
