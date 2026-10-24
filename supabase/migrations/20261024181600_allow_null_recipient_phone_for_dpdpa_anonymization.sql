-- Migration: 20261024181600_allow_null_recipient_phone_for_dpdpa_anonymization.sql
-- Allow recipient_phone in notification_logs to be nullable so public.anonymize_user_data() can scrub PII upon customer DPDPA deletion requests.

ALTER TABLE public.notification_logs ALTER COLUMN recipient_phone DROP NOT NULL;
