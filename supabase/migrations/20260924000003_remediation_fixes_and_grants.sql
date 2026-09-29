-- =============================================================================
-- Migration: 20260924000003_remediation_fixes_and_grants.sql
-- Description:
--   1. Default Privileges: Revoke EXECUTE on new functions from PUBLIC and anon.
--   2. Tax Records & Audit Integrity:
--      - Alter bookings.customer_id and payments.booking_id foreign keys to ON DELETE RESTRICT.
--      - Alter contact_reveal_audit.booking_id and user_id to ON DELETE SET NULL so deleting
--        auth users or bookings NEVER erases audit trail rows.
--   3. Trigger Hardening: guard_profile_governance & guard_provider_governance
--   4. Item 4 Decision (Option A): confirm_booking_by_merchant strictly requires
--      payment_status = 'captured', preventing unpaid booking confirmation.
--   5. Hold & Payment Integrity:
--      - create_booking_hold: Enforce p_customer_id = auth.uid() for client callers,
--        validate slot times, and revoke from anon.
--      - confirm_booking_payment: Enforce service_role-only settlement context,
--        revoke from PUBLIC, anon, and authenticated.
--   6. Migration Content Drift: Update merchant_self_register to support optional
--      p_photo_url, minimum 8-char password, start clean with zero dummy resources,
--      and execute under app.trusted_write context.
--   7. Data Minimisation & Deletion:
--      - anonymize_user_data: Scrub storage objects (prescriptions, avatars), scrub profile,
--        attachment_url, notification logs, delete user_consents and auth.users.
--      - process_expired_account_deletions: Log failures to admin_audit_logs, update
--        last_error & retry_count on account_deletion_requests, and keep requests pending for retry.
--   8. Admin Functions Hardening:
--      - Purge all backdoor bypass tokens from get_admin_audit_logs, get_admin_city_stats,
--        get_admin_velocity_analytics, admin_update_provider_operational_settings, and
--        admin_update_merchant_status.
--      - Restrict admin_fetch_merchants to admins only (revoke from PUBLIC/anon).
--   9. Public & Anon RPC Permissions:
--      - Retain anon execute for public directory & RLS helper functions (is_admin,
--        get_user_authorized_providers, get_active_cities, search_directory, get_nearby_providers,
--        get_provider_details).
--      - Revoke anon execute on merchant bookings and management functions.
--   10. Service-Role Strict RPCs:
--      - Restrict anonymize_user_data, process_expired_account_deletions,
--        check_and_send_booking_reminders, set_booking_slot_for_reminder, and log_admin_action
--        strictly to service_role.
--   11. Table Write Surface Lockdown:
--      - Revoke all writes from anon on all public tables.
--      - Revoke authenticated writes on sensitive financial/governance tables.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DEFAULT PRIVILEGES LOCKDOWN
-- ─────────────────────────────────────────────────────────────────────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TAX RECORD PRESERVATION: RESTRICT CASCADES ON FINANCIAL LEDGER
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_customer_id_fkey;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_booking_id_fkey;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. AUDIT TRAIL PRESERVATION: FIX contact_reveal_audit FK SIDE EFFECTS
-- ─────────────────────────────────────────────────────────────────────────────
-- Deleting an auth user or a booking must NEVER erase audit rows
ALTER TABLE public.contact_reveal_audit
  ALTER COLUMN booking_id DROP NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.contact_reveal_audit
  DROP CONSTRAINT IF EXISTS contact_reveal_audit_booking_id_fkey;

ALTER TABLE public.contact_reveal_audit
  ADD CONSTRAINT contact_reveal_audit_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;

ALTER TABLE public.contact_reveal_audit
  DROP CONSTRAINT IF EXISTS contact_reveal_audit_user_id_fkey;

ALTER TABLE public.contact_reveal_audit
  ADD CONSTRAINT contact_reveal_audit_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TRIGGER HARDENING: guard_profile_governance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_profile_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Allow service_role, admin, or trusted internal execution context
  IF auth.role() = 'service_role'
     OR current_setting('app.trusted_write', true) = 'true'
     OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Block client modifications to role, flags, strikes, city assignment, and default provider
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.no_show_count IS DISTINCT FROM OLD.no_show_count
     OR NEW.is_flagged IS DISTINCT FROM OLD.is_flagged
     OR NEW.assigned_city_id IS DISTINCT FROM OLD.assigned_city_id
     OR NEW.default_provider_id IS DISTINCT FROM OLD.default_provider_id THEN
    RAISE EXCEPTION 'Unauthorized profile modification: role, city, provider, and governance fields are protected'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_governance ON public.profiles;
