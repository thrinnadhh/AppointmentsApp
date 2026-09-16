-- ==============================================================================
-- Migration: 20260912000001_phase3_storage_and_media.sql
-- Description: Phase 3 Storage & Media Pipeline
--   1. Add attachment_url to public.bookings for prescriptions / medical records
--   2. Create public bucket 'venue-assets' for venue storefronts, logos, and doctor avatars
--   3. Create private bucket 'prescriptions-and-records' for customer health documents
--   4. Define RLS policies on storage.objects for secure access and upload control
-- ==============================================================================

-- 1. Add attachment_url to public.bookings
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS attachment_url text;

-- 2. Create public bucket 'venue-assets'
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'venue-assets',
  'venue-assets',
  true,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

-- 3. Create private bucket 'prescriptions-and-records'
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'prescriptions-and-records',
  'prescriptions-and-records',
  false,
  20971520, -- 20MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- 4. Storage Objects Security Policies
-- Public Read & Upload for venue-assets
DROP POLICY IF EXISTS "Public Access for Venue Assets" ON storage.objects;
CREATE POLICY "Public Access for Venue Assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'venue-assets');

DROP POLICY IF EXISTS "Allow upload to venue assets" ON storage.objects;
CREATE POLICY "Allow upload to venue assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'venue-assets');

DROP POLICY IF EXISTS "Allow update venue assets" ON storage.objects;
CREATE POLICY "Allow update venue assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'venue-assets');

DROP POLICY IF EXISTS "Allow delete venue assets" ON storage.objects;
CREATE POLICY "Allow delete venue assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'venue-assets');

-- Upload & Read for prescriptions-and-records
DROP POLICY IF EXISTS "Allow upload to prescriptions and records" ON storage.objects;
CREATE POLICY "Allow upload to prescriptions and records"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'prescriptions-and-records');

DROP POLICY IF EXISTS "Allow read prescriptions and records" ON storage.objects;
CREATE POLICY "Allow read prescriptions and records"
ON storage.objects FOR SELECT
USING (bucket_id = 'prescriptions-and-records');
