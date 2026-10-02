-- ==============================================================================
-- Migration: 20261001000002_reassign_auth_and_permission_lockdown.sql
-- Description: 
--   1. Step 1: Implement In-Function Auth for reassign_booking_resource (BOLA defense)
--   2. Step 3.1: Lockdown search_directory PII with ABAC and revoke anon SELECT on public.providers
--   3. Step 3.4: Revoke anon execute permissions on reschedule_booking_slot (fix regression)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. In-Function Auth for reassign_booking_resource
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_booking_resource(
  p_booking_id UUID,
  p_new_resource_id UUID,
  p_reason TEXT DEFAULT 'Emergency staff reassignment'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_old_resource public.resources%ROWTYPE;
  v_new_resource public.resources%ROWTYPE;
  v_conflict_id UUID;
  v_customer_phone TEXT;
  v_customer_name TEXT;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  -- 1. Fetch booking
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- 2. Caller Authorization Guard:
  -- Caller must be service_role, postgres superuser, platform admin,
  -- or authorized staff/owner for the booking's provider.
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

  -- 10. Log notification event
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
    COALESCE(v_customer_phone, '+919848000000'),
    COALESCE(v_customer_name, 'Valued Customer'),
    'RESOURCE_REASSIGNED',
    'SMS_WHATSAPP',
    'SENT',
    format('Staff reassigned: Your appointment has been transferred from %s to %s due to an emergency.', COALESCE(v_old_resource.name, 'Staff'), v_new_resource.name),
    jsonb_build_object(
      'old_resource_id', v_booking.resource_id,
      'old_resource_name', v_old_resource.name,
      'new_resource_id', p_new_resource_id,
      'new_resource_name', v_new_resource.name,
      'reason', p_reason
    )
  );

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
$$;

-- Restrict permissions on reassign_booking_resource
REVOKE ALL ON FUNCTION public.reassign_booking_resource(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_booking_resource(UUID, UUID, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. Revoke anon direct SELECT on public.providers table
-- ------------------------------------------------------------------------------
REVOKE SELECT ON public.providers FROM anon;

-- Update search_directory RPC with Attribute-Based Access Control (ABAC) on PII
CREATE OR REPLACE FUNCTION public.search_directory(p_query text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_results jsonb;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_admin BOOLEAN := FALSE;
BEGIN
  IF v_caller_role = 'service_role' OR SESSION_USER = 'postgres' OR CURRENT_USER = 'postgres' THEN
    v_is_admin := TRUE;
  ELSIF v_caller_id IS NOT NULL AND public.is_admin(v_caller_id) THEN
    v_is_admin := TRUE;
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
                'name', r.name,
                'department', r.department,
                'category_id', r.category_id,
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
              'name', r.name,
              'department', r.department,
              'category_id', r.category_id,
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

REVOKE EXECUTE ON FUNCTION public.search_directory(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_directory(text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. Fix reschedule_booking_slot permission regression (Step 3.4)
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_slot(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
