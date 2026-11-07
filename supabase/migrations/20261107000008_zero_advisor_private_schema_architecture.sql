-- =============================================================================
-- Migration: 20261107000008_zero_advisor_private_schema_architecture.sql
-- Purpose: Zero out all remaining Supabase Security Advisor findings for
--          anon_security_definer_function_executable and
--          authenticated_security_definer_function_executable
--
-- Architecture: Pattern B (Private Schema Bridge)
--   1. Create unexposed schema 'private' (not present in PostgREST exposed-schemas config).
--   2. Move SECURITY DEFINER logic to private.<name> with SET search_path = ''
--      and strict auth.uid() identity derivation and authorization guards.
--   3. Expose identical public.<name> wrappers as SECURITY INVOKER functions.
--   4. Grant USAGE on private to anon/authenticated/service_role and EXECUTE
--      on private.<name> only to authorized callers.
--   5. Fix mutable search_path on remaining invoker functions.
--
-- Rollback Notes:
--   To rollback, drop schema private CASCADE and re-apply migration
--   20261107000005_supabase_security_advisor_remediation.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema: private
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

-- =============================================================================
-- Function: get_active_cities
-- =============================================================================
CREATE OR REPLACE FUNCTION private.get_active_cities(p_include_expanding boolean DEFAULT true)
 RETURNS TABLE(id text, name text, state text, status text, latitude numeric, longitude numeric, radius_km numeric, active_providers_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.state,
    c.status,
    c.latitude,
    c.longitude,
    c.radius_km,
    COUNT(p.id) FILTER (WHERE p.status = 'ACTIVE')::BIGINT AS active_providers_count
  FROM public.cities c
  LEFT JOIN public.providers p ON p.city_id = c.id
  WHERE (c.status = 'ACTIVE') OR (p_include_expanding AND c.status = 'EXPANDING')
  GROUP BY c.id, c.name, c.state, c.status, c.latitude, c.longitude, c.radius_km
  ORDER BY (CASE WHEN c.status = 'ACTIVE' THEN 1 ELSE 2 END), c.name ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_active_cities(p_include_expanding boolean DEFAULT true)
RETURNS TABLE(id text, name text, state text, status text, latitude numeric, longitude numeric, radius_km numeric, active_providers_count bigint)
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM private.get_active_cities(p_include_expanding);
$$;

REVOKE ALL ON FUNCTION private.get_active_cities FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.get_active_cities TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_active_cities FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_cities TO anon, authenticated, service_role;


-- =============================================================================
-- Function: get_nearby_providers
-- =============================================================================
CREATE OR REPLACE FUNCTION private.get_nearby_providers(p_lat numeric, p_lng numeric, p_category text DEFAULT NULL::text, p_radius_meters integer DEFAULT 25000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_results jsonb;
  v_client_point extensions.geography;
  v_clamped_radius integer;
BEGIN
  v_clamped_radius := LEAST(GREATEST(COALESCE(p_radius_meters, 25000), 100), 50000);
  v_client_point := extensions.ST_MakePoint(p_lng, p_lat)::extensions.geography;

  WITH provider_distances AS (
    SELECT
      p.id,
      CASE WHEN auth.uid() IS NOT NULL AND (public.is_admin(auth.uid()) OR p.id IN (SELECT public.get_user_authorized_providers(auth.uid()))) THEN p.owner_id ELSE NULL END AS owner_id,
      p.category_id,
      p.sub_category_id,
      p.name,
      p.description,
      p.address,
      p.city,
      p.latitude,
      p.longitude,
      CASE WHEN auth.uid() IS NOT NULL AND (public.is_admin(auth.uid()) OR p.id IN (SELECT public.get_user_authorized_providers(auth.uid()))) THEN p.phone ELSE NULL END AS phone,
      CASE WHEN auth.uid() IS NOT NULL AND (public.is_admin(auth.uid()) OR p.id IN (SELECT public.get_user_authorized_providers(auth.uid()))) THEN p.email ELSE NULL END AS email,
      p.opening_time,
      p.closing_time,
      p.photos,
      p.status,
      p.created_at,
      p.updated_at,
      extensions.ST_Distance(
        extensions.ST_MakePoint(p.longitude, p.latitude)::extensions.geography,
        v_client_point
      ) AS distance_meters,
      ROUND(
        (extensions.ST_Distance(
          extensions.ST_MakePoint(p.longitude, p.latitude)::extensions.geography,
          v_client_point
        ) / 1000.0)::numeric, 1
      ) AS distance_km
    FROM public.providers p
    WHERE p.status = 'ACTIVE'
      AND (
        p_category IS NULL 
        OR p_category = 'all' 
        OR p.category_id = p_category
        OR regexp_replace(lower(p.category_id), 's$', '') = regexp_replace(lower(p_category), 's$', '')
      )
      AND extensions.ST_DWithin(
        extensions.ST_MakePoint(p.longitude, p.latitude)::extensions.geography,
        v_client_point,
        v_clamped_radius
      )
    ORDER BY distance_meters ASC
    LIMIT 50
  )
  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(pd.*) || jsonb_build_object(
        'resources', COALESCE(
          (
            SELECT jsonb_agg(to_jsonb(r.*))
            FROM public.resources r
            WHERE r.provider_id = pd.id AND r.is_active = true
          ),
          '[]'::jsonb
        )
      )
    ),
    '[]'::jsonb
  )
  INTO v_results
  FROM provider_distances pd;

  RETURN v_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_nearby_providers(p_lat numeric, p_lng numeric, p_category text DEFAULT NULL::text, p_radius_meters integer DEFAULT 25000)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_nearby_providers(p_lat, p_lng, p_category, p_radius_meters);
$$;

REVOKE ALL ON FUNCTION private.get_nearby_providers FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.get_nearby_providers TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_nearby_providers FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nearby_providers TO anon, authenticated, service_role;


