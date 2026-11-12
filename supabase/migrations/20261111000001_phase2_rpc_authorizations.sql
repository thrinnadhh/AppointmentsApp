-- Migration: 20261111000001_phase2_rpc_authorizations.sql
-- Description: Authorizes authenticated clients to invoke core booking, merchant, and admin RPCs
--              directly, eliminating the Next.js serverless proxy layer while preserving
--              all internal security, auth.uid() guards, and multi-tenant isolation.

BEGIN;

-- 1. Complete Booking: Support CONFIRMED, CHECKED_IN, and IN_CONSULTATION statuses
CREATE OR REPLACE FUNCTION private.complete_booking(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_booking RECORD;
  v_is_authorized BOOLEAN;
BEGIN
  IF v_caller_id IS NULL AND auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Authentication required to complete booking' USING ERRCODE = '42501';
  END IF;

  SELECT id, provider_id, resource_id, status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Verify resource-level authorization if called by user
  IF auth.role() != 'service_role' THEN
    SELECT (
      public.is_admin(v_caller_id)
      OR public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_caller_id)
    ) INTO v_is_authorized;

    IF NOT v_is_authorized THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You are not authorized for this venue or doctor');
    END IF;
  END IF;

  IF v_booking.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'COMPLETED');
  END IF;

  IF v_booking.status NOT IN ('CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid transition: Only CONFIRMED, CHECKED_IN, or IN_CONSULTATION bookings can be completed (current: ' || v_booking.status || ')');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'COMPLETED', updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'COMPLETED');
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.complete_booking(p_booking_id);
$$;

REVOKE ALL ON FUNCTION private.complete_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.complete_booking(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.complete_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_booking(uuid) TO authenticated, service_role;

-- 2. Record No-Show: Grant EXECUTE to authenticated (authorization verified inside RPC)
REVOKE ALL ON FUNCTION private.record_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.record_no_show(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_no_show(uuid) TO authenticated, service_role;

-- 3. Expire Stale Standby Queue: Add caller tenant guard & grant EXECUTE to authenticated
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
  IF auth.role() = 'authenticated' THEN
    IF NOT (
      public.is_admin(auth.uid())
      OR (p_provider_id IS NOT NULL AND p_provider_id IN (SELECT public.get_user_authorized_providers(auth.uid())))
    ) THEN
      RAISE EXCEPTION 'Not authorized to expire standby queue for this provider' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

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
      AND (b.checked_in_at IS NOT NULL OR b.customer_arrived_at IS NOT NULL OR b.queue_position IS NOT NULL OR b.skipped_at IS NOT NULL)
      AND (p_provider_id IS NULL OR b.provider_id = p_provider_id)
      AND (
        b.skipped_at IS NOT NULL
        OR COALESCE(b.checked_in_at, b.customer_arrived_at, b.updated_at) > b.slot_start + INTERVAL '5 minutes'
      )
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    v_clock := public.get_test_clock(v_rec.provider_id);
    v_cutoff := v_rec.checkin_timestamp + (COALESCE(p_threshold_minutes, 45) || ' minutes')::INTERVAL;

    IF v_clock >= v_cutoff THEN
      UPDATE public.bookings
      SET 
        status = 'NO_SHOW',
        is_present = FALSE,
        updated_at = v_clock
      WHERE id = v_rec.id
        AND is_present = FALSE;

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

-- 4. Merchant Register Shop: Grant EXECUTE to authenticated (auth.uid() = p_user_id checked inside)
REVOKE ALL ON FUNCTION public.merchant_register_shop_for_user(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_register_shop_for_user(uuid, text, text, text, text, text, text) TO authenticated, service_role;

-- 5. Admin Governance & Statistics RPCs: Grant EXECUTE to authenticated (is_admin(auth.uid()) checked inside)
REVOKE ALL ON FUNCTION public.get_admin_city_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_city_stats() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_admin_velocity_analytics(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_velocity_analytics(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_city_status(text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_city_status(text, text, integer, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_fetch_merchants(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fetch_merchants(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_update_merchant_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_merchant_status(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_admin_audit_logs(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_logs(integer, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.purge_old_app_logs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_old_app_logs(integer) TO authenticated, service_role;

-- 6. Dispatch Booking Notification: Grant EXECUTE to authenticated (caller authorization checked inside)
REVOKE ALL ON FUNCTION public.dispatch_booking_notification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(uuid, text) TO authenticated, service_role;

COMMIT;
