-- Migration: 20260917000002_drop_profiles_phone_unique_constraint.sql
-- Description: Drop overly restrictive UNIQUE constraint on profiles.phone to allow multi-tenant, multi-account and customer-merchant shared contact numbers.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_phone_key;
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone);