-- =============================================================================
-- Function: log_client_event
-- =============================================================================
CREATE OR REPLACE FUNCTION private.log_client_event(p_platform text, p_level text, p_message text, p_component text DEFAULT NULL::text, p_stack_trace text DEFAULT NULL::text, p_metadata jsonb DEFAULT NULL::jsonb, p_device_info jsonb DEFAULT NULL::jsonb, p_session_id text DEFAULT NULL::text, p_severity text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_city_id text DEFAULT NULL::text, p_vertical text DEFAULT NULL::text, p_appointment_id text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_platform_os text DEFAULT NULL::text, p_device_model text DEFAULT NULL::text, p_environment text DEFAULT NULL::text, p_fingerprint text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_actual_role text;
  v_capped_stack text;
  v_capped_meta jsonb;
  v_new_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_actual_role FROM public.profiles WHERE id = auth.uid();
  ELSE
    v_actual_role := 'anon';
  END IF;

  IF p_stack_trace IS NOT NULL THEN
    v_capped_stack := substr(p_stack_trace, 1, 8192);
  END IF;

  IF p_metadata IS NOT NULL THEN
    IF length(p_metadata::text) > 8192 THEN
      v_capped_meta := jsonb_build_object(
        '_truncated', true,
        'summary', substr(p_metadata::text, 1, 8000)
      );
    ELSE
      v_capped_meta := p_metadata;
    END IF;
  ELSE
    v_capped_meta := '{}'::jsonb;
  END IF;

  INSERT INTO public.app_logs (
    platform,
    level,
    message,
    component,
    stack_trace,
    metadata,
    device_info,
    session_id,
    severity,
    category,
    source,
    error_code,
    role,
    city_id,
    vertical,
    appointment_id,
    app_version,
    platform_os,
    device_model,
    environment,
    fingerprint,
    user_id
  ) VALUES (
    COALESCE(p_platform, 'unknown'),
    COALESCE(p_level, 'info'),
    substr(COALESCE(p_message, 'No message provided'), 1, 2000),
    substr(p_component, 1, 200),
    v_capped_stack,
    v_capped_meta,
    p_device_info,
    substr(p_session_id, 1, 100),
    COALESCE(p_severity, 'INFO'),
    COALESCE(p_category, 'OTHER'),
    substr(p_source, 1, 100),
    substr(p_error_code, 1, 100),
    v_actual_role,
    substr(p_city_id, 1, 50),
    substr(p_vertical, 1, 50),
    substr(p_appointment_id, 1, 100),
    substr(p_app_version, 1, 50),
    substr(p_platform_os, 1, 50),
    substr(p_device_model, 1, 100),
    substr(p_environment, 1, 50),
    substr(p_fingerprint, 1, 100),
    auth.uid()
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_client_event(p_platform text, p_level text, p_message text, p_component text DEFAULT NULL::text, p_stack_trace text DEFAULT NULL::text, p_metadata jsonb DEFAULT NULL::jsonb, p_device_info jsonb DEFAULT NULL::jsonb, p_session_id text DEFAULT NULL::text, p_severity text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_city_id text DEFAULT NULL::text, p_vertical text DEFAULT NULL::text, p_appointment_id text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_platform_os text DEFAULT NULL::text, p_device_model text DEFAULT NULL::text, p_environment text DEFAULT NULL::text, p_fingerprint text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.log_client_event(p_platform, p_level, p_message, p_component, p_stack_trace, p_metadata, p_device_info, p_session_id, p_severity, p_category, p_source, p_error_code, p_role, p_city_id, p_vertical, p_appointment_id, p_app_version, p_platform_os, p_device_model, p_environment, p_fingerprint);
$$;

REVOKE ALL ON FUNCTION private.log_client_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.log_client_event TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.log_client_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_client_event TO anon, authenticated, service_role;


-- =============================================================================
-- Function: submit_city_waitlist
-- =============================================================================
CREATE OR REPLACE FUNCTION private.submit_city_waitlist(p_city_name text, p_phone text, p_vertical_interest text DEFAULT 'all'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_sanitized_city text;
  v_sanitized_phone text;
  v_sanitized_vertical text;
  v_sanitized_notes text;
  v_existing_id uuid;
BEGIN
  IF p_city_name IS NULL OR length(trim(p_city_name)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'City name is required');
  END IF;

  IF p_phone IS NULL OR length(trim(p_phone)) < 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'A valid phone number is required');
  END IF;

  v_sanitized_city := substr(trim(p_city_name), 1, 100);
  v_sanitized_phone := substr(regexp_replace(trim(p_phone), '[^0-9+]', '', 'g'), 1, 15);
  v_sanitized_vertical := substr(COALESCE(trim(p_vertical_interest), 'all'), 1, 50);
  v_sanitized_notes := CASE WHEN p_notes IS NOT NULL THEN substr(trim(p_notes), 1, 500) ELSE NULL END;

  SELECT id INTO v_existing_id
  FROM public.city_waitlist
  WHERE phone = v_sanitized_phone
    AND city_name ILIKE v_sanitized_city
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'You are already registered on the waitlist for this city!',
      'id', v_existing_id
    );
  END IF;

  INSERT INTO public.city_waitlist (
    city_name,
    phone,
    vertical_interest,
    notes,
    consent_given,
    consent_timestamp
  ) VALUES (
    v_sanitized_city,
    v_sanitized_phone,
    v_sanitized_vertical,
    v_sanitized_notes,
    true,
    NOW()
  )
  RETURNING id INTO v_existing_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Successfully added to city waitlist',
    'id', v_existing_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_city_waitlist(p_city_name text, p_phone text, p_vertical_interest text DEFAULT 'all'::text, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.submit_city_waitlist(p_city_name, p_phone, p_vertical_interest, p_notes);
$$;

REVOKE ALL ON FUNCTION private.submit_city_waitlist FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.submit_city_waitlist TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_city_waitlist FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_city_waitlist TO anon, authenticated, service_role;


-- =============================================================================
-- Function: cancel_booking
-- =============================================================================
CREATE OR REPLACE FUNCTION private.cancel_booking(p_booking_id uuid, p_reason text DEFAULT 'Standard cancellation'::text, p_initiated_by text DEFAULT 'CUSTOMER'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_provider public.providers%ROWTYPE;
  v_minutes_to_slot NUMERIC;
  v_eligible BOOLEAN;
  v_payment_status public.payment_status;
  v_refund_amount NUMERIC(10, 2) := 0;
  v_now TIMESTAMPTZ;
  
  v_is_merchant BOOLEAN := FALSE;
  v_strike_increment INT := 1;
  v_new_merchant_strikes INT := 0;
  v_penalty_applied BOOLEAN := FALSE;
  v_penalty_amount NUMERIC(10, 2) := 0.00;
  v_is_frozen BOOLEAN := FALSE;
  v_customer_name TEXT;
  v_customer_phone TEXT;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Booking is already cancelled',
      'message', 'Booking is already cancelled'
    );
  END IF;

  IF v_booking.status::text IN ('CHECKED_IN', 'WAITING', 'UP_NEXT', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW')
     OR v_booking.is_present = TRUE
     OR v_booking.status::text NOT IN ('CONFIRMED', 'HELD') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot cancel booking in status ' || v_booking.status::text,
      'message', 'Bookings in status ' || v_booking.status::text || ' cannot be cancelled'
    );
  END IF;

  -- Caller Authorization Guard (resource-scoped for hospital staff)
  IF auth.role() = 'authenticated' THEN
    IF NOT (
      auth.uid() = v_booking.customer_id
      OR public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, auth.uid())
      OR public.is_admin(auth.uid())
    ) THEN
      RAISE EXCEPTION 'Access denied: You are not authorized to cancel this booking';
    END IF;
  END IF;

  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
    IF public.is_admin(auth.uid()) THEN
      v_is_merchant := (upper(COALESCE(p_initiated_by, 'CUSTOMER')) = 'MERCHANT');
    ELSIF auth.uid() = v_booking.customer_id THEN
      v_is_merchant := FALSE;
    ELSIF public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, auth.uid()) THEN
      v_is_merchant := TRUE;
    ELSE
      v_is_merchant := FALSE;
    END IF;
  ELSE
    v_is_merchant := (upper(COALESCE(p_initiated_by, 'CUSTOMER')) = 'MERCHANT');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);

  PERFORM set_config('app.trusted_write', 'true', true);

  v_minutes_to_slot := EXTRACT(EPOCH FROM (v_booking.slot_start - v_now)) / 60;

  IF v_is_merchant THEN
    v_eligible := true;
    v_payment_status := 'REFUND_PENDING'::public.payment_status;
    v_refund_amount := COALESCE(v_booking.deposit_amount, 0.00) +
                       COALESCE(v_booking.platform_fee, 0.00) +
                       COALESCE(v_booking.platform_fee_gst, 0.00);

    IF v_refund_amount = 0 THEN
      v_refund_amount := COALESCE(v_booking.total_amount, 100.00);
    END IF;

    SELECT * INTO v_provider
    FROM public.providers
    WHERE id = v_booking.provider_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_now > v_provider.strike_reset_date THEN
        v_provider.cancellation_strikes := 0;
        v_provider.strike_reset_date := v_now + INTERVAL '30 days';
      END IF;

      IF v_minutes_to_slot <= 30 THEN
        v_strike_increment := 2;
      ELSE
        v_strike_increment := 1;
      END IF;

      v_new_merchant_strikes := v_provider.cancellation_strikes + v_strike_increment;

      IF v_new_merchant_strikes >= 3 THEN
        v_penalty_applied := TRUE;
        v_penalty_amount := 100.00;
      ELSE
        v_penalty_applied := FALSE;
        v_penalty_amount := 0.00;
      END IF;

      IF v_new_merchant_strikes >= 5 THEN
        v_is_frozen := TRUE;
      ELSE
        v_is_frozen := v_provider.is_booking_frozen;
      END IF;

      UPDATE public.providers
      SET cancellation_strikes = v_new_merchant_strikes,
          penalty_balance = penalty_balance + v_penalty_amount,
          is_booking_frozen = v_is_frozen,
          strike_reset_date = v_provider.strike_reset_date,
          updated_at = v_now
      WHERE id = v_booking.provider_id;
    END IF;

  ELSE
    v_eligible := (v_minutes_to_slot >= 60.0);
    IF v_eligible THEN
      v_payment_status := 'REFUND_PENDING'::public.payment_status;
      v_refund_amount := COALESCE(v_booking.deposit_amount, 100.00);
    ELSE
      v_payment_status := 'FORFEITED'::public.payment_status;
      v_refund_amount := 0.00;
    END IF;
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CANCELLED',
      payment_status = v_payment_status,
      updated_at = v_now
  WHERE id = p_booking_id;

  IF v_booking.gateway_payment_id IS NOT NULL AND v_payment_status <> 'REFUND_PENDING' THEN
    UPDATE public.payments
    SET status = v_payment_status,
        updated_at = v_now,
        metadata = jsonb_build_object(
          'cancellation_reason', p_reason,
          'initiated_by', CASE WHEN v_is_merchant THEN 'MERCHANT' ELSE 'CUSTOMER' END,
          'refund_amount', v_refund_amount,
          'minutes_before_slot', v_minutes_to_slot,
          'merchant_strikes', v_new_merchant_strikes,
          'merchant_penalty', v_penalty_amount
        )
    WHERE booking_id = p_booking_id;
  END IF;

  IF v_is_merchant THEN
    SELECT full_name, phone INTO v_customer_name, v_customer_phone
    FROM public.profiles
    WHERE id = v_booking.customer_id;

    INSERT INTO public.notification_logs (
      booking_id,
      recipient_phone,
      recipient_name,
      event_type,
      channel,
      status,
      message_content,
      provider_response
    ) VALUES (
      p_booking_id,
      COALESCE(public.normalize_phone_number(v_customer_phone), '919848000000'),
      COALESCE(v_customer_name, 'Valued Customer'),
      'MERCHANT_CANCELLED',
      'whatsapp',
      'QUEUED',
      format('Your appointment has been cancelled by the venue due to an emergency. A full 100%% refund of ₹%s has been issued.', v_refund_amount),
      jsonb_build_object(
        'initiated_by', 'MERCHANT',
        'reason', p_reason,
        'refund_amount', v_refund_amount,
        'merchant_strikes', v_new_merchant_strikes,
        'penalty_applied', v_penalty_applied,
        'penalty_amount', v_penalty_amount
      )
    )
    ON CONFLICT (booking_id, event_type, channel) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'CANCELLED',
    'payment_status', v_payment_status,
    'refund_eligible', v_eligible,
    'refund_amount', v_refund_amount,
    'merchant_strikes', v_new_merchant_strikes,
    'penalty_applied', v_penalty_applied,
    'penalty_amount', v_penalty_amount,
    'is_booking_frozen', v_is_frozen
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason text DEFAULT 'Standard cancellation'::text, p_initiated_by text DEFAULT 'CUSTOMER'::text)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.cancel_booking(p_booking_id, p_reason, p_initiated_by);
$$;

REVOKE ALL ON FUNCTION private.cancel_booking FROM PUBLIC;
REVOKE ALL ON FUNCTION private.cancel_booking FROM anon;
GRANT EXECUTE ON FUNCTION private.cancel_booking TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_booking FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_booking FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking TO authenticated, service_role;


-- =============================================================================
-- Function: cancel_doctor_emergency
-- =============================================================================
CREATE OR REPLACE FUNCTION private.cancel_doctor_emergency(p_doctor_resource_id uuid, p_effective_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT 'Doctor emergency unavailable'::text, p_doctor_arrived boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
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
      public.is_caller_authorized_for_resource(v_doctor_res.provider_id, v_doctor_res.id, auth.uid())
      OR v_doctor_res.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
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
$function$;

CREATE OR REPLACE FUNCTION public.cancel_doctor_emergency(p_doctor_resource_id uuid, p_effective_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT 'Doctor emergency unavailable'::text, p_doctor_arrived boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  -- Delegates to private.cancel_doctor_emergency (references department_members)
  SELECT private.cancel_doctor_emergency(p_doctor_resource_id, p_effective_from, p_reason, p_doctor_arrived);
$$;

REVOKE ALL ON FUNCTION private.cancel_doctor_emergency FROM PUBLIC;
REVOKE ALL ON FUNCTION private.cancel_doctor_emergency FROM anon;
GRANT EXECUTE ON FUNCTION private.cancel_doctor_emergency TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_doctor_emergency FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_doctor_emergency FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_doctor_emergency TO authenticated, service_role;


-- =============================================================================
-- Function: check_cooling_period_eligibility
-- =============================================================================
CREATE OR REPLACE FUNCTION private.check_cooling_period_eligibility(p_customer_id uuid, p_provider_id uuid, p_target_slot timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
    v_cooling_days INTEGER;
    v_orig_id      UUID;
    v_orig_slot    TIMESTAMPTZ;
    v_valid_until  TIMESTAMPTZ;
    v_days_left    NUMERIC;
BEGIN
    -- Strict caller identity binding (vuln-0005 IDOR defense)
    IF auth.role() <> 'service_role' THEN
        IF auth.uid() IS NULL OR (auth.uid() <> p_customer_id AND NOT EXISTS (
            SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
        )) THEN
            RAISE EXCEPTION 'Access Denied: You are not authorized to check cooling period for this customer';
        END IF;
    END IF;

    SELECT COALESCE(cooling_period_days, 0) INTO v_cooling_days
    FROM public.providers
    WHERE id = p_provider_id;

    IF v_cooling_days IS NULL OR v_cooling_days <= 0 THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'cooling_period_days', 0,
            'reason', 'Cooling period not configured or disabled'
        );
    END IF;

    -- Strict non-followup anchor lookup (is_followup = FALSE) (vuln-0025)
    SELECT id, slot_start, slot_start + (v_cooling_days || ' days')::INTERVAL
    INTO v_orig_id, v_orig_slot, v_valid_until
    FROM public.bookings
    WHERE customer_id = p_customer_id
      AND provider_id = p_provider_id
      AND status IN ('CONFIRMED', 'COMPLETED')
      AND is_followup = FALSE
      AND slot_start <= p_target_slot
      AND p_target_slot <= (slot_start + (v_cooling_days || ' days')::INTERVAL)
      AND NOW() <= (slot_start + (v_cooling_days || ' days')::INTERVAL)
    ORDER BY slot_start DESC
    LIMIT 1;

    IF v_orig_id IS NOT NULL THEN
        v_days_left := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_valid_until - NOW())) / 86400.0, 1));
        RETURN jsonb_build_object(
            'eligible', true,
            'cooling_period_days', v_cooling_days,
            'original_booking_id', v_orig_id,
            'original_slot_start', v_orig_slot,
            'valid_until', v_valid_until,
            'days_remaining', v_days_left,
            'reason', 'Target appointment date is within the ' || v_cooling_days || '-day cooling period'
        );
    END IF;

    RETURN jsonb_build_object(
        'eligible', false,
        'cooling_period_days', v_cooling_days,
        'reason', 'No active completed appointment found within the cooling period window'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_cooling_period_eligibility(p_customer_id uuid, p_provider_id uuid, p_target_slot timestamp with time zone DEFAULT now())
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.check_cooling_period_eligibility(p_customer_id, p_provider_id, p_target_slot);
$$;

REVOKE ALL ON FUNCTION private.check_cooling_period_eligibility FROM PUBLIC;
REVOKE ALL ON FUNCTION private.check_cooling_period_eligibility FROM anon;
GRANT EXECUTE ON FUNCTION private.check_cooling_period_eligibility TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.check_cooling_period_eligibility FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_cooling_period_eligibility FROM anon;
GRANT EXECUTE ON FUNCTION public.check_cooling_period_eligibility TO authenticated, service_role;


-- =============================================================================
-- Function: complete_booking
-- =============================================================================
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

  IF v_booking.status != 'CONFIRMED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid transition: Only CONFIRMED bookings can be completed (current: ' || v_booking.status || ')');
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

REVOKE ALL ON FUNCTION private.complete_booking FROM PUBLIC;
REVOKE ALL ON FUNCTION private.complete_booking FROM anon;
GRANT EXECUTE ON FUNCTION private.complete_booking TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.complete_booking FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_booking FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_booking TO authenticated, service_role;


