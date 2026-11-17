-- =============================================================================
-- Migration: 20261118000008_harden_reclaim_expired_hold_and_refund.sql
-- Description: Fix BIZ-02: Revoke reclaim_expired_hold_or_refund from authenticated,
--              grant only to service_role, add CHECKED_IN/IN_CONSULTATION/WAITING/UP_NEXT
--              conflict checks, and handle exclusion_violation gracefully.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reclaim_expired_hold_or_refund(
    p_booking_id uuid,
    p_payment_id text,
    p_order_id text,
    p_amount numeric,
    p_currency text DEFAULT 'INR'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_booking RECORD;
    v_conflicting_id UUID;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    -- Caller check: only service_role or DB superuser without JWT
    IF NOT (
      (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
      OR auth.role() = 'service_role'
    ) THEN
      RAISE EXCEPTION 'Access Denied: Only service_role can reclaim expired holds' USING ERRCODE = '42501';
    END IF;

    -- 1. Fetch booking with row lock
    SELECT id, resource_id, slot_start, slot_end, status, payment_status, hold_expires_at, total_amount, deposit_amount
    INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    -- Idempotent check
    IF v_booking.status = 'CONFIRMED' THEN
        RETURN jsonb_build_object(
            'success', true,
            'reclaimed', true,
            'idempotent', true,
            'booking_id', p_booking_id
        );
    END IF;

    -- 2. Concurrency lock on the slot resource & start time
    PERFORM pg_advisory_xact_lock(hashtext('slot_claim:' || v_booking.resource_id::text || ':' || v_booking.slot_start::text));

    -- 3. Check if slot is occupied by any active booking (including CHECKED_IN, IN_CONSULTATION, WAITING, UP_NEXT)
    SELECT id INTO v_conflicting_id
    FROM public.bookings
    WHERE resource_id = v_booking.resource_id
      AND tstzrange(slot_start, slot_end) && tstzrange(v_booking.slot_start, v_booking.slot_end)
      AND (
          status IN ('CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING', 'UP_NEXT', 'PENDING_PAYMENT')
          OR (status = 'HELD' AND hold_expires_at >= v_now)
      )
      AND id <> p_booking_id
    LIMIT 1;

    IF v_conflicting_id IS NULL THEN
        -- Case A: Slot is free. Reclaim it for this customer!
        BEGIN
            PERFORM set_config('app.trusted_write', 'true', true);

            UPDATE public.bookings
            SET status = 'CONFIRMED',
                payment_status = 'CAPTURED',
                gateway_payment_id = p_payment_id,
                gateway_order_id = COALESCE(p_order_id, gateway_order_id),
                gateway_provider = 'cashfree',
                hold_expires_at = NULL,
                updated_at = v_now
            WHERE id = p_booking_id;

            INSERT INTO public.payments (
                booking_id, gateway_payment_id, amount, currency, status, metadata, updated_at
            ) VALUES (
                p_booking_id, p_payment_id, p_amount, p_currency, 'CAPTURED',
                jsonb_build_object('gateway', 'cashfree', 'order_id', p_order_id, 'reclaimed_after_expiry', true),
                v_now
            )
            ON CONFLICT (gateway_payment_id) DO UPDATE
                SET status = 'CAPTURED',
                    updated_at = v_now;

            RETURN jsonb_build_object(
                'success', true,
                'reclaimed', true,
                'trigger_refund', false,
                'booking_id', p_booking_id,
                'message', 'Slot reclaimed and confirmed after expired hold'
            );
        EXCEPTION WHEN exclusion_violation THEN
            -- Slot taken concurrently; fall back to Case B auto-refund
            v_conflicting_id := '00000000-0000-0000-0000-000000000000'::uuid;
        END;
    END IF;

    -- Case B: Slot is occupied by a competitor. Mark REFUND_PENDING and signal auto-refund!
    PERFORM set_config('app.trusted_write', 'true', true);

    UPDATE public.bookings
    SET status = 'CANCELLED',
        payment_status = 'REFUND_PENDING',
        gateway_payment_id = p_payment_id,
        gateway_order_id = COALESCE(p_order_id, gateway_order_id),
        gateway_provider = 'cashfree',
        updated_at = v_now
    WHERE id = p_booking_id;

    INSERT INTO public.payments (
        booking_id, gateway_payment_id, amount, currency, status, metadata, updated_at
    ) VALUES (
        p_booking_id, p_payment_id, p_amount, p_currency, 'CAPTURED',
        jsonb_build_object('gateway', 'cashfree', 'order_id', p_order_id, 'reason', 'Late payment arrived after hold expired and slot occupied'),
        v_now
    )
    ON CONFLICT (gateway_payment_id) DO UPDATE
        SET status = 'CAPTURED',
            updated_at = v_now;

    -- Record CRITICAL audit log
    INSERT INTO public.admin_audit_logs (
        action, target_type, target_id, details
    ) VALUES (
        'LATE_PAYMENT_REFUND_SLOT_COLLISION',
        'booking',
        p_booking_id,
        jsonb_build_object(
            'order_id', p_order_id,
            'payment_id', p_payment_id,
            'resource_id', v_booking.resource_id,
            'slot_start', v_booking.slot_start,
            'conflicting_booking_id', v_conflicting_id,
            'severity', 'CRITICAL',
            'message', 'Late payment arrived after hold expired; slot taken by competitor. Automated Cashfree refund triggered.'
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'reclaimed', false,
        'trigger_refund', true,
        'conflicting_booking_id', v_conflicting_id,
        'booking_id', p_booking_id,
        'message', 'Slot occupied by competitor; auto-refund required'
    );
END;
$function$;

-- Strict privilege lockdown: Only service_role may execute reclaim_expired_hold_or_refund
REVOKE ALL ON FUNCTION public.reclaim_expired_hold_or_refund(uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_expired_hold_or_refund(uuid, text, text, numeric, text) TO service_role;

COMMIT;
