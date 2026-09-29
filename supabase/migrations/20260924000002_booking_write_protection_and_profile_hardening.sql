-- =============================================================================
-- Migration: 20260924000002_booking_write_protection_and_profile_hardening.sql
-- Description:
--   1. Add gateway_order_id to bookings with unique index for Razorpay order matching.
--   2. Revoke table-level UPDATE and INSERT on bookings from anon & authenticated.
--   3. Grant column-level UPDATE on bookings exclusively for client-editable fields (attachment_url).
--   4. Implement complete_booking() SECURITY DEFINER RPC with venue ownership checks.
--   5. Strengthen validate_booking_update trigger to block direct client writes to financial
--      columns and status transitions, allowing service_role and trusted RPCs.
--   6. Harden guard_profile_governance trigger to protect assigned_city_id and default_provider_id.
--   7. Restrict column-level UPDATE on profiles to full_name, phone, avatar_url, and expo_push_token.
--   8. Revoke EXECUTE on reveal_customer_contact and administrative routines from PUBLIC & anon.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RAZORPAY GATEWAY ORDER ID ON BOOKINGS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS gateway_order_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_gateway_order_id
  ON public.bookings (gateway_order_id)
  WHERE gateway_order_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. COMPLETE_BOOKING RPC (Merchant Status Transition: CONFIRMED -> COMPLETED)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_booking(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_booking RECORD;
  v_is_authorized BOOLEAN;
BEGIN
  IF v_caller_id IS NULL AND auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Authentication required to complete booking' USING ERRCODE = '42501';
  END IF;

  SELECT id, provider_id, status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Verify merchant authorization if called by user
  IF auth.role() != 'service_role' THEN
    SELECT (
      public.is_admin(v_caller_id)
      OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id))
    ) INTO v_is_authorized;

    IF NOT v_is_authorized THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You are not authorized for this venue');
    END IF;
  END IF;

  IF v_booking.status != 'CONFIRMED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid transition: Only CONFIRMED bookings can be completed (current: ' || v_booking.status || ')');
  END IF;

  -- Set session trusted write to allow trigger bypass
  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'COMPLETED', updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'COMPLETED');
END;
$$;

REVOKE ALL ON FUNCTION public.complete_booking(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_booking(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. CONFIRM_BOOKING_BY_MERCHANT RPC (Manual Merchant Confirmation: HELD/PENDING -> CONFIRMED)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_booking_by_merchant(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_booking RECORD;
  v_is_authorized BOOLEAN;
BEGIN
  IF v_caller_id IS NULL AND auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, provider_id, status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF auth.role() != 'service_role' THEN
    SELECT (
      public.is_admin(v_caller_id)
      OR v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id))
    ) INTO v_is_authorized;

    IF NOT v_is_authorized THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Not authorized for this venue');
    END IF;
  END IF;

  IF v_booking.status NOT IN ('HELD', 'PENDING_PAYMENT', 'PENDING') THEN
    IF v_booking.status = 'CONFIRMED' THEN
      RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'CONFIRMED', 'already_confirmed', true);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'Cannot confirm booking in state: ' || v_booking.status);
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CONFIRMED',
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'CONFIRMED');
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_booking_by_merchant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_booking_by_merchant(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DEFENSE-IN-DEPTH TRIGGER: validate_booking_update
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_booking_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
BEGIN
  -- Allow service_role or trusted internal execution context
  IF auth.role() = 'service_role' OR current_setting('app.trusted_write', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Platform admins are exempt
  IF public.is_admin(v_caller_id) THEN
    RETURN NEW;
  END IF;

  -- Financial columns cannot be modified directly via REST
  IF NEW.platform_fee IS DISTINCT FROM OLD.platform_fee
     OR NEW.platform_fee_gst IS DISTINCT FROM OLD.platform_fee_gst
     OR NEW.deposit_amount IS DISTINCT FROM OLD.deposit_amount
     OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.total_charged IS DISTINCT FROM OLD.total_charged
     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.gstin_platform IS DISTINCT FROM OLD.gstin_platform
     OR NEW.gateway_payment_id IS DISTINCT FROM OLD.gateway_payment_id
     OR NEW.gateway_order_id IS DISTINCT FROM OLD.gateway_order_id
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    RAISE EXCEPTION 'Financial and payment fields are read-only and managed by the payment gateway'
      USING ERRCODE = '42501';
  END IF;

  -- Status transitions must go through authorized RPCs
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Booking status cannot be updated directly. Use authorized RPCs (complete_booking, cancel_booking, record_no_show).'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_booking_update ON public.bookings;
CREATE TRIGGER trg_validate_booking_update
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.validate_booking_update();

-- Also ensure protect_booking_payment_fields allows service_role and trusted writes
CREATE OR REPLACE FUNCTION public.protect_booking_payment_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'service_role' OR current_setting('app.trusted_write', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.gateway_payment_id IS DISTINCT FROM OLD.gateway_payment_id
     OR NEW.deposit_amount IS DISTINCT FROM OLD.deposit_amount THEN
    RAISE EXCEPTION 'Payment identifiers and amounts can only be set by the trusted payment system';
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF (SELECT auth.uid()) IS DISTINCT FROM OLD.customer_id OR NEW.status != 'CANCELLED' THEN
      RAISE EXCEPTION 'payment_status can only be changed by the payment system';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. TABLE-LEVEL & COLUMN-LEVEL GRANTS LOCKDOWN: bookings
-- ─────────────────────────────────────────────────────────────────────────────
-- Revoke table-wide INSERT & UPDATE from public roles
REVOKE INSERT, UPDATE ON public.bookings FROM anon, authenticated;

-- Grant column-level UPDATE on bookings strictly for customer attachment upload
GRANT UPDATE (attachment_url) ON public.bookings TO authenticated;

-- Allow service_role full write capabilities
GRANT ALL ON public.bookings TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PROFILES GOVERNANCE HARDENING: Protect assigned_city_id & default_provider_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_profile_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Allow service_role or admin bypass
  IF auth.role() = 'service_role' OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Block client modifications to role, flags, strikes, city assignment, and default provider
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.no_show_count IS DISTINCT FROM OLD.no_show_count
     OR NEW.is_flagged IS DISTINCT FROM OLD.is_flagged
     OR NEW.assigned_city_id IS DISTINCT FROM OLD.assigned_city_id
     OR NEW.default_provider_id IS DISTINCT FROM OLD.default_provider_id THEN
    RAISE EXCEPTION 'Unauthorized profile modification: role, city, provider, and governance fields are protected'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_governance ON public.profiles;
CREATE TRIGGER trg_guard_profile_governance
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_governance();

-- Restrict authenticated client UPDATE on profiles to allowed columns
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ROUTINE EXECUTION PRIVILEGE REVOCATIONS
-- ─────────────────────────────────────────────────────────────────────────────
-- Revoke reveal_customer_contact from PUBLIC and anon
REVOKE ALL ON FUNCTION public.reveal_customer_contact(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_customer_contact(UUID) TO authenticated, service_role;

-- Revoke administrative, cleanup, and test functions from PUBLIC and anon
REVOKE ALL ON FUNCTION public.reset_test_bookings(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_test_customer_strikes(UUID, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_test_provider_strikes(UUID, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_expired_waitlist_entries() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_expired_holds() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_city_status(TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reassign_booking_resource(UUID, UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.purge_expired_waitlist_entries() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_expired_holds() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_city_status(TEXT, TEXT, INT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reassign_booking_resource(UUID, UUID, TEXT) TO authenticated, service_role;