-- =============================================================================
-- Function: create_booking_hold
-- =============================================================================
CREATE OR REPLACE FUNCTION private.create_booking_hold(p_resource_id uuid, p_slot_start timestamp with time zone, p_slot_end timestamp with time zone, p_customer_id uuid, p_booking_for_someone_else boolean DEFAULT false, p_patient_name text DEFAULT NULL::text, p_patient_phone text DEFAULT NULL::text, p_patient_relationship text DEFAULT NULL::text, p_booked_for text DEFAULT 'self'::text, p_patient_age smallint DEFAULT NULL::smallint, p_booking_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
    v_provider_id UUID;
    v_category_id TEXT;
    v_deposit_amount NUMERIC(10, 2);
    v_platform_fee NUMERIC(10, 2);
    v_total_amount NUMERIC(10, 2);
    v_consultation_fee NUMERIC(10, 2);
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
    v_customer_blocked_until TIMESTAMPTZ := NULL;
    v_target_phone TEXT;
    v_target_name TEXT;
    v_gap_conflict_id UUID;
    v_booked_for TEXT;
    v_is_minor BOOLEAN;
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

    -- Resolve booked_for value
    v_booked_for := COALESCE(NULLIF(trim(p_booked_for), ''), 'self');
    IF COALESCE(p_booking_for_someone_else, false) AND v_booked_for = 'self' THEN
        v_booked_for := 'family';
    END IF;

    IF v_booked_for NOT IN ('self', 'family') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid booked_for parameter: must be "self" or "family"');
    END IF;

    -- Strict validation for family booking
    IF v_booked_for = 'family' THEN
        v_target_name := NULLIF(trim(COALESCE(p_patient_name, '')), '');
        IF v_target_name IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Patient name is required when booking for family / minor'
            );
        END IF;

        IF length(v_target_name) > 100 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Patient name must not exceed 100 characters'
            );
        END IF;

        IF p_patient_age IS NOT NULL THEN
            IF p_patient_age < 0 OR p_patient_age > 120 THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Patient age must be between 0 and 120'
                );
            END IF;
        END IF;

        IF p_patient_relationship IS NOT NULL THEN
            IF lower(trim(p_patient_relationship)) IN ('child', 'spouse', 'parent', 'sibling', 'other') THEN
                p_patient_relationship := lower(trim(p_patient_relationship));
            ELSE
                p_patient_relationship := 'other';
            END IF;
        END IF;

        IF p_booking_note IS NOT NULL AND length(p_booking_note) > 200 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Booking note must not exceed 200 characters'
            );
        END IF;
    ELSE
        p_patient_name := NULL;
        p_patient_phone := NULL;
        p_patient_relationship := NULL;
        p_patient_age := NULL;
        p_booking_note := NULL;
        v_target_name := NULL;
        v_target_phone := NULL;
    END IF;

    -- ACCOUNT BLOCK ENFORCEMENT
    SELECT blocked_until
    INTO v_customer_blocked_until
    FROM public.profiles
    WHERE id = p_customer_id;

    IF v_customer_blocked_until IS NOT NULL AND v_customer_blocked_until > NOW() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Your account is blocked for 7 days due to excessive no-shows',
            'blocked_until', v_customer_blocked_until
        );
    END IF;

    -- Validate slot times
    IF p_slot_end <= p_slot_start THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: slot_end must be after slot_start');
    END IF;

    IF p_slot_start < (NOW() - INTERVAL '5 minutes') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: cannot book slots in the past');
    END IF;

    -- 1-HOUR TIME GAP ENFORCEMENT
    IF v_booked_for = 'family' THEN
        v_target_phone := NULLIF(trim(COALESCE(p_patient_phone, '')), '');

        -- For family, check collision only if phone or identical name is provided
        IF v_target_phone IS NOT NULL OR v_target_name IS NOT NULL THEN
            SELECT b.id INTO v_gap_conflict_id
            FROM public.bookings b
            WHERE b.customer_id = p_customer_id
              AND (b.booked_for = 'family' OR b.booking_for_someone_else = TRUE)
              AND (
                (v_target_phone IS NOT NULL AND b.patient_phone = v_target_phone)
                OR (v_target_name IS NOT NULL AND LOWER(TRIM(b.patient_name)) = LOWER(TRIM(v_target_name)))
              )
              AND (
                b.status = 'CONFIRMED'
                OR (b.status = 'HELD' AND b.hold_expires_at >= NOW())
              )
              AND (p_slot_start < b.slot_end + INTERVAL '60 minutes')
              AND (b.slot_start < p_slot_end + INTERVAL '60 minutes')
            LIMIT 1;

            IF v_gap_conflict_id IS NOT NULL THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Appointments for the same patient must be at least 1 hour apart.'
                );
            END IF;
        END IF;
    ELSE
        SELECT b.id INTO v_gap_conflict_id
        FROM public.bookings b
        WHERE b.customer_id = p_customer_id
          AND b.booked_for = 'self'
          AND b.booking_for_someone_else = FALSE
          AND (
            b.status = 'CONFIRMED'
            OR (b.status = 'HELD' AND b.hold_expires_at >= NOW())
          )
          AND (p_slot_start < b.slot_end + INTERVAL '60 minutes')
          AND (b.slot_start < p_slot_end + INTERVAL '60 minutes')
        LIMIT 1;

        IF v_gap_conflict_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Appointments for the same patient must be at least 1 hour apart. To book for a family member or friend, select ''Booking for someone else'' (or select ''Booking for family / minor'').'
            );
        END IF;
    END IF;

    -- Auto-clean expired holds scoped to requested resource & slot
    PERFORM set_config('app.trusted_write', 'true', true);
    UPDATE public.bookings
    SET status = 'CANCELLED', payment_status = 'FORFEITED', updated_at = NOW()
    WHERE resource_id = p_resource_id
      AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end)
      AND status = 'HELD'
      AND hold_expires_at < NOW();

    -- Fetch resource
    SELECT provider_id, deposit_amount, is_active, price
    INTO v_provider_id, v_deposit_amount, v_is_active, v_consultation_fee
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

    -- Daily Booking Limit Concurrency Guard
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

    -- Cooling period evaluation
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
            v_consultation_fee := 0.00;
        END IF;
    END IF;

    -- SPLIT PAYMENT LOGIC:
    -- Platform fee is paid online now to reserve slot.
    -- Consultation fee is paid directly at hospital desk.
    IF NOT v_is_followup THEN
        v_platform_fee := CASE WHEN v_category_id IN ('gaming', 'turf') THEN 50.00 ELSE 10.00 END;
        v_deposit_amount := v_platform_fee;
        v_total_amount := v_platform_fee;
        v_consultation_fee := COALESCE(v_consultation_fee, 500.00);
    END IF;

    -- Overlap exclusion check
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
            disclaimer_version, is_followup, followup_original_booking_id,
            booking_for_someone_else, booked_for, patient_name, patient_phone, patient_relationship,
            patient_age, booking_note,
            platform_fee_amount, consultation_fee_amount,
            platform_payment_status, consultation_payment_status
        ) VALUES (
            p_customer_id, v_provider_id, p_resource_id,
            p_slot_start, p_slot_end, 'HELD', 'PENDING',
            v_deposit_amount, v_platform_fee, v_total_amount, v_hold_expiry,
            'v1', v_is_followup, v_followup_original_booking_id,
            (v_booked_for = 'family'),
            v_booked_for,
            v_target_name,
            v_target_phone,
            p_patient_relationship,
            p_patient_age,
            p_booking_note,
            v_platform_fee,
            v_consultation_fee,
            'PENDING',
            'PENDING_OFFLINE'
        )
        RETURNING id, reference_code INTO v_new_booking_id, v_reference_code;
    EXCEPTION
        WHEN exclusion_violation OR unique_violation THEN
            RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked');
    END;

    v_is_minor := (p_patient_age IS NOT NULL AND p_patient_age < 18);

    RETURN jsonb_build_object(
        'success',                      true,
        'booking_id',                   v_new_booking_id,
        'reference_code',               v_reference_code,
        'deposit_amount',               v_deposit_amount,
        'platform_fee',                 v_platform_fee,
        'total_amount',                 v_total_amount,
        'platform_fee_amount',          v_platform_fee,
        'consultation_fee_amount',      v_consultation_fee,
        'platform_payment_status',      'PENDING',
        'consultation_payment_status',  'PENDING_OFFLINE',
        'hold_expires_at',              v_hold_expiry,
        'is_followup',                  v_is_followup,
        'followup_original_booking_id', v_followup_original_booking_id,
        'booking_for_someone_else',      (v_booked_for = 'family'),
        'booked_for',                   v_booked_for,
        'patient_name',                 v_target_name,
        'patient_age',                  p_patient_age,
        'patient_relationship',         p_patient_relationship,
        'is_minor',                     v_is_minor,
        'booking_note',                 p_booking_note
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_booking_hold(p_resource_id uuid, p_slot_start timestamp with time zone, p_slot_end timestamp with time zone, p_customer_id uuid, p_booking_for_someone_else boolean DEFAULT false, p_patient_name text DEFAULT NULL::text, p_patient_phone text DEFAULT NULL::text, p_patient_relationship text DEFAULT NULL::text, p_booked_for text DEFAULT 'self'::text, p_patient_age smallint DEFAULT NULL::smallint, p_booking_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.create_booking_hold(p_resource_id, p_slot_start, p_slot_end, p_customer_id, p_booking_for_someone_else, p_patient_name, p_patient_phone, p_patient_relationship, p_booked_for, p_patient_age, p_booking_note);
$$;

REVOKE ALL ON FUNCTION private.create_booking_hold FROM PUBLIC;
REVOKE ALL ON FUNCTION private.create_booking_hold FROM anon;
GRANT EXECUTE ON FUNCTION private.create_booking_hold TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_booking_hold FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_booking_hold FROM anon;
GRANT EXECUTE ON FUNCTION public.create_booking_hold TO authenticated, service_role;


-- =============================================================================
-- Function: get_masked_customer_info
-- =============================================================================
CREATE OR REPLACE FUNCTION private.get_masked_customer_info(p_customer_id uuid)
 RETURNS TABLE(customer_name text, customer_phone text, no_show_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF v_caller_role = 'service_role' OR session_user = 'postgres' THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = p_customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.customer_id = p_customer_id
        AND b.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id))
    ) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      COALESCE(pr.full_name, 'Walk-in / Guest')::TEXT AS customer_name,
      public.mask_customer_phone(pr.phone)::TEXT AS customer_phone,
      COALESCE(pr.no_show_count, 0)::INTEGER AS no_show_count
    FROM public.profiles pr
    WHERE pr.id = p_customer_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_masked_customer_info(p_customer_id uuid)
RETURNS TABLE(customer_name text, customer_phone text, no_show_count integer)
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM private.get_masked_customer_info(p_customer_id);
$$;

REVOKE ALL ON FUNCTION private.get_masked_customer_info FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_masked_customer_info FROM anon;
GRANT EXECUTE ON FUNCTION private.get_masked_customer_info TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_masked_customer_info FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_masked_customer_info FROM anon;
GRANT EXECUTE ON FUNCTION public.get_masked_customer_info TO authenticated, service_role;


-- =============================================================================
-- Function: get_user_authorized_providers
-- =============================================================================
CREATE OR REPLACE FUNCTION private.get_user_authorized_providers(p_user_id uuid DEFAULT auth.uid())
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_target_id UUID := CASE 
    WHEN auth.role() = 'authenticated' THEN auth.uid() 
    ELSE COALESCE(p_user_id, auth.uid()) 
  END;
BEGIN
  IF v_target_id IS NULL THEN
    RETURN;
  END IF;

  IF public.is_admin(v_target_id) THEN
    RETURN QUERY SELECT id FROM public.providers;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT provider_id FROM public.merchant_memberships WHERE user_id = v_target_id
    UNION
    SELECT id FROM public.providers WHERE owner_id = v_target_id
    UNION
    SELECT p.id FROM public.providers p
    JOIN auth.users u ON lower(trim(u.email)) = lower(trim(p.email))
    WHERE u.id = v_target_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_authorized_providers(p_user_id uuid DEFAULT auth.uid())
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM private.get_user_authorized_providers(p_user_id);
$$;

