-- Migration: 20261026190000_split_payment_platform_fee_and_consultation_fee.sql
-- Description: Split Hospital Booking Payment Workflow:
--              1. Online payment pays ONLY platform fee to reserve slot / seat.
--              2. Doctor's consultation fee is paid offline directly at the hospital reception desk.
--              3. Track platform_fee_amount, consultation_fee_amount, platform_payment_status, and consultation_payment_status.

-- 1. Add split payment columns to public.bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS platform_fee_amount NUMERIC(10, 2) DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS consultation_fee_amount NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS platform_payment_status TEXT DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS consultation_payment_status TEXT DEFAULT 'PENDING_OFFLINE',
  ADD COLUMN IF NOT EXISTS consultation_collected_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS consultation_collected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_platform_payment_status_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_platform_payment_status_check
      CHECK (platform_payment_status IN ('PENDING', 'CAPTURED', 'REFUNDED', 'WAIVED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_consultation_payment_status_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_consultation_payment_status_check
      CHECK (consultation_payment_status IN ('PENDING_OFFLINE', 'COLLECTED_AT_DESK', 'WAIVED', 'REFUNDED'));
  END IF;
END $$;

-- 2. Backfill existing bookings
UPDATE public.bookings
SET platform_fee_amount = COALESCE(platform_fee, 10.00),
    consultation_fee_amount = COALESCE(total_amount, 0.00),
    platform_payment_status = CASE 
      WHEN payment_status = 'CAPTURED' THEN 'CAPTURED'
      WHEN payment_status = 'REFUNDED' THEN 'REFUNDED'
      ELSE 'PENDING'
    END,
    consultation_payment_status = CASE
      WHEN status IN ('IN_CONSULTATION', 'COMPLETED') THEN 'COLLECTED_AT_DESK'
      ELSE 'PENDING_OFFLINE'
    END
WHERE platform_fee_amount IS NULL OR consultation_payment_status IS NULL;

-- 3. Update create_booking_hold RPC to compute split payment fees
CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id uuid,
    p_slot_start timestamp with time zone,
    p_slot_end timestamp with time zone,
    p_customer_id uuid,
    p_booking_for_someone_else boolean DEFAULT false,
    p_patient_name text DEFAULT NULL,
    p_patient_phone text DEFAULT NULL,
    p_patient_relationship text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
    v_customer_phone TEXT;
    v_customer_name TEXT;
    v_target_phone TEXT;
    v_target_name TEXT;
    v_gap_conflict_id UUID;
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

    -- ACCOUNT BLOCK ENFORCEMENT
    SELECT blocked_until, phone, full_name
    INTO v_customer_blocked_until, v_customer_phone, v_customer_name
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
    IF COALESCE(p_booking_for_someone_else, false) THEN
        v_target_phone := NULLIF(trim(COALESCE(p_patient_phone, '')), '');
        v_target_name := NULLIF(trim(COALESCE(p_patient_name, '')), '');

        IF v_target_phone IS NOT NULL THEN
            SELECT b.id INTO v_gap_conflict_id
            FROM public.bookings b
            WHERE b.customer_id = p_customer_id
              AND b.booking_for_someone_else = TRUE
              AND b.patient_phone = v_target_phone
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
                'error', 'Appointments for the same patient must be at least 1 hour apart. To book for a family member or friend, select ''Booking for someone else''.'
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
        -- Online charge = only the platform fee
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
            booking_for_someone_else, patient_name, patient_phone, patient_relationship,
            platform_fee_amount, consultation_fee_amount,
            platform_payment_status, consultation_payment_status
        ) VALUES (
            p_customer_id, v_provider_id, p_resource_id,
            p_slot_start, p_slot_end, 'HELD', 'PENDING',
            v_deposit_amount, v_platform_fee, v_total_amount, v_hold_expiry,
            'v1', v_is_followup, v_followup_original_booking_id,
            COALESCE(p_booking_for_someone_else, false),
            v_target_name,
            v_target_phone,
            p_patient_relationship,
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
        'booking_for_someone_else',      COALESCE(p_booking_for_someone_else, false),
        'patient_name',                 v_target_name
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 4. Update confirm_booking_payment RPC with split payment status
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

  -- Anti-Replay Guard: Immediately check if gateway_payment_id is already assigned to a different booking
  IF p_gateway_payment_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.payments
      WHERE gateway_payment_id = p_gateway_payment_id
        AND booking_id <> p_booking_id
    ) OR EXISTS (
      SELECT 1 FROM public.bookings
      WHERE gateway_payment_id = p_gateway_payment_id
        AND id <> p_booking_id
    )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payment identifier has already been used for another booking'
    );
  END IF;

  -- Lock the target booking row for update
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Idempotency check: If already confirmed with this identical payment ID, return idempotent success
  IF v_booking.status = 'CONFIRMED' AND v_booking.gateway_payment_id = p_gateway_payment_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'booking_id', p_booking_id,
      'status', 'CONFIRMED',
      'payment_status', 'CAPTURED',
      'platform_payment_status', 'CAPTURED',
      'consultation_payment_status', v_booking.consultation_payment_status,
      'idempotent', true
    );
  END IF;

  IF v_booking.status NOT IN ('HELD', 'PENDING_PAYMENT') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not in a payable state');
  END IF;

  v_amount := COALESCE(p_deposit_amount, v_booking.deposit_amount, v_booking.platform_fee_amount, 10.00);

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CONFIRMED',
      payment_status = 'CAPTURED',
      platform_payment_status = 'CAPTURED',
      consultation_payment_status = 'PENDING_OFFLINE',
      gateway_payment_id = p_gateway_payment_id,
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- Record payment with unique violation handling
  BEGIN
    INSERT INTO public.payments (
      booking_id, gateway_payment_id, amount, currency, status
    ) VALUES (
      p_booking_id, p_gateway_payment_id, v_amount, 'INR', 'CAPTURED'
    );
  EXCEPTION WHEN unique_violation THEN
    IF EXISTS (
      SELECT 1 FROM public.payments
      WHERE gateway_payment_id = p_gateway_payment_id
        AND booking_id <> p_booking_id
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Payment identifier has already been used for another booking'
      );
    END IF;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'CONFIRMED',
    'payment_status', 'CAPTURED',
    'platform_payment_status', 'CAPTURED',
    'consultation_payment_status', 'PENDING_OFFLINE'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_booking_payment(UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_payment(UUID, TEXT, NUMERIC) TO service_role;

-- 5. RPC: collect_consultation_fee for Front Desk / Reception
CREATE OR REPLACE FUNCTION public.collect_consultation_fee(
    p_booking_id UUID,
    p_collected_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_staff_id UUID;
BEGIN
    v_staff_id := COALESCE(p_collected_by, auth.uid());

    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    IF v_booking.status = 'CANCELLED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot collect consultation fee on cancelled booking');
    END IF;

    PERFORM set_config('app.trusted_write', 'true', true);

    UPDATE public.bookings
    SET consultation_payment_status = 'COLLECTED_AT_DESK',
        consultation_collected_at = NOW(),
        consultation_collected_by = v_staff_id,
        updated_at = NOW()
    WHERE id = p_booking_id;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'consultation_payment_status', 'COLLECTED_AT_DESK',
        'consultation_fee_amount', v_booking.consultation_fee_amount
    );
