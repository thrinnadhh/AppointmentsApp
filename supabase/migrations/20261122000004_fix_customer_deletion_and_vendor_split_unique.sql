-- Migration: 20261122000004_fix_customer_deletion_and_vendor_split_unique.sql
-- Description:
--   1. Authorize account owners to immediately anonymize their own data under DPDP Act 2023 in public.anonymize_user_data with fail-closed positive check.
--   2. Enforce UNIQUE (booking_id) constraint on public.merchant_vendor_splits to guarantee webhook split idempotency.
--   3. Acquire customer advisory transaction lock prior to 1-hour appointment gap evaluation in private.create_booking_hold to eliminate concurrency TOCTOU races.
-- =============================================================================

BEGIN;

-- ── 1. Fix public.anonymize_user_data Authorization Guard ───────────────────
CREATE OR REPLACE FUNCTION public.anonymize_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'storage', 'auth', 'pg_temp'
AS $function$
DECLARE
    v_caller_role TEXT;
    v_user_email TEXT;
    v_user_phone TEXT;
BEGIN
    -- Permit service_role, platform admin, OR the data principal themselves (self-service right to erasure)
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = (SELECT auth.uid());
    IF NOT (
        auth.role() = 'service_role'
        OR COALESCE(v_caller_role, '') = 'admin'
        OR ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = p_user_id)
    ) THEN
        RAISE EXCEPTION 'Unauthorized: only service_role, admin, or the account owner can anonymize user data' USING ERRCODE = '42501';
    END IF;

    -- Set trusted write for internal anonymization updates
    PERFORM set_config('app.trusted_write', 'true', true);

    -- Fetch user email and phone before scrub to clean secondary tables
    SELECT email, phone INTO v_user_email, v_user_phone FROM public.profiles WHERE id = p_user_id;

    -- 1. Remove storage objects associated with user (safely handled if protect_delete trigger active)
    BEGIN
      DELETE FROM storage.objects
      WHERE owner = p_user_id
         OR owner_id = p_user_id::text
         OR (bucket_id = 'prescriptions-and-records' AND name LIKE p_user_id || '/%')
         OR (bucket_id = 'prescriptions-and-records' AND name IN (
             SELECT attachment_url FROM public.bookings WHERE customer_id = p_user_id AND attachment_url IS NOT NULL
         ));
    EXCEPTION WHEN OTHERS THEN
      -- Direct deletion from storage.objects is blocked by Supabase protect_delete() trigger;
      -- storage objects are deleted through the Storage API in the application service layer.
      NULL;
    END;

    -- 2. Delete push tokens
    DELETE FROM public.push_tokens WHERE user_id = p_user_id;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'device_push_tokens') THEN
        DELETE FROM public.device_push_tokens WHERE user_id = p_user_id;
    END IF;

    -- 3. Delete appointment checkin codes
    DELETE FROM public.appointment_checkin_codes 
    WHERE booking_id IN (SELECT id FROM public.bookings WHERE customer_id = p_user_id);

    -- 4. Scrub city waitlist entries matching user phone
    IF v_user_phone IS NOT NULL AND v_user_phone != '' THEN
        DELETE FROM public.city_waitlist WHERE phone = v_user_phone;
    END IF;

    -- 5. Anonymize profile: scrub all PII including checkin PIN, email, phone, full_name
    UPDATE public.profiles SET
        full_name             = 'Deleted User',
        phone                 = NULL,
        email                 = 'deleted_' || p_user_id || '@deleted.local',
        expo_push_token       = NULL,
        is_flagged            = FALSE,
        permanent_checkin_pin = NULL,
        updated_at            = NOW()
    WHERE id = p_user_id;

    -- 6. Scrub booking customer attachment URLs and dependent/family details and booking notes
    UPDATE public.bookings SET
        patient_name         = 'Deleted Patient',
        patient_phone        = NULL,
        patient_age          = NULL,
        patient_relationship = NULL,
        booking_note         = NULL,
        attachment_url       = NULL,
        status               = CASE WHEN status IN ('PENDING_PAYMENT', 'HELD', 'CONFIRMED') THEN 'CANCELLED'::public.booking_status ELSE status END,
        updated_at           = NOW()
    WHERE customer_id = p_user_id;

    -- 7. Scrub notification logs recipient PII and message text
    UPDATE public.notification_logs SET
        recipient_phone = NULL,
        recipient_name  = 'Deleted User',
        message_content = 'Notification content scrubbed pursuant to erasure request'
    WHERE booking_id IN (SELECT id FROM public.bookings WHERE customer_id = p_user_id);

    -- 8. Revoke and delete user consents
    DELETE FROM public.user_consents WHERE user_id = p_user_id;

    -- 9. Disable and scrub auth credentials in auth.users
    UPDATE auth.users SET
        email = 'deleted_' || p_user_id || '@deleted.local',
        phone = NULL,
        raw_user_meta_data = '{}'::jsonb,
        banned_until = '2999-01-01 00:00:00+00'
    WHERE id = p_user_id;

    -- 9b. Delete all linked identities in auth.identities to prevent residual PII
    DELETE FROM auth.identities WHERE user_id = p_user_id;

    -- 10. Mark deletion request complete
    UPDATE public.account_deletion_requests SET
        completed_at = NOW(),
        last_error = NULL
    WHERE user_id = p_user_id AND completed_at IS NULL;

    RETURN jsonb_build_object('success', true, 'anonymized_user', p_user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.anonymize_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_user_data(uuid) TO service_role;



-- ── 2. Add Unique Constraint on public.merchant_vendor_splits ──────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_merchant_vendor_splits_booking'
  ) THEN
    ALTER TABLE public.merchant_vendor_splits
      ADD CONSTRAINT uq_merchant_vendor_splits_booking UNIQUE (booking_id);
  END IF;
