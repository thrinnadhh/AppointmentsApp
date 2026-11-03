-- Migration: 20261031000001_client_grants_lockdown.sql
-- Description: Phase 1 Security Hardening — Lock down client-role (anon, authenticated)
-- table/view/function grants, enforce default privilege revocation, harden
-- cancel_doctor_emergency with in-function consultant/Hospital Admin authorization
-- and service_role-only execution, and enforce security_invoker = true on merchant_bookings.
-- Idempotent, wrapped in a single transaction, no data mutations, no table drops.

BEGIN;

-- =============================================================================
-- Helper: Safe, idempotent routine privilege management
-- Prevents 42883 (undefined_function) if a function is absent from a staging snapshot.
-- =============================================================================
CREATE OR REPLACE FUNCTION pg_temp.lockdown_proc(
    p_name TEXT,
    p_revoke_from TEXT,
    p_grant_to TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT p.oid::regprocedure AS proc_name
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = p_name
    ) LOOP
        IF p_revoke_from IS NOT NULL AND p_revoke_from <> '' THEN
            EXECUTE 'REVOKE ALL ON FUNCTION ' || r.proc_name || ' FROM ' || p_revoke_from;
        END IF;
        IF p_grant_to IS NOT NULL AND p_grant_to <> '' THEN
            EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.proc_name || ' TO ' || p_grant_to;
        END IF;
    END LOOP;
END;
$$;

-- =============================================================================
-- 2a) Revoke dangerous DDL/trigger/reference privileges on all public tables
-- =============================================================================
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

DO $$
BEGIN
  -- PostgreSQL 17+ introduces the MAINTAIN privilege; revoke it where supported
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
  END IF;
END $$;

-- =============================================================================
-- 2b) Lock down default privileges for future tables and sequences in public
-- =============================================================================
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- Also revoke sequence manipulation on existing sequences from anon, authenticated
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- =============================================================================
-- 2c) Revoke ALL privileges from anon on non-public / post-login tables
--     (Verified against docs/audit/CLIENT_DB_USAGE.md: zero pre-login direct
--     table reads/writes exist on any of these tables; pre-login client event
--     logging and waitlist submission use SECURITY DEFINER RPCs.)
-- =============================================================================
REVOKE ALL PRIVILEGES ON TABLE
  public.account_deletion_requests,
  public.admin_audit_logs,
  public.app_logs,
  public.audit_logs,
  public.bookings,
  public.city_settlements,
  public.crash_alert_dedup,
  public.department_members,
  public.departments,
  public.doctor_front_desk_assignments,
  public.merchant_memberships,
  public.notification_logs,
  public.payments,
  public.user_consents
FROM anon;

-- Also ensure anon has no direct access to remaining internal/post-login tables
REVOKE ALL PRIVILEGES ON TABLE
  public.appointment_checkin_codes,
  public.city_waitlist,
  public.contact_reveal_audit,
  public.platform_config,
  public.profiles
FROM anon;

-- =============================================================================
-- 2d) Keep anon SELECT only on public directory tables:
--     categories, sub_categories, cities, providers, resources, resource_availability
--     (Do not alter column-level SELECT exposure on providers/resources in this phase)
-- =============================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.categories,
  public.sub_categories,
  public.cities,
  public.providers,
  public.resources,
  public.resource_availability
FROM anon;

GRANT SELECT ON TABLE
  public.categories,
  public.sub_categories,
  public.cities,
  public.resources,
  public.resource_availability
TO anon;
-- Note: public.providers already has column-level SELECT granted to anon
-- (excluding owner_id, email, phone) from 20261019000005; preserved unchanged.

-- =============================================================================
-- 2e) Revoke authenticated INSERT/UPDATE/DELETE on server-managed tables
--     unless CLIENT_DB_USAGE proves a direct client write
-- =============================================================================

-- Tables with NO direct client writes (SELECT only for authenticated, gated by RLS):
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.appointment_checkin_codes,
  public.audit_logs,
  public.categories,
  public.sub_categories,
  public.department_members,
  public.departments,
  public.doctor_front_desk_assignments,
  public.merchant_memberships,
  public.notification_logs,
  public.resource_availability,
  public.account_deletion_requests,
  public.cities,
  public.city_settlements,
  public.city_waitlist,
  public.admin_audit_logs,
  public.app_logs,
  public.contact_reveal_audit,
  public.payments
FROM authenticated;

GRANT SELECT ON TABLE
  public.appointment_checkin_codes,
  public.audit_logs,
  public.categories,
  public.sub_categories,
  public.department_members,
  public.departments,
  public.doctor_front_desk_assignments,
  public.merchant_memberships,
  public.notification_logs,
  public.resource_availability,
  public.account_deletion_requests,
  public.cities,
  public.city_settlements,
  public.city_waitlist,
  public.admin_audit_logs,
  public.app_logs,
  public.contact_reveal_audit,
  public.payments
