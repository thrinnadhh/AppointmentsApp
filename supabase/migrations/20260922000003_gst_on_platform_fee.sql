-- Migration: 20260922000003_gst_on_platform_fee.sql
-- GST compliance: track platform_fee GST, invoice numbers, and GSTIN
-- GST applies once platform revenue exceeds ₹20L/year (standard rate: 18% on tech services)
-- At MVP scale this defaults to 0 — flip gstin_platform when registered

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ADD GST / INVOICE COLUMNS TO BOOKINGS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS platform_fee_gst  NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS total_charged      NUMERIC(10, 2) GENERATED ALWAYS AS
                                                    (COALESCE(deposit_amount, 0) + COALESCE(platform_fee, 0) + COALESCE(platform_fee_gst, 0))
                                                    STORED,
    ADD COLUMN IF NOT EXISTS gstin_platform     TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS invoice_number     TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS invoice_generated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.bookings.platform_fee_gst IS
    '18% GST on platform_fee. Set to 0 until GSTIN is obtained. Flip via update_platform_gstin().';
COMMENT ON COLUMN public.bookings.total_charged IS
    'Computed: deposit_amount + platform_fee + platform_fee_gst. Actual amount charged to customer.';
COMMENT ON COLUMN public.bookings.invoice_number IS
    'Format: APT-YYYYMMDD-<booking_id_prefix>. Generated on payment confirmation.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PLATFORM CONFIG TABLE — stores GSTIN and GST-active flag
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_config (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL,
    note   TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only service_role can read/write platform config
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_platform_config" ON public.platform_config
    USING (auth.role() = 'service_role');

-- Seed initial config
INSERT INTO public.platform_config (key, value, note) VALUES
    ('gst_active',      'false',  'Set to true when GSTIN is obtained and GST collection begins'),
    ('gstin',           '',       'Your 15-digit GST Identification Number once registered'),
    ('gst_rate_pct',    '18',     'Standard rate for tech/intermediary services'),
    ('platform_name',   'Appointments4u', 'Name shown on invoices'),
    ('support_email',   'support@appointments4u.in', 'Support email shown on receipts'),
    ('grievance_email', 'grievance@appointments4u.in', 'DPDPA Grievance Officer email'),
    ('refund_policy_version', '1.0', 'Version of refund policy shown to users at checkout')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. generate_invoice_number() — idempotent, called from payment webhook
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_booking_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_date_str   TEXT := TO_CHAR(NOW(), 'YYYYMMDD');
    v_id_suffix  TEXT := UPPER(SUBSTRING(p_booking_id::TEXT, 1, 6));
    v_invoice    TEXT;
    v_existing   TEXT;
BEGIN
    -- Idempotent: return existing number if already generated
    SELECT invoice_number INTO v_existing FROM public.bookings WHERE id = p_booking_id;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

    v_invoice := 'APT-' || v_date_str || '-' || v_id_suffix;

    UPDATE public.bookings
    SET
        invoice_number       = v_invoice,
        invoice_generated_at = NOW()
    WHERE id = p_booking_id;

    RETURN v_invoice;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_invoice_number(UUID) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_invoice_number(UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. compute_gst_for_booking() — recalculates GST when platform config changes
--    or when first GSTIN is added. Called by webhook / admin.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_gst_for_booking(p_booking_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_gst_active  BOOLEAN;
    v_rate        NUMERIC;
    v_fee         NUMERIC;
    v_gst_amount  NUMERIC;
BEGIN
    SELECT (value = 'true') INTO v_gst_active FROM public.platform_config WHERE key = 'gst_active';
    SELECT value::NUMERIC   INTO v_rate       FROM public.platform_config WHERE key = 'gst_rate_pct';
    SELECT platform_fee     INTO v_fee        FROM public.bookings WHERE id = p_booking_id;

    IF NOT v_gst_active OR v_fee IS NULL THEN RETURN 0; END IF;

    v_gst_amount := ROUND(v_fee * (v_rate / 100), 2);

    UPDATE public.bookings SET platform_fee_gst = v_gst_amount WHERE id = p_booking_id;
    RETURN v_gst_amount;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_gst_for_booking(UUID) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_gst_for_booking(UUID) TO service_role;
