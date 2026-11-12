-- Migration: 20261030000001_cancel_doctor_emergency_rpc.sql
-- Description: Implement cancel_doctor_emergency RPC for doctor acute emergencies / departure.
-- Cancels affected confirmed bookings, issues 100% full refund (REFUND_PENDING),
-- applies 0 merchant strikes (force majeure), and queues customer notifications.

CREATE OR REPLACE FUNCTION public.cancel_doctor_emergency(
    p_doctor_resource_id UUID,
    p_effective_from TIMESTAMPTZ DEFAULT NOW(),
    p_reason TEXT DEFAULT 'Doctor Acute Medical Emergency'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_booking RECORD;
    v_cancelled_count INT := 0;
    v_total_refund NUMERIC(10,2) := 0.00;
    v_affected_ids UUID[] := ARRAY[]::UUID[];
    v_effective_time TIMESTAMPTZ := COALESCE(p_effective_from, NOW());
    v_res_name TEXT;
    v_prov_id UUID;
BEGIN
    -- Verify resource exists
    SELECT name, provider_id INTO v_res_name, v_prov_id
    FROM public.resources
    WHERE id = p_doctor_resource_id;

    IF v_res_name IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Doctor resource not found'
        );
    END IF;

    -- Enable trusted write so protect_booking_payment_fields allows REFUND_PENDING transition
    PERFORM set_config('app.trusted_write', 'true', true);

    -- Iterate over upcoming CONFIRMED bookings for this doctor
    FOR v_booking IN
        SELECT b.id, b.customer_id, b.provider_id, b.total_amount, b.deposit_amount, b.slot_start,
               p.phone AS customer_phone, p.full_name AS customer_name
        FROM public.bookings b
        LEFT JOIN public.profiles p ON p.id = b.customer_id
        WHERE b.resource_id = p_doctor_resource_id
          AND b.status = 'CONFIRMED'
          AND b.slot_start >= v_effective_time
        ORDER BY b.slot_start ASC
        FOR UPDATE OF b
    LOOP
        -- 1. Cancel the booking with full refund pending and record emergency
        UPDATE public.bookings
        SET status = 'CANCELLED',
            payment_status = 'REFUND_PENDING',
            updated_at = NOW()
        WHERE id = v_booking.id;

        v_cancelled_count := v_cancelled_count + 1;
        v_total_refund := v_total_refund + COALESCE(v_booking.total_amount, 0.00);
        v_affected_ids := array_append(v_affected_ids, v_booking.id);

        -- 2. Insert notification log for the customer with 100% full refund notice
        INSERT INTO public.notification_logs (
            booking_id,
            recipient_phone,
            recipient_name,
            event_type,
            channel,
            status,
            message_content
        ) VALUES (
            v_booking.id,
            COALESCE(v_booking.customer_phone, 'Not provided'),
            COALESCE(v_booking.customer_name, 'Patient'),
            'DOCTOR_EMERGENCY_CANCELLED',
            'whatsapp',
            'QUEUED',
            format('Your appointment has been cancelled due to doctor emergency: %s. A 100%% full refund of ₹%s has been issued.', p_reason, COALESCE(v_booking.total_amount, 0.00))
        )
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- Force Majeure Policy: 0 merchant cancellation strikes or financial penalties applied
    -- Return summary to caller
    RETURN jsonb_build_object(
        'success', true,
        'doctor_resource_id', p_doctor_resource_id,
        'doctor_name', v_res_name,
        'cancelled_count', v_cancelled_count,
        'merchant_strikes_applied', 0,
        'total_refund_amount', v_total_refund,
        'affected_booking_ids', v_affected_ids
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_doctor_emergency(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_doctor_emergency(UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
