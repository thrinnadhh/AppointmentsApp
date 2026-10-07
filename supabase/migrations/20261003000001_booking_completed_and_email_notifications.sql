-- Migration: 20261003000001_booking_completed_and_email_notifications.sql
-- Description: Adds BOOKING_COMPLETED notification event, email channel logging, and automatic completion triggers.

-- 1. Update dispatch_booking_notification to allow BOOKING_COMPLETED and send email logs
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
  v_email TEXT;
  v_name TEXT;
  v_ref TEXT;
  v_msg_content TEXT;
  v_slot_formatted TEXT;
  v_whatsapp_id UUID;
  v_sms_id UUID;
  v_email_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT := auth.role();
  v_is_authorized BOOLEAN := FALSE;
BEGIN
  -- Validate event_type against strict allowlist to prevent log injection
  IF p_event_type NOT IN (
    'BOOKING_CONFIRMED',
    'BOOKING_REMINDER_1H',
    'BOOKING_REMINDER_30M',
    'BOOKING_CANCELLED',
    'BOOKING_COMPLETED',
    'RESOURCE_REASSIGNED',
    'REFUND_FAILED_ALERT'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid event_type: not in allowed notification types');
  END IF;

  -- Fetch booking details with provider and resource info
  SELECT 
    b.id,
    b.reference_code,
    b.slot_start,
    b.slot_end,
    b.status,
    b.payment_status,
    b.customer_id,
    b.provider_id,
    p.name AS provider_name,
    p.address AS provider_address,
    p.phone AS provider_phone,
    r.name AS resource_name,
    r.department AS resource_dept,
    prof.phone AS customer_phone,
    prof.email AS customer_email,
    prof.full_name AS customer_name,
    u.email AS auth_email
  INTO v_booking
  FROM public.bookings b
  JOIN public.providers p ON b.provider_id = p.id
  JOIN public.resources r ON b.resource_id = r.id
  LEFT JOIN public.profiles prof ON b.customer_id = prof.id
  LEFT JOIN auth.users u ON b.customer_id = u.id
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller authorization check: service_role, postgres, owning customer, provider staff/owner, or admin
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND (SESSION_USER = 'postgres' OR CURRENT_USER = 'postgres')) THEN
    v_is_authorized := TRUE;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := TRUE;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := TRUE;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := TRUE;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Caller is not authorized for this booking notification');
  END IF;

  v_phone := COALESCE(v_booking.customer_phone, 'Unregistered Customer');
  v_email := COALESCE(v_booking.customer_email, v_booking.auth_email, 'customer@appointments-tirupati.com');
  v_name := COALESCE(v_booking.customer_name, 'Valued Customer');
  v_ref := COALESCE(v_booking.reference_code, p_booking_id::text);
  v_slot_formatted := to_char(v_booking.slot_start AT TIME ZONE 'Asia/Kolkata', 'Mon DD, YYYY at HH12:MI AM');

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
    WHEN 'BOOKING_COMPLETED' THEN
      v_msg_content := format(
        'Tirupati Appointments: Your consultation at %s with %s (Ref: %s) has been completed! Status: COMPLETED. Thank you for choosing zero-wait care. Your digital receipt is ready.',
        v_booking.provider_name, v_booking.resource_name, v_ref
      );
    WHEN 'RESOURCE_REASSIGNED' THEN
      v_msg_content := format(
        'Tirupati Appointments: Staff re-assigned for booking %s at %s. Your new specialist is %s.',
        v_ref, v_booking.provider_name, v_booking.resource_name
      );
    WHEN 'REFUND_FAILED_ALERT' THEN
      v_msg_content := format(
        'Tirupati Appointments Alert: Refund processing for booking %s at %s is pending manual reconciliation.',
        v_ref, v_booking.provider_name
      );
    ELSE
      v_msg_content := format(
        'Tirupati Appointments Notification: Status update for booking %s at %s.',
        v_ref, v_booking.provider_name
      );
  END CASE;

  PERFORM set_config('app.trusted_write', 'true', true);

  -- Insert WhatsApp notification log
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
    jsonb_build_object('provider', 'mock-whatsapp', 'timestamp', now())
  ) RETURNING id INTO v_whatsapp_id;

  -- Insert SMS notification log
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
    jsonb_build_object('provider', 'mock-sms', 'timestamp', now())
  ) RETURNING id INTO v_sms_id;

  -- Insert Email notification log
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
    COALESCE(v_email, v_phone),
    v_name,
    p_event_type,
    'email',
    'SENT',
    v_msg_content,
    jsonb_build_object('provider', 'mock-email-resend', 'recipient_email', v_email, 'timestamp', now())
  ) RETURNING id INTO v_email_id;

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
    'recipient_email', v_email,
    'recipient_name', v_name,
    'whatsapp_log_id', v_whatsapp_id,
    'sms_log_id', v_sms_id,
    'email_log_id', v_email_id,
    'channel', 'whatsapp,sms,email',
    'status', 'SENT',
    'message', v_msg_content
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification(UUID, TEXT) TO authenticated, service_role;

-- 2. Update trigger to automatically dispatch on status change to COMPLETED
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

  -- When booking becomes COMPLETED
  IF NEW.status = 'COMPLETED' AND (TG_OP = 'UPDATE' AND OLD.status != 'COMPLETED') THEN
    PERFORM public.dispatch_booking_notification(NEW.id, 'BOOKING_COMPLETED');
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_booking_notification_trigger() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_booking_notification_trigger() TO service_role;
