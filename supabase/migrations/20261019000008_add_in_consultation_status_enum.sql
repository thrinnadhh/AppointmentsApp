-- =============================================================================
-- Migration: 20261019000008_add_in_consultation_status_enum.sql
-- Description:
--   Add 'IN_CONSULTATION' to public.booking_status ENUM.
--   Separated to prevent Postgres SQLSTATE 55P04.
-- =============================================================================

ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'IN_CONSULTATION';
