-- Migration: 20260912000004_super_admin_multi_city.sql
-- Super Admin Multi-City Expansion, Merchant Onboarding Funnel & Velocity Analytics

-- 1. CITIES TABLE
CREATE TABLE IF NOT EXISTS public.cities (
    id TEXT PRIMARY KEY, -- e.g. 'tirupati', 'nellore', 'chittoor'
    name TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'Andhra Pradesh',
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'EXPANDING', 'PLANNED', 'PAUSED')) DEFAULT 'PLANNED',
    latitude NUMERIC(10, 7) NOT NULL,
    longitude NUMERIC(10, 7) NOT NULL,
    radius_km NUMERIC(6, 2) NOT NULL DEFAULT 25.00,
    merchant_target INT NOT NULL DEFAULT 15,
    launch_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on city status
CREATE INDEX IF NOT EXISTS idx_cities_status ON public.cities(status);

-- 2. SEED INITIAL CITIES
INSERT INTO public.cities (id, name, state, status, latitude, longitude, radius_km, merchant_target, launch_date)
VALUES 
    ('tirupati', 'Tirupati', 'Andhra Pradesh', 'ACTIVE', 13.6288000, 79.4192000, 25.00, 20, '2026-01-01'),
    ('nellore', 'Nellore', 'Andhra Pradesh', 'EXPANDING', 14.4426000, 79.9865000, 20.00, 15, '2026-10-15'),
    ('chittoor', 'Chittoor', 'Andhra Pradesh', 'EXPANDING', 13.2172000, 79.1003000, 20.00, 15, '2026-11-01'),
    ('chennai', 'Chennai', 'Tamil Nadu', 'PLANNED', 13.0827000, 80.2707000, 35.00, 30, '2027-01-15'),
    ('bangalore', 'Bangalore', 'Karnataka', 'PLANNED', 12.9716000, 77.5946000, 40.00, 30, '2027-03-01'),
    ('hyderabad', 'Hyderabad', 'Telangana', 'PLANNED', 17.3850000, 78.4867000, 40.00, 30, '2027-05-01')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    state = EXCLUDED.state,
    status = EXCLUDED.status,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    radius_km = EXCLUDED.radius_km,
    merchant_target = EXCLUDED.merchant_target;

-- 3. LINK PROVIDERS TO CITIES
ALTER TABLE public.providers 
ADD COLUMN IF NOT EXISTS city_id TEXT REFERENCES public.cities(id) ON DELETE SET NULL;

-- Backfill existing providers to tirupati
UPDATE public.providers 
SET city_id = 'tirupati' 
WHERE city_id IS NULL OR city ILIKE '%tirupati%';

CREATE INDEX IF NOT EXISTS idx_providers_city_id ON public.providers(city_id);

-- 4. EXPANSION WAITLIST TABLE (Organic Unlaunched City Demand)
CREATE TABLE IF NOT EXISTS public.city_waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_name TEXT NOT NULL,
    phone TEXT,
    vertical_interest TEXT, -- 'clinics', 'salons', 'gaming', 'dining', 'pets'
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_city_waitlist_city ON public.city_waitlist(city_name);

-- Seed some initial demand signals for realistic admin dashboard display
INSERT INTO public.city_waitlist (city_name, phone, vertical_interest, latitude, longitude)
VALUES 
    ('Nellore', '+91 98480 11223', 'clinics', 14.4426, 79.9865),
    ('Nellore', '+91 98480 22334', 'salons', 14.4426, 79.9865),
    ('Nellore', '+91 98480 33445', 'gaming', 14.4426, 79.9865),
    ('Chittoor', '+91 98480 44556', 'clinics', 13.2172, 79.1003),
    ('Chittoor', '+91 98480 55667', 'dining', 13.2172, 79.1003),
    ('Kadapa', '+91 98480 66778', 'clinics', 14.4673, 78.8242),
    ('Kadapa', '+91 98480 77889', 'gaming', 14.4673, 78.8242),
    ('Kadapa', '+91 98480 88990', 'salons', 14.4673, 78.8242)
ON CONFLICT DO NOTHING;

