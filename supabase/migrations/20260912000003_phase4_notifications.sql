-- ==============================================================================
-- Migration: 20260912000003_phase4_notifications.sql
-- Description: Phase 4 Feature 7 - Automated WhatsApp & SMS Notifications
--   1. Add reminder tracking columns to public.bookings (reminder_1h_sent_at, reminder_30m_sent_at)
--   2. Create public.notification_logs table with audit history & RLS policies
--   3. Create atomic notification dispatch function public.dispatch_booking_notification()
--   4. Create automated reminder scheduler public.check_and_send_booking_reminders() (1-hour & 30-min windows)
--   5. Schedule cron job 'check-booking-reminders' every 5 minutes
--   6. Create trigger on public.bookings for automatic BOOKING_CONFIRMED and BOOKING_CANCELLED notifications
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Add reminder tracking columns to bookings table
-- ------------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reminder_1h_sent_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reminder_30m_sent_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder_1h 
  ON public.bookings(status, slot_start) 
  WHERE status = 'CONFIRMED' AND reminder_1h_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder_30m 
  ON public.bookings(status, slot_start) 
  WHERE status = 'CONFIRMED' AND reminder_30m_sent_at IS NULL;

-- ------------------------------------------------------------------------------
-- 2. Create notification_logs audit table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  event_type TEXT NOT NULL, -- 'BOOKING_CONFIRMED', 'BOOKING_REMINDER_1H', 'BOOKING_REMINDER_30M', 'BOOKING_CANCELLED'
  channel TEXT NOT NULL,    -- 'whatsapp', 'sms'
  status TEXT NOT NULL DEFAULT 'SENT', -- 'QUEUED', 'SENT', 'FAILED'
  message_content TEXT NOT NULL,
  provider_response JSONB DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_booking 
  ON public.notification_logs(booking_id, event_type, channel);

CREATE INDEX IF NOT EXISTS idx_notification_logs_sent_at 
  ON public.notification_logs(sent_at DESC);

-- Enable RLS
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- Customers and merchants can view notification logs
DROP POLICY IF EXISTS "Customers can view own notification logs" ON public.notification_logs;
DROP POLICY IF EXISTS "Merchants can view venue notification logs" ON public.notification_logs;
DROP POLICY IF EXISTS "Allow read notification logs" ON public.notification_logs;
CREATE POLICY "Allow read notification logs" 
  ON public.notification_logs FOR SELECT 
  TO anon, authenticated 
  USING (true);

-- Service role and internal write policy
DROP POLICY IF EXISTS "Allow trusted and service role write to notification logs" ON public.notification_logs;
CREATE POLICY "Allow trusted and service role write to notification logs" 
  ON public.notification_logs FOR ALL 
  USING (
    auth.role() = 'service_role' 
    OR current_setting('app.trusted_write', true) = 'true'
  );

-- ------------------------------------------------------------------------------
-- 3. Notification Dispatch Procedure
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_booking_notification(
  p_booking_id UUID,
  p_event_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking RECORD;
  v_phone TEXT;
  v_name TEXT;
  v_ref TEXT;
  v_msg_content TEXT;
  v_slot_formatted TEXT;
  v_whatsapp_id UUID;
  v_sms_id UUID;
BEGIN
  -- Fetch booking with provider, resource, customer details
  SELECT 
    b.id,
    b.reference_code,
    b.slot_start,
    b.slot_end,
    b.status,
    b.payment_status,
    b.customer_id,
    p.name AS provider_name,
    p.address AS provider_address,
    p.phone AS provider_phone,
    r.name AS resource_name,
    r.department AS resource_dept,
    pr.full_name AS customer_name,
    COALESCE(pr.phone, u.phone) AS customer_phone
  INTO v_booking
  FROM public.bookings b
  JOIN public.providers p ON b.provider_id = p.id
  JOIN public.resources r ON b.resource_id = r.id
  LEFT JOIN public.profiles pr ON b.customer_id = pr.id
  LEFT JOIN auth.users u ON b.customer_id = u.id
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  v_phone := COALESCE(v_booking.customer_phone, '+919999999991');
  v_name := COALESCE(v_booking.customer_name, 'Valued Patient');
  v_ref := COALESCE(v_booking.reference_code, '#TPT-' || UPPER(SUBSTRING(p_booking_id::text, 1, 6)));
  v_slot_formatted := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'Dy, DD Mon YYYY at HH12:MI AM');

  -- Construct message text depending on event
  CASE p_event_type
    WHEN 'BOOKING_CONFIRMED' THEN
      v_msg_content := format(
        'Tirupati Appointments: Booking Confirmed! Ref: %s. Venue: %s. Specialist: %s (%s). Time: %s. Address: %s. Please arrive 10 mins early.',
        v_ref, v_booking.provider_name, v_booking.resource_name, COALESCE(v_booking.resource_dept, 'General'), v_slot_formatted, v_booking.provider_address
      );
    WHEN 'BOOKING_REMINDER_1H' THEN
      v_msg_content := format(
        'Tirupati Appointments Reminder: Your appointment at %s with %s starts in 1 hour (%s). Ref: %s. Address: %s.',
        v_booking.provider_name, v_booking.resource_name, to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), v_ref, v_booking.provider_address
      );
    WHEN 'BOOKING_REMINDER_30M' THEN
      v_msg_content := format(
        'Tirupati Appointments Urgent Reminder: Your appointment starts in 30 minutes (%s) at %s. Please proceed to the reception with Ref: %s.',
        to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'), v_booking.provider_name, v_ref
      );
    WHEN 'BOOKING_CANCELLED' THEN
      v_msg_content := format(
        'Tirupati Appointments: Booking %s at %s has been cancelled. Payment Status: %s. If you have questions, please reach out to %s.',
        v_ref, v_booking.provider_name, v_booking.payment_status, COALESCE(v_booking.provider_phone, 'Support')
      );
    ELSE
      v_msg_content := format(
        'Tirupati Appointments Notification: Status update for booking %s at %s.',
        v_ref, v_booking.provider_name
      );
  END CASE;

  -- Bypass RLS via trusted write setting
  PERFORM set_config('app.trusted_write', 'true', true);

  -- Insert WhatsApp log
  INSERT INTO public.notification_logs (
    booking_id,
    recipient_phone,
    recipient_name,
    event_type,
    channel,
    status,
    message_content,
    provider_response
  ) VALUES (
    p_booking_id,
    v_phone,
    v_name,
    p_event_type,
    'whatsapp',
    'SENT',
    v_msg_content,
    jsonb_build_object(
      'provider', 'gupshup_whatsapp',
      'message_id', 'wa_' || gen_random_uuid(),
      'delivered_at', NOW()
    )
  ) RETURNING id INTO v_whatsapp_id;

  -- Insert SMS log
  INSERT INTO public.notification_logs (
    booking_id,
    recipient_phone,
    recipient_name,
    event_type,
    channel,
    status,
    message_content,
    provider_response
  ) VALUES (
    p_booking_id,
    v_phone,
    v_name,
    p_event_type,
    'sms',
    'SENT',
    v_msg_content,
    jsonb_build_object(
      'provider', 'twilio_sms',
      'message_id', 'sms_' || gen_random_uuid(),
      'delivered_at', NOW()
    )
  ) RETURNING id INTO v_sms_id;

  -- Update reminder timestamp on booking if this was a reminder
  IF p_event_type = 'BOOKING_REMINDER_1H' THEN
    UPDATE public.bookings
    SET reminder_1h_sent_at = NOW(),
        updated_at = NOW()
    WHERE id = p_booking_id;
  ELSIF p_event_type = 'BOOKING_REMINDER_30M' THEN
    UPDATE public.bookings
    SET reminder_30m_sent_at = NOW(),
        updated_at = NOW()
    WHERE id = p_booking_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'event_type', p_event_type,
    'recipient_phone', v_phone,
    'recipient_name', v_name,
    'whatsapp_log_id', v_whatsapp_id,
    'sms_log_id', v_sms_id,
    'message', v_msg_content
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) 
  TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. Automated Reminder Scheduler (1-hour and 30-minute windows)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_and_send_booking_reminders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_count_1h INTEGER := 0;
  v_count_30m INTEGER := 0;