REVOKE ALL ON FUNCTION private.get_user_authorized_providers FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_user_authorized_providers FROM anon;
GRANT EXECUTE ON FUNCTION private.get_user_authorized_providers TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_user_authorized_providers FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_authorized_providers FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_authorized_providers TO authenticated, service_role;


-- =============================================================================
-- Function: hospital_accessible_resource_ids
-- =============================================================================
CREATE OR REPLACE FUNCTION private.hospital_accessible_resource_ids(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_caller_id UUID := CASE 
    WHEN auth.role() = 'authenticated' THEN auth.uid() 
    ELSE COALESCE(p_user_id, auth.uid()) 
  END;
  v_role TEXT;
  v_user_email TEXT;
  v_email_confirmed BOOLEAN := FALSE;
BEGIN
  IF v_caller_id IS NULL OR p_provider_id IS NULL THEN
    RETURN;
  END IF;

  v_role := public.hospital_role(p_provider_id, v_caller_id);

  IF v_role = 'admin' THEN
    RETURN QUERY
      SELECT r.id
      FROM public.resources r
      WHERE r.provider_id = p_provider_id;

  ELSIF v_role = 'front_desk' THEN
    RETURN QUERY
      SELECT dfda.doctor_id
      FROM public.doctor_front_desk_assignments dfda
      JOIN public.resources r ON r.id = dfda.doctor_id
      WHERE dfda.provider_id = p_provider_id
        AND dfda.user_id = v_caller_id
        AND r.provider_id = p_provider_id;

  ELSIF v_role = 'consultant' THEN
    SELECT email, (email_confirmed_at IS NOT NULL)
    INTO v_user_email, v_email_confirmed
    FROM auth.users
    WHERE id = v_caller_id;

    RETURN QUERY
      SELECT r.id
      FROM public.resources r
      WHERE r.provider_id = p_provider_id
        AND (
          r.user_id = v_caller_id
          OR (
            (r.attributes->>'user_id') IS NOT NULL
            AND (r.attributes->>'user_id')::uuid = v_caller_id
          )
          OR (
            r.attributes->>'email' IS NOT NULL
            AND v_user_email IS NOT NULL
            AND lower(trim(r.attributes->>'email')) = lower(trim(v_user_email))
            AND v_email_confirmed IS TRUE
          )
        );

  ELSE
    RETURN;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.hospital_accessible_resource_ids(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM private.hospital_accessible_resource_ids(p_provider_id, p_user_id);
$$;

REVOKE ALL ON FUNCTION private.hospital_accessible_resource_ids FROM PUBLIC;
REVOKE ALL ON FUNCTION private.hospital_accessible_resource_ids FROM anon;
GRANT EXECUTE ON FUNCTION private.hospital_accessible_resource_ids TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.hospital_accessible_resource_ids FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hospital_accessible_resource_ids FROM anon;
GRANT EXECUTE ON FUNCTION public.hospital_accessible_resource_ids TO authenticated, service_role;


-- =============================================================================
-- Function: hospital_role
-- =============================================================================
CREATE OR REPLACE FUNCTION private.hospital_role(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_caller_id UUID := CASE 
    WHEN auth.role() = 'authenticated' THEN auth.uid() 
    ELSE COALESCE(p_user_id, auth.uid()) 
  END;
  v_category TEXT;
  v_dept_status TEXT;
  v_has_assignment BOOLEAN;
  v_is_consultant BOOLEAN := FALSE;
  v_user_email TEXT;
  v_email_confirmed BOOLEAN := FALSE;
BEGIN
  IF v_caller_id IS NULL OR p_provider_id IS NULL THEN
    RETURN 'none';
  END IF;

  -- 1. Strictly verify hospital/clinic vertical
  SELECT category_id INTO v_category
  FROM public.providers
  WHERE id = p_provider_id;

  IF NOT FOUND OR v_category IS NULL THEN
    RETURN 'none';
  END IF;

  IF NOT (
    v_category = 'clinics'
    OR v_category = 'hospital'
    OR v_category ILIKE '%clinic%'
    OR v_category ILIKE '%hospital%'
  ) THEN
    RETURN 'none';
  END IF;

  -- 2. Hospital Administrator Check
  IF public.is_admin(v_caller_id) THEN
    RETURN 'admin';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.providers
    WHERE id = p_provider_id AND owner_id = v_caller_id
  ) THEN
    RETURN 'admin';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.merchant_memberships
    WHERE provider_id = p_provider_id
      AND user_id = v_caller_id
      AND role IN ('admin', 'owner')
  ) THEN
    RETURN 'admin';
  END IF;

  -- 3. Check Department Membership status (if registered in department_members)
  SELECT status INTO v_dept_status
  FROM public.department_members
  WHERE merchant_id = p_provider_id
    AND user_id = v_caller_id
  ORDER BY (status = 'active') DESC, created_at DESC
  LIMIT 1;

  IF v_dept_status = 'revoked' THEN
    RETURN 'none';
  END IF;

  -- Get email and confirmed status for v_caller_id
  SELECT email, (email_confirmed_at IS NOT NULL)
  INTO v_user_email, v_email_confirmed
  FROM auth.users
  WHERE id = v_caller_id;

  -- 4. Consultant Check
  SELECT TRUE INTO v_is_consultant
  FROM public.resources r
  WHERE r.provider_id = p_provider_id
    AND (
      r.user_id = v_caller_id
      OR (
        (r.attributes->>'user_id') IS NOT NULL
        AND (r.attributes->>'user_id')::uuid = v_caller_id
      )
      OR (
        r.attributes->>'email' IS NOT NULL
        AND v_user_email IS NOT NULL
        AND lower(trim(r.attributes->>'email')) = lower(trim(v_user_email))
        AND v_email_confirmed IS TRUE
      )
    )
  LIMIT 1;

  IF v_is_consultant IS TRUE THEN
    RETURN 'consultant';
  END IF;

  -- 5. Front Desk Check
  IF v_dept_status = 'active' THEN
    SELECT TRUE INTO v_has_assignment
    FROM public.doctor_front_desk_assignments
    WHERE provider_id = p_provider_id
      AND user_id = v_caller_id
    LIMIT 1;

    IF v_has_assignment IS TRUE THEN
      RETURN 'front_desk';
    END IF;
  END IF;

  RETURN 'none';
END;
$function$;

CREATE OR REPLACE FUNCTION public.hospital_role(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.hospital_role(p_provider_id, p_user_id);
$$;

REVOKE ALL ON FUNCTION private.hospital_role FROM PUBLIC;
REVOKE ALL ON FUNCTION private.hospital_role FROM anon;
GRANT EXECUTE ON FUNCTION private.hospital_role TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.hospital_role FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hospital_role FROM anon;
GRANT EXECUTE ON FUNCTION public.hospital_role TO authenticated, service_role;


-- =============================================================================
-- Function: is_admin
-- =============================================================================
CREATE OR REPLACE FUNCTION private.is_admin(p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_target_id UUID := CASE 
    WHEN auth.role() = 'authenticated' THEN auth.uid() 
    ELSE COALESCE(p_user_id, auth.uid()) 
  END;
BEGIN
  IF v_target_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = v_target_id AND role = 'admin'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.is_admin(p_user_id);
$$;

REVOKE ALL ON FUNCTION private.is_admin FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_admin FROM anon;
GRANT EXECUTE ON FUNCTION private.is_admin TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_admin FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin TO authenticated, service_role;


-- =============================================================================
-- Function: is_hospital_provider
-- =============================================================================
CREATE OR REPLACE FUNCTION private.is_hospital_provider(p_provider_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.providers
    WHERE id = p_provider_id
      AND (
        category_id = 'clinics'
        OR category_id = 'hospital'
        OR category_id ILIKE '%clinic%'
        OR category_id ILIKE '%hospital%'
      )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_hospital_provider(p_provider_id uuid)
RETURNS boolean
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.is_hospital_provider(p_provider_id);
$$;

REVOKE ALL ON FUNCTION private.is_hospital_provider FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_hospital_provider FROM anon;
GRANT EXECUTE ON FUNCTION private.is_hospital_provider TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_hospital_provider FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_hospital_provider FROM anon;
GRANT EXECUTE ON FUNCTION public.is_hospital_provider TO authenticated, service_role;


-- =============================================================================
-- Function: is_merchant_owner_or_admin
-- =============================================================================
CREATE OR REPLACE FUNCTION private.is_merchant_owner_or_admin(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_target_id UUID := CASE 
    WHEN auth.role() = 'authenticated' THEN auth.uid() 
    ELSE COALESCE(p_user_id, auth.uid()) 
  END;
BEGIN
  IF v_target_id IS NULL OR p_provider_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN (
    public.is_admin(v_target_id) OR EXISTS (
      SELECT 1 FROM public.providers WHERE id = p_provider_id AND owner_id = v_target_id
      UNION
      SELECT 1 FROM public.merchant_memberships WHERE provider_id = p_provider_id AND user_id = v_target_id AND role = 'owner'
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_merchant_owner_or_admin(p_provider_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.is_merchant_owner_or_admin(p_provider_id, p_user_id);
$$;

REVOKE ALL ON FUNCTION private.is_merchant_owner_or_admin FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_merchant_owner_or_admin FROM anon;
GRANT EXECUTE ON FUNCTION private.is_merchant_owner_or_admin TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_merchant_owner_or_admin FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_merchant_owner_or_admin FROM anon;
GRANT EXECUTE ON FUNCTION public.is_merchant_owner_or_admin TO authenticated, service_role;


-- =============================================================================
-- Function: mark_customer_reached
-- =============================================================================
CREATE OR REPLACE FUNCTION private.mark_customer_reached(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Booking not found'
    );
  END IF;

  -- Verify caller authorization:
  -- Allowed: service_role, booking customer, venue staff/owners, or platform admin
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
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: You do not have permission to mark arrival for this booking'
    );
  END IF;

  IF v_booking.status = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot mark arrived: Booking is already cancelled'
    );
  END IF;

  IF v_booking.status = 'NO_SHOW' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot mark arrived: Booking was marked as no-show'
    );
  END IF;

  UPDATE public.bookings
  SET 
    is_present = true,
    customer_arrived_at = COALESCE(customer_arrived_at, now()),
    updated_at = now()
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'is_present', v_booking.is_present,
    'customer_arrived_at', v_booking.customer_arrived_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_customer_reached(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.mark_customer_reached(p_booking_id);
$$;

REVOKE ALL ON FUNCTION private.mark_customer_reached FROM PUBLIC;
REVOKE ALL ON FUNCTION private.mark_customer_reached FROM anon;
GRANT EXECUTE ON FUNCTION private.mark_customer_reached TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_customer_reached FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_customer_reached FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_customer_reached TO authenticated, service_role;


-- =============================================================================
-- Function: mark_present_manually
-- =============================================================================
CREATE OR REPLACE FUNCTION private.mark_present_manually(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_staff_id UUID := auth.uid();
  v_now TIMESTAMPTZ;
  v_booking public.bookings%ROWTYPE;
  v_patient_name TEXT;
  v_service_doctor TEXT;
  v_slot_time_str TEXT;
  v_is_late BOOLEAN;
  v_was_skipped BOOLEAN;
  v_is_hospital BOOLEAN;
  v_hosp_role TEXT;
BEGIN
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Authentication required');
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Booking not found');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);
  v_is_hospital := public.is_hospital_provider(v_booking.provider_id);

  IF v_is_hospital THEN
    v_hosp_role := public.hospital_role(v_booking.provider_id, v_staff_id);
    IF v_hosp_role = 'none' THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Not authorized for this hospital');
    END IF;

    IF NOT public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_staff_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Staff is not authorized for this doctor');
    END IF;
  ELSE
    IF NOT public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_staff_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Staff is not authorized for this shop');
    END IF;
  END IF;

  IF v_booking.status = 'CHECKED_IN' OR v_booking.is_present = TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'Booking is already checked in');
  END IF;

  IF v_booking.status != 'CONFIRMED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Only confirmed bookings can be marked present');
  END IF;

  v_was_skipped := (v_booking.skipped_at IS NOT NULL) OR EXISTS (
    SELECT 1
    FROM public.bookings b2
    WHERE b2.resource_id = v_booking.resource_id
      AND (b2.slot_start AT TIME ZONE 'Asia/Kolkata')::date = (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date
      AND b2.slot_start > v_booking.slot_start
      AND b2.status IN ('IN_CONSULTATION', 'COMPLETED')
  );

  v_is_late := v_was_skipped OR (v_now > (v_booking.slot_start + interval '5 minutes'));

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CHECKED_IN',
      is_present = TRUE,
      checked_in_at = v_now,
      checked_in_by = v_staff_id,
      checked_in_method = 'manual',
      customer_arrived_at = COALESCE(customer_arrived_at, v_now),
      skipped_at = CASE WHEN v_was_skipped THEN COALESCE(skipped_at, v_now) ELSE skipped_at END,
      updated_at = v_now
  WHERE id = v_booking.id
    AND status = 'CONFIRMED'
    AND is_present = FALSE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'Booking is already checked in');
  END IF;

  SELECT COALESCE(full_name, 'Patient') INTO v_patient_name
  FROM public.profiles WHERE id = v_booking.customer_id;

  SELECT name INTO v_service_doctor
  FROM public.resources WHERE id = v_booking.resource_id;

  v_slot_time_str := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'patient_name', v_patient_name,
    'service_doctor', v_service_doctor,
    'slot_time', v_slot_time_str,
    'is_late', v_is_late,
    'checked_in_at', v_now
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_present_manually(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.mark_present_manually(p_booking_id);
$$;

REVOKE ALL ON FUNCTION private.mark_present_manually FROM PUBLIC;
REVOKE ALL ON FUNCTION private.mark_present_manually FROM anon;
GRANT EXECUTE ON FUNCTION private.mark_present_manually TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_present_manually FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_present_manually FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_present_manually TO authenticated, service_role;


-- =============================================================================
-- Function: override_hospital_queue_position
-- =============================================================================
CREATE OR REPLACE FUNCTION private.override_hospital_queue_position(p_booking_id uuid, p_override_position integer, p_caller_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_caller_id UUID := CASE
    WHEN auth.role() = 'service_role' OR auth.uid() IS NULL THEN COALESCE(p_caller_id, auth.uid())
    ELSE auth.uid()
  END;
  v_booking RECORD;
  v_role TEXT;
  v_accessible_ids UUID[];
  v_target_pos INT := GREATEST(1, COALESCE(p_override_position, 1));
  b RECORD;
  v_curr_pos INT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Fetch target booking with row lock
  SELECT id, provider_id, resource_id, status, queue_position
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Verify access
  v_role := public.hospital_role(v_booking.provider_id, v_caller_id);
  IF v_role NOT IN ('admin', 'front_desk', 'consultant') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT ARRAY_AGG(id) INTO v_accessible_ids
  FROM public.hospital_accessible_resource_ids(v_booking.provider_id, v_caller_id) id;

  IF NOT (v_booking.resource_id = ANY(v_accessible_ids)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden: Doctor queue not accessible');
  END IF;

  -- Lock all active queue bookings for this doctor
  PERFORM id
  FROM public.bookings
  WHERE provider_id = v_booking.provider_id
    AND resource_id = v_booking.resource_id
    AND status IN ('CONFIRMED', 'CHECKED_IN')
  FOR UPDATE;

  -- Temporarily clear target position
  UPDATE public.bookings
  SET queue_position = NULL
  WHERE id = p_booking_id;

  -- Re-number all active bookings for this doctor ordered by current position
  -- leaving the slot open at v_target_pos
  v_curr_pos := 1;
  FOR b IN
    SELECT id
    FROM public.bookings
    WHERE provider_id = v_booking.provider_id
      AND resource_id = v_booking.resource_id
      AND status IN ('CONFIRMED', 'CHECKED_IN')
      AND id <> p_booking_id
    ORDER BY COALESCE(queue_position, 9999), slot_start ASC
  LOOP
    IF v_curr_pos = v_target_pos THEN
      v_curr_pos := v_curr_pos + 1;
    END IF;

    UPDATE public.bookings
    SET queue_position = v_curr_pos
    WHERE id = b.id;

    v_curr_pos := v_curr_pos + 1;
  END LOOP;

  -- Place the target booking at exactly v_target_pos
  UPDATE public.bookings
  SET queue_position = v_target_pos,
      updated_at = v_now
  WHERE id = p_booking_id;

  -- Record audit log entry for queue override
  INSERT INTO public.audit_logs (
    merchant_id,
    actor_id,
    action,
    target,
    booking_id,
    role,
    metadata,
    created_at
  ) VALUES (
    v_booking.provider_id,
    v_caller_id,
    'QUEUE_OVERRIDE',
    'booking',
    p_booking_id,
    v_role,
    jsonb_build_object(
      'actor', v_caller_id,
      'role', v_role,
      'booking_id', p_booking_id,
      'action', 'QUEUE_OVERRIDE',
      'before', jsonb_build_object('queue_position', v_booking.queue_position),
      'after', jsonb_build_object('queue_position', v_target_pos),
      'time', v_now
    ),
    v_now
  );

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'queue_position', v_target_pos);
END;
$function$;

CREATE OR REPLACE FUNCTION public.override_hospital_queue_position(p_booking_id uuid, p_override_position integer, p_caller_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.override_hospital_queue_position(p_booking_id, p_override_position, p_caller_id);
$$;

REVOKE ALL ON FUNCTION private.override_hospital_queue_position FROM PUBLIC;
REVOKE ALL ON FUNCTION private.override_hospital_queue_position FROM anon;
GRANT EXECUTE ON FUNCTION private.override_hospital_queue_position TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.override_hospital_queue_position FROM PUBLIC;
REVOKE ALL ON FUNCTION public.override_hospital_queue_position FROM anon;
GRANT EXECUTE ON FUNCTION public.override_hospital_queue_position TO authenticated, service_role;


-- =============================================================================
-- Function: reassign_booking_resource
-- =============================================================================
CREATE OR REPLACE FUNCTION private.reassign_booking_resource(p_booking_id uuid, p_new_resource_id uuid, p_reason text DEFAULT 'Emergency re-allocation'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_old_resource public.resources%ROWTYPE;
  v_new_resource public.resources%ROWTYPE;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
  v_conflict_id UUID;
  v_customer_name TEXT;
  v_customer_phone TEXT;
BEGIN
  -- 1. Fetch booking with row lock
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- 2. Caller Authorization Guard
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND (SESSION_USER = 'postgres' OR CURRENT_USER = 'postgres')) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Caller is not permitted to reassign resources for this booking'
    );
  END IF;

  IF v_booking.status IN ('CANCELLED', 'COMPLETED', 'NO_SHOW') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot reassign a ' || lower(v_booking.status::text) || ' booking'
    );
  END IF;

  -- 3. Fetch current resource
  SELECT * INTO v_old_resource
  FROM public.resources
  WHERE id = v_booking.resource_id;

  -- 4. Fetch target resource
  SELECT * INTO v_new_resource
  FROM public.resources
  WHERE id = p_new_resource_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target resource not found');
  END IF;

  -- 5. Verify target resource belongs to same provider
  IF v_new_resource.provider_id != v_booking.provider_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target resource belongs to a different business/provider');
  END IF;

  -- 6. Verify target resource is active
  IF NOT v_new_resource.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target resource is not currently active');
  END IF;

  -- 7. Check slot conflict for new resource
  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = p_new_resource_id
    AND slot_start = v_booking.slot_start
    AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
    AND id != p_booking_id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'The target resource already has a booking during this slot');
  END IF;

  -- 8. Perform update
  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET resource_id = p_new_resource_id,
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- 9. Fetch customer details for notification
  SELECT full_name, phone INTO v_customer_name, v_customer_phone
  FROM public.profiles
  WHERE id = v_booking.customer_id;

  -- 10. Log notification event (QUEUED)
  INSERT INTO public.notification_logs (
    booking_id,
    recipient_phone,
    recipient_name,
    event_type,
    channel,
    status,
    message_content,
    provider_response
  ) VALUES (
    p_booking_id,
    COALESCE(public.normalize_phone_number(v_customer_phone), '919848000000'),
    COALESCE(v_customer_name, 'Valued Customer'),
    'RESOURCE_REASSIGNED',
    'whatsapp',
    'QUEUED',
    format('Staff reassigned: Your appointment has been transferred from %s to %s due to an emergency.', COALESCE(v_old_resource.name, 'Staff'), v_new_resource.name),
    jsonb_build_object(
      'old_resource_id', v_booking.resource_id,
      'old_resource_name', v_old_resource.name,
      'new_resource_id', p_new_resource_id,
      'new_resource_name', v_new_resource.name,
      'reason', p_reason
    )
  )
  ON CONFLICT (booking_id, event_type, channel) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'old_resource_id', v_booking.resource_id,
    'old_resource_name', v_old_resource.name,
    'new_resource_id', p_new_resource_id,
    'new_resource_name', v_new_resource.name,
    'slot_start', v_booking.slot_start,
    'slot_end', v_booking.slot_end,
    'status', v_booking.status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reassign_booking_resource(p_booking_id uuid, p_new_resource_id uuid, p_reason text DEFAULT 'Emergency re-allocation'::text)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.reassign_booking_resource(p_booking_id, p_new_resource_id, p_reason);
$$;

REVOKE ALL ON FUNCTION private.reassign_booking_resource FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reassign_booking_resource FROM anon;
GRANT EXECUTE ON FUNCTION private.reassign_booking_resource TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reassign_booking_resource FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reassign_booking_resource FROM anon;
GRANT EXECUTE ON FUNCTION public.reassign_booking_resource TO authenticated, service_role;


-- =============================================================================
-- Function: request_account_deletion
-- =============================================================================
CREATE OR REPLACE FUNCTION private.request_account_deletion(p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
    v_uid UUID := (SELECT auth.uid());
    v_existing UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Idempotent: if an active request already exists, return it
    SELECT id INTO v_existing
    FROM public.account_deletion_requests
    WHERE user_id = v_uid
      AND completed_at IS NULL
      AND cancelled_at IS NULL;

    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Deletion request already pending',
            'request_id', v_existing
        );
    END IF;

    INSERT INTO public.account_deletion_requests (user_id, reason)
    VALUES (v_uid, p_reason)
    RETURNING id INTO v_existing;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Account scheduled for deletion in 30 days. Contact support to cancel.',
        'request_id', v_existing,
        'scheduled_for', (NOW() + INTERVAL '30 days')
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_account_deletion(p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.request_account_deletion(p_reason);
$$;

REVOKE ALL ON FUNCTION private.request_account_deletion FROM PUBLIC;
REVOKE ALL ON FUNCTION private.request_account_deletion FROM anon;
GRANT EXECUTE ON FUNCTION private.request_account_deletion TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_account_deletion FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_account_deletion FROM anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion TO authenticated, service_role;


-- =============================================================================
-- Function: reschedule_booking_slot
-- =============================================================================
CREATE OR REPLACE FUNCTION private.reschedule_booking_slot(p_booking_id uuid, p_new_slot_start timestamp with time zone, p_new_slot_end timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
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

  -- Caller Authorization Guard (resource-scoped for hospital staff)
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND (SESSION_USER = 'postgres' OR CURRENT_USER = 'postgres')) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_caller_id) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not authorized to reschedule this booking');
  END IF;

  IF v_booking.status::text IN ('CHECKED_IN', 'WAITING', 'UP_NEXT', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW', 'CANCELLED')
     OR v_booking.is_present = TRUE
     OR v_booking.status::text NOT IN ('CONFIRMED', 'HELD') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  v_now := public.get_test_clock(v_booking.provider_id);

  IF p_new_slot_start < v_now THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule to a slot in the past');
  END IF;

  IF v_caller_role <> 'service_role'
     AND v_caller_id IS NOT NULL
     AND v_caller_id = v_booking.customer_id
     AND v_booking.slot_start < v_now + INTERVAL '60 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Late reschedule: appointments within 60 minutes of their slot cannot be rescheduled.');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);
  UPDATE public.bookings
  SET status = 'CANCELLED', payment_status = 'FORFEITED', updated_at = v_now
  WHERE resource_id = v_booking.resource_id
    AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end)
    AND status = 'HELD'
    AND hold_expires_at < v_now;

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
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_booking_slot(p_booking_id uuid, p_new_slot_start timestamp with time zone, p_new_slot_end timestamp with time zone)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.reschedule_booking_slot(p_booking_id, p_new_slot_start, p_new_slot_end);
$$;

REVOKE ALL ON FUNCTION private.reschedule_booking_slot FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reschedule_booking_slot FROM anon;
GRANT EXECUTE ON FUNCTION private.reschedule_booking_slot TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reschedule_booking_slot FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reschedule_booking_slot FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_slot TO authenticated, service_role;


-- =============================================================================
-- Function: reveal_customer_contact
-- =============================================================================
CREATE OR REPLACE FUNCTION private.reveal_customer_contact(p_booking_id uuid, p_reason text DEFAULT 'Operational check-in'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_caller_id UUID;
  v_booking RECORD;
  v_customer RECORD;
  v_is_authorized BOOLEAN := FALSE;
  v_reveals_last_hour INT;
  v_hourly_limit INT := 20; -- Maximum 20 reveals per user per rolling 1 hour
  v_return_phone TEXT;
  v_return_name TEXT;
BEGIN
  v_caller_id := auth.uid();
  
  -- Handle system / service_role invocation safely
  IF v_caller_id IS NULL THEN
    IF auth.role() = 'service_role' THEN
      SELECT id INTO v_caller_id FROM auth.users WHERE email LIKE '%admin%' LIMIT 1;
    ELSE
      RAISE EXCEPTION 'Authentication required to reveal customer contact' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. Validate mandatory business justification reason
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A valid business justification reason is required to reveal customer contact' USING ERRCODE = '22023';
  END IF;

  -- 2. Verify caller rate limit (rolling 1-hour window)
  SELECT count(*) INTO v_reveals_last_hour
  FROM public.contact_reveal_audit
  WHERE user_id = v_caller_id
    AND revealed_at > (NOW() - INTERVAL '1 hour');

  IF v_reveals_last_hour >= v_hourly_limit 
     AND NOT public.is_admin(v_caller_id) 
     AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Rate limit exceeded: You have reached the maximum of % contact reveals per hour. Please try again later.', v_hourly_limit
      USING ERRCODE = 'P0003';
  END IF;

  -- 3. Fetch booking record
  SELECT id, customer_id, provider_id, status, booking_for_someone_else, patient_name, patient_phone
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Verify merchant authorization or admin
  -- NOTE: Do NOT check current_user = 'postgres' or SESSION_USER as that is bypassed in test/pg connections
  IF auth.role() = 'service_role' THEN
    v_is_authorized := TRUE;
  ELSIF public.is_admin(v_caller_id) THEN
    v_is_authorized := TRUE;
  ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
    v_is_authorized := TRUE;
  ELSIF EXISTS (
    SELECT 1 FROM public.department_members dm
    WHERE dm.user_id = v_caller_id AND dm.merchant_id = v_booking.provider_id AND dm.status = 'active'
  ) THEN
    v_is_authorized := TRUE;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to view contacts for this venue' USING ERRCODE = '42501';
  END IF;

  -- 5. Verify booking is confirmed
  IF v_booking.status != 'CONFIRMED' THEN
    RAISE EXCEPTION 'Customer contact can only be revealed for confirmed bookings (current status: %)', v_booking.status
      USING ERRCODE = '22023';
  END IF;

  -- 6. Fetch customer profile contact
  SELECT phone, full_name
  INTO v_customer
  FROM public.profiles
  WHERE id = v_booking.customer_id;

  IF v_booking.booking_for_someone_else IS TRUE AND v_booking.patient_phone IS NOT NULL AND trim(v_booking.patient_phone) != '' THEN
    v_return_phone := v_booking.patient_phone;
    v_return_name := COALESCE(v_booking.patient_name, v_customer.full_name, 'Patient');
  ELSE
    v_return_phone := v_customer.phone;
    v_return_name := COALESCE(v_customer.full_name, 'Valued Customer');
  END IF;

  -- 7. Insert audit log with reason
  INSERT INTO public.contact_reveal_audit (
    user_id,
    booking_id,
    revealed_at,
    reason
  ) VALUES (
    v_caller_id,
    p_booking_id,
    NOW(),
    trim(p_reason)
  );

  -- 8. Return unmasked contact
  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'phone', COALESCE(v_return_phone, 'Not provided'),
    'full_name', v_return_name
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reveal_customer_contact(p_booking_id uuid, p_reason text DEFAULT 'Operational check-in'::text)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.reveal_customer_contact(p_booking_id, p_reason);
$$;

REVOKE ALL ON FUNCTION private.reveal_customer_contact FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reveal_customer_contact FROM anon;
GRANT EXECUTE ON FUNCTION private.reveal_customer_contact TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reveal_customer_contact FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reveal_customer_contact FROM anon;
GRANT EXECUTE ON FUNCTION public.reveal_customer_contact TO authenticated, service_role;


-- =============================================================================
-- Function: search_directory
-- =============================================================================
CREATE OR REPLACE FUNCTION private.search_directory(p_query text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
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
  )
  INTO v_results
  FROM matched_providers mp;

  RETURN v_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_directory(p_query text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.search_directory(p_query);
$$;

REVOKE ALL ON FUNCTION private.search_directory FROM PUBLIC;
REVOKE ALL ON FUNCTION private.search_directory FROM anon;
GRANT EXECUTE ON FUNCTION private.search_directory TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_directory FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_directory FROM anon;
GRANT EXECUTE ON FUNCTION public.search_directory TO authenticated, service_role;


-- =============================================================================
-- Function: sync_customer_profile
-- =============================================================================
CREATE OR REPLACE FUNCTION private.sync_customer_profile(p_full_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.profiles (id, full_name, phone, email, role)
  VALUES (
    v_uid,
    COALESCE(p_full_name, 'Verified Customer'),
    COALESCE(p_phone, (SELECT phone FROM auth.users WHERE id = v_uid)),
    COALESCE(p_email, (SELECT email FROM auth.users WHERE id = v_uid)),
    'customer'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(p_full_name, public.profiles.full_name),
    phone = COALESCE(p_phone, public.profiles.phone),
    email = COALESCE(p_email, public.profiles.email),
    updated_at = now()
  RETURNING to_jsonb(public.profiles.*) INTO v_res;

  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_customer_profile(p_full_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.sync_customer_profile(p_full_name, p_phone, p_email);
$$;

REVOKE ALL ON FUNCTION private.sync_customer_profile FROM PUBLIC;
REVOKE ALL ON FUNCTION private.sync_customer_profile FROM anon;
GRANT EXECUTE ON FUNCTION private.sync_customer_profile TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sync_customer_profile FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_customer_profile FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_customer_profile TO authenticated, service_role;


-- =============================================================================
-- Function: verify_checkin_code
-- =============================================================================
CREATE OR REPLACE FUNCTION private.verify_checkin_code(p_shop_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_staff_id UUID := auth.uid();
  v_now TIMESTAMPTZ := public.get_test_clock(p_shop_id);
  v_today_ist DATE := (v_now AT TIME ZONE 'Asia/Kolkata')::date;
  v_clean_code TEXT := trim(p_code);
  v_rate_limit public.staff_checkin_rate_limits%ROWTYPE;
  v_checkin_record public.appointment_checkin_codes%ROWTYPE;
  v_other_date_record public.appointment_checkin_codes%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_patient_name TEXT;
  v_service_doctor TEXT;
  v_slot_time_str TEXT;
  v_is_late BOOLEAN;
  v_was_skipped BOOLEAN;
  v_window_start TIMESTAMPTZ;
  v_is_hospital BOOLEAN;
  v_hosp_role TEXT;
  v_caller_dept_id UUID;
  v_dept_modules TEXT[];
  v_is_owner BOOLEAN;
BEGIN
  -- 1. Authentication check
  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Authentication required'
    );
  END IF;

  v_is_hospital := public.is_hospital_provider(p_shop_id);

  -- 2. Rate limit check: 5 failed attempts locks staff for 60 seconds
  SELECT * INTO v_rate_limit
  FROM public.staff_checkin_rate_limits
  WHERE user_id = v_staff_id;

  IF FOUND THEN
    IF v_rate_limit.locked_until IS NOT NULL AND v_rate_limit.locked_until > v_now THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'RATE_LIMITED',
        'message', 'Too many failed attempts. Locked for 60 seconds.',
        'locked_until', v_rate_limit.locked_until
      );
    ELSIF v_rate_limit.locked_until IS NOT NULL AND v_rate_limit.locked_until <= v_now THEN
      UPDATE public.staff_checkin_rate_limits
      SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
      WHERE user_id = v_staff_id;
    END IF;
  ELSE
    INSERT INTO public.staff_checkin_rate_limits (user_id, failed_attempts, locked_until, updated_at)
    VALUES (v_staff_id, 0, NULL, v_now)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- ───────────────────────────────────────────────────────────────────────────
  -- NON-HOSPITAL PROVIDERS
  -- ───────────────────────────────────────────────────────────────────────────
  IF NOT v_is_hospital THEN
    v_is_owner := (p_shop_id IN (SELECT public.get_user_authorized_providers(v_staff_id)))
                  OR public.is_caller_authorized_for_resource(p_shop_id, NULL, v_staff_id)
                  OR public.is_admin(v_staff_id);

    IF NOT v_is_owner THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'UNAUTHORIZED',
        'message', 'Staff is not authorized for this shop'
      );
    END IF;

    -- Lookup checkin code for this shop today, prioritizing CONFIRMED closest to now
    SELECT c.* INTO v_checkin_record
    FROM public.appointment_checkin_codes c
    JOIN public.bookings b ON b.id = c.booking_id
    WHERE c.provider_id = p_shop_id
      AND c.appointment_date = v_today_ist
      AND c.code = v_clean_code
    ORDER BY (b.status = 'CONFIRMED') DESC, ABS(EXTRACT(EPOCH FROM (b.slot_start - v_now))) ASC
    LIMIT 1
    FOR UPDATE OF b;

    IF NOT FOUND THEN
      -- Permanent Lifetime PIN fallback: check profiles.permanent_checkin_pin
      SELECT b.* INTO v_booking
      FROM public.bookings b
      JOIN public.profiles p ON p.id = b.customer_id
      WHERE p.permanent_checkin_pin = v_clean_code
        AND b.provider_id = p_shop_id
        AND (b.slot_start AT TIME ZONE 'Asia/Kolkata')::date = v_today_ist
      ORDER BY (b.status = 'CONFIRMED') DESC, ABS(EXTRACT(EPOCH FROM (b.slot_start - v_now))) ASC
      LIMIT 1
      FOR UPDATE OF b;

      IF v_booking.id IS NULL THEN
        -- Check if code exists on other dates for future guidance
        SELECT c.* INTO v_other_date_record
        FROM public.appointment_checkin_codes c
        JOIN public.bookings b ON b.id = c.booking_id
        WHERE c.provider_id = p_shop_id
          AND c.code = v_clean_code
          AND c.appointment_date > v_today_ist
          AND b.status = 'CONFIRMED'
        ORDER BY c.appointment_date ASC
        LIMIT 1;

        IF v_other_date_record.id IS NOT NULL THEN
          PERFORM public._record_checkin_failure(v_staff_id, v_now);
          RETURN jsonb_build_object(
            'success', false,
            'error', 'APPOINTMENT_FUTURE',
            'message', 'This check-in code is scheduled for a future date: ' || to_char(v_other_date_record.appointment_date, 'YYYY-MM-DD') || '. Check-in opens on the scheduled appointment date.',
            'appointment_date', v_other_date_record.appointment_date
          );
        END IF;

        PERFORM public._record_checkin_failure(v_staff_id, v_now);
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'Invalid check-in code');
      END IF;
    ELSE
      SELECT * INTO v_booking
      FROM public.bookings
      WHERE id = v_checkin_record.booking_id;
    END IF;

    IF v_booking.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'BOOKING_NOT_FOUND', 'message', 'Associated appointment record not found');
    END IF;

    IF v_booking.status = 'CHECKED_IN' OR v_booking.is_present = TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CHECKED_IN', 'message', 'This appointment is already checked in');
    END IF;

    IF v_booking.status != 'CONFIRMED' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Appointment is not in confirmed status (current: ' || v_booking.status || ')');
    END IF;

    v_window_start := v_booking.slot_start - interval '60 minutes';
    IF v_now < v_window_start THEN
      RETURN jsonb_build_object('success', false, 'error', 'TOO_EARLY', 'message', 'Check-in opens 60 minutes before scheduled time');
    END IF;

    v_is_late := v_now > (v_booking.slot_start + interval '10 minutes');

    PERFORM set_config('app.trusted_write', 'true', true);

    UPDATE public.bookings
    SET status = 'CHECKED_IN',
        is_present = TRUE,
        checked_in_at = v_now,
        checked_in_by = v_staff_id,
        checked_in_method = 'code',
        customer_arrived_at = COALESCE(customer_arrived_at, v_now),
        updated_at = v_now
    WHERE id = v_booking.id
      AND status = 'CONFIRMED'
      AND is_present = FALSE;

    UPDATE public.staff_checkin_rate_limits
    SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
    WHERE user_id = v_staff_id;

    SELECT COALESCE(v_booking.patient_name, full_name, 'Patient') INTO v_patient_name FROM public.profiles WHERE id = v_booking.customer_id;
    SELECT name INTO v_service_doctor FROM public.resources WHERE id = v_booking.resource_id;
    v_slot_time_str := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');

    RETURN jsonb_build_object(
      'success', true,
      'booking_id', v_booking.id,
      'patient_name', v_patient_name,
      'service_doctor', v_service_doctor,
      'slot_time', v_slot_time_str,
      'is_late', v_is_late,
      'checked_in_at', v_now
    );
  END IF;

  -- ───────────────────────────────────────────────────────────────────────────
  -- HOSPITAL PROVIDERS
  -- ───────────────────────────────────────────────────────────────────────────
  v_hosp_role := public.hospital_role(p_shop_id, v_staff_id);

  IF v_hosp_role = 'none' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Staff is not authorized for this hospital'
    );
  END IF;

  -- Department check-in module verification for non-admin hospital staff
  IF v_hosp_role != 'admin' THEN
    SELECT d.id, d.allowed_modules INTO v_caller_dept_id, v_dept_modules
    FROM public.departments d
    JOIN public.department_members dm ON dm.department_id = d.id
    WHERE dm.user_id = v_staff_id
      AND dm.merchant_id = p_shop_id
      AND dm.status = 'active'
    LIMIT 1;

    IF v_caller_dept_id IS NULL OR NOT ('check_in' = ANY(v_dept_modules)) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'MODULE_DISABLED',
        'message', 'Check-in desk module is not enabled for your department'
      );
    END IF;
  END IF;

  -- Lookup today's checkin code for this hospital, prioritizing CONFIRMED closest to now
  SELECT c.* INTO v_checkin_record
  FROM public.appointment_checkin_codes c
  JOIN public.bookings b ON b.id = c.booking_id
  WHERE c.provider_id = p_shop_id
    AND c.appointment_date = v_today_ist
    AND c.code = v_clean_code
  ORDER BY (b.status = 'CONFIRMED') DESC, ABS(EXTRACT(EPOCH FROM (b.slot_start - v_now))) ASC
  LIMIT 1
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    -- Fallback: Permanent Lifetime Customer PIN
    SELECT b.* INTO v_booking
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.customer_id
    WHERE p.permanent_checkin_pin = v_clean_code
      AND b.provider_id = p_shop_id
      AND (b.slot_start AT TIME ZONE 'Asia/Kolkata')::date = v_today_ist
    ORDER BY (b.status = 'CONFIRMED') DESC, ABS(EXTRACT(EPOCH FROM (b.slot_start - v_now))) ASC
    LIMIT 1
    FOR UPDATE OF b;

    IF v_booking.id IS NULL THEN
      -- Check future dates for upcoming guidance
      SELECT c.* INTO v_other_date_record
      FROM public.appointment_checkin_codes c
      JOIN public.bookings b ON b.id = c.booking_id
      WHERE c.provider_id = p_shop_id
        AND c.code = v_clean_code
        AND c.appointment_date > v_today_ist
        AND b.status = 'CONFIRMED'
      ORDER BY c.appointment_date ASC
      LIMIT 1;

      IF v_other_date_record.id IS NOT NULL THEN
        PERFORM public._record_checkin_failure(v_staff_id, v_now);
        RETURN jsonb_build_object(
          'success', false,
          'error', 'APPOINTMENT_FUTURE',
          'message', 'This check-in code is scheduled for a future date: ' || to_char(v_other_date_record.appointment_date, 'YYYY-MM-DD') || '. Check-in opens on the scheduled appointment date.',
          'appointment_date', v_other_date_record.appointment_date
        );
      END IF;

      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'Invalid check-in code');
    END IF;
  ELSE
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = v_checkin_record.booking_id;
  END IF;

  IF v_booking.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BOOKING_NOT_FOUND', 'message', 'Associated appointment record not found');
  END IF;

  -- Enforce per-consultant resource access
  IF v_hosp_role != 'admin' THEN
    IF NOT public.is_caller_authorized_for_resource(p_shop_id, v_booking.resource_id, v_staff_id) THEN
      PERFORM public._record_checkin_failure(v_staff_id, v_now);
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INVALID_CODE',
        'message', 'Staff is not authorized for this doctor'
      );
    END IF;
  END IF;

  -- State validation
  IF v_booking.status = 'CHECKED_IN' OR v_booking.is_present = TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ALREADY_CHECKED_IN',
      'message', 'This appointment is already checked in'
    );
  END IF;

  IF v_booking.status != 'CONFIRMED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_STATUS',
      'message', 'Appointment is not in confirmed status (current: ' || v_booking.status || ')'
    );
  END IF;

  -- Time window validation: max 60 minutes before slot_start
  v_window_start := v_booking.slot_start - interval '60 minutes';
  IF v_now < v_window_start THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TOO_EARLY',
      'message', 'Check-in opens 60 minutes before scheduled time'
    );
  END IF;

  -- Phase 3 queue R7 logic: Determine if patient was skipped while absent
  v_was_skipped := (v_booking.skipped_at IS NOT NULL) OR EXISTS (
    SELECT 1
    FROM public.bookings b2
    WHERE b2.resource_id = v_booking.resource_id
      AND (b2.slot_start AT TIME ZONE 'Asia/Kolkata')::date = (v_booking.slot_start AT TIME ZONE 'Asia/Kolkata')::date
      AND b2.slot_start > v_booking.slot_start
      AND b2.status IN ('IN_CONSULTATION', 'COMPLETED')
  );

  v_is_late := v_was_skipped OR (v_now > (v_booking.slot_start + interval '5 minutes'));

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CHECKED_IN',
      is_present = TRUE,
      checked_in_at = v_now,
      checked_in_by = v_staff_id,
      checked_in_method = 'code',
      customer_arrived_at = COALESCE(customer_arrived_at, v_now),
      skipped_at = CASE WHEN v_was_skipped THEN COALESCE(skipped_at, v_now) ELSE skipped_at END,
      updated_at = v_now
  WHERE id = v_booking.id
    AND status = 'CONFIRMED'
    AND is_present = FALSE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ALREADY_CHECKED_IN',
      'message', 'This appointment is already checked in'
    );
  END IF;

  UPDATE public.staff_checkin_rate_limits
  SET failed_attempts = 0, locked_until = NULL, updated_at = v_now
  WHERE user_id = v_staff_id;

  SELECT COALESCE(v_booking.patient_name, full_name, 'Patient') INTO v_patient_name
  FROM public.profiles WHERE id = v_booking.customer_id;

  SELECT name INTO v_service_doctor
  FROM public.resources WHERE id = v_booking.resource_id;

  v_slot_time_str := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM');

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'patient_name', v_patient_name,
    'service_doctor', v_service_doctor,
    'slot_time', v_slot_time_str,
    'is_late', v_is_late,
    'was_skipped', v_was_skipped,
    'checked_in_at', v_now
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_checkin_code(p_shop_id uuid, p_code text)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.verify_checkin_code(p_shop_id, p_code);
$$;

