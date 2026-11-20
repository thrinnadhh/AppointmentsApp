-- Migration Draft: 20261120000004_guard_provider_payout_and_city.sql
-- Description: Extend guard_provider_governance() to protect providers.city, cashfree_vendor_id, cashfree_vendor_status,
--              cashfree_app_id, payout_upi_id, and masked bank/PAN credentials against unauthorized client modification (SEC-WIN-017 & SEC-WIN-019).
-- Note: DRAFT ONLY - DO NOT MOVE TO supabase/migrations/ until authorized.

CREATE OR REPLACE FUNCTION public.guard_provider_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Allow service_role, admin, or trusted internal execution context
  IF auth.role() = 'service_role'
     OR current_setting('app.trusted_write', true) = 'true'
     OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Block client modifications to governance, penalty, strike, status, city, ownership, and payout/gateway fields
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.cancellation_strikes IS DISTINCT FROM OLD.cancellation_strikes
     OR NEW.strike_reset_date IS DISTINCT FROM OLD.strike_reset_date
     OR NEW.penalty_balance IS DISTINCT FROM OLD.penalty_balance
     OR NEW.is_booking_frozen IS DISTINCT FROM OLD.is_booking_frozen
     OR NEW.city_id IS DISTINCT FROM OLD.city_id
     OR NEW.city IS DISTINCT FROM OLD.city
     OR NEW.cashfree_vendor_id IS DISTINCT FROM OLD.cashfree_vendor_id
     OR NEW.cashfree_vendor_status IS DISTINCT FROM OLD.cashfree_vendor_status
     OR NEW.cashfree_app_id IS DISTINCT FROM OLD.cashfree_app_id
     OR NEW.bank_account_holder IS DISTINCT FROM OLD.bank_account_holder
     OR NEW.bank_account_last4 IS DISTINCT FROM OLD.bank_account_last4
     OR NEW.bank_ifsc IS DISTINCT FROM OLD.bank_ifsc
     OR NEW.pan_last4 IS DISTINCT FROM OLD.pan_last4
     OR NEW.payout_upi_id IS DISTINCT FROM OLD.payout_upi_id THEN
    RAISE EXCEPTION 'Unauthorized provider modification: governance, status, strikes, penalty balance, booking freeze, city, ownership, and payout credentials are protected'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
