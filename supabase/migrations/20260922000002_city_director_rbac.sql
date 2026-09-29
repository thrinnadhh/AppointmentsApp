-- Migration: 20260922000002_city_director_rbac.sql
-- Adds city_director role, city assignment on profiles, city-scoped analytics RPC,
-- city_settlements profit-share audit table, and merchant ToS acceptance tracking.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EXTEND user_role ENUM with city_director
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'city_director';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ADD assigned_city_id to profiles (city directors get one city assigned)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS assigned_city_id TEXT REFERENCES public.cities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_assigned_city ON public.profiles (assigned_city_id)
    WHERE assigned_city_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CITY-SCOPED ANALYTICS RPC (city_director sees ONLY their city; admin sees all)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_city_director_stats(
    p_from  DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::DATE,
    p_until DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid       UUID := (SELECT auth.uid());
    v_role      TEXT;
    v_city_id   TEXT;
BEGIN
    SELECT role, assigned_city_id INTO v_role, v_city_id
    FROM public.profiles
    WHERE id = v_uid;

    IF v_role NOT IN ('city_director', 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: city_director or admin role required';
    END IF;

    -- admin: v_city_id stays NULL → no city filter (sees all)
    -- city_director: v_city_id is enforced → only their city
    IF v_role = 'city_director' AND v_city_id IS NULL THEN
        RAISE EXCEPTION 'City director has no assigned city. Contact your administrator.';
    END IF;

    RETURN (
        SELECT jsonb_build_object(
            'city_id',              COALESCE(v_city_id, 'all'),
            'period_start',         p_from,
            'period_end',           p_until,
            'total_bookings',       COUNT(*),
            'confirmed_bookings',   COUNT(*) FILTER (WHERE b.status = 'CONFIRMED'),
            'completed_bookings',   COUNT(*) FILTER (WHERE b.status = 'COMPLETED'),
            'cancelled_bookings',   COUNT(*) FILTER (WHERE b.status = 'CANCELLED'),
            'gross_platform_revenue', COALESCE(SUM(b.platform_fee) FILTER (
                                        WHERE b.payment_status = 'CAPTURED'), 0),
            'active_merchants',     COUNT(DISTINCT b.provider_id)
        )
        FROM public.bookings b
        JOIN public.providers p ON b.provider_id = p.id
        WHERE b.created_at::date BETWEEN p_from AND p_until
          AND (v_city_id IS NULL OR p.city_id = v_city_id)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_city_director_stats(DATE, DATE) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_city_director_stats(DATE, DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CITY SETTLEMENTS — immutable monthly profit-share ledger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.city_settlements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id         TEXT NOT NULL REFERENCES public.cities(id),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,

    -- Revenue components (all in INR)
    gross_revenue   NUMERIC(12, 2) NOT NULL DEFAULT 0,  -- SUM(platform_fee) CAPTURED
    gateway_fees    NUMERIC(12, 2) NOT NULL DEFAULT 0,  -- from Razorpay settlement report
    platform_alloc  NUMERIC(12, 2) NOT NULL DEFAULT 0,  -- monthly tech cost per city
    refunds         NUMERIC(12, 2) NOT NULL DEFAULT 0,  -- chargebacks + refunds

    -- Computed columns (cannot be tampered)
    net_revenue     NUMERIC(12, 2) GENERATED ALWAYS AS
                        (gross_revenue - gateway_fees - platform_alloc - refunds) STORED,
    director_share  NUMERIC(12, 2) GENERATED ALWAYS AS
                        (GREATEST(0, (gross_revenue - gateway_fees - platform_alloc - refunds) * 0.40)) STORED,
    founders_share  NUMERIC(12, 2) GENERATED ALWAYS AS
                        (GREATEST(0, (gross_revenue - gateway_fees - platform_alloc - refunds) * 0.60)) STORED,

    status          TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'APPROVED', 'PAID')),
    approved_by     UUID REFERENCES auth.users(id),
    approved_at     TIMESTAMPTZ,
    paid_at         TIMESTAMPTZ,
    payment_ref     TEXT,          -- NEFT/IMPS transaction reference
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (city_id, period_start, period_end)
);

-- Only admins can insert/update settlements
ALTER TABLE public.city_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage settlements" ON public.city_settlements
    FOR ALL USING (public.is_admin());
CREATE POLICY "City directors view own settlement" ON public.city_settlements
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = (SELECT auth.uid())
              AND role::text = 'city_director'
              AND assigned_city_id = city_id
        )
    );

GRANT SELECT ON public.city_settlements TO authenticated;
GRANT INSERT, UPDATE ON public.city_settlements TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. MERCHANT ToS ACCEPTANCE TRACKING
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.providers
    ADD COLUMN IF NOT EXISTS tos_accepted_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS tos_version       TEXT DEFAULT '1.0',
    ADD COLUMN IF NOT EXISTS grievance_notified BOOLEAN DEFAULT FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ₹100 MINIMUM DEPOSIT FLOOR on create_booking_hold
--    Ensures Razorpay's minimum ₹2 fee never exceeds 20% of platform fee
-- ─────────────────────────────────────────────────────────────────────────────
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
    -- Auto-clean expired holds first
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

    -- ► ENFORCE ₹100 MINIMUM DEPOSIT (keeps Razorpay fee < 4% of deposit)
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

    -- Conflict check with 3-second lock timeout (prevents long waits)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. QUEUE / TOKEN SYSTEM for clinic vertical
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS queue_position        INT,
    ADD COLUMN IF NOT EXISTS estimated_wait_minutes INT;

-- Trigger: assign sequential queue position for clinic bookings on confirmation
CREATE OR REPLACE FUNCTION public.assign_clinic_queue_position()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_category_id TEXT;
    v_pos         INT;
BEGIN
    IF NEW.status = 'CONFIRMED' AND OLD.status != 'CONFIRMED' THEN
        -- Check if this is a clinic booking
        SELECT p.category_id INTO v_category_id
        FROM public.providers p WHERE p.id = NEW.provider_id;

        IF v_category_id = 'clinic' OR v_category_id ILIKE '%clinic%' OR v_category_id ILIKE '%doctor%' THEN
            SELECT COUNT(*) + 1 INTO v_pos
            FROM public.bookings
            WHERE resource_id  = NEW.resource_id
              AND slot_start::date = NEW.slot_start::date
              AND status IN ('CONFIRMED', 'COMPLETED')
              AND id != NEW.id;

            NEW.queue_position        := v_pos;
            NEW.estimated_wait_minutes := (v_pos - 1) * COALESCE(
                (SELECT duration_minutes FROM public.resources WHERE id = NEW.resource_id),
                15
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_clinic_queue_position ON public.bookings;
CREATE TRIGGER tg_clinic_queue_position
    BEFORE UPDATE ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.assign_clinic_queue_position();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. CITY_WAITLIST — add consent gate and auto-purge after 90 days
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.city_waitlist
    ADD COLUMN IF NOT EXISTS consent_given     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS consent_timestamp TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS purge_after       DATE
        GENERATED ALWAYS AS ((timezone('UTC', created_at)::date + 90)) STORED;

-- Cron-style cleanup function (call from pg_cron or external scheduler)
CREATE OR REPLACE FUNCTION public.purge_expired_waitlist_entries()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INT;
BEGIN
    DELETE FROM public.city_waitlist
    WHERE purge_after < CURRENT_DATE
    RETURNING 1 INTO v_count;
    RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_expired_waitlist_entries() TO service_role;
