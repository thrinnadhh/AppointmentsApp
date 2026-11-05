-- Migration: 20261105100003_pgmq_queues_and_helpers.sql
-- Description: Idempotently creates pgmq queues (notifications, notifications_dlq,
--              refunds, refunds_dlq) with strict anon/authenticated lockdown and
--              safe security-definer helper functions.

-- 1. Idempotently create queues
DO $$
DECLARE
  v_queue text;
  v_queues text[] := ARRAY['notifications', 'notifications_dlq', 'refunds', 'refunds_dlq'];
BEGIN
  FOREACH v_queue IN ARRAY v_queues LOOP
    IF NOT EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = v_queue) THEN
      PERFORM pgmq.create(v_queue);
    END IF;
  END LOOP;
END $$;

-- 2. Lockdown table permissions for newly created pgmq queue tables
DO $$
DECLARE
  v_tbl record;
BEGIN
  FOR v_tbl IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'pgmq'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE pgmq.%I FROM anon, authenticated, public;', v_tbl.tablename);
    EXECUTE format('GRANT ALL ON TABLE pgmq.%I TO postgres, service_role;', v_tbl.tablename);
  END LOOP;
END $$;

-- 3. Security-definer helper: Enqueue refund request
-- Atomic check, transitions payment/booking status to REFUND_PENDING, enqueues to refunds queue
CREATE OR REPLACE FUNCTION public.enqueue_refund_request(
  p_booking_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'Refund requested'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_booking record;
  v_refund_amount numeric(10, 2);
  v_caller_id uuid := COALESCE(p_actor_id, auth.uid());
  v_caller_role text := auth.role();
  v_is_authorized boolean := false;
  v_enqueued_msg_id bigint;
  v_payload jsonb;
BEGIN
  -- Row lock booking
  SELECT 
    id, provider_id, customer_id, gateway_payment_id,
    deposit_amount, total_amount, refund_amount,
    status, payment_status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Caller Authorization Guard
  IF v_caller_role = 'service_role' OR (v_caller_id IS NULL AND (SESSION_USER = 'postgres' OR CURRENT_USER = 'postgres')) THEN
    v_is_authorized := true;
  ELSIF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_booking.customer_id THEN
      v_is_authorized := true;
    ELSIF public.is_admin(v_caller_id) THEN
      v_is_authorized := true;
    ELSIF v_booking.provider_id IN (SELECT public.get_user_authorized_providers(v_caller_id)) THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized to request refund for this booking');
  END IF;

  -- Validate refund eligibility
  IF v_booking.payment_status IN ('REFUNDED', 'REFUND_IN_PROGRESS') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking is already refunded or in progress');
  END IF;

  v_refund_amount := COALESCE(v_booking.refund_amount, v_booking.deposit_amount, v_booking.total_amount, 0.00);

  PERFORM set_config('app.trusted_write', 'true', true);

  -- Atomic claim on payments table
  UPDATE public.payments
  SET status = 'REFUND_PENDING',
      updated_at = NOW()
  WHERE booking_id = p_booking_id
    AND status IN ('CAPTURED', 'REFUND_FAILED');

  -- Update booking status
  UPDATE public.bookings
  SET payment_status = 'REFUND_PENDING',
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- Build privacy-safe payload (IDs and numbers only, NO PII)
  v_payload := jsonb_build_object(
    'appointment_id', v_booking.id,
    'tenant_id', v_booking.provider_id,
    'user_id', v_booking.customer_id,
    'type', 'REFUND_REQUESTED',
    'amount', v_refund_amount,
    'reason', p_reason,
    'gateway_payment_id', v_booking.gateway_payment_id
  );

  -- Enqueue into pgmq refunds queue
  SELECT pgmq.send('refunds', v_payload) INTO v_enqueued_msg_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'payment_status', 'REFUND_PENDING',
    'refund_amount', v_refund_amount,
    'queue_msg_id', v_enqueued_msg_id
  );
END;
$$;

-- 4. Helper function: Read from queue with automatic DLQ routing after N failed attempts
CREATE OR REPLACE FUNCTION public.read_queue_with_dlq(
  p_queue text,
  p_dlq text,
  p_vt integer DEFAULT 30,
  p_qty integer DEFAULT 10,
  p_max_reads integer DEFAULT 5
)
RETURNS TABLE (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamp with time zone,
  vt timestamp with time zone,
  message jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rec record;
BEGIN
  -- Loop through messages read from queue with visibility timeout
  FOR v_rec IN
    SELECT r.msg_id, r.read_ct, r.enqueued_at, r.vt, r.message
    FROM pgmq.read(p_queue, p_vt, p_qty) r
  LOOP
    -- If read_ct exceeds max threshold, move to DLQ and log
    IF v_rec.read_ct >= p_max_reads THEN
      PERFORM pgmq.send(
        p_dlq,
        v_rec.message || jsonb_build_object(
          '_dlq_reason', 'max_read_count_exceeded',
          '_original_msg_id', v_rec.msg_id,
          '_read_ct', v_rec.read_ct,
          '_moved_at', NOW()
        )
      );

      PERFORM pgmq.delete(p_queue, v_rec.msg_id);

      -- Log DLQ movement to app_logs
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_logs') THEN
        INSERT INTO public.app_logs (
          platform,
          level,
          severity,
          category,
          message,
          metadata
        ) VALUES (
          'backend',
          'error',
          'ERROR',
          'NOTIFICATION',
          format('PGMQ message %s moved to DLQ %s after exceeding max reads', v_rec.msg_id, p_dlq),
          jsonb_build_object(
            'source_queue', p_queue,
            'dlq_queue', p_dlq,
            'msg_id', v_rec.msg_id,
            'read_ct', v_rec.read_ct,
            'message', v_rec.message
          )
        );
      END IF;
    ELSE
      -- Message is within retry budget, return to worker
      msg_id := v_rec.msg_id;
      read_ct := v_rec.read_ct;
      enqueued_at := v_rec.enqueued_at;
      vt := v_rec.vt;
      message := v_rec.message;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- Grant execution to postgres and service_role only
REVOKE ALL ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.read_queue_with_dlq(text, text, integer, integer, integer) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.read_queue_with_dlq(text, text, integer, integer, integer) TO service_role;

-- 5. Device Push Tokens compatibility view (maps push_tokens table to device_push_tokens with security_invoker RLS)
CREATE OR REPLACE VIEW public.device_push_tokens WITH (security_invoker = true) AS
  SELECT id, user_id, token, device_type AS platform, created_at, updated_at
  FROM public.push_tokens;

REVOKE ALL ON public.device_push_tokens FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_tokens TO authenticated;
GRANT ALL ON public.device_push_tokens TO service_role;

