-- Migration: 20260908000003_merchant_portal_extensions.sql
-- Description: Add email to profiles, department and price to resources, and seed admin accounts

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS department text DEFAULT 'General';
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS price numeric(10, 2) DEFAULT 500.00;

-- Update existing resources with specific departments and appointment fees
UPDATE public.resources SET department = 'Implantology', price = 800.00 WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
UPDATE public.resources SET department = 'Orthodontics', price = 600.00 WHERE id = 'aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
UPDATE public.resources SET department = 'Cardiology', price = 1000.00 WHERE id = 'aaaaaaac-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
UPDATE public.resources SET department = 'Hair Styling', price = 400.00 WHERE id = 'aaaaaaad-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
UPDATE public.resources SET department = 'Cricket Arena', price = 1200.00 WHERE id = 'aaaaaaae-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Seed Admin and Merchant Staff Profiles
INSERT INTO public.profiles (id, phone, full_name, email, role, no_show_count, is_flagged, created_at, updated_at)
VALUES
  ('88888888-8888-8888-8888-888888888881', '+91 99000 00001', 'Platform Owner (Super Admin)', 'admin@appointments.tirupati', 'admin', 0, false, now(), now()),
  ('88888888-8888-8888-8888-888888888882', '+91 99000 00002', 'Dr. Sundararajan (SVIMS Admin)', 'svims.clinic@tirupati.com', 'merchant', 0, false, now(), now()),
  ('88888888-8888-8888-8888-888888888883', '+91 99000 00003', 'Pooja Reddy (Naturals Salon Mgr)', 'naturals.salon@tirupati.com', 'merchant', 0, false, now(), now())
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role, full_name = EXCLUDED.full_name;
