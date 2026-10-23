-- =============================================================================
-- Migration: 20261022000001_standby_expiry_and_doctor_emergency_policies.sql
-- Description:
--   Implements:
--   1. 45-Minute Standby Auto-Expiry Policy (public.expire_stale_standby_queue)
--      Automatically expires late/standby patients who wait > 45m without consultation.
--   2. Doctor Emergency 1-Click Cancel + Full Refund (public.cancel_doctor_emergency)
--      Bulk cancels doctor schedule on emergency with 100% full refund and ZERO merchant penalties.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. STANDBY AUTO-EXPIRY RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_stale_standby_queue(
  p_threshold_minutes INT DEFAULT 45,
  p_provider_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired_count INT := 0;
  v_expired_ids UUID[] := ARRAY[]::UUID[];
  v_rec RECORD;
  v_clock TIMESTAMPTZ;
  v_cutoff TIMESTAMPTZ;
BEGIN
  -- Enable trusted write for state changes
  PERFORM set_config('app.trusted_write', 'true', true);

  -- Iterate over candidate standby bookings that have exceeded the wait threshold
  FOR v_rec IN
    SELECT 
      b.id,
      b.customer_id,
      b.provider_id,
      b.slot_start,
      COALESCE(b.checked_in_at, b.customer_arrived_at) AS checkin_timestamp,
      p.full_name AS customer_name,
      p.phone AS customer_phone,
      pr.name AS provider_name
    FROM public.bookings b
    LEFT JOIN public.profiles p ON p.id = b.customer_id
    LEFT JOIN public.providers pr ON pr.id = b.provider_id
    WHERE b.is_present = TRUE
      AND b.status IN ('WAITING', 'CONFIRMED')
      AND (b.checked_in_at IS NOT NULL OR b.customer_arrived_at IS NOT NULL)
      AND (p_provider_id IS NULL OR b.provider_id = p_provider_id)
    FOR UPDATE OF b
  LOOP
    -- Calculate simulated/current clock for this booking's provider
    v_clock := public.get_test_clock(v_rec.provider_id);
    v_cutoff := v_rec.checkin_timestamp + (COALESCE(p_threshold_minutes, 45) || ' minutes')::INTERVAL;

    IF v_clock >= v_cutoff THEN
      -- Expire the standby booking
      UPDATE public.bookings
      SET 
        status = 'NO_SHOW',
        is_present = FALSE,
        updated_at = v_clock
      WHERE id = v_rec.id;

      -- Enqueue/log notification to customer
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
        'SMS',
        'SENT',
        format('Hello %s, your standby wait at %s has exceeded %s minutes. As no consultation slot opened, your standby status has expired. Please reschedule at your convenience.', 
               COALESCE(v_rec.customer_name, 'Patient'), 
               COALESCE(v_rec.provider_name, 'the clinic'), 
               p_threshold_minutes),
        v_clock
      );

      v_expired_count := v_expired_count + 1;
      v_expired_ids := array_append(v_expired_ids, v_rec.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'expired_count', v_expired_count,
    'threshold_minutes', p_threshold_minutes,
    'expired_booking_ids', to_jsonb(v_expired_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_standby_queue(INT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_standby_queue(INT, UUID) TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DOCTOR EMERGENCY 1-CLICK CANCEL + 100% FULL REFUND RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_doctor_emergency(
  p_doctor_resource_id UUID,
  p_effective_from TIMESTAMPTZ DEFAULT NULL,
  p_reason TEXT DEFAULT 'Doctor Emergency / Unscheduled Medical Departure'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doctor_res RECORD;
  v_provider RECORD;
  v_effective_time TIMESTAMPTZ;
  v_cancelled_count INT := 0;
  v_total_refund NUMERIC(10, 2) := 0.00;
  v_affected_ids UUID[] := ARRAY[]::UUID[];
  v_booking RECORD;
  v_refund_amt NUMERIC(10, 2);
  v_now TIMESTAMPTZ;
BEGIN
  -- 1. Validate Doctor Resource
  SELECT r.id, r.provider_id, r.name, r.type
  INTO v_doctor_res
  FROM public.resources r
  WHERE r.id = p_doctor_resource_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Doctor resource not found');
  END IF;

  SELECT * INTO v_provider
  FROM public.providers
  WHERE id = v_doctor_res.provider_id;

  -- 2. Authorization Check
  IF auth.role() = 'authenticated' THEN
    IF NOT (
      v_doctor_res.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
      OR public.is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.hospital_department_members m
        WHERE m.user_id = auth.uid() AND m.role IN ('ADMIN', 'DOCTOR')
      )
    ) THEN
      RAISE EXCEPTION 'Access denied: You are not authorized to cancel doctor schedule';
    END IF;
  END IF;

  v_now := public.get_test_clock(v_doctor_res.provider_id);
  v_effective_time := COALESCE(p_effective_from, v_now);

  -- Enable trusted write for financial and status updates
  PERFORM set_config('app.trusted_write', 'true', true);

  -- 3. Bulk cancel all upcoming active appointments for this doctor resource
  FOR v_booking IN
    SELECT 
      b.id,
      b.customer_id,
      b.provider_id,
      b.slot_start,
      b.slot_end,
      b.status,
      b.payment_status,
      b.deposit_amount,
      b.platform_fee,
      b.platform_fee_gst,
      b.total_amount,
      b.gateway_payment_id,
      p.full_name AS customer_name,
      p.phone AS customer_phone
    FROM public.bookings b
    LEFT JOIN public.profiles p ON p.id = b.customer_id
    WHERE b.resource_id = p_doctor_resource_id
      AND b.slot_start >= v_effective_time
      AND b.status IN ('HELD', 'CONFIRMED', 'WAITING', 'UP_NEXT')
    FOR UPDATE OF b
  LOOP
    -- 100% Full Refund Policy for Force Majeure / Doctor Emergency
    v_refund_amt := COALESCE(v_booking.deposit_amount, 0.00) +
                    COALESCE(v_booking.platform_fee, 0.00) +
                    COALESCE(v_booking.platform_fee_gst, 0.00);

    IF v_refund_amt = 0.00 AND v_booking.total_amount IS NOT NULL THEN
      v_refund_amt := v_booking.total_amount;
    END IF;

    -- Update booking status to CANCELLED with REFUND_PENDING
    UPDATE public.bookings
    SET 
      status = 'CANCELLED',
      payment_status = CASE 
        WHEN v_booking.payment_status = 'CAPTURED' THEN 'REFUND_PENDING'::public.payment_status
        ELSE v_booking.payment_status
      END,
      is_present = FALSE,
      updated_at = v_now
    WHERE id = v_booking.id;

    -- Emits high-priority SMS / notification log
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
      v_booking.id,
      COALESCE(v_booking.customer_name, 'Patient'),
      COALESCE(v_booking.customer_phone, '+919999999999'),
      'DOCTOR_EMERGENCY_CANCELLED',
      'SMS',
      'SENT',
      format('Dear %s, your appointment with %s on %s has been cancelled due to an urgent doctor emergency. A 100%% full refund of ₹%s has been initiated to your original payment method. We apologize for the inconvenience.',
             COALESCE(v_booking.customer_name, 'Patient'),
             v_doctor_res.name,
             to_char(v_booking.slot_start, 'DD Mon YYYY at HH12:MI AM'),
             v_refund_amt),
      v_now
    );

    v_cancelled_count := v_cancelled_count + 1;
    v_total_refund := v_total_refund + v_refund_amt;
    v_affected_ids := array_append(v_affected_ids, v_booking.id);
  END LOOP;

  -- CRITICAL RULE: ZERO MERCHANT PENALTY STRIKES
  -- Authorized medical emergencies / force majeure cancellations DO NOT increment cancellation_strikes or penalty_balance.

  RETURN jsonb_build_object(
    'success', true,
    'doctor_resource_id', p_doctor_resource_id,
    'doctor_name', v_doctor_res.name,
    'provider_id', v_doctor_res.provider_id,
    'cancelled_count', v_cancelled_count,
    'total_refund_amount', v_total_refund,
    'affected_booking_ids', to_jsonb(v_affected_ids),
    'merchant_strikes_applied', 0,
    'reason', p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_doctor_emergency(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_doctor_emergency(UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
