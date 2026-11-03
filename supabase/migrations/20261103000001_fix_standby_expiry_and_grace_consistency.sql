-- =============================================================================
-- Migration: 20261103000001_fix_standby_expiry_and_grace_consistency.sql
-- Description:
--   1. Protects physically present (is_present = TRUE) late patients from ever
--      being auto-expired as NO_SHOW by background standby cleanup (Decision D2).
--      Only unverified remote standby claims (is_present = FALSE) expire after 45m.
--   2. Unifies the late arrival grace threshold to strict > 10 minutes
--      (arrival > slot_start + INTERVAL '10 minutes') matching queue-engine.ts,
--      checkin/route.ts, and reach/route.ts (Decision D4).
-- =============================================================================

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

  -- Iterate over candidate standby bookings that have exceeded the wait threshold.
  -- CRITICAL (D2 & D4):
  --   1. Physically checked-in / present patients (b.is_present = TRUE) are NEVER
  --      auto-expired as NO_SHOW. Only unverified remote claims (b.is_present = FALSE)
  --      can expire.
  --   2. Unified 10-minute grace window using strict '>' operator.
  FOR v_rec IN
    SELECT 
      b.id,
      b.customer_id,
      b.provider_id,
      b.slot_start,
      COALESCE(b.checked_in_at, b.customer_arrived_at, b.updated_at) AS checkin_timestamp,
      p.full_name AS customer_name,
      p.phone AS customer_phone,
      pr.name AS provider_name
    FROM public.bookings b
    LEFT JOIN public.profiles p ON p.id = b.customer_id
    LEFT JOIN public.providers pr ON pr.id = b.provider_id
    WHERE b.is_present = FALSE
      AND b.status IN ('WAITING', 'CONFIRMED')
      AND (b.checked_in_at IS NOT NULL OR b.customer_arrived_at IS NOT NULL OR b.queue_position IS NOT NULL)
      AND (p_provider_id IS NULL OR b.provider_id = p_provider_id)
      AND COALESCE(b.checked_in_at, b.customer_arrived_at, b.updated_at) > b.slot_start + INTERVAL '10 minutes'
    FOR UPDATE OF b
  LOOP
    -- Calculate simulated/current clock for this booking's provider
    v_clock := public.get_test_clock(v_rec.provider_id);
    v_cutoff := v_rec.checkin_timestamp + (COALESCE(p_threshold_minutes, 45) || ' minutes')::INTERVAL;

    IF v_clock >= v_cutoff THEN
      -- Expire the unverified standby booking
      UPDATE public.bookings
      SET 
        status = 'NO_SHOW',
        is_present = FALSE,
        updated_at = v_clock
      WHERE id = v_rec.id
        AND is_present = FALSE;

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
        format('Hello %s, your standby reservation at %s has exceeded %s minutes without physical check-in. Please reschedule at your convenience.', 
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

