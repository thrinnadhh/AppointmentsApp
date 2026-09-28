-- Migration: 20260926000004_allow_merchants_read_booking_notification_logs.sql
-- Description: Allow authorized merchants and booking owners to read their notification logs while retaining strict admin access and PII protection.

DROP POLICY IF EXISTS "Admins only read notification logs" ON public.notification_logs;
DROP POLICY IF EXISTS "Merchants and customers read own booking notification logs" ON public.notification_logs;

CREATE POLICY "Merchants and customers read own booking notification logs" ON public.notification_logs
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR booking_id IN (
    SELECT id FROM public.bookings
    WHERE customer_id = auth.uid()
       OR provider_id IN (SELECT get_user_authorized_providers(auth.uid()))
  )
);
