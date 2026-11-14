-- 20261114000003_scale_100k_rls_and_hold_batching.sql
-- Resolution of 100,000-User Scale Stress Test Bottlenecks:
-- 1. Uncorrelated InitPlan for hospital resource check in bookings_select_policy and bookings_update_policy
-- 2. Bounded batching (LIMIT 1000 FOR UPDATE SKIP LOCKED) in release_expired_holds()
-- 3. Trigger optimization: Fast exit for unpaid HELD cancellations/expirations

-- 1. Helper function: Uncorrelated hospital accessible resource IDs for user
CREATE OR REPLACE FUNCTION public.hospital_accessible_resource_ids_for_user(p_user_id uuid DEFAULT auth.uid())
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := CASE
    WHEN auth.role() = 'authenticated' THEN auth.uid()
    ELSE COALESCE(p_user_id, auth.uid())
  END;
  v_user_email TEXT;
  v_email_confirmed BOOLEAN := FALSE;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN;
  END IF;

  -- Superadmin has access to all hospital resources
  IF public.is_admin(v_caller_id) THEN
    RETURN QUERY
      SELECT r.id
      FROM public.resources r
      WHERE public.is_hospital_provider(r.provider_id);
    RETURN;
  END IF;

  -- Fetch caller email & confirmation status once
  SELECT email, (email_confirmed_at IS NOT NULL)
  INTO v_user_email, v_email_confirmed
  FROM auth.users
  WHERE id = v_caller_id;

  RETURN QUERY
    SELECT DISTINCT res_id FROM (
      -- 1. All resources for hospitals where caller is admin or owner
      SELECT r.id AS res_id
      FROM public.resources r
      WHERE r.provider_id IN (
        SELECT p.id FROM public.providers p
        WHERE (
          p.owner_id = v_caller_id
          OR EXISTS (
            SELECT 1 FROM public.department_members dm 
            WHERE dm.user_id = v_caller_id
              AND dm.merchant_id = p.id
              AND dm.status = 'active'
              AND dm.role = 'admin'
          )
        )
        AND public.is_hospital_provider(p.id)
      )
      UNION
      -- 2. Doctor assignments for front desk staff
      SELECT dfda.doctor_id AS res_id
      FROM public.doctor_front_desk_assignments dfda
      WHERE dfda.user_id = v_caller_id
        AND public.is_hospital_provider(dfda.provider_id)
        AND EXISTS (
          SELECT 1 FROM public.department_members dm
          WHERE dm.user_id = v_caller_id
            AND dm.merchant_id = dfda.provider_id
            AND dm.status = 'active'
        )
      UNION
      -- 3. Consultant's own resources
      SELECT r.id AS res_id
      FROM public.resources r
      WHERE public.is_hospital_provider(r.provider_id)
        AND (
          r.user_id = v_caller_id
          OR (
            (r.attributes->>'user_id') IS NOT NULL
            AND (r.attributes->>'user_id')::uuid = v_caller_id
          )
          OR (
            r.attributes->>'email' IS NOT NULL
            AND v_user_email IS NOT NULL
            AND lower(trim(r.attributes->>'email')) = lower(trim(v_user_email))
            AND v_email_confirmed IS TRUE
          )
        )
    ) sub;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.hospital_accessible_resource_ids_for_user(uuid) TO authenticated, service_role;

-- 2. Update bookings_select_policy with uncorrelated InitPlan
DROP POLICY IF EXISTS "bookings_select_policy" ON public.bookings;

CREATE POLICY "bookings_select_policy" ON public.bookings
FOR SELECT TO authenticated
USING (
  ((( SELECT auth.uid() AS uid) = customer_id)
   OR is_admin(( SELECT auth.uid() AS uid))
   OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN ( SELECT get_user_authorized_providers(( SELECT auth.uid() AS uid)) AS get_user_authorized_providers)))
   OR (is_hospital_provider(provider_id) AND (
        (hospital_role(provider_id, ( SELECT auth.uid() AS uid)) = 'admin'::text)
        OR (
          (resource_id IS NOT NULL)
          AND (resource_id = ANY(ARRAY(SELECT public.hospital_accessible_resource_ids_for_user((SELECT auth.uid())))))
          AND ((department_id IS NULL) OR (EXISTS (
            SELECT 1 FROM departments d
            WHERE d.id = bookings.department_id
              AND (('appointments'::text = ANY (d.allowed_modules)) OR ('queue_schedule'::text = ANY (d.allowed_modules)) OR ('check_in'::text = ANY (d.allowed_modules)))
          )))
        )
      ))
  )
);

-- 3. Update bookings_update_policy with uncorrelated InitPlan
DROP POLICY IF EXISTS "bookings_update_policy" ON public.bookings;

