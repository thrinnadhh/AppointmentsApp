-- =============================================================================
-- Migration: 20261011000000_add_checked_in_status_enum.sql
-- Description: Add 'CHECKED_IN' to public.booking_status ENUM.
-- Separated into its own migration to avoid Postgres SQLSTATE 55P04:
-- "unsafe use of new value of enum type in same transaction".
-- =============================================================================

ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'CHECKED_IN';
