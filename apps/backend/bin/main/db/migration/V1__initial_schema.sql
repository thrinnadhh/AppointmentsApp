-- Enable required extension for exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─────────────────────────────────────────────
-- CITIES
-- ─────────────────────────────────────────────
CREATE TABLE cities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    timezone    TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    is_active   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cities (slug, name, timezone, is_active)
VALUES ('tirupati', 'Tirupati', 'Asia/Kolkata', TRUE);

-- ─────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────
CREATE TABLE users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_ref   TEXT UNIQUE NOT NULL,   -- Supabase auth.users.id (external)
    email      TEXT,
    phone      TEXT UNIQUE,
    role       TEXT NOT NULL CHECK (role IN ('customer', 'merchant_staff', 'admin')),
    city_id    UUID REFERENCES cities (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_auth_ref ON users (auth_ref);

-- ─────────────────────────────────────────────
-- CATEGORIES
-- ─────────────────────────────────────────────
CREATE TABLE categories (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug     TEXT UNIQUE NOT NULL,
    name     TEXT NOT NULL,
    icon_key TEXT
);

INSERT INTO categories (slug, name, icon_key) VALUES
    ('salon',          'Salon & Beauty',   'scissors'),
    ('clinic',         'Clinic',           'stethoscope'),
    ('physiotherapy',  'Physiotherapy',    'activity'),
    ('spa',            'Spa & Wellness',   'leaf'),
    ('dental',         'Dental',           'smile');

-- ─────────────────────────────────────────────
-- MERCHANTS
-- ─────────────────────────────────────────────
CREATE TABLE merchants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id     UUID NOT NULL REFERENCES cities (id),
    owner_id    UUID NOT NULL REFERENCES users (id),
    category_id UUID NOT NULL REFERENCES categories (id),
    name        TEXT NOT NULL,
    address     TEXT,
    lat         NUMERIC(9, 6),
    lng         NUMERIC(9, 6),
    photo_url   TEXT,
    status      TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
    timezone    TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_merchants_city    ON merchants (city_id);
CREATE INDEX idx_merchants_status  ON merchants (status);
CREATE INDEX idx_merchants_owner   ON merchants (owner_id);

-- ─────────────────────────────────────────────
-- MERCHANT STAFF
-- ─────────────────────────────────────────────
CREATE TABLE merchant_staff (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users (id),
    role        TEXT NOT NULL DEFAULT 'staff'
                    CHECK (role IN ('owner', 'staff')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (merchant_id, user_id)
);

-- ─────────────────────────────────────────────
-- RESOURCES  (chairs, practitioners, rooms)
-- ─────────────────────────────────────────────
CREATE TABLE resources (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- SERVICES
-- ─────────────────────────────────────────────
CREATE TABLE services (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id  UUID NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    duration_min INT NOT NULL CHECK (duration_min > 0),
    deposit_amt  NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (deposit_amt >= 0),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_services_merchant ON services (merchant_id);

-- ─────────────────────────────────────────────
-- AVAILABILITY RULES  (weekly repeating schedule)
-- ─────────────────────────────────────────────
CREATE TABLE availability_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
    resource_id UUID REFERENCES resources (id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
    open_time   TIME NOT NULL,
    close_time  TIME NOT NULL,
    is_closed   BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (close_time > open_time OR is_closed),
    UNIQUE (merchant_id, resource_id, day_of_week)
);

CREATE INDEX idx_avail_merchant ON availability_rules (merchant_id);

-- ─────────────────────────────────────────────
-- BOOKINGS
-- ─────────────────────────────────────────────
CREATE TABLE bookings (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id        UUID NOT NULL REFERENCES merchants (id),
    customer_id        UUID NOT NULL REFERENCES users (id),
    service_id         UUID NOT NULL REFERENCES services (id),
    resource_id        UUID REFERENCES resources (id),
    slot_start         TIMESTAMPTZ NOT NULL,
    slot_end           TIMESTAMPTZ NOT NULL,
    status             TEXT NOT NULL DEFAULT 'CONFIRMED'
                           CHECK (status IN ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
    deposit_amount     NUMERIC(10, 2) NOT NULL DEFAULT 0,
    platform_fee       NUMERIC(10, 2) NOT NULL DEFAULT 0,
    gateway_payment_id TEXT,
    cancelled_by       UUID REFERENCES users (id),
    cancelled_at       TIMESTAMPTZ,
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_slot_order CHECK (slot_end > slot_start),

    -- Double-booking prevention on resource level
    -- Two bookings cannot overlap on the same resource (when resource is assigned)
    EXCLUDE USING gist (
        resource_id WITH =,
        tstzrange(slot_start, slot_end, '[)') WITH &&
    ) WHERE (resource_id IS NOT NULL AND status NOT IN ('CANCELLED')),

    -- Double-booking prevention at merchant level (when no specific resource)
    EXCLUDE USING gist (
        merchant_id WITH =,
        tstzrange(slot_start, slot_end, '[)') WITH &&
    ) WHERE (resource_id IS NULL AND status NOT IN ('CANCELLED'))
);

CREATE INDEX idx_bookings_merchant    ON bookings (merchant_id, slot_start);
CREATE INDEX idx_bookings_customer    ON bookings (customer_id);
CREATE INDEX idx_bookings_status      ON bookings (status);
CREATE INDEX idx_bookings_slot_range  ON bookings USING gist (tstzrange(slot_start, slot_end, '[)'));

-- ─────────────────────────────────────────────
-- SLOT HOLDS  (in-progress, expires automatically)
-- ─────────────────────────────────────────────
CREATE TABLE slot_holds (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants (id),
    resource_id UUID REFERENCES resources (id),
    customer_id UUID NOT NULL REFERENCES users (id),
    service_id  UUID NOT NULL REFERENCES services (id),
    slot_start  TIMESTAMPTZ NOT NULL,
    slot_end    TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_slot_holds_expires ON slot_holds (expires_at);

-- ─────────────────────────────────────────────
-- CANCELLATION POLICIES
-- ─────────────────────────────────────────────
CREATE TABLE cancellation_policies (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id      UUID NOT NULL UNIQUE REFERENCES merchants (id) ON DELETE CASCADE,
    cutoff_hours     INT NOT NULL DEFAULT 24,     -- must cancel N hours before
    penalty_percent  INT NOT NULL DEFAULT 0       -- % of deposit kept on late cancel
);

-- ─────────────────────────────────────────────
-- OUTBOX EVENTS  (transactional outbox pattern)
-- ─────────────────────────────────────────────
CREATE TABLE outbox_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_id UUID NOT NULL,          -- booking_id / merchant_id, etc.
    event_type   TEXT NOT NULL,          -- e.g. 'booking.confirmed'
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ             -- NULL = unprocessed
);

CREATE INDEX idx_outbox_unprocessed ON outbox_events (created_at)
    WHERE processed_at IS NULL;

-- ShedLock table for distributed lock on outbox poller
CREATE TABLE shedlock (
    name       VARCHAR(64)  NOT NULL,
    lock_until TIMESTAMPTZ  NOT NULL,
    locked_at  TIMESTAMPTZ  NOT NULL,
    locked_by  VARCHAR(255) NOT NULL,
    PRIMARY KEY (name)
);
