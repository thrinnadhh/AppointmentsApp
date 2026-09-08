-- Hyperlocal Booking Platform MVP v1 Schema
-- Database: PostgreSQL on Supabase

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUMS
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('customer', 'merchant', 'admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE provider_status AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE booking_status AS ENUM ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('PENDING', 'CAPTURED', 'REFUNDED', 'FORFEITED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. USER PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    phone TEXT UNIQUE,
    full_name TEXT,
    role user_role NOT NULL DEFAULT 'customer',
    no_show_count INT NOT NULL DEFAULT 0,
    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. CATEGORIES & SUB-CATEGORIES
CREATE TABLE IF NOT EXISTS public.categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    display_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.sub_categories (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    display_order INT NOT NULL DEFAULT 0
);

-- 5. PROVIDERS (BUSINESSES)
CREATE TABLE IF NOT EXISTS public.providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    category_id TEXT NOT NULL REFERENCES public.categories(id),
    sub_category_id TEXT REFERENCES public.sub_categories(id),
    name TEXT NOT NULL,
    description TEXT,
    address TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT 'Tirupati',
    latitude NUMERIC(10, 7) NOT NULL,
    longitude NUMERIC(10, 7) NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    opening_time TIME NOT NULL DEFAULT '09:00:00',
    closing_time TIME NOT NULL DEFAULT '21:00:00',
    photos TEXT[] DEFAULT '{}',
    status provider_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. RESOURCES (DOCTORS, TABLES, COURTS, STYLISTS, VETS)
CREATE TABLE IF NOT EXISTS public.resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'doctor', 'table', 'court', 'stylist', 'groomer', 'vet'
    duration_minutes INT NOT NULL DEFAULT 30,
    capacity INT NOT NULL DEFAULT 1,
    deposit_amount NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. RESOURCE AVAILABILITY (WEEKLY SCHEDULE)
CREATE TABLE IF NOT EXISTS public.resource_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id UUID NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 1=Mon, ..., 6=Sat
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_interval_minutes INT NOT NULL DEFAULT 30,
    CONSTRAINT check_avail_times CHECK (start_time < end_time)
);

-- 8. BOOKINGS
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
    slot_start TIMESTAMPTZ NOT NULL,
    slot_end TIMESTAMPTZ NOT NULL,
    status booking_status NOT NULL DEFAULT 'HELD',
    payment_status payment_status NOT NULL DEFAULT 'PENDING',
    deposit_amount NUMERIC(10, 2) NOT NULL,
    hold_expires_at TIMESTAMPTZ,
    gateway_payment_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT check_booking_times CHECK (slot_start < slot_end)
);

-- CONCURRENCY GUARD: No two overlapping active bookings for the same resource slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_resource_slot 
ON public.bookings(resource_id, slot_start) 
WHERE status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED');

-- 9. PAYMENTS LEDGER
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    gateway_payment_id TEXT,
    amount NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    status payment_status NOT NULL DEFAULT 'PENDING',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. INDEXES FOR FAST QUERYING
