-- Migration: 20260919000001_platform_fee_breakdown.sql
-- Description: Dynamic platform fees (₹10 for Clinics, Salons, Pets, Restaurants; ₹50 for Gaming/Turf) added to bookings

-- 1. Add platform_fee and total_amount columns to public.bookings
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(10, 2) DEFAULT 10.00;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10, 2);

-- 2. Backfill existing bookings with vertical-based platform fee
UPDATE public.bookings b
SET platform_fee = CASE 
  WHEN p.category_id IN ('gaming', 'turf') THEN 50.00 
  ELSE 10.00 
END,
total_amount = COALESCE(b.deposit_amount, 0) + CASE 
  WHEN p.category_id IN ('gaming', 'turf') THEN 50.00 
  ELSE 10.00 
END
FROM public.providers p
WHERE b.provider_id = p.id AND (b.platform_fee IS NULL OR b.total_amount IS NULL);

-- 3. Update create_booking_hold RPC to compute and store platform fee & total
CREATE OR REPLACE FUNCTION public.create_booking_hold(
    p_resource_id UUID,
    p_slot_start TIMESTAMPTZ,
    p_slot_end TIMESTAMPTZ,
    p_customer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_provider_id UUID;
    v_provider_status provider_status;
    v_category_id TEXT;
    v_deposit_amount NUMERIC(10, 2);
    v_platform_fee NUMERIC(10, 2);
    v_total_amount NUMERIC(10, 2);
    v_is_active BOOLEAN;
    v_existing_booking_id UUID;
    v_new_booking_id UUID;
    v_reference_code TEXT;
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

    -- Guard: check if merchant provider is suspended or fetch category
    SELECT status, category_id INTO v_provider_status, v_category_id
    FROM public.providers
    WHERE id = v_provider_id;

    IF v_provider_status = 'SUSPENDED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Merchant provider is suspended. Bookings unavailable.');
    END IF;

    -- Calculate platform fee: ₹50 for Gaming & Turf, ₹10 for all others
    IF v_category_id IN ('gaming', 'turf') THEN
        v_platform_fee := 50.00;
    ELSE
        v_platform_fee := 10.00;
    END IF;

    v_total_amount := COALESCE(v_deposit_amount, 0) + v_platform_fee;

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
        platform_fee,
        total_amount,
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
        v_platform_fee,
        v_total_amount,
        v_hold_expiry
    )
    RETURNING id, reference_code INTO v_new_booking_id, v_reference_code;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_new_booking_id,
        'reference_code', v_reference_code,
        'deposit_amount', v_deposit_amount,
        'platform_fee', v_platform_fee,
        'total_amount', v_total_amount,
        'hold_expires_at', v_hold_expiry
    );
END;
$function$;