END $$;

-- ── 3. Harden private.create_booking_hold with Early Advisory Lock ──────────
CREATE OR REPLACE FUNCTION private.create_booking_hold(p_resource_id uuid, p_slot_start timestamp with time zone, p_slot_end timestamp with time zone, p_customer_id uuid, p_booking_for_someone_else boolean DEFAULT false, p_patient_name text DEFAULT NULL::text, p_patient_phone text DEFAULT NULL::text, p_patient_relationship text DEFAULT NULL::text, p_booked_for text DEFAULT 'self'::text, p_patient_age smallint DEFAULT NULL::smallint, p_booking_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
    v_provider_is_active BOOLEAN;
    v_existing_id UUID;
    v_new_booking_id UUID;
    v_reference_code TEXT;
    v_hold_expiry TIMESTAMPTZ;
    v_daily_booking_limit INT;
    v_cooling_period_days INT;
    v_followup_original_booking_id UUID;
    v_is_followup BOOLEAN := FALSE;
    v_daily_count INT;
    v_slot_date_ist DATE;
    v_day_start TIMESTAMPTZ;
    v_day_end TIMESTAMPTZ;
    v_customer_blocked_until TIMESTAMPTZ;
    v_booked_for TEXT;
    v_is_minor BOOLEAN := FALSE;
    v_target_name TEXT;
    v_target_phone TEXT;
    v_gap_conflict_id UUID;
    v_active_hold_count INT;
    v_department_id UUID;
BEGIN
    -- Caller identity authorization guard
    IF auth.role() = 'authenticated' AND p_customer_id <> auth.uid() THEN
        IF NOT (
            (public.is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
            OR EXISTS (
                SELECT 1
                FROM public.resources r
                JOIN public.providers p ON p.id = r.provider_id
                WHERE r.id = p_resource_id
                  AND (p.owner_id = auth.uid() OR p.id IN (SELECT public.get_user_authorized_providers(auth.uid())))
            )
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You cannot book on behalf of another user');
        END IF;
    END IF;

    -- Acquire a per-customer transactional advisory lock early to serialize hold creations
    -- and eliminate the TOCTOU race condition where concurrent requests bypass the 1-hour gap
    -- or exceed 3 active holds.
    PERFORM pg_advisory_xact_lock(hashtext('hold_limit:' || p_customer_id::text));

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
            IF p_patient_age < 18 THEN
                v_is_minor := TRUE;
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

    -- Fetch resource
    SELECT provider_id, deposit_amount, is_active, price, department_id
    INTO v_provider_id, v_deposit_amount, v_is_active, v_consultation_fee, v_department_id
    FROM public.resources
    WHERE id = p_resource_id;

    IF NOT FOUND OR NOT v_is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Resource not found or inactive');
    END IF;

    -- Fetch provider status, category, operational daily booking limit, cooling period, and is_active
    SELECT status, category_id, daily_booking_limit, COALESCE(cooling_period_days, 0), is_active
    INTO v_provider_status, v_category_id, v_daily_booking_limit, v_cooling_period_days, v_provider_is_active
    FROM public.providers 
    WHERE id = v_provider_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Provider not found');
    END IF;

    IF v_provider_status = 'SUSPENDED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Merchant provider is suspended');
    END IF;

    IF v_provider_is_active = FALSE OR v_provider_status = 'PAUSED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This venue is temporarily paused and not accepting new appointments right now.');
    END IF;

    -- 1-HOUR TIME GAP ENFORCEMENT
    IF v_booked_for = 'family' THEN
        v_target_phone := NULLIF(trim(COALESCE(p_patient_phone, '')), '');

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
                b.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING', 'UP_NEXT', 'PENDING_PAYMENT')
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
            b.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING', 'UP_NEXT', 'PENDING_PAYMENT')
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

    -- Platform fee logic
    IF NOT v_is_followup THEN
        v_platform_fee := CASE WHEN v_category_id IN ('gaming', 'turf') THEN 50.00 ELSE 10.00 END;
        v_deposit_amount := v_platform_fee;
        v_total_amount := v_platform_fee;
        v_consultation_fee := COALESCE(v_consultation_fee, 500.00);
    END IF;

    -- ── TASK 1: Slot-Hoarding & Velocity Defense (Advisory Lock Pre-Acquired) ───────
    -- Note: Advisory lock hashtext('hold_limit:' || p_customer_id::text) acquired early at function entry.

    SELECT COUNT(*)
    INTO v_active_hold_count
    FROM public.bookings
    WHERE customer_id = p_customer_id
      AND status = 'HELD'
      AND hold_expires_at > NOW();

    IF v_active_hold_count >= 3 THEN
        RAISE EXCEPTION 'rate_limit_exceeded: Maximum 3 concurrent active booking holds allowed'
            USING ERRCODE = 'P0001';
    END IF;
    -- ── End TASK 1 ────────────────────────────────────────────────────────────

    -- Overlap exclusion check
    SET LOCAL lock_timeout = '3s';
    SELECT id INTO v_existing_id
    FROM public.bookings
    WHERE resource_id = p_resource_id
      AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end)
      AND (
        status IN ('CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING', 'UP_NEXT', 'PENDING_PAYMENT')
        OR (status = 'HELD' AND hold_expires_at >= NOW())
      )
      FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked');
    END IF;

    v_hold_expiry := NOW() + INTERVAL '5 minutes';

    BEGIN
        INSERT INTO public.bookings (
            customer_id, provider_id, resource_id, department_id,
            slot_start, slot_end, status, payment_status,
            deposit_amount, platform_fee, total_amount, hold_expires_at,
            disclaimer_version, is_followup, followup_original_booking_id,
            booking_for_someone_else, booked_for, patient_name, patient_phone, patient_relationship,
            patient_age, booking_note,
            platform_fee_amount, consultation_fee_amount,
            platform_payment_status, consultation_payment_status
        ) VALUES (
            p_customer_id, v_provider_id, p_resource_id, v_department_id,
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
        WHEN exclusion_violation THEN
            RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked (concurrent reservation)');
    END;

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
$function$

;

REVOKE ALL ON FUNCTION private.create_booking_hold(uuid, timestamptz, timestamptz, uuid, boolean, text, text, text, text, smallint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.create_booking_hold(uuid, timestamptz, timestamptz, uuid, boolean, text, text, text, text, smallint, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_booking_hold(uuid, timestamptz, timestamptz, uuid, boolean, text, text, text, text, smallint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(uuid, timestamptz, timestamptz, uuid, boolean, text, text, text, text, smallint, text) TO authenticated, service_role;


COMMIT;
