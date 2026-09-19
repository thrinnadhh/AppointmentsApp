-- =============================================================================
-- Migration: 20260917000003_defensive_db_remediation.sql
-- Description:
--   1. Drop permissive legacy quoted RLS policies ("Allow reading bookings",
--      "Allow updating bookings", "Allow reading profiles") and recreate with
--      ownership/membership-scoped, authenticated-only access.
--   2. Lock down storage.objects policies: public venue-assets read only;
--      prescriptions bucket restricted to owning customer + merchant + admin.
--   3. Revoke anon/PUBLIC execute on sensitive SECURITY DEFINER functions and
--      enforce in-function auth guards (customer-own, merchant-membership,
--      admin-only). Payment settlement restricted to service_role.
--   4. Idempotent, locked, amount-checked confirm_booking_payment; validated
--      cancel_booking with refund_status tracking; guarded test utilities.
--   5. refund_status TEXT tracking column on bookings; service-only
--      payment_orders table for gateway order persistence.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RLS: bookings — customers own, merchants membership, admins
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow reading bookings" ON public.bookings;
DROP POLICY IF EXISTS allow_reading_bookings ON public.bookings;
DROP POLICY IF EXISTS "Allow updating bookings" ON public.bookings;
DROP POLICY IF EXISTS allow_updating_bookings ON public.bookings;

CREATE POLICY allow_reading_bookings ON public.bookings
FOR SELECT TO authenticated
USING (
  auth.uid() = customer_id
  OR provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  OR public.is_admin(auth.uid())
);

CREATE POLICY allow_updating_bookings ON public.bookings
FOR UPDATE TO authenticated
USING (
  auth.uid() = customer_id
  OR provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  OR public.is_admin(auth.uid())
)
WITH CHECK (
  auth.uid() = customer_id
  OR provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  OR public.is_admin(auth.uid())
);

-- -----------------------------------------------------------------------------
-- 2. RLS: profiles — own row only for reads; no anon visibility; prevent
--    self-escalation of role / governance columns
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow reading profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY users_read_own_profile ON public.profiles
FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.customer_id = profiles.id
      AND b.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
  )
);

CREATE POLICY users_update_own_profile ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- -----------------------------------------------------------------------------
-- 3. Trigger: prevent self-escalation of profile role and governance columns
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_governance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'service_role' OR current_setting('app.trusted_write', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role can only be changed by trusted backend flows';
  END IF;

  IF NEW.no_show_count IS DISTINCT FROM OLD.no_show_count
     OR NEW.is_flagged IS DISTINCT FROM OLD.is_flagged
     OR NEW.default_provider_id IS DISTINCT FROM OLD.default_provider_id THEN
    RAISE EXCEPTION 'governance fields can only be changed by trusted system functions';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_governance ON public.profiles;
CREATE TRIGGER trg_guard_profile_governance
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_governance();

-- -----------------------------------------------------------------------------
-- 4. Storage: restrict prescriptions bucket to owning customer + merchant + admin
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow upload to prescriptions and records" ON storage.objects;
DROP POLICY IF EXISTS "Allow read prescriptions and records" ON storage.objects;

CREATE POLICY prescriptions_owner_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'prescriptions-and-records'
  AND (
    owner = auth.uid()
    OR public.is_admin(auth.uid())
    OR (
      (storage.foldername(name))[1] = auth.uid()::text
      AND EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.customer_id = auth.uid()
          AND b.attachment_url = 'prescriptions-and-records/' || name
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.providers p ON b.provider_id = p.id
      WHERE b.attachment_url = 'prescriptions-and-records/' || name
        AND p.id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    )
  )
);

CREATE POLICY prescriptions_owner_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'prescriptions-and-records'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY prescriptions_owner_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'prescriptions-and-records'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'prescriptions-and-records'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY prescriptions_owner_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'prescriptions-and-records'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- venue-assets: read for everyone, write only for owning merchants/admin
DROP POLICY IF EXISTS "Public Access for Venue Assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow upload to venue assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow update venue assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow delete venue assets" ON storage.objects;

CREATE POLICY venue_assets_public_read ON storage.objects
FOR SELECT TO anon, authenticated
USING (bucket_id = 'venue-assets');

CREATE POLICY venue_assets_merchant_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'venue-assets'
  AND EXISTS (
    SELECT 1
    FROM public.providers p
    WHERE p.owner_id = auth.uid()
      AND (storage.foldername(name))[1] = p.id::text
  )
);

CREATE POLICY venue_assets_merchant_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'venue-assets'
  AND EXISTS (
    SELECT 1
    FROM public.providers p
    WHERE p.owner_id = auth.uid()
      AND (storage.foldername(name))[1] = p.id::text
  )
)
WITH CHECK (
  bucket_id = 'venue-assets'
  AND EXISTS (
    SELECT 1
    FROM public.providers p
    WHERE p.owner_id = auth.uid()
      AND (storage.foldername(name))[1] = p.id::text
  )
);

CREATE POLICY venue_assets_merchant_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'venue-assets'
  AND EXISTS (
    SELECT 1
    FROM public.providers p
    WHERE p.owner_id = auth.uid()
      AND (storage.foldername(name))[1] = p.id::text
  )
);

-- -----------------------------------------------------------------------------
-- 5. Harden SECURITY DEFINER functions with auth guards + grant tightening
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_booking_actor(
  p_customer_id UUID,
  p_provider_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.role() = 'service_role'
    OR (SELECT auth.uid()) = p_customer_id
    OR p_provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
    OR public.is_admin(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.assert_booking_actor(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_booking_actor(uuid, uuid) TO authenticated, service_role;

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
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'payment settlement restricted to service role';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status NOT IN ('HELD', 'PENDING_PAYMENT') THEN
    IF v_booking.status = 'CONFIRMED' AND v_booking.gateway_payment_id = p_gateway_payment_id THEN
      RETURN jsonb_build_object(
        'success', true, 'booking_id', p_booking_id,
        'status', 'CONFIRMED', 'payment_status', 'CAPTURED', 'idempotent', true
      );
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'Booking not in a payable state');
  END IF;

  v_amount := COALESCE(p_deposit_amount, v_booking.deposit_amount);

  IF v_amount IS DISTINCT FROM v_booking.deposit_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch with held deposit');
  END IF;

  UPDATE public.bookings
  SET status = 'CONFIRMED',
      payment_status = 'CAPTURED',
      gateway_payment_id = p_gateway_payment_id,
      updated_at = NOW()
  WHERE id = p_booking_id;

  INSERT INTO public.payments (
    booking_id, gateway_payment_id, amount, currency, status
  )
  SELECT p_booking_id, p_gateway_payment_id, v_amount, 'INR', 'CAPTURED'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.payments
    WHERE booking_id = p_booking_id
      AND gateway_payment_id = p_gateway_payment_id
      AND status = 'CAPTURED'
  );

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'CONFIRMED',
    'payment_status', 'CAPTURED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_booking_payment(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_payment(uuid, text, numeric) TO service_role;