TO authenticated;

-- Server-only internal tables: revoke ALL privileges (including SELECT) from authenticated
REVOKE ALL PRIVILEGES ON TABLE
  public.crash_alert_dedup,
  public.platform_config
FROM authenticated;

-- providers: Direct client UPDATE exists in apps/merchant-web/src/app/page.tsx:575,610,654,
-- apps/merchant-web/src/app/venues/page.tsx:151, and apps/merchant-web/src/lib/supabase.ts:327.
-- No client INSERT or DELETE exists. Revoke INSERT, DELETE; keep SELECT and UPDATE (gated by
-- RLS policy merchants_update_own_provider and trigger guard_provider_governance).
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.providers FROM authenticated;
GRANT UPDATE ON TABLE public.providers TO authenticated;

-- resources: Direct client UPDATE exists in apps/merchant-web/src/app/resources/page.tsx:335
-- (toggleActive updates is_active, updated_at). No client INSERT or DELETE exists.
-- Revoke INSERT, DELETE; keep SELECT and UPDATE (gated by RLS).
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.resources FROM authenticated;
GRANT SELECT, UPDATE ON TABLE public.resources TO authenticated;

-- user_consents: Mobile client calls .select() (AccountScreen.tsx:48) and
-- .upsert(..., { onConflict: 'user_id,purpose,version' }) (AccountScreen.tsx:95,
-- ConsentScreen.tsx:117). PostgreSQL INSERT ... ON CONFLICT DO UPDATE requires
-- both INSERT and UPDATE privileges. Revoke DELETE; keep SELECT, INSERT, UPDATE.
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_consents FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_consents TO authenticated;

-- profiles: Mobile client updates expo_push_token (notifications.ts:75); column-level
-- SELECT/UPDATE grants from 20261019000005 and 20261022000009 are preserved.
-- Revoke table-level INSERT and DELETE from authenticated.
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.profiles FROM authenticated;

-- =============================================================================
-- 2f) bookings: Revoke INSERT, UPDATE, and DELETE from authenticated (keep SELECT)
-- =============================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.bookings FROM authenticated;
GRANT SELECT ON TABLE public.bookings TO authenticated;

-- =============================================================================
-- 2g) Harden cancel_doctor_emergency:
--     1. Add in-function authorization check that the caller is that consultant
--        or the Hospital Admin of that hospital (or platform Super Admin) using
--        existing helpers (public.hospital_role, public.hospital_accessible_resource_ids,
--        public.is_admin).
--     2. Revoke EXECUTE from PUBLIC, anon, authenticated; grant EXECUTE to service_role.
-- =============================================================================