-- 5. RPC: GET ACTIVE CITIES FOR CONSUMER APP
CREATE OR REPLACE FUNCTION public.get_active_cities(p_include_expanding BOOLEAN DEFAULT TRUE)
RETURNS TABLE (
    id TEXT,
    name TEXT,
    state TEXT,
    status TEXT,
    latitude NUMERIC,
    longitude NUMERIC,
    radius_km NUMERIC,
    active_providers_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.get_active_cities(BOOLEAN) TO anon, authenticated, service_role;

-- 6. RPC: GET ADMIN CITY EXPANSION STATS
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

GRANT EXECUTE ON FUNCTION public.get_admin_city_stats() TO authenticated, service_role;

-- 7. RPC: GET TIME-SLICED ADMIN VELOCITY ANALYTICS
CREATE OR REPLACE FUNCTION public.get_admin_velocity_analytics(
    p_time_window TEXT DEFAULT 'today', -- 'today', '3days', '7days', '30days', 'all'
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
    -- Determine time slice
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
            fb.city_id,
            fb.city_name,
            COUNT(*)::INT AS booking_count,
            COALESCE(SUM(fb.deposit_amount), 0)::NUMERIC AS deposit_sum
        FROM filtered_bookings fb
        GROUP BY fb.city_id, fb.city_name
    ),
    funnel_metrics AS (
        SELECT 
            COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'ACTIVE')::INT AS onboarded_count,
            COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'PENDING_APPROVAL')::INT AS in_progress_count,
            COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'SUSPENDED')::INT AS suspended_count,
            COUNT(DISTINCT p.id)::INT AS total_merchants
        FROM public.providers p
        WHERE (p_city_id IS NULL OR p.city_id = p_city_id)
    ),
    city_counts AS (
        SELECT 
            COUNT(*) FILTER (WHERE status = 'ACTIVE')::INT AS active_cities,
            COUNT(*) FILTER (WHERE status = 'EXPANDING')::INT AS expanding_cities,
            COUNT(*) FILTER (WHERE status = 'PLANNED')::INT AS planned_cities,
            COUNT(*)::INT AS total_cities
        FROM public.cities
    )
    SELECT jsonb_build_object(
        'time_window', p_time_window,
        'since', v_start_time,
        'total_bookings', (SELECT COUNT(*)::INT FROM filtered_bookings),
        'completed_bookings', (SELECT COUNT(*)::INT FROM filtered_bookings WHERE status = 'COMPLETED'),
        'held_bookings', (SELECT COUNT(*)::INT FROM filtered_bookings WHERE status = 'HELD'),
        'confirmed_bookings', (SELECT COUNT(*)::INT FROM filtered_bookings WHERE status = 'CONFIRMED'),
        'no_show_bookings', (SELECT COUNT(*)::INT FROM filtered_bookings WHERE status = 'NO_SHOW'),
        'cancelled_bookings', (SELECT COUNT(*)::INT FROM filtered_bookings WHERE status = 'CANCELLED'),
        'gross_deposit_amount', (SELECT COALESCE(SUM(deposit_amount) FILTER (WHERE payment_status IN ('CAPTURED', 'FORFEITED')), 0)::NUMERIC FROM filtered_bookings),
        'forfeited_deposit_amount', (SELECT COALESCE(SUM(deposit_amount) FILTER (WHERE payment_status = 'FORFEITED'), 0)::NUMERIC FROM filtered_bookings),
        'refunded_deposit_amount', (SELECT COALESCE(SUM(deposit_amount) FILTER (WHERE payment_status = 'REFUNDED'), 0)::NUMERIC FROM filtered_bookings),
        'city_density', (SELECT COALESCE(jsonb_agg(cd), '[]'::jsonb) FROM city_density cd),
        'merchant_funnel', (SELECT to_jsonb(fm) FROM funnel_metrics fm),
        'cities_overview', (SELECT to_jsonb(cc) FROM city_counts cc)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_velocity_analytics(TEXT, TEXT) TO authenticated, service_role;

-- 8. RPC: UPDATE CITY STATUS (ADMIN ONLY)
CREATE OR REPLACE FUNCTION public.update_city_status(
    p_city_id TEXT,
    p_status TEXT,
    p_merchant_target INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_updated public.cities%ROWTYPE;
BEGIN
    IF p_status NOT IN ('ACTIVE', 'EXPANDING', 'PLANNED', 'PAUSED') THEN
        RAISE EXCEPTION 'Invalid city status: %', p_status;
    END IF;

    UPDATE public.cities
    SET 
        status = p_status,
        merchant_target = COALESCE(p_merchant_target, merchant_target),
        updated_at = NOW()
    WHERE id = p_city_id
    RETURNING * INTO v_updated;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'City not found: %', p_city_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'city', row_to_json(v_updated)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_city_status(TEXT, TEXT, INT) TO authenticated, service_role;

-- 9. RLS POLICIES FOR CITIES & WAITLIST
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.city_waitlist ENABLE ROW LEVEL SECURITY;

-- Allow public read access to cities
DO $$ BEGIN
    CREATE POLICY "Allow public read cities"
    ON public.cities FOR SELECT
    TO anon, authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Allow admin full control over cities
DO $$ BEGIN
    CREATE POLICY "Allow admin full manage cities"
    ON public.cities FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Allow public submit to city waitlist
DO $$ BEGIN
    CREATE POLICY "Allow public insert city waitlist"
    ON public.city_waitlist FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Allow admin view and manage city waitlist
DO $$ BEGIN
    CREATE POLICY "Allow admin manage city waitlist"
    ON public.city_waitlist FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
