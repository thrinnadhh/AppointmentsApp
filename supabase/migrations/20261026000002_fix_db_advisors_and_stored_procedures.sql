-- ==============================================================================
-- Migration: 20261026000002_fix_db_advisors_and_stored_procedures.sql
-- Description: Fix database advisor issues and stored procedure defects:
--   1. cancel_doctor_emergency: fix table reference to public.department_members
--   2. confirm_booking_by_merchant: replace invalid enum literal 'PENDING' with 'PENDING_PAYMENT'
--   3. reschedule_booking_slot: replace invalid enum literal 'PAID' with 'CAPTURED'
--   4. search_directory & search_directory_public: remove invalid column r.category_id
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FIX cancel_doctor_emergency (Table reference to department_members)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.cancel_doctor_emergency(UUID, TIMESTAMPTZ, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.cancel_doctor_emergency(
  p_doctor_resource_id UUID,
  p_doctor_arrived BOOLEAN DEFAULT FALSE,
  p_reason TEXT DEFAULT 'Doctor emergency unavailable',
  p_effective_from TIMESTAMPTZ DEFAULT NULL
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

  -- 2. Authorization Check (support admin, venue owner/manager, and active department members)
  IF auth.role() = 'authenticated' THEN
    IF NOT (
      v_doctor_res.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
      OR public.is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.department_members m
        WHERE m.user_id = auth.uid()
          AND m.merchant_id = v_doctor_res.provider_id
          AND m.status = 'active'
      )
    ) THEN
      RAISE EXCEPTION 'Access denied: You are not authorized to cancel doctor schedule';
    END IF;
  END IF;

  v_now := public.get_test_clock(v_doctor_res.provider_id);
  v_effective_time := COALESCE(p_effective_from, v_now);

  -- Enable trusted write
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
      p.full_name AS customer_name,
      p.phone AS customer_phone
    FROM public.bookings b
    LEFT JOIN public.profiles p ON p.id = b.customer_id
    WHERE b.resource_id = p_doctor_resource_id
      AND b.slot_start >= v_effective_time
      AND b.status IN ('HELD', 'CONFIRMED', 'WAITING', 'UP_NEXT')
    FOR UPDATE OF b
  LOOP
    -- 100% Full Refund Policy including platform fee
    v_refund_amt := COALESCE(v_booking.deposit_amount, 0.00) +
                    COALESCE(v_booking.platform_fee, 0.00) +
                    COALESCE(v_booking.platform_fee_gst, 0.00);

    IF v_refund_amt = 0.00 AND v_booking.total_amount IS NOT NULL THEN
      v_refund_amt := v_booking.total_amount;
    END IF;

    -- Update booking status to CANCELLED with REFUND_PENDING and mark emergency flags
    UPDATE public.bookings
    SET 
      status = 'CANCELLED',
      payment_status = CASE 
        WHEN v_booking.payment_status = 'CAPTURED' THEN 'REFUND_PENDING'::public.payment_status
        ELSE v_booking.payment_status
      END,
      emergency_cancelled = TRUE,
      emergency_doctor_arrived = p_doctor_arrived,
      emergency_patient_choice = NULL,
      is_present = FALSE,
      updated_at = v_now
    WHERE id = v_booking.id;

    -- Emits high-priority SMS / WhatsApp notification log
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
      format('Due to an emergency, %s is not available. Your appointment has been cancelled and a 100%% full refund of ₹%s (including deposit and platform fee) has been initiated. Open your app to reschedule or choose available options.',
             v_doctor_res.name,
             v_refund_amt),
      v_now
    );

    v_cancelled_count := v_cancelled_count + 1;
    v_total_refund := v_total_refund + v_refund_amt;
    v_affected_ids := array_append(v_affected_ids, v_booking.id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'doctor_resource_id', p_doctor_resource_id,
    'doctor_name', v_doctor_res.name,
    'provider_id', v_doctor_res.provider_id,
    'doctor_arrived', p_doctor_arrived,
    'cancelled_count', v_cancelled_count,
    'total_refund_amount', v_total_refund,
    'affected_booking_ids', to_jsonb(v_affected_ids),
    'merchant_strikes_applied', 0,
    'reason', p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_doctor_emergency(UUID, BOOLEAN, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_doctor_emergency(UUID, BOOLEAN, TEXT, TIMESTAMPTZ) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FIX confirm_booking_by_merchant (Invalid enum literal 'PENDING')
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_booking_by_merchant(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_booking RECORD;
  v_is_authorized BOOLEAN;
BEGIN
  IF v_caller_id IS NULL AND auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, provider_id, status, payment_status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF auth.role() != 'service_role' THEN
    SELECT (
      public.is_admin(v_caller_id)
      OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id))
    ) INTO v_is_authorized;

    IF NOT v_is_authorized THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Not authorized for this venue');
    END IF;
  END IF;

  -- OPTION A ENFORCEMENT: Booking must have been paid and captured via server payment path
  IF LOWER(COALESCE(v_booking.payment_status::TEXT, '')) != 'captured' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payment required: Booking must have payment_status = captured before confirmation'
    );
  END IF;

  -- Use valid enum literals HELD and PENDING_PAYMENT
  IF v_booking.status NOT IN ('HELD', 'PENDING_PAYMENT') THEN
    IF v_booking.status = 'CONFIRMED' THEN
      RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'CONFIRMED', 'already_confirmed', true);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'Cannot confirm booking in state: ' || v_booking.status);
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CONFIRMED',
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'CONFIRMED');
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_booking_by_merchant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_booking_by_merchant(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FIX reschedule_booking_slot (Invalid enum literal 'PAID')
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_booking
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

  -- Late-window enforcement: customer cannot reschedule within 60 minutes of slot
  IF v_caller_role <> 'service_role'
     AND v_caller_id IS NOT NULL
     AND v_caller_id = v_booking.customer_id
     AND v_booking.slot_start < v_now + INTERVAL '60 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Late reschedule: appointments within 60 minutes of their slot cannot be rescheduled.');
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
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND (
      status = 'CONFIRMED'
      OR (status = 'HELD' AND (hold_expires_at IS NULL OR hold_expires_at >= v_now))
    )
    AND id != p_booking_id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'The requested new slot is already booked or held');
  END IF;

  IF v_booking.status = 'HELD' THEN
    -- Check payment_status with valid enum literal 'CAPTURED'
    IF COALESCE(v_booking.deposit_amount, 0) > 0 AND (v_booking.payment_status != 'CAPTURED' OR v_booking.gateway_payment_id IS NULL) THEN
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FIX search_directory_public & search_directory (Invalid column r.category_id)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_directory_public(p_query text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_results jsonb;
BEGIN
  IF p_query IS NULL OR trim(p_query) = '' THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'category_id', p.category_id,
          'address', p.address,
          'city', p.city,
          'opening_time', p.opening_time,
          'closing_time', p.closing_time,
          'description', p.description,
          'photos', p.photos,
          'latitude', p.latitude,
          'longitude', p.longitude,
          'status', p.status,
          'resources', COALESCE(
            (SELECT jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'provider_id', r.provider_id,
                'name', r.name,
                'type', r.type,
                'department', r.department,
                'department_id', r.department_id,
                'deposit_amount', r.deposit_amount,
                'duration_minutes', r.duration_minutes,
                'capacity', r.capacity,
                'is_active', r.is_active
              )
            ) FROM public.resources r WHERE r.provider_id = p.id AND r.is_active = true),
            '[]'::jsonb
          )
        )
      ),
      '[]'::jsonb
    )
    INTO v_results
    FROM public.providers p
    WHERE p.status = 'ACTIVE';
    RETURN v_results;
  END IF;

  WITH matched_providers AS (
    SELECT
      p.id,
      p.name,
      p.category_id,
      p.address,
      p.city,
      p.opening_time,
      p.closing_time,
      p.description,
      p.photos,
      p.latitude,
      p.longitude,
      p.status,
      GREATEST(
        word_similarity(p_query, p.name),
        word_similarity(p_query, COALESCE(p.description, '')),
        COALESCE(MAX(word_similarity(p_query, r.name)), 0),
        COALESCE(MAX(word_similarity(p_query, COALESCE(r.department, ''))), 0)
      ) AS relevance
    FROM public.providers p
    LEFT JOIN public.resources r ON r.provider_id = p.id
    WHERE p.status = 'ACTIVE'
      AND (
        p.name ILIKE '%' || p_query || '%'
        OR COALESCE(p.description, '') ILIKE '%' || p_query || '%'
        OR r.name ILIKE '%' || p_query || '%'
        OR COALESCE(r.department, '') ILIKE '%' || p_query || '%'
        OR word_similarity(p_query, p.name) > 0.3
        OR word_similarity(p_query, COALESCE(r.name, '')) > 0.3
        OR word_similarity(p_query, COALESCE(r.department, '')) > 0.3
      )
    GROUP BY p.id, p.name, p.category_id, p.address, p.city,
             p.opening_time, p.closing_time, p.description, p.photos,
             p.latitude, p.longitude, p.status
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', mp.id,
        'name', mp.name,
        'category_id', mp.category_id,
        'address', mp.address,
        'city', mp.city,
        'opening_time', mp.opening_time,
        'closing_time', mp.closing_time,
        'description', mp.description,
        'photos', mp.photos,
        'latitude', mp.latitude,
        'longitude', mp.longitude,
        'status', mp.status,
        'relevance', mp.relevance,
        'resources', COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              'id', r.id,
              'provider_id', r.provider_id,
              'name', r.name,
              'type', r.type,
              'department', r.department,
              'department_id', r.department_id,
              'deposit_amount', r.deposit_amount,
              'duration_minutes', r.duration_minutes,
              'capacity', r.capacity,
              'is_active', r.is_active
            )
          ) FROM public.resources r WHERE r.provider_id = mp.id AND r.is_active = true),
          '[]'::jsonb
        )
      )
      ORDER BY mp.relevance DESC
    ),
    '[]'::jsonb
  ) INTO v_results
  FROM matched_providers mp;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_directory_public(TEXT) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.search_directory(p_query text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_results jsonb;
  v_caller_id UUID := auth.uid();
  v_is_admin BOOLEAN := FALSE;
BEGIN
  IF v_caller_id IS NOT NULL THEN
    v_is_admin := public.is_admin(v_caller_id);
  END IF;

  IF p_query IS NULL OR trim(p_query) = '' THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'category_id', p.category_id,
          'address', p.address,
          'city', p.city,
          'phone', CASE
            WHEN v_is_admin OR (v_caller_id IS NOT NULL AND p.id IN (SELECT public.get_user_authorized_providers(v_caller_id)))
            THEN p.phone
            ELSE NULL
          END,
          'email', CASE
            WHEN v_is_admin OR (v_caller_id IS NOT NULL AND p.id IN (SELECT public.get_user_authorized_providers(v_caller_id)))
            THEN p.email
            ELSE NULL
          END,
          'opening_time', p.opening_time,
          'closing_time', p.closing_time,
          'description', p.description,
          'photos', p.photos,
          'latitude', p.latitude,
          'longitude', p.longitude,
          'status', p.status,
          'resources', COALESCE(
            (SELECT jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'provider_id', r.provider_id,
                'name', r.name,
                'type', r.type,
                'department', r.department,
                'department_id', r.department_id,
                'deposit_amount', r.deposit_amount,
                'duration_minutes', r.duration_minutes,
                'capacity', r.capacity,
                'is_active', r.is_active
              )
            ) FROM public.resources r WHERE r.provider_id = p.id AND r.is_active = true),
            '[]'::jsonb
          )
        )
      ),
      '[]'::jsonb
    )
    INTO v_results
    FROM public.providers p
    WHERE p.status = 'ACTIVE';
    RETURN v_results;
  END IF;

  WITH matched_providers AS (
    SELECT
      p.id,
      p.name,
      p.category_id,
      p.address,
      p.city,
      p.phone,
      p.email,
      p.opening_time,
      p.closing_time,
      p.description,
      p.photos,
      p.latitude,
      p.longitude,
      p.status,
      GREATEST(
        word_similarity(p_query, p.name),
        word_similarity(p_query, COALESCE(p.description, '')),
        COALESCE(MAX(word_similarity(p_query, r.name)), 0),
        COALESCE(MAX(word_similarity(p_query, COALESCE(r.department, ''))), 0)
      ) AS relevance
    FROM public.providers p
    LEFT JOIN public.resources r ON r.provider_id = p.id
    WHERE p.status = 'ACTIVE'
      AND (
        p.name ILIKE '%' || p_query || '%'
        OR COALESCE(p.description, '') ILIKE '%' || p_query || '%'
        OR r.name ILIKE '%' || p_query || '%'
        OR COALESCE(r.department, '') ILIKE '%' || p_query || '%'
        OR word_similarity(p_query, p.name) > 0.3
        OR word_similarity(p_query, COALESCE(r.name, '')) > 0.3
        OR word_similarity(p_query, COALESCE(r.department, '')) > 0.3
      )
    GROUP BY p.id, p.name, p.category_id, p.address, p.city, p.phone, p.email,
             p.opening_time, p.closing_time, p.description, p.photos,
             p.latitude, p.longitude, p.status
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', mp.id,
        'name', mp.name,
        'category_id', mp.category_id,
        'address', mp.address,
        'city', mp.city,
        'phone', CASE
          WHEN v_is_admin OR (v_caller_id IS NOT NULL AND mp.id IN (SELECT public.get_user_authorized_providers(v_caller_id)))
          THEN mp.phone
          ELSE NULL
        END,
        'email', CASE
          WHEN v_is_admin OR (v_caller_id IS NOT NULL AND mp.id IN (SELECT public.get_user_authorized_providers(v_caller_id)))
          THEN mp.email
          ELSE NULL
        END,
        'opening_time', mp.opening_time,
        'closing_time', mp.closing_time,
        'description', mp.description,
        'photos', mp.photos,
        'latitude', mp.latitude,
        'longitude', mp.longitude,
        'status', mp.status,
        'relevance', mp.relevance,
        'resources', COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              'id', r.id,
              'provider_id', r.provider_id,
              'name', r.name,
              'type', r.type,
              'department', r.department,
              'department_id', r.department_id,
              'deposit_amount', r.deposit_amount,
              'duration_minutes', r.duration_minutes,
              'capacity', r.capacity,
              'is_active', r.is_active
            )
          ) FROM public.resources r WHERE r.provider_id = mp.id AND r.is_active = true),
          '[]'::jsonb
        )
      )
      ORDER BY mp.relevance DESC
    ),
    '[]'::jsonb
  ) INTO v_results
  FROM matched_providers mp;

  RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.search_directory(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_directory(TEXT) TO authenticated, service_role;
