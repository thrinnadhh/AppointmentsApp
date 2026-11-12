-- Migration: 20261108000001_perf_consolidate_cities_and_profiles.sql
-- Description: Fix final 3 Supabase Performance Advisor WARN findings (lint 0006: multiple_permissive_policies)
-- 1. public.profiles: Drop duplicate policy "Users can update own profile" (retaining "users_update_own_profile")
-- 2. public.cities: Consolidate "Allow public read cities", "allow_read_active_cities", and "Allow admin full manage cities"
--    into a single SELECT policy and dedicated admin INSERT/UPDATE/DELETE policies.
--
-- Rollback SQL documented at bottom of file.

BEGIN;

-- =============================================================================
-- 1. Table: public.profiles
-- =============================================================================
-- Drop redundant duplicate UPDATE policy
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Ensure users_update_own_profile is present and wrapped
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'users_update_own_profile'
  ) THEN
    CREATE POLICY "users_update_own_profile"
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (id = (SELECT auth.uid()))
      WITH CHECK (id = (SELECT auth.uid()));
  END IF;
END $$;

-- =============================================================================
-- 2. Table: public.cities
-- =============================================================================
DROP POLICY IF EXISTS "Allow public read cities" ON public.cities;
DROP POLICY IF EXISTS "allow_read_active_cities" ON public.cities;
DROP POLICY IF EXISTS "Allow admin full manage cities" ON public.cities;
DROP POLICY IF EXISTS "cities_select_policy" ON public.cities;
DROP POLICY IF EXISTS "cities_insert_policy" ON public.cities;
DROP POLICY IF EXISTS "cities_update_policy" ON public.cities;
DROP POLICY IF EXISTS "cities_delete_policy" ON public.cities;
DROP POLICY IF EXISTS "cities_select_anon" ON public.cities;
DROP POLICY IF EXISTS "cities_select_authenticated" ON public.cities;
DROP POLICY IF EXISTS "cities_admin_insert" ON public.cities;
DROP POLICY IF EXISTS "cities_admin_update" ON public.cities;
DROP POLICY IF EXISTS "cities_admin_delete" ON public.cities;

-- 2.1 Consolidated SELECT Policies for cities
-- Behavior-neutral: preserves ability of anon and authenticated users to read all cities
CREATE POLICY "cities_select_anon"
  ON public.cities
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "cities_select_authenticated"
  ON public.cities
  FOR SELECT
  TO authenticated
  USING (true);

-- 2.2 Dedicated admin write policies (split from FOR ALL to prevent SELECT overlap)
CREATE POLICY "cities_admin_insert"
  ON public.cities
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY "cities_admin_update"
  ON public.cities
  FOR UPDATE
  TO authenticated
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY "cities_admin_delete"
  ON public.cities
  FOR DELETE
  TO authenticated
  USING ((SELECT is_admin()));

COMMIT;

-- =============================================================================
-- ROLLBACK INSTRUCTIONS
-- =============================================================================
-- BEGIN;
-- CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id));
-- DROP POLICY IF EXISTS "cities_select_anon" ON public.cities;
-- DROP POLICY IF EXISTS "cities_select_authenticated" ON public.cities;
-- DROP POLICY IF EXISTS "cities_admin_insert" ON public.cities;
-- DROP POLICY IF EXISTS "cities_admin_update" ON public.cities;
-- DROP POLICY IF EXISTS "cities_admin_delete" ON public.cities;
-- CREATE POLICY "Allow public read cities" ON public.cities FOR SELECT TO anon, authenticated USING (true);
-- CREATE POLICY "allow_read_active_cities" ON public.cities FOR SELECT TO anon, authenticated USING (status IN ('ACTIVE', 'EXPANDING'));
-- CREATE POLICY "Allow admin full manage cities" ON public.cities FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
-- COMMIT;