CREATE TRIGGER trg_guard_profile_governance
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_governance();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. TRIGGER HARDENING: guard_provider_governance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_provider_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Allow service_role, admin, or trusted internal execution context
  IF auth.role() = 'service_role'
     OR current_setting('app.trusted_write', true) = 'true'
     OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Block client modifications to governance, penalty, strike, status, city, and ownership fields
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.cancellation_strikes IS DISTINCT FROM OLD.cancellation_strikes
     OR NEW.strike_reset_date IS DISTINCT FROM OLD.strike_reset_date
     OR NEW.penalty_balance IS DISTINCT FROM OLD.penalty_balance
     OR NEW.is_booking_frozen IS DISTINCT FROM OLD.is_booking_frozen
     OR NEW.city_id IS DISTINCT FROM OLD.city_id THEN
    RAISE EXCEPTION 'Unauthorized provider modification: status, strikes, penalty balance, booking freeze, city, and ownership are protected'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_provider_governance ON public.providers;
CREATE TRIGGER trg_guard_provider_governance
  BEFORE UPDATE ON public.providers
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_provider_governance();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. OPTION A (STRICT PREPAID): confirm_booking_by_merchant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_booking_by_merchant(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  IF v_booking.status NOT IN ('HELD', 'PENDING_PAYMENT', 'PENDING') THEN
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
$$;

REVOKE ALL ON FUNCTION public.confirm_booking_by_merchant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_booking_by_merchant(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PAYMENT & HOLD INTEGRITY: confirm_booking_payment & create_booking_hold
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_booking_payment(
  p_booking_id UUID,
  p_gateway_payment_id TEXT,
  p_deposit_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_amount NUMERIC(10,2);
BEGIN
  -- Strict server-only guard: PostgREST clients cannot call this
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'payment settlement restricted to service role' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status NOT IN ('HELD', 'PENDING_PAYMENT') THEN
    IF v_booking.status = 'CONFIRMED' AND v_booking.gateway_payment_id = p_gateway_payment_id THEN
      RETURN jsonb_build_object(
        'success', true, 'booking_id', p_booking_id,
        'status', 'CONFIRMED', 'payment_status', 'CAPTURED', 'idempotent', true
      );
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'Booking not in a payable state');
  END IF;

  v_amount := COALESCE(p_deposit_amount, v_booking.deposit_amount);

  IF v_amount IS DISTINCT FROM v_booking.deposit_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch with held deposit');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CONFIRMED',
      payment_status = 'CAPTURED',
      gateway_payment_id = p_gateway_payment_id,
      updated_at = NOW()
  WHERE id = p_booking_id;

  INSERT INTO public.payments (
    booking_id, gateway_payment_id, amount, currency, status
  )
  SELECT p_booking_id, p_gateway_payment_id, v_amount, 'INR', 'CAPTURED'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.payments
    WHERE booking_id = p_booking_id
      AND gateway_payment_id = p_gateway_payment_id
      AND status = 'CAPTURED'
  );

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'CONFIRMED',
    'payment_status', 'CAPTURED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_booking_payment(UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_payment(UUID, TEXT, NUMERIC) TO service_role;

CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id UUID,
    p_slot_start  TIMESTAMPTZ,
    p_slot_end    TIMESTAMPTZ,
    p_customer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_provider_id      UUID;
    v_provider_status  provider_status;
    v_category_id      TEXT;
    v_deposit_amount   NUMERIC(10, 2);
    v_platform_fee     NUMERIC(10, 2);
    v_total_amount     NUMERIC(10, 2);
    v_is_active        BOOLEAN;
    v_existing_id      UUID;
    v_new_booking_id   UUID;
    v_reference_code   TEXT;
    v_hold_expiry      TIMESTAMPTZ;
BEGIN
    -- Verify caller identity: Client callers cannot forge customer_id
    IF auth.role() != 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_customer_id THEN
            RAISE EXCEPTION 'Unauthorized: customer_id must match authenticated user' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Validate slot times
    IF p_slot_end <= p_slot_start THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: slot_end must be after slot_start');
    END IF;

    IF p_slot_start < (NOW() - INTERVAL '5 minutes') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: cannot book slots in the past');
    END IF;

    -- Auto-clean expired holds
    UPDATE public.bookings
    SET status = 'CANCELLED', updated_at = NOW()
    WHERE status = 'HELD' AND hold_expires_at < NOW();

    -- Fetch resource
    SELECT provider_id, deposit_amount, is_active
    INTO v_provider_id, v_deposit_amount, v_is_active
    FROM public.resources
    WHERE id = p_resource_id;

    IF NOT FOUND OR NOT v_is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Resource not found or inactive');
    END IF;

    -- Enforce ₹100 minimum deposit floor
    IF COALESCE(v_deposit_amount, 0) < 100 THEN
        v_deposit_amount := 100.00;
    END IF;

    -- Fetch provider status and category
    SELECT status, category_id INTO v_provider_status, v_category_id
    FROM public.providers WHERE id = v_provider_id;

    IF v_provider_status = 'SUSPENDED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Merchant provider is suspended');
    END IF;

    -- Platform fee: ₹50 for Gaming & Turf, ₹10 for all others
    v_platform_fee := CASE WHEN v_category_id IN ('gaming', 'turf') THEN 50.00 ELSE 10.00 END;
    v_total_amount := v_deposit_amount + v_platform_fee;

    -- Conflict check with 3-second lock timeout
    SET LOCAL lock_timeout = '3s';
    SELECT id INTO v_existing_id
    FROM public.bookings
    WHERE resource_id = p_resource_id
      AND slot_start  = p_slot_start
      AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
    FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked');
    END IF;

    v_hold_expiry := NOW() + INTERVAL '5 minutes';

    INSERT INTO public.bookings (
        customer_id, provider_id, resource_id,
        slot_start, slot_end, status, payment_status,
        deposit_amount, platform_fee, total_amount, hold_expires_at,
        disclaimer_version
    ) VALUES (
        p_customer_id, v_provider_id, p_resource_id,
        p_slot_start, p_slot_end, 'HELD', 'PENDING',
        v_deposit_amount, v_platform_fee, v_total_amount, v_hold_expiry,
        'v1'
    )
    RETURNING id, reference_code INTO v_new_booking_id, v_reference_code;

    RETURN jsonb_build_object(
        'success',          true,
        'booking_id',       v_new_booking_id,
        'reference_code',   v_reference_code,
        'deposit_amount',   v_deposit_amount,
        'platform_fee',     v_platform_fee,
        'total_amount',     v_total_amount,
        'hold_expires_at',  v_hold_expiry
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. MIGRATION DRIFT: merchant_self_register (photo_url support & clean shop)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.merchant_self_register(text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.merchant_self_register(
  p_full_name text,
  p_email text,
  p_password text,
  p_phone text,
  p_shop_name text,
  p_category_id text,
  p_address text DEFAULT 'AIR Bypass Road, Tirupati'::text,
  p_photo_url text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_provider_id uuid := gen_random_uuid();
  v_encrypted_pw text;
  v_clean_email text := lower(trim(p_email));
  v_clean_phone text;
  v_category text := lower(trim(p_category_id));
  v_photos text[] := NULL;
BEGIN
  IF v_clean_email IS NULL OR position('@' in v_clean_email) = 0 THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;

  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters long';
  END IF;

  IF length(trim(p_shop_name)) = 0 THEN
    RAISE EXCEPTION 'Shop name is required';
  END IF;

  v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));
  v_clean_phone := COALESCE(NULLIF(trim(p_phone), ''), '+91 98480 00000');

  -- Normalize category to valid ID
  IF v_category NOT IN ('salons', 'clinics', 'gaming', 'restaurants', 'pets') THEN
    v_category := 'salons';
  END IF;

  IF p_photo_url IS NOT NULL AND length(trim(p_photo_url)) > 0 THEN
    v_photos := ARRAY[trim(p_photo_url)];
  END IF;

  -- Allow internal profile updates
  PERFORM set_config('app.trusted_write', 'true', true);

  -- 1. Check or Create User in auth.users
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_clean_email;

  IF v_user_id IS NOT NULL THEN
    UPDATE auth.users 
    SET encrypted_password = v_encrypted_pw,
        raw_user_meta_data = jsonb_build_object('full_name', p_full_name, 'role', 'merchant'),
        updated_at = now()
    WHERE id = v_user_id;
  ELSE
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone_change_token, reauthentication_token, email_change_token_current, is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_clean_email, v_encrypted_pw, now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object('full_name', p_full_name, 'role', 'merchant'),
      now(), now(), '', '', '', '', '', '', '', false
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id,
      jsonb_build_object('sub', v_user_id, 'email', v_clean_email),
      'email', v_user_id::text, now(), now(), now()
    );
  END IF;

  -- 2. Upsert Profile
  INSERT INTO public.profiles (id, full_name, phone, role, email, updated_at)
  VALUES (v_user_id, p_full_name, v_clean_phone, 'merchant'::public.user_role, v_clean_email, now())
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = 'merchant'::public.user_role,
    email = EXCLUDED.email,
    updated_at = now();

  -- 3. Create Shop / Provider
  INSERT INTO public.providers (
    id, name, category_id, address, phone, email, city, city_id,
    latitude, longitude, opening_time, closing_time, owner_id, status, photos, created_at, updated_at
  ) VALUES (
    v_provider_id, trim(p_shop_name), v_category, COALESCE(NULLIF(trim(p_address), ''), 'AIR Bypass Road, Tirupati'),
    v_clean_phone, v_clean_email, 'Tirupati', 'tirupati',
    13.6288, 79.4192, '09:00:00', '21:00:00', v_user_id, 'ACTIVE', v_photos, now(), now()
  );

  -- 4. Create Merchant Membership
  INSERT INTO public.merchant_memberships (user_id, provider_id, role, created_at, updated_at)
  VALUES (v_user_id, v_provider_id, 'owner', now(), now())
  ON CONFLICT (user_id, provider_id) DO UPDATE SET role = 'owner', updated_at = now();

  -- 5. Set default provider on profile
  UPDATE public.profiles
  SET default_provider_id = v_provider_id
  WHERE id = v_user_id;

  -- Note: Newly registered merchants start with a clean shop with zero dummy resources.

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'provider_id', v_provider_id,
    'shop_name', trim(p_shop_name),
    'category_id', v_category,
    'email', v_clean_email,
    'photos', v_photos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_self_register(text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_self_register(text, text, text, text, text, text, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. DATA PRIVACY & STORAGE DELETION: anonymize_user_data & process_expired_account_deletions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.account_deletion_requests
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;

CREATE OR REPLACE FUNCTION public.anonymize_user_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_caller_role TEXT;
BEGIN
    -- Strict service_role only execution
    IF auth.role() != 'service_role' THEN
        SELECT role INTO v_caller_role FROM public.profiles WHERE id = (SELECT auth.uid());
        IF v_caller_role != 'admin' THEN
            RAISE EXCEPTION 'Unauthorized: only service_role or admin can anonymize users' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Set trusted execution context so triggers allow updates
    PERFORM set_config('app.trusted_write', 'true', true);

    -- 1. Delete physical files from Supabase Storage (prescriptions & avatars)
    DELETE FROM storage.objects
    WHERE owner = p_user_id
       OR owner_id = p_user_id::text
       OR (bucket_id = 'prescriptions-and-records' AND name LIKE p_user_id || '/%')
       OR (bucket_id = 'prescriptions-and-records' AND name IN (
           SELECT attachment_url FROM public.bookings WHERE customer_id = p_user_id AND attachment_url IS NOT NULL
       ));

    -- 2. Anonymize profile: scrub PII, clear avatar, set placeholder name and email for financial tax retention
    UPDATE public.profiles SET
        full_name       = 'Deleted User',
        phone           = NULL,
        email           = 'deleted_' || p_user_id || '@deleted.local',
        avatar_url      = NULL,
        is_flagged      = FALSE,
        updated_at      = NOW()
    WHERE id = p_user_id;

    -- 3. Scrub booking customer attachment URLs (valid column)
    UPDATE public.bookings SET
        attachment_url = NULL,
        updated_at     = NOW()
    WHERE customer_id = p_user_id;

    -- 4. Scrub notification logs recipient PII
    UPDATE public.notification_logs SET
        recipient_phone = NULL,
        recipient_name  = 'Deleted User'
    WHERE booking_id IN (SELECT id FROM public.bookings WHERE customer_id = p_user_id);

    -- 5. Revoke and delete user consents
    DELETE FROM public.user_consents WHERE user_id = p_user_id;

    -- 6. Delete from auth.users (cascades identities and sessions)
    DELETE FROM auth.users WHERE id = p_user_id;

    -- 7. Mark deletion request complete
    UPDATE public.account_deletion_requests SET
        completed_at = NOW(),
        last_error = NULL
    WHERE user_id = p_user_id AND completed_at IS NULL;

    RETURN jsonb_build_object('success', true, 'anonymized_user', p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_user_data(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_user_data(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.process_expired_account_deletions()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_processed_count INT := 0;
BEGIN
    FOR r IN
        SELECT user_id
        FROM public.account_deletion_requests
        WHERE scheduled_for <= NOW()
          AND completed_at IS NULL
          AND cancelled_at IS NULL
        ORDER BY scheduled_for ASC
    LOOP
        BEGIN
            -- Anonymize user records and scrub booking notes
            PERFORM public.anonymize_user_data(r.user_id);
            v_processed_count := v_processed_count + 1;
        EXCEPTION WHEN OTHERS THEN
            -- Record failure and increment retry_count, keeping completed_at NULL so it retries
            UPDATE public.account_deletion_requests
            SET last_error = SQLERRM,
                retry_count = COALESCE(retry_count, 0) + 1
            WHERE user_id = r.user_id AND completed_at IS NULL;

            -- Log failure to admin_audit_logs for security & operational visibility
            INSERT INTO public.admin_audit_logs (
                action, target_type, target_id, details
            ) VALUES (
                'ACCOUNT_DELETION_FAILED',
                'USER',
                r.user_id::text,
                jsonb_build_object('error', SQLERRM, 'time', NOW())
            );

            RAISE WARNING 'Failed to anonymize user %: %', r.user_id, SQLERRM;
        END;
    END LOOP;

    RETURN v_processed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_expired_account_deletions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_expired_account_deletions() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ADMIN FUNCTIONS HARDENING: REMOVE BACKDOORS & IN-FUNCTION is_admin() GUARDS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_audit_logs(
  p_limit INT DEFAULT 50,
  p_admin_token TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  admin_id UUID,
  admin_name TEXT,
  admin_email TEXT,
  action TEXT,
  target_type TEXT,
  target_id TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Strict role guard: Must be authenticated admin or service_role
  -- Backdoor tokens are completely removed
  IF auth.role() != 'service_role' AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access Denied: Administrator authority required to view audit logs' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.admin_id,
    COALESCE(p.full_name, 'Platform Super Admin')::text AS admin_name,
    COALESCE(p.email, 'admin@appointments-tirupati.com')::text AS admin_email,
    l.action,
    l.target_type,
    l.target_id,
    l.details,
    l.ip_address,
    l.created_at
  FROM public.admin_audit_logs l
  LEFT JOIN public.profiles p ON p.id = l.admin_id
  ORDER BY l.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_audit_logs(INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_logs(INTEGER, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_admin_city_stats()
RETURNS TABLE (
    city_id TEXT,
    city_name TEXT,
    state TEXT,
    status TEXT,
    merchant_target INT,
    onboarded_merchants BIGINT,
    in_progress_merchants BIGINT,
    suspended_merchants BIGINT,
    total_resources BIGINT,
    total_bookings BIGINT,
    completed_bookings BIGINT,
    deposit_volume NUMERIC,
    waitlist_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
    IF auth.role() != 'service_role' AND NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Access Denied: Administrator authority required to view city stats' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT 
        c.id AS city_id,
        c.name AS city_name,
        c.state,
        c.status,
        c.merchant_target,
        COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'ACTIVE')::BIGINT AS onboarded_merchants,
        COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'PENDING_APPROVAL')::BIGINT AS in_progress_merchants,
        COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'SUSPENDED')::BIGINT AS suspended_merchants,
        COUNT(DISTINCT r.id)::BIGINT AS total_resources,
        COUNT(DISTINCT b.id)::BIGINT AS total_bookings,
        COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'COMPLETED')::BIGINT AS completed_bookings,
        COALESCE(SUM(b.deposit_amount) FILTER (WHERE b.payment_status IN ('CAPTURED', 'FORFEITED')), 0)::NUMERIC AS deposit_volume,
        COALESCE(w.w_count, 0)::BIGINT AS waitlist_count
    FROM public.cities c
    LEFT JOIN public.providers p ON p.city_id = c.id
    LEFT JOIN public.resources r ON r.provider_id = p.id
    LEFT JOIN public.bookings b ON b.resource_id = r.id
    LEFT JOIN (
        SELECT cw.city_name, COUNT(*)::BIGINT AS w_count
        FROM public.city_waitlist cw
        GROUP BY cw.city_name
    ) w ON LOWER(w.city_name) = LOWER(c.name)
    GROUP BY c.id, c.name, c.state, c.status, c.merchant_target, w.w_count
    ORDER BY (CASE WHEN c.status = 'ACTIVE' THEN 1 WHEN c.status = 'EXPANDING' THEN 2 ELSE 3 END), c.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_city_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_city_stats() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_admin_velocity_analytics(
    p_time_window TEXT DEFAULT 'today',
    p_city_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_start_time TIMESTAMPTZ;
    v_result JSONB;
BEGIN
    IF auth.role() != 'service_role' AND NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Access Denied: Administrator authority required to view velocity analytics' USING ERRCODE = '42501';
    END IF;

    IF p_time_window = 'today' THEN
        v_start_time := date_trunc('day', NOW());
    ELSIF p_time_window = '3days' THEN
        v_start_time := NOW() - INTERVAL '3 days';
    ELSIF p_time_window = '7days' THEN
        v_start_time := NOW() - INTERVAL '7 days';
    ELSIF p_time_window = '30days' THEN
        v_start_time := NOW() - INTERVAL '30 days';
    ELSE
        v_start_time := '2020-01-01'::TIMESTAMPTZ;
    END IF;

    WITH filtered_bookings AS (
        SELECT 
            b.id,
            b.status,
            b.payment_status,
            b.deposit_amount,
            p.city_id,
            c.name AS city_name
        FROM public.bookings b
        JOIN public.resources r ON b.resource_id = r.id
        JOIN public.providers p ON r.provider_id = p.id
        JOIN public.cities c ON p.city_id = c.id
        WHERE b.created_at >= v_start_time
          AND (p_city_id IS NULL OR p.city_id = p_city_id)
    ),
    city_density AS (
        SELECT 
            city_id,
            city_name,
            COUNT(*) AS booking_count,
            COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed_count,
            COALESCE(SUM(deposit_amount) FILTER (WHERE payment_status IN ('CAPTURED', 'FORFEITED')), 0) AS total_revenue
        FROM filtered_bookings
        GROUP BY city_id, city_name
    ),
    hourly_trends AS (
        SELECT 
            to_char(date_trunc('hour', b.created_at), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS hour_bucket,
            COUNT(*) AS booking_velocity
        FROM public.bookings b
        JOIN public.resources r ON b.resource_id = r.id
        JOIN public.providers p ON r.provider_id = p.id
        WHERE b.created_at >= v_start_time
          AND (p_city_id IS NULL OR p.city_id = p_city_id)
        GROUP BY date_trunc('hour', b.created_at)
        ORDER BY date_trunc('hour', b.created_at) ASC
    )
    SELECT jsonb_build_object(
        'window', p_time_window,
        'city_id', p_city_id,
        'total_bookings', (SELECT COUNT(*) FROM filtered_bookings),
        'total_revenue', (SELECT COALESCE(SUM(deposit_amount) FILTER (WHERE payment_status IN ('CAPTURED', 'FORFEITED')), 0) FROM filtered_bookings),
        'by_city', COALESCE((SELECT jsonb_agg(row_to_json(cd)) FROM city_density cd), '[]'::JSONB),
        'velocity_trend', COALESCE((SELECT jsonb_agg(row_to_json(ht)) FROM hourly_trends ht), '[]'::JSONB)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_velocity_analytics(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_velocity_analytics(TEXT, TEXT) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8b. LOCK DOWN admin_fetch_merchants: ADMIN ONLY, REVOKE FROM ANON
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_fetch_merchants(p_city_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  -- Restrict access to authenticated platform administrator or service_role
  IF auth.role() != 'service_role' AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access Denied: Administrator authority required to view merchant records' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(p.*) || jsonb_build_object(
        'categories', (
          SELECT jsonb_build_object('name', c.name)
          FROM public.categories c
          WHERE c.id = p.category_id
        ),
        'resources', jsonb_build_array(
          jsonb_build_object(
            'count', (
              SELECT count(*)::int
              FROM public.resources r
              WHERE r.provider_id = p.id
            )
          )
        )
      )
      ORDER BY p.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_res
  FROM public.providers p
  WHERE (p_city_id IS NULL OR p_city_id = 'all' OR p.city_id = p_city_id);

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_fetch_merchants(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fetch_merchants(text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8c. HARDEN admin_update_provider_operational_settings: REMOVE BACKDOOR TOKEN
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_update_provider_operational_settings(uuid, boolean, boolean, integer, text);

CREATE OR REPLACE FUNCTION public.admin_update_provider_operational_settings(
  p_provider_id uuid,
  p_is_active boolean DEFAULT NULL,
  p_auto_accept boolean DEFAULT NULL,
  p_daily_limit integer DEFAULT NULL,
  p_admin_token text DEFAULT '',
  p_weekly_hours jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Backdoors removed: Must be service_role, admin, or authorized provider manager
  IF NOT (
    auth.role() = 'service_role'
    OR public.is_admin(auth.uid())
    OR (auth.uid() IS NOT NULL AND p_provider_id IN (SELECT public.get_user_authorized_providers(auth.uid())))
  ) THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to modify provider operational settings' USING ERRCODE = '42501';
  END IF;

  UPDATE public.providers
  SET is_active = COALESCE(p_is_active, is_active),
      auto_accept_bookings = COALESCE(p_auto_accept, auto_accept_bookings),
      daily_booking_limit = COALESCE(p_daily_limit, daily_booking_limit),
      weekly_hours = COALESCE(p_weekly_hours, weekly_hours),
      updated_at = now()
  WHERE id = p_provider_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Provider not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_provider_operational_settings(uuid, boolean, boolean, integer, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_provider_operational_settings(uuid, boolean, boolean, integer, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_update_merchant_status(
  p_provider_id uuid,
  p_status text,
  p_admin_token text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() != 'service_role' AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access Denied: Administrator authority required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.providers
  SET status = p_status::provider_status,
      updated_at = now()
  WHERE id = p_provider_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Provider not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_merchant_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_merchant_status(uuid, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. PUBLIC DIRECTORY & RLS FUNCTIONS PERMISSIONS
-- ─────────────────────────────────────────────────────────────────────────────
-- RLS policies invoke is_admin() and get_user_authorized_providers() under the querying role (including anon).
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_authorized_providers(uuid) TO anon, authenticated, service_role;

-- Public marketplace directory functions required for unauthenticated discovery
GRANT EXECUTE ON FUNCTION public.get_active_cities(boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_directory(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_nearby_providers(numeric, numeric, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_provider_details(uuid) TO anon, authenticated, service_role;

-- Restrict merchant bookings retrieval to authenticated users and service_role
REVOKE ALL ON FUNCTION public.get_merchant_bookings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_merchant_bookings(uuid) TO authenticated, service_role;

-- Restrict admin entity provisioning to authenticated administrators
REVOKE ALL ON FUNCTION public.admin_create_venue(text, text, text, text, time without time zone, time without time zone, text, text, uuid, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_resource(uuid, text, text, text, numeric, numeric, integer, integer, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_user(text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_resource(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_venue(text, text, text, text, time without time zone, time without time zone, text, text, uuid, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_resource(uuid, text, text, text, numeric, numeric, integer, integer, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_resource(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. SERVICE ROLE / POSTGRES STRICT ONLY PROCEDURES
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.check_and_send_booking_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_send_booking_reminders() TO service_role;

REVOKE ALL ON FUNCTION public.set_booking_slot_for_reminder(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_booking_slot_for_reminder(UUID, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.log_admin_action(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_admin_action(TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. TABLE WRITE SURFACE LOCKDOWN
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON public.account_deletion_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.admin_audit_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.bookings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.categories FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.cities FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.city_settlements FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.city_waitlist FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.contact_reveal_audit FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.merchant_memberships FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.notification_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.platform_config FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.providers FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.resource_availability FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.resources FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.sub_categories FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.user_consents FROM anon;

-- Revoke client writes from authenticated on sensitive financial, audit, and platform tables
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.platform_config FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.admin_audit_logs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.city_settlements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cities FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.notification_logs FROM authenticated;
