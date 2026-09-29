-- =============================================================================
-- Migration: 20260928000003_multi_tenant_isolation_and_boundary_hardening.sql
-- Description:
--   1. Add expo_push_token to public.profiles and grant column update.
--   2. Enforce verified email requirement on auto_link_merchant_by_email and revoke anon execute.
--   3. Harden storage.objects RLS for venue-assets to enforce tenant provider ownership.
--   4. Enforce event_type allowlist in dispatch_booking_notification procedure.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. EXPO PUSH TOKEN ON PROFILES
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS expo_push_token TEXT;

-- Grant column-level update on expo_push_token to authenticated users
GRANT UPDATE (full_name, phone, expo_push_token) ON public.profiles TO authenticated;


-- -----------------------------------------------------------------------------
-- 2. HARDEN AUTO-LINK MERCHANT (Prevent Unverified Account Takeover)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_link_merchant_by_email(p_user_id uuid, p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_provider RECORD;
  v_clean_email text := lower(trim(p_email));
  v_confirmed_at timestamptz;
BEGIN
  IF v_clean_email IS NULL OR v_clean_email = '' OR p_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Require email confirmation in auth.users before linking any merchant provider
  SELECT email_confirmed_at INTO v_confirmed_at
  FROM auth.users
  WHERE id = p_user_id;

  IF v_confirmed_at IS NULL THEN
    -- User email is not yet verified; reject auto-linking to protect provider ownership
    RETURN;
  END IF;

  FOR v_provider IN 
    SELECT id, name FROM public.providers 
    WHERE lower(trim(email)) = v_clean_email
  LOOP
    -- Link provider ownership only if unowned or already owned by caller
    UPDATE public.providers
    SET owner_id = p_user_id, updated_at = now()
    WHERE id = v_provider.id AND (owner_id IS NULL OR owner_id = p_user_id);

    -- Link membership
    INSERT INTO public.merchant_memberships (user_id, provider_id, role, created_at, updated_at)
    VALUES (p_user_id, v_provider.id, 'owner', now(), now())
    ON CONFLICT (user_id, provider_id) DO UPDATE SET role = 'owner', updated_at = now();

    -- Set default provider and merchant role on profile
    UPDATE public.profiles
    SET role = 'merchant'::public.user_role,
        default_provider_id = v_provider.id,
        updated_at = now()
    WHERE id = p_user_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_link_merchant_by_email(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_link_merchant_by_email(uuid, text) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3. HARDEN STORAGE RLS FOR VENUE-ASSETS (Prevent Direct Upload Bypass & Cross-Tenant Overwrite)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow upload to venue assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow update venue assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow delete venue assets" ON storage.objects;
DROP POLICY IF EXISTS "Public Access for Venue Assets" ON storage.objects;

-- Public read access for venue assets (storefronts, avatars)
CREATE POLICY "Public Access for Venue Assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'venue-assets');

-- INSERT: Only authorized merchant staff/owners, superadmins, or service_role can upload under a provider's folder
CREATE POLICY "Allow upload to venue assets"
ON storage.objects FOR INSERT
TO authenticated, service_role
WITH CHECK (
  bucket_id = 'venue-assets'
  AND (
    auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
    OR (
      storage.foldername(name) IS NOT NULL
      AND (
        (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_authorized_providers(auth.uid()))
      )
    )
  )
);

-- UPDATE: Scoped to authorized provider owner/staff or superadmin
CREATE POLICY "Allow update venue assets"
ON storage.objects FOR UPDATE
TO authenticated, service_role
USING (
  bucket_id = 'venue-assets'
  AND (
    auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
    OR (
      storage.foldername(name) IS NOT NULL
      AND (
        (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_authorized_providers(auth.uid()))
      )
    )
  )
);

-- DELETE: Scoped to authorized provider owner/staff or superadmin
CREATE POLICY "Allow delete venue assets"
ON storage.objects FOR DELETE
TO authenticated, service_role
USING (
  bucket_id = 'venue-assets'
  AND (
    auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
    OR (
      storage.foldername(name) IS NOT NULL
      AND (
        (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_authorized_providers(auth.uid()))
      )
    )
  )
);


-- -----------------------------------------------------------------------------
-- 4. HARDEN NOTIFICATION DISPATCH (Prevent Event-Type Log Injection)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_booking_notification(
  p_booking_id UUID,
  p_event_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking RECORD;
  v_phone TEXT;
  v_name TEXT;
  v_ref TEXT;
  v_slot_formatted TEXT;
  v_msg_content TEXT;
  v_log_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  -- Validate event_type against strict allowlist to prevent log injection
  IF p_event_type NOT IN (
    'BOOKING_CONFIRMED',
    'BOOKING_REMINDER_1H',
    'BOOKING_REMINDER_30M',
    'BOOKING_CANCELLED',
    'RESOURCE_REASSIGNED',
    'REFUND_FAILED_ALERT'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid event_type: not in allowed notification types');
  END IF;

  -- Fetch booking details with provider and resource info
  SELECT 
    b.id,
    b.reference_code,
    b.slot_start,
    b.slot_end,
    b.status,
    b.payment_status,
    b.customer_id,
    b.provider_id,
    p.name AS provider_name,
    p.address AS provider_address,
    p.phone AS provider_phone,
    r.name AS resource_name,
    r.department AS resource_dept,
    prof.phone AS customer_phone,
    prof.full_name AS customer_name
  INTO v_booking
  FROM public.bookings b
  JOIN public.providers p ON b.provider_id = p.id
  JOIN public.resources r ON b.resource_id = r.id
  LEFT JOIN public.profiles prof ON b.customer_id = prof.id
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller authorization check: service_role, owning customer, provider staff/owner, or admin
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
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not authorized for this booking notification');
  END IF;

  v_phone := COALESCE(v_booking.customer_phone, 'Unregistered Customer');
  v_name := COALESCE(v_booking.customer_name, 'Valued Customer');
  v_ref := COALESCE(v_booking.reference_code, p_booking_id::text);
  v_slot_formatted := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'Mon DD, YYYY at HH12:MI AM');

  -- Construct message text depending on event
  CASE p_event_type
    WHEN 'BOOKING_CONFIRMED' THEN
      v_msg_content := format(
        'Tirupati Appointments: Booking Confirmed! Ref: %s. Venue: %s. Specialist: %s (%s). Time: %s. Address: %s. Please arrive 10 mins early.',
        v_ref, v_booking.provider_name, v_booking.resource_name, COALESCE(v_booking.resource_dept, 'General'), v_slot_formatted, v_booking.provider_address
      );
    WHEN 'BOOKING_REMINDER_1H' THEN
      v_msg_content := format(
        'Tirupati Appointments Reminder: Your appointment at %s with %s starts in 1 hour (%s). Ref: %s. Address: %s.',
        v_booking.provider_name, v_booking.resource_name, to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), v_ref, v_booking.provider_address
      );
    WHEN 'BOOKING_REMINDER_30M' THEN
      v_msg_content := format(
        'Tirupati Appointments Urgent Reminder: Your appointment starts in 30 minutes (%s) at %s. Please proceed to the reception with Ref: %s.',
        to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), v_booking.provider_name, v_ref
      );
    WHEN 'BOOKING_CANCELLED' THEN
      v_msg_content := format(
        'Tirupati Appointments: Booking %s at %s has been cancelled. Payment Status: %s. If you have questions, please reach out to %s.',
        v_ref, v_booking.provider_name, v_booking.payment_status, COALESCE(v_booking.provider_phone, 'Support')
      );
    WHEN 'RESOURCE_REASSIGNED' THEN
      v_msg_content := format(
        'Tirupati Appointments: Staff re-assigned for booking %s at %s. Your new specialist is %s.',
        v_ref, v_booking.provider_name, v_booking.resource_name
      );
    WHEN 'REFUND_FAILED_ALERT' THEN
      v_msg_content := format(
        'Tirupati Appointments Alert: Refund processing for booking %s at %s is pending manual reconciliation.',
        v_ref, v_booking.provider_name
      );
    ELSE
      v_msg_content := format(
        'Tirupati Appointments Notification: Status update for booking %s at %s.',
        v_ref, v_booking.provider_name
      );
  END CASE;

  PERFORM set_config('app.trusted_write', 'true', true);

  -- Insert notification log
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
    v_phone,
    v_name,
    p_event_type,
    'whatsapp',
    'SENT',
    v_msg_content,
    jsonb_build_object('provider', 'mock-whatsapp', 'timestamp', now())
  ) RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'notification_id', v_log_id,
    'channel', 'whatsapp',
    'event_type', p_event_type,
    'status', 'SENT'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) TO authenticated, service_role;
