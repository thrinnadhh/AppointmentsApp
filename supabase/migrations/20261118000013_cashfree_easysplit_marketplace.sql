-- =============================================================================
-- Migration: 20261118000013_cashfree_easysplit_marketplace.sql
-- Description: Cashfree EasySplit Marketplace Split Settlements Schema:
--              1. Alter public.providers for vendor status, masked bank & PAN details.
--              2. Alter public.bookings for merchant share, split status, and cf_refund_id.
--              3. Create public.merchant_vendor_splits ledger with RLS.
-- =============================================================================

BEGIN;

-- 1. Extend public.providers with Cashfree EasySplit vendor columns
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS cashfree_vendor_status text NOT NULL DEFAULT 'NOT_REGISTERED',
  ADD COLUMN IF NOT EXISTS bank_account_holder text,
  ADD COLUMN IF NOT EXISTS bank_account_last4 text,
  ADD COLUMN IF NOT EXISTS bank_ifsc text,
  ADD COLUMN IF NOT EXISTS pan_last4 text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'providers_cashfree_vendor_status_check'
  ) THEN
    ALTER TABLE public.providers
      ADD CONSTRAINT providers_cashfree_vendor_status_check
      CHECK (cashfree_vendor_status IN ('NOT_REGISTERED', 'PENDING_KYC', 'ACTIVE', 'SUSPENDED'));
  END IF;
END $$;

GRANT SELECT (cashfree_vendor_status, bank_account_holder, bank_account_last4, bank_ifsc, pan_last4)
  ON public.providers TO authenticated, service_role;

-- 2. Extend public.bookings with marketplace split settlement columns
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS merchant_share_amount numeric(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS split_status text NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN IF NOT EXISTS cf_refund_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_split_status_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_split_status_check
      CHECK (split_status IN ('NOT_APPLICABLE', 'PENDING_SPLIT', 'SPLIT_CAPTURED', 'SPLIT_REFUNDED'));
  END IF;
END $$;

GRANT SELECT (merchant_share_amount, split_status, cf_refund_id)
  ON public.bookings TO authenticated, service_role;

-- 3. Create public.merchant_vendor_splits ledger table
CREATE TABLE IF NOT EXISTS public.merchant_vendor_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  cashfree_vendor_id text NOT NULL,
  cf_order_id text NOT NULL,
  cf_transfer_id text,
  gross_amount numeric(10,2) NOT NULL,
  merchant_share numeric(10,2) NOT NULL,
  platform_fee numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_vendor_splits_status_check
    CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_vendor_splits_booking ON public.merchant_vendor_splits(booking_id);
CREATE INDEX IF NOT EXISTS idx_merchant_vendor_splits_provider ON public.merchant_vendor_splits(provider_id);
CREATE INDEX IF NOT EXISTS idx_merchant_vendor_splits_order ON public.merchant_vendor_splits(cf_order_id);
CREATE INDEX IF NOT EXISTS idx_merchant_vendor_splits_vendor ON public.merchant_vendor_splits(cashfree_vendor_id);

-- Enable Row Level Security
ALTER TABLE public.merchant_vendor_splits ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Merchants can view their own provider's split records
CREATE POLICY merchant_vendor_splits_select_owner
  ON public.merchant_vendor_splits
  FOR SELECT
  TO authenticated
  USING (
    provider_id IN (
      SELECT p.id FROM public.providers p
      WHERE p.owner_id = (SELECT auth.uid())
         OR p.id IN (SELECT public.get_user_authorized_providers((SELECT auth.uid())))
    )
    OR public.is_admin((SELECT auth.uid()))
  );

-- Service role full access
CREATE POLICY merchant_vendor_splits_service_role
  ON public.merchant_vendor_splits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.merchant_vendor_splits TO authenticated, service_role;
GRANT ALL ON public.merchant_vendor_splits TO service_role;

COMMIT;
