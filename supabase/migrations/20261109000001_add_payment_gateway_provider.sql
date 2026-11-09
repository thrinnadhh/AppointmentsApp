-- Migration: Add payment gateway provider and payment session ID to bookings
-- Purpose: Introduce Cashfree PG support alongside existing Razorpay infrastructure (Phase 1)
-- Invariants: Additive schema, non-destructive, zero mutation of legacy columns

-- 1. Add gateway_provider to bookings (defaulting to 'razorpay')
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS gateway_provider VARCHAR(32) NOT NULL DEFAULT 'razorpay';

-- 2. Add payment_session_id to bookings (stores Cashfree payment_session_id)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_session_id TEXT;

-- 3. Create compound index for gateway lookups
CREATE INDEX IF NOT EXISTS idx_bookings_gateway_lookup
  ON public.bookings (gateway_provider, gateway_order_id);