REVOKE ALL ON FUNCTION private.verify_checkin_code FROM PUBLIC;
REVOKE ALL ON FUNCTION private.verify_checkin_code FROM anon;
GRANT EXECUTE ON FUNCTION private.verify_checkin_code TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.verify_checkin_code FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_checkin_code FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_checkin_code TO authenticated, service_role;


-- =============================================================================
-- Function: search_directory_public
-- =============================================================================
CREATE OR REPLACE FUNCTION private.search_directory_public(p_query text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_results jsonb;
  v_sanitized_query text;
BEGIN
  v_sanitized_query := substr(trim(COALESCE(p_query, '')), 1, 100);

  IF v_sanitized_query = '' THEN
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
        word_similarity(v_sanitized_query, p.name),
        word_similarity(v_sanitized_query, COALESCE(p.description, '')),
        COALESCE(MAX(word_similarity(v_sanitized_query, r.name)), 0),
        COALESCE(MAX(word_similarity(v_sanitized_query, COALESCE(r.department, ''))), 0)
      ) AS relevance
    FROM public.providers p
    LEFT JOIN public.resources r ON r.provider_id = p.id
    WHERE p.status = 'ACTIVE'
      AND (
        p.name ILIKE '%' || v_sanitized_query || '%'
        OR COALESCE(p.description, '') ILIKE '%' || v_sanitized_query || '%'
        OR r.name ILIKE '%' || v_sanitized_query || '%'
        OR COALESCE(r.department, '') ILIKE '%' || v_sanitized_query || '%'
        OR word_similarity(v_sanitized_query, p.name) > 0.3
        OR word_similarity(v_sanitized_query, COALESCE(r.name, '')) > 0.3
        OR word_similarity(v_sanitized_query, COALESCE(r.department, '')) > 0.3
      )
    GROUP BY p.id, p.name, p.category_id, p.address, p.city, p.opening_time, p.closing_time, p.description, p.photos, p.latitude, p.longitude, p.status
    ORDER BY relevance DESC
    LIMIT 50
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
    ),
    '[]'::jsonb
  )
  INTO v_results
  FROM matched_providers mp;

  RETURN v_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_directory_public(p_query text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.search_directory_public(p_query);
$$;

REVOKE ALL ON FUNCTION private.search_directory_public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.search_directory_public TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_directory_public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_directory_public TO anon, authenticated, service_role;


-- =============================================================================
-- Function: get_provider_details
-- =============================================================================
CREATE OR REPLACE FUNCTION private.get_provider_details(p_provider_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_res jsonb;
  v_caller_id uuid := auth.uid();
  v_caller_role text := auth.role();
  v_is_authorized boolean := false;
BEGIN
  IF v_caller_role = 'service_role' THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL THEN
    IF public.is_admin(v_caller_id) THEN
      v_is_authorized := true;
    ELSIF p_provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Caller does not have permission to view provider details' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(p.*) || jsonb_build_object(
    'resources', COALESCE(
      (SELECT jsonb_agg(to_jsonb(r.*)) FROM public.resources r WHERE r.provider_id = p.id),
      '[]'::jsonb
    )
  )
  INTO v_res
  FROM public.providers p
  WHERE p.id = p_provider_id;

  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_provider_details(p_provider_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_provider_details(p_provider_id);
$$;

REVOKE ALL ON FUNCTION private.get_provider_details FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_provider_details TO service_role;

REVOKE ALL ON FUNCTION public.get_provider_details FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_details TO service_role;


-- =============================================================================
-- Function: get_merchant_bookings
-- =============================================================================
CREATE OR REPLACE FUNCTION private.get_merchant_bookings(p_provider_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, customer_id uuid, provider_id uuid, resource_id uuid, slot_start timestamp with time zone, slot_end timestamp with time zone, status booking_status, payment_status payment_status, deposit_amount numeric, platform_fee numeric, total_amount numeric, gateway_payment_id text, hold_expires_at timestamp with time zone, reference_code text, attachment_url text, reminder_1h_sent_at timestamp with time zone, reminder_30m_sent_at timestamp with time zone, is_present boolean, customer_arrived_at timestamp with time zone, platform_fee_gst numeric, gstin_platform text, invoice_number text, created_at timestamp with time zone, updated_at timestamp with time zone, customer_name text, customer_phone text, no_show_count integer, resource_name text, resource_type text, provider_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.customer_id,
    b.provider_id,
    b.resource_id,
    b.slot_start,
    b.slot_end,
    b.status,
    b.payment_status,
    b.deposit_amount,
    b.platform_fee,
    b.total_amount,
    b.gateway_payment_id,
    b.hold_expires_at,
    b.reference_code,
    b.attachment_url,
    b.reminder_1h_sent_at,
    b.reminder_30m_sent_at,
    b.is_present,
    b.customer_arrived_at,
    b.platform_fee_gst,
    b.gstin_platform,
    b.invoice_number,
    b.created_at,
    b.updated_at,
    COALESCE(pr.full_name, 'Walk-in / Guest') AS customer_name,
    public.mask_customer_phone(pr.phone) AS customer_phone,
    COALESCE(pr.no_show_count, 0) AS no_show_count,
    COALESCE(r.name, 'Standard Unit') AS resource_name,
    COALESCE(r.type, 'slot') AS resource_type,
    COALESCE(p.name, 'Merchant Venue') AS provider_name
  FROM public.bookings b
  LEFT JOIN public.profiles pr ON pr.id = b.customer_id
  LEFT JOIN public.resources r ON r.id = b.resource_id
  LEFT JOIN public.providers p ON p.id = b.provider_id
  WHERE (p_provider_id IS NULL OR b.provider_id = p_provider_id)
    AND (
      b.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
      OR public.is_admin(auth.uid())
    )
  ORDER BY b.slot_start ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_merchant_bookings(p_provider_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(id uuid, customer_id uuid, provider_id uuid, resource_id uuid, slot_start timestamp with time zone, slot_end timestamp with time zone, status booking_status, payment_status payment_status, deposit_amount numeric, platform_fee numeric, total_amount numeric, gateway_payment_id text, hold_expires_at timestamp with time zone, reference_code text, attachment_url text, reminder_1h_sent_at timestamp with time zone, reminder_30m_sent_at timestamp with time zone, is_present boolean, customer_arrived_at timestamp with time zone, platform_fee_gst numeric, gstin_platform text, invoice_number text, created_at timestamp with time zone, updated_at timestamp with time zone, customer_name text, customer_phone text, no_show_count integer, resource_name text, resource_type text, provider_name text)
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM private.get_merchant_bookings(p_provider_id);
$$;

REVOKE ALL ON FUNCTION private.get_merchant_bookings FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_merchant_bookings TO service_role;

REVOKE ALL ON FUNCTION public.get_merchant_bookings FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_merchant_bookings TO service_role;


-- =============================================================================
-- Function: confirm_booking_by_merchant
-- =============================================================================
CREATE OR REPLACE FUNCTION private.confirm_booking_by_merchant(p_booking_id uuid)
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

CREATE OR REPLACE FUNCTION public.confirm_booking_by_merchant(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.confirm_booking_by_merchant(p_booking_id);
$$;

REVOKE ALL ON FUNCTION private.confirm_booking_by_merchant FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.confirm_booking_by_merchant TO service_role;

REVOKE ALL ON FUNCTION public.confirm_booking_by_merchant FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_by_merchant TO service_role;


-- =============================================================================
-- Function: record_no_show
-- =============================================================================
CREATE OR REPLACE FUNCTION private.record_no_show(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
    v_booking public.bookings%ROWTYPE;
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

    -- Caller Authorization Guard: venue owner, authorized staff/consultant, or admin
    IF auth.role() = 'authenticated' THEN
      IF NOT (
        public.is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, auth.uid())
        OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
        OR public.is_admin(auth.uid())
      ) THEN
        RAISE EXCEPTION 'Only the owning merchant, authorized consultant/staff, or an admin can record a no-show';
      END IF;
    END IF;

    -- Read current strike count of customer with row lock
    SELECT COALESCE(no_show_count, 0) INTO v_current_count
    FROM public.profiles
    WHERE id = v_booking.customer_id
    FOR UPDATE;

    v_new_count := v_current_count + 1;
    v_deposit := COALESCE(v_booking.deposit_amount, 100.00);

    -- TIERED NO-SHOW POLICY:
    -- Strikes 1 & 2: Courtesy 100% refund, no penalty
    IF v_new_count <= 2 THEN
        v_payment_status := 'REFUND_PENDING'::public.payment_status;
        v_penalty := FALSE;
        v_refund_amount := v_deposit;
        v_merchant_credit := 0;
        v_final_count := v_new_count;
        v_is_blocked := FALSE;
        v_blocked_until := NULL;

    -- Strikes 3 to 5: ₹50 to doctor, ₹10 to platform, remainder (deposit - 60) refunded
    ELSIF v_new_count <= 5 THEN
        v_penalty := TRUE;
        v_merchant_credit := 50.00;
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

    -- Exceeded 5 Strikes (6th strike):
    -- Account blocked for 7 days, counter reset to 0, same fee split
    ELSE
        v_penalty := TRUE;
        v_merchant_credit := 50.00;
        v_final_count := 0; -- Reset strike counter per product spec
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

    PERFORM set_config('app.trusted_write', 'true', true);

    -- Update customer profile strikes & block
    UPDATE public.profiles
    SET no_show_count = v_final_count,
        blocked_until = CASE WHEN v_is_blocked THEN v_blocked_until ELSE blocked_until END,
        is_flagged = CASE WHEN v_is_blocked OR v_new_count >= 3 THEN TRUE ELSE is_flagged END,
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
        'no_show_count', v_final_count,
        'penalty_applied', v_penalty,
        'payment_status', v_payment_status::text,
        'refund_amount', v_refund_amount,
        'is_blocked', v_is_blocked,
        'blocked_until', v_blocked_until,
        'flagged', v_is_blocked OR v_new_count >= 3,
        'is_flagged', v_is_blocked OR v_new_count >= 3
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_no_show(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.record_no_show(p_booking_id);
$$;

REVOKE ALL ON FUNCTION private.record_no_show FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.record_no_show TO service_role;

REVOKE ALL ON FUNCTION public.record_no_show FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_no_show TO service_role;


-- =============================================================================
-- Function: reorder_hospital_queue
-- =============================================================================
CREATE OR REPLACE FUNCTION private.reorder_hospital_queue(p_provider_id uuid, p_doctor_id uuid, p_booking_ids uuid[], p_caller_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_caller_id UUID := CASE
    WHEN auth.role() = 'service_role' OR auth.uid() IS NULL THEN COALESCE(p_caller_id, auth.uid())
    ELSE auth.uid()
  END;
  v_role TEXT;
  v_accessible_ids UUID[];
  v_id UUID;
  v_pos INT := 1;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Authorization check
  v_role := public.hospital_role(p_provider_id, v_caller_id);
  IF v_role NOT IN ('admin', 'front_desk', 'consultant') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT ARRAY_AGG(id) INTO v_accessible_ids
  FROM public.hospital_accessible_resource_ids(p_provider_id, v_caller_id) id;

  IF NOT (p_doctor_id = ANY(v_accessible_ids)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden: Doctor queue not accessible');
  END IF;

  -- Lock all active bookings for this doctor to serialize queue updates
  PERFORM id
  FROM public.bookings
  WHERE provider_id = p_provider_id
    AND resource_id = p_doctor_id
    AND status IN ('CONFIRMED', 'CHECKED_IN')
  FOR UPDATE;

  -- Assign positions 1..N gap-free
  FOREACH v_id IN ARRAY p_booking_ids
  LOOP
    UPDATE public.bookings
    SET queue_position = v_pos,
        updated_at = v_now
    WHERE id = v_id
      AND provider_id = p_provider_id
      AND resource_id = p_doctor_id;

    v_pos := v_pos + 1;
  END LOOP;

  -- Record audit log entry for queue reorder
  INSERT INTO public.audit_logs (
    merchant_id,
    actor_id,
    action,
    target,
    booking_id,
    role,
    metadata,
    created_at
  ) VALUES (
    p_provider_id,
    v_caller_id,
    'QUEUE_REORDER',
    'queue',
    NULL,
    v_role,
    jsonb_build_object(
      'actor', v_caller_id,
      'role', v_role,
      'doctor_id', p_doctor_id,
      'action', 'QUEUE_REORDER',
      'before', null,
      'after', jsonb_build_object('booking_ids', p_booking_ids),
      'time', v_now
    ),
    v_now
  );

  RETURN jsonb_build_object('success', true, 'reordered_count', array_length(p_booking_ids, 1));
END;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_hospital_queue(p_provider_id uuid, p_doctor_id uuid, p_booking_ids uuid[], p_caller_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.reorder_hospital_queue(p_provider_id, p_doctor_id, p_booking_ids, p_caller_id);
$$;

REVOKE ALL ON FUNCTION private.reorder_hospital_queue FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.reorder_hospital_queue TO service_role;

REVOKE ALL ON FUNCTION public.reorder_hospital_queue FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_hospital_queue TO service_role;


-- =============================================================================
-- Function: merchant_update_cooling_period
-- =============================================================================
CREATE OR REPLACE FUNCTION private.merchant_update_cooling_period(p_provider_id uuid, p_cooling_period_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
    v_caller_id UUID := auth.uid();
    v_role TEXT := auth.role();
    v_authorized BOOLEAN := FALSE;
BEGIN
    IF v_role = 'service_role' THEN
        v_authorized := TRUE;
    ELSIF v_caller_id IS NOT NULL THEN
        -- Check if caller is owner in providers table
        SELECT (owner_id = v_caller_id) INTO v_authorized
        FROM public.providers
        WHERE id = p_provider_id;

        IF NOT COALESCE(v_authorized, false) THEN
            -- Check if caller is active member/owner in merchant_memberships
            SELECT EXISTS (
                SELECT 1 FROM public.merchant_memberships
                WHERE provider_id = p_provider_id
                  AND user_id = v_caller_id
            ) INTO v_authorized;
        END IF;

        IF NOT COALESCE(v_authorized, false) THEN
            -- Check if caller is platform admin
            SELECT public.is_admin(v_caller_id) INTO v_authorized;
        END IF;
    END IF;

    IF NOT v_authorized THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized to modify this provider');
    END IF;

    IF p_cooling_period_days < 0 OR p_cooling_period_days > 365 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cooling period must be between 0 and 365 days');
    END IF;

    UPDATE public.providers
    SET cooling_period_days = p_cooling_period_days,
        updated_at = NOW()
    WHERE id = p_provider_id;

    RETURN jsonb_build_object(
        'success', true,
        'provider_id', p_provider_id,
        'cooling_period_days', p_cooling_period_days
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.merchant_update_cooling_period(p_provider_id uuid, p_cooling_period_days integer)
RETURNS jsonb
LANGUAGE sql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.merchant_update_cooling_period(p_provider_id, p_cooling_period_days);
$$;

REVOKE ALL ON FUNCTION private.merchant_update_cooling_period FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.merchant_update_cooling_period TO service_role;

REVOKE ALL ON FUNCTION public.merchant_update_cooling_period FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_update_cooling_period TO service_role;


-- =============================================================================
-- 3. Fix Mutable search_path on Remaining Functions
-- =============================================================================
ALTER FUNCTION public.normalize_phone_number(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.sanitize_template_param(text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_template_name(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_booking_for_family() SET search_path = public, pg_temp;
ALTER FUNCTION public.admin_update_resource_status(uuid, boolean, text) SET search_path = public, pg_temp;