-- Drop any legacy 4-argument overload if present in older staging snapshots
DROP FUNCTION IF EXISTS public.cancel_doctor_emergency(UUID, BOOLEAN, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.cancel_doctor_emergency(
    p_doctor_resource_id UUID,
    p_effective_from TIMESTAMPTZ DEFAULT NOW(),
    p_reason TEXT DEFAULT 'Doctor Acute Medical Emergency'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_booking RECORD;
    v_cancelled_count INT := 0;
    v_total_refund NUMERIC(10,2) := 0.00;
    v_affected_ids UUID[] := ARRAY[]::UUID[];
    v_effective_time TIMESTAMPTZ := COALESCE(p_effective_from, NOW());
    v_res_name TEXT;
    v_prov_id UUID;
    v_res_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_caller_role TEXT := COALESCE(auth.role(), '');
    v_hospital_role TEXT;
    v_is_authorized BOOLEAN := FALSE;
BEGIN
    -- Verify resource exists and fetch its provider and linked consultant user_id
    SELECT name, provider_id, user_id
    INTO v_res_name, v_prov_id, v_res_user_id
    FROM public.resources
    WHERE id = p_doctor_resource_id;

    IF v_res_name IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Doctor resource not found'
        );
    END IF;

    -- In-function caller authorization check:
    -- Must be that specific consultant, the Hospital Admin of that hospital, or Super Admin.
    -- (Service role / postgres sessions are pre-authorized by the server route guard.)
    IF v_caller_role = 'service_role' AND v_caller_id IS NULL THEN
        v_is_authorized := TRUE;
    ELSIF v_caller_id IS NULL AND SESSION_USER IN ('postgres', 'supabase_admin') THEN
        v_is_authorized := TRUE;
    ELSIF v_caller_id IS NOT NULL THEN
        IF public.is_admin(v_caller_id) THEN
            v_is_authorized := TRUE;
        ELSE
            v_hospital_role := public.hospital_role(v_prov_id, v_caller_id);
            IF v_hospital_role = 'admin' THEN
                -- Hospital Admin of that hospital
                v_is_authorized := TRUE;
            ELSIF v_res_user_id IS NOT NULL AND v_res_user_id = v_caller_id THEN
                -- The consultant themselves (matched via resources.user_id)
                v_is_authorized := TRUE;
            ELSIF v_hospital_role = 'consultant' AND p_doctor_resource_id IN (
                SELECT public.hospital_accessible_resource_ids(v_prov_id, v_caller_id)
            ) THEN
                -- The consultant themselves (matched via hospital_accessible_resource_ids)
                v_is_authorized := TRUE;
            END IF;
        END IF;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Forbidden: Only the target consultant or the Hospital Admin of this hospital may trigger an emergency cancellation'
        );
    END IF;

    -- Enable trusted write so protect_booking_payment_fields allows REFUND_PENDING transition
    PERFORM set_config('app.trusted_write', 'true', true);

    -- Iterate over upcoming CONFIRMED bookings for this doctor
    FOR v_booking IN
        SELECT b.id, b.customer_id, b.provider_id, b.total_amount, b.deposit_amount, b.slot_start,
               p.phone AS customer_phone, p.full_name AS customer_name
        FROM public.bookings b
        LEFT JOIN public.profiles p ON p.id = b.customer_id
        WHERE b.resource_id = p_doctor_resource_id
          AND b.status = 'CONFIRMED'
          AND b.slot_start >= v_effective_time
        ORDER BY b.slot_start ASC
        FOR UPDATE OF b
    LOOP
        -- 1. Cancel the booking with full refund pending and record emergency
        UPDATE public.bookings
        SET status = 'CANCELLED',
            payment_status = 'REFUND_PENDING',
            updated_at = NOW()
        WHERE id = v_booking.id;

        v_cancelled_count := v_cancelled_count + 1;
        v_total_refund := v_total_refund + COALESCE(v_booking.total_amount, 0.00);
        v_affected_ids := array_append(v_affected_ids, v_booking.id);

        -- 2. Insert notification log for the customer with 100% full refund notice
        INSERT INTO public.notification_logs (
            booking_id,
            recipient_phone,
            recipient_name,
            event_type,
            channel,
            status,
            message_content
        ) VALUES (
            v_booking.id,
            COALESCE(v_booking.customer_phone, 'Not provided'),
            COALESCE(v_booking.customer_name, 'Patient'),
            'DOCTOR_EMERGENCY_CANCELLED',
            'whatsapp',
            'QUEUED',
            format('Your appointment has been cancelled due to doctor emergency: %s. A 100%% full refund of ₹%s has been issued.', p_reason, COALESCE(v_booking.total_amount, 0.00))
        )
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- Force Majeure Policy: 0 merchant cancellation strikes or financial penalties applied
    RETURN jsonb_build_object(
        'success', true,
        'doctor_resource_id', p_doctor_resource_id,
        'doctor_name', v_res_name,
        'cancelled_count', v_cancelled_count,
        'merchant_strikes_applied', 0,
        'total_refund_amount', v_total_refund,
        'affected_booking_ids', v_affected_ids
    );
END;
$$;

SELECT pg_temp.lockdown_proc('cancel_doctor_emergency', 'PUBLIC, anon, authenticated', 'service_role');

-- =============================================================================
-- 2h) Revoke execute from PUBLIC, anon, authenticated and grant to service_role
--     for build_template_params and confirm_booking_payment
-- =============================================================================
SELECT pg_temp.lockdown_proc('build_template_params', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('confirm_booking_payment', 'PUBLIC, anon, authenticated', 'service_role');

-- =============================================================================
-- 2i) SECURITY DEFINER Function Classification & Grants Lockdown
-- =============================================================================

-- Category (1a): Client RPCs with verified pre-login (anon + authenticated) usage
-- Revoke from PUBLIC; grant EXECUTE to anon, authenticated, service_role.
SELECT pg_temp.lockdown_proc('get_nearby_providers', 'PUBLIC', 'anon, authenticated, service_role');
SELECT pg_temp.lockdown_proc('search_directory_public', 'PUBLIC', 'anon, authenticated, service_role');
SELECT pg_temp.lockdown_proc('get_active_cities', 'PUBLIC', 'anon, authenticated, service_role');
SELECT pg_temp.lockdown_proc('submit_city_waitlist', 'PUBLIC', 'anon, authenticated, service_role');
SELECT pg_temp.lockdown_proc('log_client_event', 'PUBLIC', 'anon, authenticated, service_role');

