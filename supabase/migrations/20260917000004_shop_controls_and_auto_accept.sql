-- Migration: Add is_active, auto_accept_bookings, and daily_booking_limit to providers table
-- Allows merchants to toggle their shop online/offline, enable/disable auto-accepting, and set daily appointment caps.

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_accept_bookings BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_booking_limit INTEGER NOT NULL DEFAULT 50;

COMMENT ON COLUMN public.providers.is_active IS 'Whether the shop is currently active and taking customer appointments';
COMMENT ON COLUMN public.providers.auto_accept_bookings IS 'Whether new customer bookings automatically confirm without manual merchant review';
COMMENT ON COLUMN public.providers.daily_booking_limit IS 'Maximum allowed accepted appointments per calendar day (default: 50)';
