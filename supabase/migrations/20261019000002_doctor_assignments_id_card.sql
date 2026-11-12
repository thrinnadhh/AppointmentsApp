-- Migration: 20261019000002_doctor_assignments_id_card.sql
-- Description:
--   Add optional id_card_number column to public.doctor_front_desk_assignments
--   to store employee badges, hospital ID cards, or staff identification numbers.

ALTER TABLE public.doctor_front_desk_assignments 
ADD COLUMN IF NOT EXISTS id_card_number TEXT;