-- Category (1b): Client RPCs used post-login only (authenticated)
-- Revoke from PUBLIC, anon; grant EXECUTE to authenticated, service_role.
SELECT pg_temp.lockdown_proc('search_directory', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('check_cooling_period_eligibility', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('cancel_booking', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('reschedule_booking_slot', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('mark_customer_reached', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('sync_customer_profile', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('request_account_deletion', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('expire_stale_standby_queue', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('auto_link_merchant_by_email', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('reveal_customer_contact', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('merchant_update_cooling_period', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('complete_booking', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('reassign_booking_resource', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('get_provider_details', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('verify_checkin_code', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('mark_present_manually', 'PUBLIC, anon', 'authenticated, service_role');

-- Kept in Category (1b) as ambiguous client helpers in apps/merchant-web/src/lib/supabase.ts:516,555,584:
SELECT pg_temp.lockdown_proc('admin_create_user', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('admin_create_venue', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('admin_create_resource', 'PUBLIC, anon', 'authenticated, service_role');

-- Category (2): Used inside RLS policies or by functions called from RLS policies / client RPCs
-- Keep authenticated and service_role EXECUTE; revoke from PUBLIC and anon.
SELECT pg_temp.lockdown_proc('is_admin', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('get_user_authorized_providers', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('is_hospital_provider', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('hospital_role', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('hospital_accessible_resource_ids', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('is_hospital_owner', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('get_user_department_id', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('is_merchant_owner_or_admin', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('assert_booking_actor', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('get_test_clock', 'PUBLIC, anon', 'authenticated, service_role');
SELECT pg_temp.lockdown_proc('get_test_clock_for_prefix', 'PUBLIC, anon', 'authenticated, service_role');

-- Category (3): Server-only SECURITY DEFINER RPCs, cron workers, and internal functions
-- Revoke EXECUTE from PUBLIC, anon, authenticated; grant EXECUTE to service_role only.
SELECT pg_temp.lockdown_proc('create_booking_hold', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('override_hospital_queue_position', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('reorder_hospital_queue', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('record_no_show', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('release_expired_holds', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('check_and_send_booking_reminders', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('purge_old_app_logs', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('expire_standby_bookings', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('confirm_booking_by_merchant', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('reveal_contact', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('merchant_register_shop_for_user', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('admin_delete_resource', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('admin_fetch_merchants', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('admin_update_merchant_status', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('admin_update_provider_operational_settings', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('get_admin_audit_logs', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('get_admin_city_stats', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('get_admin_velocity_analytics', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('get_city_director_stats', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('update_city_status', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('get_masked_customer_info', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('get_merchant_bookings', 'PUBLIC, anon, authenticated', 'service_role');

-- Idempotently re-assert service_role-only on already-restricted server functions:
SELECT pg_temp.lockdown_proc('_record_checkin_failure', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('advance_test_clock', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('anonymize_user_data', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('claim_queued_notifications', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('compute_gst_for_booking', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('dispatch_booking_notification', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('generate_appointment_checkin_code_for_booking', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('generate_invoice_number', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('log_admin_action', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('merchant_self_register', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('process_expired_account_deletions', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('purge_expired_waitlist_entries', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('reset_test_bookings', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('reset_test_customer_strikes', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('reset_test_provider_strikes', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('set_booking_slot_for_reminder', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('set_test_clock', 'PUBLIC, anon, authenticated', 'service_role');
SELECT pg_temp.lockdown_proc('trigger_whatsapp_sender_cron', 'PUBLIC, anon, authenticated', 'service_role');

-- Internal trigger functions: revoke PUBLIC, anon, authenticated
SELECT pg_temp.lockdown_proc('assign_clinic_queue_position', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('auto_create_user_for_profile', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('auto_ensure_booking_customer', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('check_department_member_limit', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('guard_profile_governance', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('guard_provider_governance', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('handle_booking_checkin_code_trigger', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('handle_booking_notification_trigger', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('handle_new_auth_user', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('handle_table_creation', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('increment_booking_version', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('protect_booking_payment_fields', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('set_booking_reference_code', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('sync_resource_user_id', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('trg_audit_booking_status_change', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('trg_audit_doctor_assignments', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('trg_audit_resource_services', 'PUBLIC, anon, authenticated');
SELECT pg_temp.lockdown_proc('validate_booking_update', 'PUBLIC, anon, authenticated');

-- Clean up helper function
DROP FUNCTION IF EXISTS pg_temp.lockdown_proc(TEXT, TEXT, TEXT);

-- =============================================================================
-- 2j) Set security_invoker = true on merchant_bookings view
-- =============================================================================
ALTER VIEW public.merchant_bookings SET (security_invoker = true);

REVOKE ALL PRIVILEGES ON TABLE public.merchant_bookings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.merchant_bookings FROM authenticated;
GRANT SELECT ON TABLE public.merchant_bookings TO authenticated, service_role;

COMMIT;
