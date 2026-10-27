-- Migration: Harden collect_consultation_fee RPC permissions and execution
-- Vulnerability reference: vuln-0004 (Strix Penetration Test finding)
-- Description: Revoke execute privilege on collect_consultation_fee from PUBLIC, anon, and authenticated.
-- Restrict execute privilege strictly to service_role only (aligning with confirm_booking_payment).
-- Ensure search_path is set to public, pg_temp and add defense-in-depth caller role validation.

CREATE OR REPLACE FUNCTION public.collect_consultation_fee(
    p_booking_id UUID,
    p_collected_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_staff_id UUID;
    v_jwt_role TEXT;
BEGIN
    -- Defense-in-depth: When invoked over HTTP / PostgREST RPC, enforce service_role
    v_jwt_role := current_setting('request.jwt.claim.role', true);
    IF v_jwt_role IS NOT NULL AND v_jwt_role != 'service_role' THEN
        RAISE EXCEPTION 'Access denied: public.collect_consultation_fee is executable only by service_role'
            USING ERRCODE = '42501';
    END IF;

    v_staff_id := COALESCE(p_collected_by, auth.uid());

    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    IF v_booking.status = 'CANCELLED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot collect consultation fee on cancelled booking');
    END IF;

    PERFORM set_config('app.trusted_write', 'true', true);

    UPDATE public.bookings
    SET consultation_payment_status = 'COLLECTED_AT_DESK',
        consultation_collected_at = NOW(),
        consultation_collected_by = v_staff_id,
        updated_at = NOW()
    WHERE id = p_booking_id;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'consultation_payment_status', 'COLLECTED_AT_DESK',
        'consultation_fee_amount', v_booking.consultation_fee_amount
    );
END;
$$;

-- Revoke all execute privileges from untrusted roles
REVOKE ALL ON FUNCTION public.collect_consultation_fee(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collect_consultation_fee(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.collect_consultation_fee(UUID, UUID) FROM authenticated;

-- Grant execute exclusively to service_role (used by server API route after reception staff check)
GRANT EXECUTE ON FUNCTION public.collect_consultation_fee(UUID, UUID) TO service_role;
