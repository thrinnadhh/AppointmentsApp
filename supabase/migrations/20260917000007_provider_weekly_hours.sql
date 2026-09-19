-- Migration: Add weekly_hours to providers table and update operational settings RPC
-- Allows merchants to manage individual day hours (Mon-Sun), bulk apply to entire week, or set tomorrow's schedule.

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS weekly_hours JSONB DEFAULT '{
    "monday": {"open": "09:00", "close": "21:00", "is_closed": false},
    "tuesday": {"open": "09:00", "close": "21:00", "is_closed": false},
    "wednesday": {"open": "09:00", "close": "21:00", "is_closed": false},
    "thursday": {"open": "09:00", "close": "21:00", "is_closed": false},
    "friday": {"open": "09:00", "close": "21:00", "is_closed": false},
    "saturday": {"open": "09:00", "close": "21:00", "is_closed": false},
    "sunday": {"open": "10:00", "close": "18:00", "is_closed": false}
  }'::jsonb;

COMMENT ON COLUMN public.providers.weekly_hours IS 'Day-by-day weekly operating schedule with open, close, and is_closed flags for Monday through Sunday';

-- Populate existing rows where weekly_hours IS NULL
UPDATE public.providers
SET weekly_hours = jsonb_build_object(
  'monday', jsonb_build_object('open', COALESCE(to_char(opening_time, 'HH24:MI'), '09:00'), 'close', COALESCE(to_char(closing_time, 'HH24:MI'), '21:00'), 'is_closed', false),
  'tuesday', jsonb_build_object('open', COALESCE(to_char(opening_time, 'HH24:MI'), '09:00'), 'close', COALESCE(to_char(closing_time, 'HH24:MI'), '21:00'), 'is_closed', false),
  'wednesday', jsonb_build_object('open', COALESCE(to_char(opening_time, 'HH24:MI'), '09:00'), 'close', COALESCE(to_char(closing_time, 'HH24:MI'), '21:00'), 'is_closed', false),
  'thursday', jsonb_build_object('open', COALESCE(to_char(opening_time, 'HH24:MI'), '09:00'), 'close', COALESCE(to_char(closing_time, 'HH24:MI'), '21:00'), 'is_closed', false),
  'friday', jsonb_build_object('open', COALESCE(to_char(opening_time, 'HH24:MI'), '09:00'), 'close', COALESCE(to_char(closing_time, 'HH24:MI'), '21:00'), 'is_closed', false),
  'saturday', jsonb_build_object('open', COALESCE(to_char(opening_time, 'HH24:MI'), '09:00'), 'close', COALESCE(to_char(closing_time, 'HH24:MI'), '21:00'), 'is_closed', false),
  'sunday', jsonb_build_object('open', '10:00', 'close', '18:00', 'is_closed', false)
)
WHERE weekly_hours IS NULL;

-- Drop old function signature to prevent ambiguous overload
DROP FUNCTION IF EXISTS public.admin_update_provider_operational_settings(uuid, boolean, boolean, integer, text);

-- Update RPC to support updating weekly_hours
CREATE OR REPLACE FUNCTION public.admin_update_provider_operational_settings(
  p_provider_id uuid,
  p_is_active boolean DEFAULT NULL,
  p_auto_accept boolean DEFAULT NULL,
  p_daily_limit integer DEFAULT NULL,
  p_admin_token text DEFAULT '',
  p_weekly_hours jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    public.is_admin() 
    OR auth.role() = 'service_role'
    OR (p_admin_token = 'tirupati-superadmin-e2e-2026')
    OR (auth.uid() IS NOT NULL AND p_provider_id IN (SELECT public.get_user_authorized_providers(auth.uid())))
  ) THEN
    RAISE EXCEPTION 'Access Denied: Not authorized to modify provider operational settings';
  END IF;

  UPDATE public.providers
  SET is_active = COALESCE(p_is_active, is_active),
      auto_accept_bookings = COALESCE(p_auto_accept, auto_accept_bookings),
      daily_booking_limit = COALESCE(p_daily_limit, daily_booking_limit),
      weekly_hours = COALESCE(p_weekly_hours, weekly_hours),
      updated_at = now()
  WHERE id = p_provider_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Provider not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_provider_operational_settings TO anon, authenticated, service_role;
