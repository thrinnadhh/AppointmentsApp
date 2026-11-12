-- Migration: 20261027201000_store_expected_payment_amount.sql
-- Description: Store expected online payment amount in paise at order creation for strict 1-to-1 payment amount verification.

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS expected_payment_amount_paise INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.bookings.expected_payment_amount_paise IS 'Expected online payment amount in paise recorded at order creation. Webhook and verify routes compare strictly to this single value.';
