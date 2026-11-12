-- Migration: 20261022000002_fix_clinic_queue_position_concurrency.sql
-- Description: Fix concurrent confirm race in assign_clinic_queue_position using per-resource-per-day advisory lock

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
    IF NEW.status = 'CONFIRMED' AND (OLD.status IS NULL OR OLD.status != 'CONFIRMED') THEN
        -- Check if this is a clinic booking
        SELECT p.category_id INTO v_category_id
        FROM public.providers p WHERE p.id = NEW.provider_id;

        IF v_category_id = 'clinic' OR v_category_id ILIKE '%clinic%' OR v_category_id ILIKE '%doctor%' THEN
            v_slot_date := (NEW.slot_start AT TIME ZONE 'Asia/Kolkata')::date;

            -- Serialize queue position assignment per doctor per day
            PERFORM pg_advisory_xact_lock(hashtext('clinic_queue:' || NEW.resource_id::text || ':' || v_slot_date::text));

            -- Calculate next gap-free monotonic queue position
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
