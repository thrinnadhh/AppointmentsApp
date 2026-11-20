-- Rollback Migration: 20261120000004_rollback_provider_payout_and_city.sql
-- Description: Revert guard_provider_governance() to pre-20261120000004 definition (city text and payout fields unconstrained in direct table updates).

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

  -- Block client modifications to governance, penalty, strike, status, city_id, and ownership fields
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.cancellation_strikes IS DISTINCT FROM OLD.cancellation_strikes
     OR NEW.strike_reset_date IS DISTINCT FROM OLD.strike_reset_date
     OR NEW.penalty_balance IS DISTINCT FROM OLD.penalty_balance
     OR NEW.is_booking_frozen IS DISTINCT FROM OLD.is_booking_frozen
     OR NEW.city_id IS DISTINCT FROM OLD.city_id THEN
    RAISE EXCEPTION 'Unauthorized provider modification: status, strikes, penalty balance, booking freeze, city, and ownership are protected'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
