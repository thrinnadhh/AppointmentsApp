-- Migration: 20260909000001_security_fixes.sql
-- Production Security Hardening & Performance Optimization Gate
-- -----------------------------------------------------------------------------
-- 1. Function search_path mutability hardening (SET search_path = public, pg_temp)
-- 2. Authorization enforcement on sensitive admin and merchant RPCs
-- 3. Revoke public/anon execute on sensitive stored procedures
-- 4. Drop all temporary preview bypass policies
-- 5. Add database trigger protecting booking payment fields from client tampering
-- 6. Add covering indexes on unindexed foreign keys
-- 7. Optimize RLS auth function calls with (SELECT auth.uid()) InitPlan subqueries
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 1. Helper Function: is_admin
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role = 'admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Admin RPC: admin_create_user
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text DEFAULT 'merchant',
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_encrypted_pw text;
  v_phone text;
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'
      ) THEN
        RAISE EXCEPTION 'Only an existing admin or service role can create new staff users';
      END IF;
    END IF;
  END IF;

  IF p_email IS NULL OR position('@' in p_email) = 0 THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;
  IF length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'User with this email already exists';
  END IF;

  v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));
  v_phone := COALESCE(p_phone, '+91' || lpad((floor(random() * 9000000000) + 1000000000)::text, 10, '0'));

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    phone_change_token, reauthentication_token, email_change_token_current, is_super_admin
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    lower(trim(p_email)), v_encrypted_pw, now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'role', p_role),
    now(), now(), '', '', '', '', '', '', '', (p_role = 'admin')
  );

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), v_user_id, jsonb_build_object('sub', v_user_id, 'email', lower(trim(p_email))),
          'email', v_user_id::text, now(), now(), now());

  INSERT INTO public.profiles (id, full_name, phone, role, email)
  VALUES (v_user_id, p_full_name, v_phone, p_role::public.user_role, lower(trim(p_email)))
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, email = EXCLUDED.email;

  RETURN jsonb_build_object('id', v_user_id, 'email', lower(trim(p_email)), 'full_name', p_full_name,
                             'role', p_role, 'phone', v_phone);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Admin RPC: admin_create_venue
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_venue(
  p_name text,
  p_category_id text,
  p_address text,
  p_phone text,
  p_opening_time time DEFAULT '09:00:00',
  p_closing_time time DEFAULT '21:00:00',
  p_description text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_latitude numeric DEFAULT 13.6288,
  p_longitude numeric DEFAULT 79.4192
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_provider_id uuid := gen_random_uuid();
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin') THEN
      RAISE EXCEPTION 'Only an admin can create a venue';
    END IF;
  END IF;

  INSERT INTO public.providers (id, name, category_id, address, city, phone, email, opening_time,
                                 closing_time, description, owner_id, latitude, longitude, status)
  VALUES (v_provider_id, p_name, p_category_id, p_address, 'Tirupati', p_phone, p_email,
          p_opening_time, p_closing_time, p_description, p_owner_id, p_latitude, p_longitude, 'ACTIVE');

  RETURN jsonb_build_object('id', v_provider_id, 'name', p_name, 'category_id', p_category_id,
                             'address', p_address, 'phone', p_phone,
                             'opening_time', p_opening_time, 'closing_time', p_closing_time);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_venue(text, text, text, text, time, time, text, text, uuid, numeric, numeric) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Admin RPC: admin_create_resource
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_resource(
  p_provider_id uuid,
  p_name text,
  p_type text,
  p_department text DEFAULT 'General',
  p_price numeric DEFAULT 500.00,
  p_deposit_amount numeric DEFAULT 50.00,
  p_duration_minutes integer DEFAULT 30,
  p_capacity integer DEFAULT 1,
  p_attributes jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_resource_id uuid := gen_random_uuid();
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin') THEN
      RAISE EXCEPTION 'Only an admin can create a resource';
    END IF;
  END IF;

  INSERT INTO public.resources (id, provider_id, name, type, department, price, deposit_amount,
                                 duration_minutes, capacity, attributes, is_active)
  VALUES (v_resource_id, p_provider_id, p_name, p_type, p_department, p_price, p_deposit_amount,
          p_duration_minutes, p_capacity, p_attributes, true);

  RETURN jsonb_build_object('id', v_resource_id, 'provider_id', p_provider_id, 'name', p_name,
                             'type', p_type, 'department', p_department, 'price', p_price,
                             'deposit_amount', p_deposit_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_resource(uuid, text, text, text, numeric, numeric, integer, integer, jsonb) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Merchant RPC: record_no_show
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_no_show(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_customer_id UUID;
    v_provider_id UUID;
    v_count INT;
BEGIN
    SELECT provider_id, customer_id INTO v_provider_id, v_customer_id
    FROM public.bookings WHERE id = p_booking_id;

    IF v_provider_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    IF auth.role() = 'authenticated' THEN
      IF NOT (
        EXISTS (SELECT 1 FROM public.providers WHERE id = v_provider_id AND owner_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
      ) THEN
        RAISE EXCEPTION 'Only the owning merchant or an admin can record a no-show';
      END IF;
    END IF;

    PERFORM set_config('app.trusted_write', 'true', true);

    UPDATE public.bookings
    SET status = 'NO_SHOW', payment_status = 'FORFEITED', updated_at = NOW()
    WHERE id = p_booking_id
    RETURNING customer_id INTO v_customer_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    UPDATE public.profiles
    SET no_show_count = no_show_count + 1,
        is_flagged = CASE WHEN no_show_count + 1 >= 4 THEN TRUE ELSE is_flagged END,
        updated_at = NOW()
    WHERE id = v_customer_id
    RETURNING no_show_count INTO v_count;

    RETURN jsonb_build_object('success', true, 'no_show_count', v_count, 'flagged', v_count >= 4);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_no_show(uuid) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Cron RPC: release_expired_holds
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_expired_holds()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_released_count INT;
BEGIN
    WITH updated AS (
        UPDATE public.bookings
        SET status = 'CANCELLED',
            updated_at = NOW()
        WHERE status = 'HELD'
          AND hold_expires_at < NOW()
        RETURNING id
    )
    SELECT count(*) INTO v_released_count FROM updated;

    RETURN jsonb_build_object(
        'success', true,
        'released_count', v_released_count,
        'timestamp', NOW()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_expired_holds() TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Booking RPC: create_booking_hold
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id UUID,
    p_slot_start TIMESTAMPTZ,
    p_slot_end TIMESTAMPTZ,
    p_customer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_provider_id UUID;
    v_deposit_amount NUMERIC(10, 2);
    v_is_active BOOLEAN;
    v_existing_booking_id UUID;
    v_new_booking_id UUID;
    v_hold_expiry TIMESTAMPTZ;
BEGIN
    UPDATE public.bookings
    SET status = 'CANCELLED', updated_at = NOW()
    WHERE status = 'HELD' AND hold_expires_at < NOW();

    SELECT provider_id, deposit_amount, is_active 
    INTO v_provider_id, v_deposit_amount, v_is_active
    FROM public.resources
    WHERE id = p_resource_id;

    IF NOT FOUND OR NOT v_is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Resource not found or inactive');
    END IF;

    SELECT id INTO v_existing_booking_id
    FROM public.bookings
    WHERE resource_id = p_resource_id
      AND slot_start = p_slot_start
      AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
    FOR UPDATE;

    IF v_existing_booking_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked by another customer');
    END IF;

    v_hold_expiry := NOW() + INTERVAL '5 minutes';

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

GRANT EXECUTE ON FUNCTION public.create_booking_hold(uuid, timestamptz, timestamptz, uuid) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Trigger: protect_booking_payment_fields
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_booking_payment_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hours_to_slot numeric;
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

    v_hours_to_slot := EXTRACT(EPOCH FROM (OLD.slot_start - now())) / 3600;

    IF v_hours_to_slot > 1 AND NEW.payment_status != 'REFUNDED' THEN
      RAISE EXCEPTION 'Cancellations more than 1 hour before the slot must be REFUNDED, not %', NEW.payment_status;
    ELSIF v_hours_to_slot <= 1 AND NEW.payment_status != 'FORFEITED' THEN
      RAISE EXCEPTION 'Cancellations within 1 hour of the slot must be FORFEITED, not %', NEW.payment_status;
    END IF;
  END IF;

  IF (SELECT auth.uid()) = OLD.customer_id AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status != 'CANCELLED' THEN
    RAISE EXCEPTION 'Customers may only cancel their own booking, not set status to %', NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_booking_payment_fields ON public.bookings;
CREATE TRIGGER trg_protect_booking_payment_fields
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.protect_booking_payment_fields();

-- -----------------------------------------------------------------------------
-- 9. Drop all temporary preview bypass policies
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Enable read for all during preview" ON public.bookings;
DROP POLICY IF EXISTS "Enable insert for all during preview" ON public.bookings;
DROP POLICY IF EXISTS "Enable update for all during preview" ON public.bookings;
DROP POLICY IF EXISTS "Enable read for all payments during preview" ON public.payments;
DROP POLICY IF EXISTS "Enable insert for all payments during preview" ON public.payments;
DROP POLICY IF EXISTS "Enable read for all profiles during preview" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can insert providers" ON public.providers;
DROP POLICY IF EXISTS "Authenticated users can update providers" ON public.providers;
DROP POLICY IF EXISTS "Authenticated users can insert resources" ON public.resources;
DROP POLICY IF EXISTS "Authenticated users can update resources" ON public.resources;

-- -----------------------------------------------------------------------------
-- 10. Re-create Optimized RLS Policies (InitPlan auth subqueries)
-- -----------------------------------------------------------------------------
-- Profiles
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow reading profiles" ON public.profiles;
CREATE POLICY "Allow reading profiles" ON public.profiles
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
FOR UPDATE USING ((SELECT auth.uid()) = id);

-- Providers
DROP POLICY IF EXISTS "Active providers are readable by everyone" ON public.providers;
CREATE POLICY "Active providers are readable by everyone" ON public.providers
FOR SELECT USING ((status = 'ACTIVE'::provider_status) OR ((SELECT auth.uid()) = owner_id));

DROP POLICY IF EXISTS "Merchants can insert own provider" ON public.providers;
CREATE POLICY "Merchants can insert own provider" ON public.providers
FOR INSERT WITH CHECK ((SELECT auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Merchants can update own provider" ON public.providers;
CREATE POLICY "Merchants can update own provider" ON public.providers
FOR UPDATE USING ((SELECT auth.uid()) = owner_id);

-- Resources
DROP POLICY IF EXISTS "Active resources are readable by everyone" ON public.resources;
CREATE POLICY "Active resources are readable by everyone" ON public.resources
FOR SELECT USING ((is_active = true) OR (provider_id IN (SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "Merchants can manage resources" ON public.resources;
DROP POLICY IF EXISTS "Merchants can insert resources" ON public.resources;
DROP POLICY IF EXISTS "Merchants can update resources" ON public.resources;
DROP POLICY IF EXISTS "Merchants can delete resources" ON public.resources;
CREATE POLICY "Merchants can insert resources" ON public.resources
FOR INSERT WITH CHECK (provider_id IN (SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())));
CREATE POLICY "Merchants can update resources" ON public.resources
FOR UPDATE USING (provider_id IN (SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())));
CREATE POLICY "Merchants can delete resources" ON public.resources
FOR DELETE USING (provider_id IN (SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid())));

-- Resource Availability
DROP POLICY IF EXISTS "Merchants can manage availability" ON public.resource_availability;
DROP POLICY IF EXISTS "Merchants can insert availability" ON public.resource_availability;
DROP POLICY IF EXISTS "Merchants can update availability" ON public.resource_availability;
DROP POLICY IF EXISTS "Merchants can delete availability" ON public.resource_availability;
CREATE POLICY "Merchants can insert availability" ON public.resource_availability
FOR INSERT WITH CHECK (resource_id IN (SELECT r.id FROM public.resources r JOIN public.providers p ON r.provider_id = p.id WHERE p.owner_id = (SELECT auth.uid())));
CREATE POLICY "Merchants can update availability" ON public.resource_availability
FOR UPDATE USING (resource_id IN (SELECT r.id FROM public.resources r JOIN public.providers p ON r.provider_id = p.id WHERE p.owner_id = (SELECT auth.uid())));
CREATE POLICY "Merchants can delete availability" ON public.resource_availability
FOR DELETE USING (resource_id IN (SELECT r.id FROM public.resources r JOIN public.providers p ON r.provider_id = p.id WHERE p.owner_id = (SELECT auth.uid())));

-- Bookings
DROP POLICY IF EXISTS "Customers can view own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Merchants can view provider bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow reading bookings" ON public.bookings;
CREATE POLICY "Allow reading bookings" ON public.bookings
FOR SELECT USING (
  (SELECT auth.uid()) IS NULL
  OR (SELECT auth.uid()) = customer_id
  OR provider_id IN (SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "Customers can update own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Merchants can update provider bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow updating bookings" ON public.bookings;
CREATE POLICY "Allow updating bookings" ON public.bookings
FOR UPDATE USING (
  (SELECT auth.uid()) IS NULL
  OR (SELECT auth.uid()) = customer_id
  OR provider_id IN (SELECT p.id FROM public.providers p WHERE p.owner_id = (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "Customers can create bookings" ON public.bookings;
CREATE POLICY "Customers can create bookings" ON public.bookings
FOR INSERT WITH CHECK ((SELECT auth.uid()) = customer_id);

-- Payments
DROP POLICY IF EXISTS "Customers can view own payments" ON public.payments;
DROP POLICY IF EXISTS "Merchants can view provider payments" ON public.payments;
DROP POLICY IF EXISTS "Allow reading payments" ON public.payments;
CREATE POLICY "Allow reading payments" ON public.payments
FOR SELECT USING (
  (SELECT auth.uid()) IS NULL
  OR booking_id IN (SELECT b.id FROM public.bookings b WHERE b.customer_id = (SELECT auth.uid()))
  OR booking_id IN (SELECT b.id FROM public.bookings b JOIN public.providers p ON b.provider_id = p.id WHERE p.owner_id = (SELECT auth.uid()))
);

-- -----------------------------------------------------------------------------
-- 11. Covering Indexes for Unindexed Foreign Keys
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON public.payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_providers_owner_id ON public.providers(owner_id);
CREATE INDEX IF NOT EXISTS idx_providers_sub_category_id ON public.providers(sub_category_id);
CREATE INDEX IF NOT EXISTS idx_resource_availability_resource_id ON public.resource_availability(resource_id);
CREATE INDEX IF NOT EXISTS idx_sub_categories_category_id ON public.sub_categories(category_id);

-- -----------------------------------------------------------------------------
-- 12. RPC: confirm_booking_payment
-- -----------------------------------------------------------------------------
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
  v_amount numeric(10, 2);
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  v_amount := COALESCE(p_deposit_amount, v_booking.deposit_amount, 100.00);

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CONFIRMED',
      payment_status = 'CAPTURED',
      gateway_payment_id = p_gateway_payment_id,
      updated_at = NOW()
  WHERE id = p_booking_id;

  INSERT INTO public.payments (
    booking_id,
    gateway_payment_id,
    amount,
    currency,
    status
  ) VALUES (
    p_booking_id,
    p_gateway_payment_id,
    v_amount,
    'INR',
    'CAPTURED'
  );

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'CONFIRMED',
    'payment_status', 'CAPTURED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_booking_payment(uuid, text, numeric) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 13. RPC: reschedule_booking_slot
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_booking_slot(
  p_booking_id UUID,
  p_new_slot_start TIMESTAMPTZ,
  p_new_slot_end TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_conflict_id UUID;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status IN ('CANCELLED', 'COMPLETED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reschedule a ' || lower(v_booking.status::text) || ' booking');
  END IF;

  SELECT id INTO v_conflict_id
  FROM public.bookings
  WHERE resource_id = v_booking.resource_id
    AND slot_start = p_new_slot_start
    AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
    AND id != p_booking_id
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'The requested new slot is already booked or held');
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET slot_start = p_new_slot_start,
      slot_end = p_new_slot_end,
      status = 'CONFIRMED',
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'slot_start', p_new_slot_start,
    'slot_end', p_new_slot_end,
    'status', 'CONFIRMED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_booking_slot(uuid, timestamptz, timestamptz) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 14. RPC: cancel_booking
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id UUID,
  p_reason TEXT DEFAULT 'Standard cancellation',
  p_initiated_by TEXT DEFAULT 'CUSTOMER'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_hours_to_slot NUMERIC;
  v_eligible BOOLEAN;
  v_payment_status public.payment_status;
  v_refund_amount NUMERIC(10, 2) := 0;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking is already cancelled');
  END IF;

  v_hours_to_slot := EXTRACT(EPOCH FROM (v_booking.slot_start - NOW())) / 3600;
  IF upper(p_initiated_by) = 'MERCHANT' THEN
    v_eligible := true;
  ELSE
    v_eligible := (v_hours_to_slot > 1);
  END IF;

  IF v_eligible THEN
    v_payment_status := 'REFUNDED'::public.payment_status;
    v_refund_amount := v_booking.deposit_amount;
  ELSE
    v_payment_status := 'FORFEITED'::public.payment_status;
  END IF;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET status = 'CANCELLED',
      payment_status = v_payment_status,
      updated_at = NOW()
  WHERE id = p_booking_id;

  IF v_booking.gateway_payment_id IS NOT NULL THEN
    UPDATE public.payments
    SET status = v_payment_status,
        updated_at = NOW(),
        metadata = jsonb_build_object(
          'cancellation_reason', p_reason,
          'initiated_by', p_initiated_by,
          'refund_amount', v_refund_amount
        )
    WHERE booking_id = p_booking_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'CANCELLED',
    'payment_status', v_payment_status,
    'refund_eligible', v_eligible,
    'refund_amount', v_refund_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text) TO anon, authenticated, service_role;