CREATE INDEX IF NOT EXISTS idx_providers_category ON public.providers(category_id, sub_category_id);
CREATE INDEX IF NOT EXISTS idx_providers_status ON public.providers(status);
CREATE INDEX IF NOT EXISTS idx_resources_provider ON public.resources(provider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON public.bookings(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_provider ON public.bookings(provider_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_bookings_hold_expiry ON public.bookings(hold_expires_at) WHERE status = 'HELD';

-- 11. ATOMIC STORED PROCEDURES

-- Atomic Hold Creation with 5-minute Hold Window
CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id UUID,
    p_slot_start TIMESTAMPTZ,
    p_slot_end TIMESTAMPTZ,
    p_customer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_provider_id UUID;
    v_deposit_amount NUMERIC(10, 2);
    v_is_active BOOLEAN;
    v_existing_booking_id UUID;
    v_new_booking_id UUID;
    v_hold_expiry TIMESTAMPTZ;
BEGIN
    -- 1. Auto-clean expired holds
    UPDATE public.bookings
    SET status = 'CANCELLED', updated_at = NOW()
    WHERE status = 'HELD' AND hold_expires_at < NOW();

    -- 2. Verify resource exists and active
    SELECT provider_id, deposit_amount, is_active 
    INTO v_provider_id, v_deposit_amount, v_is_active
    FROM public.resources
    WHERE id = p_resource_id;

    IF NOT FOUND OR NOT v_is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Resource not found or inactive');
    END IF;

    -- 3. Check for conflict
    SELECT id INTO v_existing_booking_id
    FROM public.bookings
    WHERE resource_id = p_resource_id
      AND slot_start = p_slot_start
      AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
    FOR UPDATE;

    IF v_existing_booking_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked by another customer');
    END IF;

    -- 4. Calculate hold expiry (5 minutes from now)
    v_hold_expiry := NOW() + INTERVAL '5 minutes';

    -- 5. Insert new held booking
    INSERT INTO public.bookings (
        customer_id,
        provider_id,
        resource_id,
        slot_start,
        slot_end,
        status,
        payment_status,
        deposit_amount,
        hold_expires_at
    ) VALUES (
        p_customer_id,
        v_provider_id,
        p_resource_id,
        p_slot_start,
        p_slot_end,
        'HELD',
        'PENDING',
        v_deposit_amount,
        v_hold_expiry
    )
    RETURNING id INTO v_new_booking_id;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_new_booking_id,
        'deposit_amount', v_deposit_amount,
        'hold_expires_at', v_hold_expiry
    );
END;
$$;

-- Mark No-Show and Record Count
CREATE OR REPLACE FUNCTION public.record_no_show(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_customer_id UUID;
    v_count INT;
BEGIN
    UPDATE public.bookings
    SET status = 'NO_SHOW',
        payment_status = 'FORFEITED',
        updated_at = NOW()
    WHERE id = p_booking_id
    RETURNING customer_id INTO v_customer_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    -- Increment profile no-show count
    UPDATE public.profiles
    SET no_show_count = no_show_count + 1,
        is_flagged = CASE WHEN no_show_count + 1 >= 4 THEN TRUE ELSE is_flagged END,
        updated_at = NOW()
    WHERE id = v_customer_id
    RETURNING no_show_count INTO v_count;

    RETURN jsonb_build_object('success', true, 'no_show_count', v_count, 'flagged', v_count >= 4);
END;
$$;

-- 12. ROW LEVEL SECURITY (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Categories are readable by everyone" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Subcategories are readable by everyone" ON public.sub_categories FOR SELECT USING (true);
CREATE POLICY "Active providers are readable by everyone" ON public.providers FOR SELECT USING (status = 'ACTIVE' OR auth.uid() = owner_id);
CREATE POLICY "Active resources are readable by everyone" ON public.resources FOR SELECT USING (is_active = true OR provider_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid()));
CREATE POLICY "Availability is readable by everyone" ON public.resource_availability FOR SELECT USING (true);

-- User Profiles
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Merchant Provider Management
CREATE POLICY "Merchants can insert own provider" ON public.providers FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Merchants can update own provider" ON public.providers FOR UPDATE USING (auth.uid() = owner_id);

-- Merchant Resource Management
CREATE POLICY "Merchants can manage resources" ON public.resources FOR ALL USING (provider_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid()));
CREATE POLICY "Merchants can manage availability" ON public.resource_availability FOR ALL USING (resource_id IN (SELECT r.id FROM public.resources r JOIN public.providers p ON r.provider_id = p.id WHERE p.owner_id = auth.uid()));

-- Bookings RLS
CREATE POLICY "Customers can view own bookings" ON public.bookings FOR SELECT USING (auth.uid() = customer_id);
CREATE POLICY "Merchants can view provider bookings" ON public.bookings FOR SELECT USING (provider_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid()));
CREATE POLICY "Customers can update own bookings" ON public.bookings FOR UPDATE USING (auth.uid() = customer_id);
CREATE POLICY "Merchants can update provider bookings" ON public.bookings FOR UPDATE USING (provider_id IN (SELECT id FROM public.providers WHERE owner_id = auth.uid()));

-- Payments RLS
CREATE POLICY "Customers can view own payments" ON public.payments FOR SELECT USING (booking_id IN (SELECT id FROM public.bookings WHERE customer_id = auth.uid()));
CREATE POLICY "Merchants can view provider payments" ON public.payments FOR SELECT USING (booking_id IN (SELECT b.id FROM public.bookings b JOIN public.providers p ON b.provider_id = p.id WHERE p.owner_id = auth.uid()));
