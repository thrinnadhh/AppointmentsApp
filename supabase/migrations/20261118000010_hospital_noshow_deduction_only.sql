-- =============================================================================
-- Migration: 20261118000010_hospital_noshow_deduction_only.sql
-- Description: Align hospital vertical no-show policy with product decision:
--              When provider vertical is 'clinics' (hospital), no-shows apply the
--              ₹60 tiered financial deduction without setting a 7-day blocked_until
--              account lockout (preserving the 6-strike 7-day lockout for non-medical
--              verticals such as salons).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION private.record_no_show(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_provider_vertical TEXT := 'clinics';
    v_current_count INT := 0;
    v_new_count INT := 1;
    v_final_count INT := 1;
    v_payment_status public.payment_status;
    v_penalty BOOLEAN := FALSE;
    v_refund_amount NUMERIC(10, 2) := 0;
    v_merchant_credit NUMERIC(10, 2) := 0;
    v_is_blocked BOOLEAN := FALSE;
    v_blocked_until TIMESTAMPTZ := NULL;
    v_deposit NUMERIC(10, 2) := 0;
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

    -- Reject premature no-show: only allow no-show after slot start + grace period (10 minutes)
    IF NOW() < (v_booking.slot_start + INTERVAL '10 minutes') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Premature no-show: Appointment slot is in the future. Cannot report no-show before slot start and grace period.'
        );
    END IF;

    -- Reject no-show if patient has already arrived and is marked present
    IF v_booking.is_present = TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot report no-show: Patient has already arrived and is marked present'
        );
    END IF;

    -- Caller Authorization Guard: venue owner, authorized staff/consultant, admin, or service_role
    IF auth.role() = 'authenticated' THEN
      IF NOT (
        public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, auth.uid())
        OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
        OR public.is_admin(auth.uid())
      ) THEN
        RAISE EXCEPTION 'Only the owning merchant, authorized consultant/staff, or an admin can record a no-show' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT (
      (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
      OR auth.role() = 'service_role'
    ) THEN
      RAISE EXCEPTION 'Access Denied: Unauthorized caller' USING ERRCODE = '42501';
    END IF;

    -- Lookup provider category / vertical (e.g. 'clinics', 'salons', etc.)
    SELECT COALESCE(category_id, 'clinics') INTO v_provider_vertical
    FROM public.providers
    WHERE id = v_booking.provider_id;

    -- Read current strike count of customer with row lock
    SELECT COALESCE(no_show_count, 0) INTO v_current_count
    FROM public.profiles
    WHERE id = v_booking.customer_id
    FOR UPDATE;

    v_new_count := v_current_count + 1;
    v_deposit := COALESCE(v_booking.deposit_amount, 100.00);

    -- =========================================================================
    -- VERTICAL-SPECIFIC NO-SHOW POLICY:
    --
    -- 1. CLINICS (HOSPITALS & HEALTHCARE):
    --    Deduction only. Healthcare patients are never locked out of booking doctors.
    --    - Strikes 1 & 2: Courtesy 100% refund, no penalty.
    --    - Strikes 3+: ₹50 to doctor, ₹10 to platform, remainder refunded.
    --      No 7-day account lockout is EVER applied for medical appointments.
    --
    -- 2. NON-MEDICAL VERTICALS (SALONS, DINING, TURF, ETC.):
    --    - Strikes 1 & 2: Courtesy 100% refund.
    --    - Strikes 3 to 5: ₹60 tiered deduction, strike counter increments.
    --    - Exceeded 5 strikes (6th no-show): Account blocked for 7 days (`blocked_until`),
    --      strike counter reset to 0.
    -- =========================================================================
    IF v_provider_vertical = 'clinics' THEN
        -- Hospital vertical: Tiered financial deduction, NO account block
        IF v_new_count <= 2 THEN
            v_payment_status := 'REFUND_PENDING'::public.payment_status;
            v_penalty := FALSE;
            v_refund_amount := v_deposit;
            v_merchant_credit := 0;
            v_final_count := v_new_count;
            v_is_blocked := FALSE;
            v_blocked_until := NULL;
        ELSE
            -- Strike 3 onwards in hospital vertical: ₹60 penalty, no account lockout
            v_penalty := TRUE;
            v_merchant_credit := LEAST(50.00, GREATEST(0.00, v_deposit));
            v_final_count := v_new_count;
            v_is_blocked := FALSE;
            v_blocked_until := NULL;

            IF v_deposit > 60.00 THEN
                v_refund_amount := v_deposit - 60.00;
                v_payment_status := 'REFUND_PENDING'::public.payment_status;
            ELSE
                v_refund_amount := 0.00;
                v_payment_status := 'FORFEITED'::public.payment_status;
            END IF;
        END IF;

    ELSE
        -- Non-medical verticals: Standard 6-strike policy with 7-day account block
        IF v_new_count <= 2 THEN
            v_payment_status := 'REFUND_PENDING'::public.payment_status;
            v_penalty := FALSE;
            v_refund_amount := v_deposit;
            v_merchant_credit := 0;
            v_final_count := v_new_count;
            v_is_blocked := FALSE;
            v_blocked_until := NULL;

        ELSIF v_new_count <= 5 THEN
            v_penalty := TRUE;
            v_merchant_credit := LEAST(50.00, GREATEST(0.00, v_deposit));
            v_final_count := v_new_count;
            v_is_blocked := FALSE;
            v_blocked_until := NULL;

            IF v_deposit > 60.00 THEN
                v_refund_amount := v_deposit - 60.00;
                v_payment_status := 'REFUND_PENDING'::public.payment_status;
            ELSE
                v_refund_amount := 0.00;
                v_payment_status := 'FORFEITED'::public.payment_status;
            END IF;

        ELSE
            -- 6th strike in non-medical verticals triggers 7-day account block
            v_penalty := TRUE;
            v_merchant_credit := LEAST(50.00, GREATEST(0.00, v_deposit));
            v_final_count := 0; -- Reset strike counter per spec
            v_is_blocked := TRUE;
            v_blocked_until := NOW() + INTERVAL '7 days';

            IF v_deposit > 60.00 THEN
                v_refund_amount := v_deposit - 60.00;
                v_payment_status := 'REFUND_PENDING'::public.payment_status;
            ELSE
                v_refund_amount := 0.00;
                v_payment_status := 'FORFEITED'::public.payment_status;
            END IF;
        END IF;
    END IF;

    PERFORM set_config('app.trusted_write', 'true', true);

    -- Update customer profile strikes & block
    UPDATE public.profiles
    SET no_show_count = v_final_count,
        blocked_until = CASE WHEN v_is_blocked THEN v_blocked_until ELSE blocked_until END,
        is_flagged = CASE WHEN v_is_blocked OR (v_provider_vertical != 'clinics' AND v_new_count >= 3) THEN TRUE ELSE is_flagged END,
        updated_at = NOW()
    WHERE id = v_booking.customer_id;

    -- Update booking status and payment status atomically
    UPDATE public.bookings
    SET status = 'NO_SHOW',
        payment_status = v_payment_status,
        updated_at = NOW()
    WHERE id = p_booking_id;

    -- If monetary penalty applied, credit merchant penalty_balance
    IF v_merchant_credit > 0 THEN
        UPDATE public.providers
        SET penalty_balance = COALESCE(penalty_balance, 0) + v_merchant_credit,
            updated_at = NOW()
        WHERE id = v_booking.provider_id;

        IF v_payment_status = 'FORFEITED' THEN
            UPDATE public.payments
            SET status = 'FORFEITED',
                updated_at = NOW()
            WHERE booking_id = p_booking_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'vertical', v_provider_vertical,
        'no_show_count', v_final_count,
        'penalty_applied', v_penalty,
        'payment_status', v_payment_status::text,
        'refund_amount', v_refund_amount,
        'merchant_credit', v_merchant_credit,
        'is_blocked', v_is_blocked,
        'blocked_until', v_blocked_until,
        'flagged', v_is_blocked OR (v_provider_vertical != 'clinics' AND v_new_count >= 3),
        'is_flagged', v_is_blocked OR (v_provider_vertical != 'clinics' AND v_new_count >= 3)
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.record_no_show(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT private.record_no_show(p_booking_id);
$function$;

REVOKE ALL ON FUNCTION private.record_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.record_no_show(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_no_show(uuid) TO authenticated, service_role;

COMMIT;
