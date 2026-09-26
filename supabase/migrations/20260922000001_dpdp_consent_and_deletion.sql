-- Migration: 20260922000001_dpdp_consent_and_deletion.sql
-- DPDP Act 2023 compliance: consent table, account deletion, data anonymisation

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. USER CONSENTS (DPDP Section 6 — separate, granular, affirmative consent)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_consents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    purpose         TEXT NOT NULL CHECK (purpose IN (
                        'phone_otp',
                        'location_detection',
                        'booking_data',
                        'clinical_booking',
                        'marketing_notifications'
                    )),
    granted         BOOLEAN NOT NULL,
    version         TEXT NOT NULL DEFAULT '1.0',
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, purpose, version)
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user ON public.user_consents (user_id);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own consents" ON public.user_consents
    FOR ALL USING ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE ON public.user_consents TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ACCOUNT DELETION REQUESTS (Play Store May 2024 mandate + DPDP right to erasure)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 30-day grace period (user can cancel via support within this window)
    scheduled_for   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
    completed_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_pending
    ON public.account_deletion_requests (scheduled_for)
    WHERE completed_at IS NULL AND cancelled_at IS NULL;

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own deletion request" ON public.account_deletion_requests
    FOR SELECT USING ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT ON public.account_deletion_requests TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REQUEST ACCOUNT DELETION — idempotent, customer-callable RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_account_deletion(p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := (SELECT auth.uid());
    v_existing UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Idempotent: if an active request already exists, return it
    SELECT id INTO v_existing
    FROM public.account_deletion_requests
    WHERE user_id = v_uid
      AND completed_at IS NULL
      AND cancelled_at IS NULL;

    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Deletion request already pending',
            'request_id', v_existing
        );
    END IF;

    INSERT INTO public.account_deletion_requests (user_id, reason)
    VALUES (v_uid, p_reason)
    RETURNING id INTO v_existing;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Account scheduled for deletion in 30 days. Contact support to cancel.',
        'request_id', v_existing,
        'scheduled_for', (NOW() + INTERVAL '30 days')
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_account_deletion(TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ANONYMIZE_USER_DATA — called by admin/cron after 30-day grace period
--    Preserves merchant P&L records; removes all personal identifiers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.anonymize_user_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_role TEXT;
BEGIN
    -- Only service_role or admin profiles may call this
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = (SELECT auth.uid());
    IF auth.role() != 'service_role' AND v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: only service_role or admin can anonymize users';
    END IF;

    -- Anonymize profile (keep row for FK integrity in bookings/payments)
    UPDATE public.profiles SET
        full_name   = 'Deleted User',
        phone       = NULL,
        is_flagged  = FALSE,
        updated_at  = NOW()
    WHERE id = p_user_id;

    -- Scrub booking notes (slot records kept for merchant revenue audit)
    UPDATE public.bookings SET
        notes = NULL,
        updated_at = NOW()
    WHERE customer_id = p_user_id;

    -- Revoke all consents
    DELETE FROM public.user_consents WHERE user_id = p_user_id;

    -- Mark deletion request complete
    UPDATE public.account_deletion_requests SET
        completed_at = NOW()
    WHERE user_id = p_user_id AND completed_at IS NULL;

    RETURN jsonb_build_object('success', true, 'anonymized_user', p_user_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anonymize_user_data(UUID) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.anonymize_user_data(UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. DISCLAIMER VERSION on bookings (medical liability audit trail)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS disclaimer_version TEXT DEFAULT 'v1';
