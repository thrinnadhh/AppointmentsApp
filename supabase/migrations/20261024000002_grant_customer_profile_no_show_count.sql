-- Migration: 20261024000002_grant_customer_profile_no_show_count.sql
-- Grants authenticated and anon roles SELECT access to no_show_count and is_flagged
-- on public.profiles so mobile customers can inspect their attendance standing and strike notices.

GRANT SELECT (no_show_count, is_flagged) ON public.profiles TO authenticated, anon;