END;
$$;

REVOKE ALL ON FUNCTION public.collect_consultation_fee(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_consultation_fee(UUID, UUID) TO authenticated, service_role;

-- 6. Update merchant_bookings view with split payment fields
DROP VIEW IF EXISTS public.merchant_bookings CASCADE;
CREATE VIEW public.merchant_bookings WITH (security_invoker = true) AS
 SELECT b.id,
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
    b.platform_fee_amount,
    b.consultation_fee_amount,
    b.platform_payment_status,
    b.consultation_payment_status,
    b.consultation_collected_at,
    b.consultation_collected_by,
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
    COALESCE(c.customer_name, 'Walk-in / Guest'::text) AS customer_name,
    COALESCE(c.customer_phone, 'Not provided'::text) AS customer_phone,
    COALESCE(c.no_show_count, 0) AS no_show_count,
    COALESCE(r.name, 'Standard Unit'::text) AS resource_name,
    COALESCE(r.type, 'slot'::text) AS resource_type,
    COALESCE(p.name, 'Merchant Venue'::text) AS provider_name,
    b.department_id,
    COALESCE(dept.name, 'General Medicine'::text) AS department_name,
    b.queue_position,
    b.estimated_wait_minutes,
    b.checked_in_at,
    b.checked_in_method,
    b.is_followup,
    b.followup_original_booking_id,
    b.booking_for_someone_else,
    b.patient_name,
    CASE
      WHEN b.patient_phone IS NOT NULL AND trim(b.patient_phone) != '' THEN public.mask_customer_phone(b.patient_phone)
      ELSE NULL
    END AS patient_phone,
    b.patient_relationship,
    b.emergency_cancelled,
    b.emergency_doctor_arrived,
    b.emergency_patient_choice
   FROM bookings b
     LEFT JOIN LATERAL get_masked_customer_info(b.customer_id) c(customer_name, customer_phone, no_show_count) ON true
     LEFT JOIN resources r ON r.id = b.resource_id
     LEFT JOIN providers p ON p.id = b.provider_id
     LEFT JOIN departments dept ON dept.id = b.department_id
  WHERE (current_user = 'postgres')
     OR (b.provider_id IN ( SELECT get_user_authorized_providers(auth.uid()) AS get_user_authorized_providers))
     OR (b.provider_id IN ( SELECT department_members.merchant_id
           FROM department_members
          WHERE department_members.user_id = auth.uid() AND department_members.status = 'active'::text))
     OR is_admin(auth.uid());

GRANT SELECT ON public.merchant_bookings TO authenticated, anon;