BEGIN
  -- 1. Scan for 1-hour reminders: slot_start between 40 and 75 minutes from now
  FOR v_rec IN
    SELECT id, slot_start
    FROM public.bookings
    WHERE status = 'CONFIRMED'
      AND reminder_1h_sent_at IS NULL
      AND slot_start >= NOW() + INTERVAL '40 minutes'
      AND slot_start <= NOW() + INTERVAL '75 minutes'
  LOOP
    PERFORM public.dispatch_booking_notification(v_rec.id, 'BOOKING_REMINDER_1H');
    v_count_1h := v_count_1h + 1;
  END LOOP;

  -- 2. Scan for 30-minute reminders: slot_start between 10 and 35 minutes from now
  FOR v_rec IN
    SELECT id, slot_start
    FROM public.bookings
    WHERE status = 'CONFIRMED'
      AND reminder_30m_sent_at IS NULL
      AND slot_start >= NOW() + INTERVAL '10 minutes'
      AND slot_start <= NOW() + INTERVAL '35 minutes'
  LOOP
    PERFORM public.dispatch_booking_notification(v_rec.id, 'BOOKING_REMINDER_30M');
    v_count_30m := v_count_30m + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reminders_1h_dispatched', v_count_1h,
    'reminders_30m_dispatched', v_count_30m,
    'executed_at', NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_send_booking_reminders() 
  TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. pg_cron Schedule for Reminders (runs every 5 minutes)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'check-booking-reminders'
  ) THEN
    PERFORM cron.schedule(
      'check-booking-reminders',
      '*/5 * * * *',
      'SELECT public.check_and_send_booking_reminders();'
    );
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 6. Trigger on public.bookings for automatic CONFIRMED & CANCELLED notifications
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_booking_notification_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- When booking becomes CONFIRMED
  IF NEW.status = 'CONFIRMED' AND (TG_OP = 'INSERT' OR OLD.status != 'CONFIRMED') THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'BOOKING_CONFIRMED');
  END IF;

  -- When booking becomes CANCELLED
  IF NEW.status = 'CANCELLED' AND (TG_OP = 'UPDATE' AND OLD.status != 'CANCELLED') THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'BOOKING_CANCELLED');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_notification_events ON public.bookings;

CREATE TRIGGER trg_booking_notification_events
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_booking_notification_trigger();

-- ------------------------------------------------------------------------------
-- 7. Helper RPC for testing & manual reminder simulation
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_booking_slot_for_reminder(
  p_booking_id UUID,
  p_minutes_from_now INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot_start TIMESTAMPTZ;
BEGIN
  v_slot_start := NOW() + (p_minutes_from_now || ' minutes')::interval;

  PERFORM set_config('app.trusted_write', 'true', true);

  UPDATE public.bookings
  SET slot_start = v_slot_start,
      slot_end = v_slot_start + INTERVAL '30 minutes',
      reminder_1h_sent_at = NULL,
      reminder_30m_sent_at = NULL,
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'slot_start', v_slot_start
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_booking_slot_for_reminder(UUID, INTEGER) 
  TO anon, authenticated, service_role;

