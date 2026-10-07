-- Migration: 20261007000001_strix_b7ac_rpc_hardening.sql
-- Description: Remediate Strix findings vuln-0004 and vuln-0005
--   1. vuln-0004: Revoke and drop un-guarded 3-parameter update_city_status(TEXT, TEXT, INT)
--   2. vuln-0005: Enforce strict caller identity binding in check_cooling_period_eligibility(UUID, UUID, TIMESTAMPTZ)

-- ============================================================================
-- 1. vuln-0004: Privilege Escalation via update_city_status overload
-- ============================================================================
-- The legacy 3-argument overload from 20260912000004_super_admin_multi_city.sql
-- lacked authorization checks and remained executable by authenticated users.
-- Revoke all permissions and drop this signature. The platform uses the
-- guarded 4-argument signature (with p_admin_token and is_admin() checks) restricted to service_role.

REVOKE ALL ON FUNCTION public.update_city_status(TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.update_city_status(TEXT, TEXT, INT);

-- ============================================================================
-- 2. vuln-0005: Cross-Customer IDOR in check_cooling_period_eligibility RPC
-- ============================================================================
-- Enforce caller binding: The authenticated user calling the RPC must be
-- the customer themselves (auth.uid() = p_customer_id), a platform administrator,
-- or service_role.

CREATE OR REPLACE FUNCTION public.check_cooling_period_eligibility(
    p_customer_id UUID,
    p_provider_id UUID,
    p_target_slot TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cooling_days INTEGER;
    v_orig_id      UUID;
    v_orig_slot    TIMESTAMPTZ;
    v_valid_until  TIMESTAMPTZ;
    v_days_left    NUMERIC;
BEGIN
    -- Strict caller identity binding (vuln-0005 IDOR defense)
    IF auth.role() <> 'service_role' THEN
        IF auth.uid() IS NULL OR (auth.uid() <> p_customer_id AND NOT EXISTS (
            SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
        )) THEN
            RAISE EXCEPTION 'Access Denied: You are not authorized to check cooling period for this customer';
        END IF;
    END IF;

    SELECT COALESCE(cooling_period_days, 0) INTO v_cooling_days
    FROM public.providers
    WHERE id = p_provider_id;

    IF v_cooling_days IS NULL OR v_cooling_days <= 0 THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'cooling_period_days', 0,
            'reason', 'Cooling period not configured or disabled'
        );
    END IF;

    -- Strict non-followup anchor lookup (is_followup = FALSE) (vuln-0025)
    SELECT id, slot_start, slot_start + (v_cooling_days || ' days')::INTERVAL
    INTO v_orig_id, v_orig_slot, v_valid_until
    FROM public.bookings
    WHERE customer_id = p_customer_id
      AND provider_id = p_provider_id
      AND status IN ('CONFIRMED', 'COMPLETED')
      AND is_followup = FALSE
      AND slot_start <= p_target_slot
      AND p_target_slot <= (slot_start + (v_cooling_days || ' days')::INTERVAL)
      AND NOW() <= (slot_start + (v_cooling_days || ' days')::INTERVAL)
    ORDER BY slot_start DESC
    LIMIT 1;

    IF v_orig_id IS NOT NULL THEN
        v_days_left := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_valid_until - NOW())) / 86400.0, 1));
        RETURN jsonb_build_object(
            'eligible', true,
            'cooling_period_days', v_cooling_days,
            'original_booking_id', v_orig_id,
            'original_slot_start', v_orig_slot,
            'valid_until', v_valid_until,
            'days_remaining', v_days_left,
            'reason', 'Target appointment date is within the ' || v_cooling_days || '-day cooling period'
        );
    END IF;

    RETURN jsonb_build_object(
        'eligible', false,
        'cooling_period_days', v_cooling_days,
        'reason', 'No active completed appointment found within the cooling period window'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_cooling_period_eligibility(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_cooling_period_eligibility(UUID, UUID, TIMESTAMPTZ) TO authenticated, service_role;