CREATE POLICY "bookings_update_policy" ON public.bookings
FOR UPDATE TO authenticated
USING (
  ((( SELECT auth.uid() AS uid) = customer_id)
   OR is_admin(( SELECT auth.uid() AS uid))
   OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN ( SELECT get_user_authorized_providers(( SELECT auth.uid() AS uid)) AS get_user_authorized_providers)))
   OR (is_hospital_provider(provider_id) AND (
        (hospital_role(provider_id, ( SELECT auth.uid() AS uid)) = 'admin'::text)
        OR (
          (resource_id IS NOT NULL)
          AND (resource_id = ANY(ARRAY(SELECT public.hospital_accessible_resource_ids_for_user((SELECT auth.uid())))))
          AND ((department_id IS NULL) OR (EXISTS (
            SELECT 1 FROM departments d
            WHERE d.id = bookings.department_id
              AND (('appointments'::text = ANY (d.allowed_modules)) OR ('queue_schedule'::text = ANY (d.allowed_modules)) OR ('check_in'::text = ANY (d.allowed_modules)))
          )))
        )
      ))
  )
)
WITH CHECK (
  ((( SELECT auth.uid() AS uid) = customer_id)
   OR is_admin(( SELECT auth.uid() AS uid))
   OR ((NOT is_hospital_provider(provider_id)) AND (provider_id IN ( SELECT get_user_authorized_providers(( SELECT auth.uid() AS uid)) AS get_user_authorized_providers)))
   OR (is_hospital_provider(provider_id) AND (
        (hospital_role(provider_id, ( SELECT auth.uid() AS uid)) = 'admin'::text)
        OR (
          (resource_id IS NOT NULL)
          AND (resource_id = ANY(ARRAY(SELECT public.hospital_accessible_resource_ids_for_user((SELECT auth.uid())))))
        )
      ))
  )
);

-- 4. Batch release_expired_holds() with LIMIT 1000 FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.release_expired_holds()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_released_count INT;
BEGIN
    PERFORM set_config('app.trusted_write', 'true', true);

    WITH expired_candidates AS (
        SELECT id
        FROM public.bookings
        WHERE status = 'HELD'
          AND hold_expires_at <= NOW()
        ORDER BY hold_expires_at ASC
        LIMIT 1000
        FOR UPDATE SKIP LOCKED
    ),
    updated AS (
        UPDATE public.bookings b
        SET status = 'CANCELLED',
            payment_status = 'FORFEITED',
            updated_at = NOW()
        FROM expired_candidates c
        WHERE b.id = c.id
        RETURNING b.id
    )
    SELECT count(*) INTO v_released_count FROM updated;

    RETURN jsonb_build_object(
        'success', true,
        'released_count', v_released_count,
        'timestamp', NOW()
    );
END;
$function$;

-- 5. Trigger optimization on public.bookings: fast exit for unpaid HELD cancellations/expirations
CREATE OR REPLACE FUNCTION public.assign_clinic_queue_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_category_id TEXT;
    v_pos         INT;
    v_slot_date   DATE;
BEGIN
    -- Fast exit for cancelled/expired holds: unpaid HELD slots were never in the active clinic queue
    IF OLD.status = 'HELD' AND NEW.status = 'CANCELLED' THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'CONFIRMED' AND (OLD.status IS NULL OR OLD.status != 'CONFIRMED') THEN
        SELECT p.category_id INTO v_category_id
        FROM public.providers p WHERE p.id = NEW.provider_id;

        IF v_category_id = 'clinic' OR v_category_id ILIKE '%clinic%' OR v_category_id ILIKE '%doctor%' THEN
            v_slot_date := (NEW.slot_start AT TIME ZONE 'Asia/Kolkata')::date;

            PERFORM pg_advisory_xact_lock(hashtext('clinic_queue:' || NEW.resource_id::text || ':' || v_slot_date::text));

            IF NEW.queue_position IS NULL THEN
                SELECT COALESCE(MAX(queue_position), 0) + 1 INTO v_pos
                FROM public.bookings
                WHERE resource_id  = NEW.resource_id
                  AND (slot_start AT TIME ZONE 'Asia/Kolkata')::date = v_slot_date
                  AND status IN ('CONFIRMED', 'COMPLETED', 'CHECKED_IN', 'IN_CONSULTATION')
                  AND id != NEW.id;

                NEW.queue_position := v_pos;
                NEW.estimated_wait_minutes := (v_pos - 1) * COALESCE(
                    (SELECT duration_minutes FROM public.resources WHERE id = NEW.resource_id),
                    15
                );
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

-- 6. Skip notification dispatch for expired/cancelled holds
CREATE OR REPLACE FUNCTION public.handle_booking_notification_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- When booking becomes CONFIRMED
  IF NEW.status = 'CONFIRMED' AND (TG_OP = 'INSERT' OR OLD.status != 'CONFIRMED') THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'BOOKING_CONFIRMED');
  END IF;

  -- When booking becomes CANCELLED (skip unpaid HELD holds)
  IF NEW.status = 'CANCELLED' AND (TG_OP = 'UPDATE' AND OLD.status != 'CANCELLED' AND OLD.status != 'HELD') THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'BOOKING_CANCELLED');
  END IF;

  -- When refund is processed (payment_status transitions to REFUNDED)
  IF NEW.payment_status = 'REFUNDED' AND (TG_OP = 'UPDATE' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'REFUNDED')) THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'REFUND_PROCESSED');
  END IF;

  RETURN NEW;
END;
$function$;
