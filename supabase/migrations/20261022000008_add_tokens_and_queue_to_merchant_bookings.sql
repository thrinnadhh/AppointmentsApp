-- =============================================================================
-- Migration: 20261022000008_add_tokens_and_queue_to_merchant_bookings.sql
-- Description:
--   Appends queue_position, estimated_wait_minutes, checked_in_at, checked_in_method,
--   is_followup, and followup_original_booking_id to the merchant_bookings view so
--   all tokens and queue badges are immediately present upon query.
-- =============================================================================

CREATE OR REPLACE VIEW public.merchant_bookings
WITH (security_invoker = true)
AS
SELECT
  b.id,
  b.customer_id,
  b.provider_id,
  b.resource_id,
  b.slot_start,
  b.slot_end,
  b.status,
  b.payment_status,
  b.deposit_amount,
  b.platform_fee,
  b.total_amount,
  b.gateway_payment_id,
  b.hold_expires_at,
  b.reference_code,
  b.attachment_url,
  b.reminder_1h_sent_at,
  b.reminder_30m_sent_at,
  b.is_present,
  b.customer_arrived_at,
  b.platform_fee_gst,
  b.gstin_platform,
  b.invoice_number,
  b.created_at,
  b.updated_at,
  COALESCE(c.customer_name, 'Walk-in / Guest') AS customer_name,
  COALESCE(c.customer_phone, 'Not provided') AS customer_phone,
  COALESCE(c.no_show_count, 0) AS no_show_count,
  COALESCE(r.name, 'Standard Unit') AS resource_name,
  COALESCE(r.type, 'slot') AS resource_type,
  COALESCE(p.name, 'Merchant Venue') AS provider_name,
  b.department_id,
  COALESCE(dept.name, 'General Medicine') AS department_name,
  b.queue_position,
  b.estimated_wait_minutes,
  b.checked_in_at,
  b.checked_in_method,
  b.is_followup,
  b.followup_original_booking_id
FROM bookings b
  LEFT JOIN LATERAL get_masked_customer_info(b.customer_id) c(customer_name, customer_phone, no_show_count) ON true
  LEFT JOIN resources r ON r.id = b.resource_id
  LEFT JOIN providers p ON p.id = b.provider_id
  LEFT JOIN departments dept ON dept.id = b.department_id
WHERE (b.provider_id IN ( SELECT get_user_authorized_providers(auth.uid()) AS get_user_authorized_providers))
   OR (b.provider_id IN ( SELECT department_members.merchant_id FROM department_members WHERE department_members.user_id = auth.uid() AND department_members.status = 'active'))
   OR is_admin(auth.uid());
