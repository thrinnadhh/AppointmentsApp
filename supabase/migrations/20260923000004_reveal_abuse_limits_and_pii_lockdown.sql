-- =============================================================================
-- Migration: 20260923000004_reveal_abuse_limits_and_pii_lockdown.sql
-- Description:
--   1. Lockdown contact_reveal_audit to ADMIN-ONLY SELECT (merchants cannot inspect audits).
--   2. Enforce per-user rate limit on reveal_customer_contact (max 20 reveals/hour).
--   3. Create admin-visible contact_reveal_anomalies view for unusual reveal velocity.
--   4. Revoke routine EXECUTE from anon & PUBLIC on reveal_customer_contact,
--      mask_customer_phone, and dispatch_booking_notification.
--   5. Drop permissive (qual: "true") leak policies on notification_logs and city_waitlist,
--      restricting read access exclusively to platform admins.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AUDIT TABLE: Admin-Only Read Policy
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins and authorized merchants can view reveal audits" ON public.contact_reveal_audit;
DROP POLICY IF EXISTS "Admins only read reveal audits" ON public.contact_reveal_audit;

CREATE POLICY "Admins only read reveal audits" ON public.contact_reveal_audit
FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REVEAL ABUSE LIMITS: Rate-Limited reveal_customer_contact RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reveal_customer_contact(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_booking RECORD;
  v_customer RECORD;
  v_is_authorized BOOLEAN;
  v_reveals_last_hour INT;
  v_hourly_limit INT := 20; -- Maximum 20 reveals per user per rolling 1 hour
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to reveal customer contact' USING ERRCODE = '42501';
  END IF;

  -- 1. Verify caller rate limit (rolling 1-hour window)
  SELECT count(*) INTO v_reveals_last_hour
  FROM public.contact_reveal_audit
  WHERE user_id = v_caller_id
    AND revealed_at > (NOW() - INTERVAL '1 hour');

  IF v_reveals_last_hour >= v_hourly_limit AND NOT public.is_admin(v_caller_id) THEN
    RAISE EXCEPTION 'Rate limit exceeded: You have reached the maximum of % contact reveals per hour. Please try again later.', v_hourly_limit
      USING ERRCODE = 'P0003';
  END IF;

  -- 2. Fetch booking record
  SELECT id, customer_id, provider_id, status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Verify merchant authorization or admin
  SELECT (
    public.is_admin(v_caller_id)
    OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id))
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to view contacts for this venue' USING ERRCODE = '42501';
  END IF;

  -- 4. Verify booking is confirmed
  IF v_booking.status != 'CONFIRMED' THEN
    RAISE EXCEPTION 'Customer contact can only be revealed for confirmed bookings (current status: %)', v_booking.status
      USING ERRCODE = '22023';
  END IF;

  -- 5. Fetch customer profile contact
  SELECT phone, full_name
  INTO v_customer
  FROM public.profiles
  WHERE id = v_booking.customer_id;

  IF NOT FOUND OR v_customer.phone IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'booking_id', p_booking_id,
      'phone', 'Not provided',
      'full_name', COALESCE(v_customer.full_name, 'Valued Customer')
    );
  END IF;

  -- 6. Insert audit log
  INSERT INTO public.contact_reveal_audit (
    user_id,
    booking_id,
    revealed_at
  ) VALUES (
    v_caller_id,
    p_booking_id,
    NOW()
  );

  -- 7. Return unmasked contact
  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'phone', v_customer.phone,
    'full_name', COALESCE(v_customer.full_name, 'Valued Customer')
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ANOMALY DETECTION: Admin-Visible Unusual Volume View
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.contact_reveal_anomalies AS
SELECT
  cra.user_id,
  p.full_name AS staff_name,
  p.phone AS staff_phone,
  pr.name AS venue_name,
  COUNT(*) AS reveals_last_24h,
  COUNT(*) FILTER (WHERE cra.revealed_at > NOW() - INTERVAL '1 hour') AS reveals_last_1h,
  MAX(cra.revealed_at) AS last_revealed_at
FROM public.contact_reveal_audit cra
LEFT JOIN public.profiles p ON p.id = cra.user_id
LEFT JOIN public.bookings b ON b.id = cra.booking_id
LEFT JOIN public.providers pr ON pr.id = b.provider_id
WHERE cra.revealed_at > NOW() - INTERVAL '24 hours'
GROUP BY cra.user_id, p.full_name, p.phone, pr.name
HAVING COUNT(*) > 10
ORDER BY reveals_last_1h DESC, reveals_last_24h DESC;

REVOKE ALL ON public.contact_reveal_anomalies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contact_reveal_anomalies TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ROUTINE GRANTS HARDENING: Strip anon & PUBLIC access
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.reveal_customer_contact(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_customer_contact(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mask_customer_phone(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.mask_customer_phone(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. LEAK PATH REMEDIATION: notification_logs & city_waitlist
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow read notification logs" ON public.notification_logs;
CREATE POLICY "Admins only read notification logs" ON public.notification_logs
FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Allow public select city waitlist" ON public.city_waitlist;
CREATE POLICY "Admins only read city waitlist" ON public.city_waitlist
FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));
