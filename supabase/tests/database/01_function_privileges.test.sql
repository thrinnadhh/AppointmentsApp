-- =============================================================================
-- pgTAP Test Suite 01: Function Privileges and Default Privileges
-- Verifies ACL lockdown across all categorized functions from Security Advisor
-- =============================================================================

BEGIN;
SELECT plan(254);

-- -----------------------------------------------------------------------------
-- 1. CATEGORY A: Trigger & Internal Functions (service_role only)
-- -----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.' || fn, 'execute'),
  fn || ' denied for anon'
) FROM unnest(ARRAY[
  'check_department_member_limit()',
  'handle_booking_checkin_code_trigger()',
  'increment_booking_version()',
  'sync_resource_user_id()',
  'trg_audit_booking_status_change()',
  'trg_audit_doctor_assignments()',
  'trg_audit_resource_services()',
  'assign_clinic_queue_position()',
  'guard_profile_governance()',
  'guard_provider_governance()',
  'handle_booking_notification_trigger()',
  'handle_new_auth_user()',
  'set_booking_reference_code()',
  'validate_booking_update()',
  '_record_checkin_failure(uuid, timestamp with time zone)',
  'generate_appointment_checkin_code_for_booking(uuid)',
  'dispatch_booking_notification(uuid, text)',
  '_handle_ddl_setup()',
  'auto_ensure_booking_customer()'
]) AS fn;

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.' || fn, 'execute'),
  fn || ' denied for authenticated'
) FROM unnest(ARRAY[
  'check_department_member_limit()',
  'handle_booking_checkin_code_trigger()',
  'increment_booking_version()',
  'sync_resource_user_id()',
  'trg_audit_booking_status_change()',
  'trg_audit_doctor_assignments()',
  'trg_audit_resource_services()',
  'assign_clinic_queue_position()',
  'guard_profile_governance()',
  'guard_provider_governance()',
  'handle_booking_notification_trigger()',
  'handle_new_auth_user()',
  'set_booking_reference_code()',
  'validate_booking_update()',
  '_record_checkin_failure(uuid, timestamp with time zone)',
  'generate_appointment_checkin_code_for_booking(uuid)',
  'dispatch_booking_notification(uuid, text)',
  '_handle_ddl_setup()',
  'auto_ensure_booking_customer()'
]) AS fn;

SELECT ok(
  has_function_privilege('service_role', 'public.' || fn, 'execute'),
  fn || ' granted to service_role'
) FROM unnest(ARRAY[
  'check_department_member_limit()',
  'handle_booking_checkin_code_trigger()',
  'increment_booking_version()',
  'sync_resource_user_id()',
  'trg_audit_booking_status_change()',
  'trg_audit_doctor_assignments()',
  'trg_audit_resource_services()',
  'assign_clinic_queue_position()',
  'guard_profile_governance()',
  'guard_provider_governance()',
  'handle_booking_notification_trigger()',
  'handle_new_auth_user()',
  'set_booking_reference_code()',
  'validate_booking_update()',
  '_record_checkin_failure(uuid, timestamp with time zone)',
  'generate_appointment_checkin_code_for_booking(uuid)',
  'dispatch_booking_notification(uuid, text)',
  '_handle_ddl_setup()',
  'auto_ensure_booking_customer()'
]) AS fn;

-- -----------------------------------------------------------------------------
-- 2. CATEGORY B: Helper & Application Functions
-- -----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.' || fn, 'execute'),
  fn || ' denied for anon'
) FROM unnest(ARRAY[
  'is_admin(uuid)',
  'hospital_role(uuid, uuid)',
  'hospital_accessible_resource_ids(uuid, uuid)',
  'get_user_authorized_providers(uuid)',
  'is_hospital_provider(uuid)',
  'is_merchant_owner_or_admin(uuid, uuid)'
]) AS fn;

SELECT ok(
  has_function_privilege('authenticated', 'public.' || fn, 'execute'),
  fn || ' granted to authenticated'
) FROM unnest(ARRAY[
  'is_admin(uuid)',
  'hospital_role(uuid, uuid)',
  'hospital_accessible_resource_ids(uuid, uuid)',
  'get_user_authorized_providers(uuid)',
  'is_hospital_provider(uuid)',
  'is_merchant_owner_or_admin(uuid, uuid)'
]) AS fn;

SELECT ok(
  has_function_privilege('service_role', 'public.' || fn, 'execute'),
  fn || ' granted to service_role'
) FROM unnest(ARRAY[
  'is_admin(uuid)',
  'hospital_role(uuid, uuid)',
  'hospital_accessible_resource_ids(uuid, uuid)',
  'get_user_authorized_providers(uuid)',
  'is_hospital_provider(uuid)',
  'is_merchant_owner_or_admin(uuid, uuid)'
]) AS fn;

-- Category B: Service role only helpers
SELECT ok(
  NOT has_function_privilege('anon', 'public.' || fn, 'execute'),
  fn || ' denied for anon'
) FROM unnest(ARRAY[
  'is_hospital_owner(uuid, uuid)',
  'get_user_department_id(uuid, uuid)',
  'is_caller_authorized_for_resource(uuid, uuid, uuid)'
]) AS fn;

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.' || fn, 'execute'),
  fn || ' denied for authenticated'
) FROM unnest(ARRAY[
  'is_hospital_owner(uuid, uuid)',
  'get_user_department_id(uuid, uuid)',
  'is_caller_authorized_for_resource(uuid, uuid, uuid)'
]) AS fn;

SELECT ok(
  has_function_privilege('service_role', 'public.' || fn, 'execute'),
  fn || ' granted to service_role'
) FROM unnest(ARRAY[
  'is_hospital_owner(uuid, uuid)',
  'get_user_department_id(uuid, uuid)',
  'is_caller_authorized_for_resource(uuid, uuid, uuid)'
]) AS fn;

-- -----------------------------------------------------------------------------
-- 3. CATEGORY C: Public By Design Functions
-- -----------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('anon', 'public.' || fn, 'execute'),
  fn || ' granted to anon'
) FROM unnest(ARRAY[
  'get_active_cities(boolean)',
  'search_directory_public(text)',
  'get_nearby_providers(numeric, numeric, text, integer)',
  'submit_city_waitlist(text, text, text, text)',
  'log_client_event(text, text, text, text, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text)'
]) AS fn;

SELECT ok(
  has_function_privilege('authenticated', 'public.' || fn, 'execute'),
  fn || ' granted to authenticated'
) FROM unnest(ARRAY[
  'get_active_cities(boolean)',
  'search_directory_public(text)',
  'get_nearby_providers(numeric, numeric, text, integer)',
  'submit_city_waitlist(text, text, text, text)',
  'log_client_event(text, text, text, text, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text)'
]) AS fn;

SELECT ok(
  has_function_privilege('service_role', 'public.' || fn, 'execute'),
  fn || ' granted to service_role'
) FROM unnest(ARRAY[
  'get_active_cities(boolean)',
  'search_directory_public(text)',
  'get_nearby_providers(numeric, numeric, text, integer)',
  'submit_city_waitlist(text, text, text, text)',
  'log_client_event(text, text, text, text, text, jsonb, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text)'
]) AS fn;

-- -----------------------------------------------------------------------------
-- 4. CATEGORY D: Admin Only Procedures (service_role only)
-- -----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.' || fn, 'execute'),
  fn || ' denied for anon'
) FROM unnest(ARRAY[
  'admin_create_resource(uuid, text, text, text, numeric, numeric, integer, integer, jsonb)',
  'admin_create_user(text, text, text, text, text)',
  'admin_create_venue(text, text, text, text, time without time zone, time without time zone, text, text, uuid, numeric, numeric)',
  'admin_delete_resource(uuid)',
  'admin_fetch_merchants(text)',
  'admin_update_merchant_status(uuid, text, text)',
  'admin_update_provider_operational_settings(uuid, boolean, boolean, integer, text, jsonb)',
  'admin_update_resource_status(uuid, boolean, text)',
  'auto_link_merchant_by_email(uuid, text)',
  'get_admin_audit_logs(integer, text)',
  'get_admin_city_stats()',
  'get_admin_velocity_analytics(text, text)',
  'get_city_director_stats(date, date)',
  'merchant_self_register(text, text, text, text, text, text, text, text)',
  'reveal_contact(uuid)',
  'update_city_status(text, text, integer, text)',
  'confirm_booking_by_merchant(uuid)',
  'get_merchant_bookings(uuid)',
  'get_provider_details(uuid)',
  'merchant_register_shop_for_user(uuid, text, text, text, text, text, text)',
  'merchant_update_cooling_period(uuid, integer)',
  'record_no_show(uuid)',
  'reorder_hospital_queue(uuid, uuid, uuid[], uuid)',
  'collect_consultation_fee(uuid, uuid)'
]) AS fn;

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.' || fn, 'execute'),
  fn || ' denied for authenticated'
) FROM unnest(ARRAY[
  'admin_create_resource(uuid, text, text, text, numeric, numeric, integer, integer, jsonb)',
  'admin_create_user(text, text, text, text, text)',
  'admin_create_venue(text, text, text, text, time without time zone, time without time zone, text, text, uuid, numeric, numeric)',
  'admin_delete_resource(uuid)',
  'admin_fetch_merchants(text)',
  'admin_update_merchant_status(uuid, text, text)',
  'admin_update_provider_operational_settings(uuid, boolean, boolean, integer, text, jsonb)',
  'admin_update_resource_status(uuid, boolean, text)',
  'auto_link_merchant_by_email(uuid, text)',
  'get_admin_audit_logs(integer, text)',
  'get_admin_city_stats()',
  'get_admin_velocity_analytics(text, text)',
  'get_city_director_stats(date, date)',
  'merchant_self_register(text, text, text, text, text, text, text, text)',
  'reveal_contact(uuid)',
  'update_city_status(text, text, integer, text)',
  'confirm_booking_by_merchant(uuid)',
  'get_merchant_bookings(uuid)',
  'get_provider_details(uuid)',
  'merchant_register_shop_for_user(uuid, text, text, text, text, text, text)',
  'merchant_update_cooling_period(uuid, integer)',
  'record_no_show(uuid)',
  'reorder_hospital_queue(uuid, uuid, uuid[], uuid)',
  'collect_consultation_fee(uuid, uuid)'
]) AS fn;

SELECT ok(
  has_function_privilege('service_role', 'public.' || fn, 'execute'),
  fn || ' granted to service_role'
) FROM unnest(ARRAY[
  'admin_create_resource(uuid, text, text, text, numeric, numeric, integer, integer, jsonb)',
  'admin_create_user(text, text, text, text, text)',
  'admin_create_venue(text, text, text, text, time without time zone, time without time zone, text, text, uuid, numeric, numeric)',
  'admin_delete_resource(uuid)',
  'admin_fetch_merchants(text)',
  'admin_update_merchant_status(uuid, text, text)',
  'admin_update_provider_operational_settings(uuid, boolean, boolean, integer, text, jsonb)',
  'admin_update_resource_status(uuid, boolean, text)',
  'auto_link_merchant_by_email(uuid, text)',
  'get_admin_audit_logs(integer, text)',
  'get_admin_city_stats()',
  'get_admin_velocity_analytics(text, text)',
  'get_city_director_stats(date, date)',
  'merchant_self_register(text, text, text, text, text, text, text, text)',
  'reveal_contact(uuid)',
  'update_city_status(text, text, integer, text)',
  'confirm_booking_by_merchant(uuid)',
  'get_merchant_bookings(uuid)',
  'get_provider_details(uuid)',
  'merchant_register_shop_for_user(uuid, text, text, text, text, text, text)',
  'merchant_update_cooling_period(uuid, integer)',
  'record_no_show(uuid)',
  'reorder_hospital_queue(uuid, uuid, uuid[], uuid)',
  'collect_consultation_fee(uuid, uuid)'
]) AS fn;

-- -----------------------------------------------------------------------------
-- 5. CATEGORY D: Authenticated RPCs (authenticated + service_role)
-- -----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.' || fn, 'execute'),
  fn || ' denied for anon'
) FROM unnest(ARRAY[
  'cancel_booking(uuid, text, text)',
  'cancel_doctor_emergency(uuid, timestamp with time zone, text, boolean)',
  'check_cooling_period_eligibility(uuid, uuid, timestamp with time zone)',
  'complete_booking(uuid)',
  'create_booking_hold(uuid, timestamp with time zone, timestamp with time zone, uuid, boolean, text, text, text, text, smallint, text)',
  'get_masked_customer_info(uuid)',
  'mark_customer_reached(uuid)',
  'mark_present_manually(uuid)',
  'override_hospital_queue_position(uuid, integer, uuid)',
  'reassign_booking_resource(uuid, uuid, text)',
  'request_account_deletion(text)',
  'reschedule_booking_slot(uuid, timestamp with time zone, timestamp with time zone)',
  'reveal_customer_contact(uuid, text)',
  'search_directory(text)',
  'sync_customer_profile(text, text, text)',
  'verify_checkin_code(uuid, text)'
]) AS fn;

SELECT ok(
  has_function_privilege('authenticated', 'public.' || fn, 'execute'),
  fn || ' granted to authenticated'
) FROM unnest(ARRAY[
  'cancel_booking(uuid, text, text)',
  'cancel_doctor_emergency(uuid, timestamp with time zone, text, boolean)',
  'check_cooling_period_eligibility(uuid, uuid, timestamp with time zone)',
  'complete_booking(uuid)',
  'create_booking_hold(uuid, timestamp with time zone, timestamp with time zone, uuid, boolean, text, text, text, text, smallint, text)',
  'get_masked_customer_info(uuid)',
  'mark_customer_reached(uuid)',
  'mark_present_manually(uuid)',
  'override_hospital_queue_position(uuid, integer, uuid)',
  'reassign_booking_resource(uuid, uuid, text)',
  'request_account_deletion(text)',
  'reschedule_booking_slot(uuid, timestamp with time zone, timestamp with time zone)',
  'reveal_customer_contact(uuid, text)',
  'search_directory(text)',
  'sync_customer_profile(text, text, text)',
  'verify_checkin_code(uuid, text)'
]) AS fn;

SELECT ok(
  has_function_privilege('service_role', 'public.' || fn, 'execute'),
  fn || ' granted to service_role'
) FROM unnest(ARRAY[
  'cancel_booking(uuid, text, text)',
  'cancel_doctor_emergency(uuid, timestamp with time zone, text, boolean)',
  'check_cooling_period_eligibility(uuid, uuid, timestamp with time zone)',
  'complete_booking(uuid)',
  'create_booking_hold(uuid, timestamp with time zone, timestamp with time zone, uuid, boolean, text, text, text, text, smallint, text)',
  'get_masked_customer_info(uuid)',
  'mark_customer_reached(uuid)',
  'mark_present_manually(uuid)',
  'override_hospital_queue_position(uuid, integer, uuid)',
  'reassign_booking_resource(uuid, uuid, text)',
  'request_account_deletion(text)',
  'reschedule_booking_slot(uuid, timestamp with time zone, timestamp with time zone)',
  'reveal_customer_contact(uuid, text)',
  'search_directory(text)',
  'sync_customer_profile(text, text, text)',
  'verify_checkin_code(uuid, text)'
]) AS fn;

-- -----------------------------------------------------------------------------
-- 6. CATEGORY E: Server & Cron Only Functions (service_role only)
-- -----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.' || fn, 'execute'),
  fn || ' denied for anon'
) FROM unnest(ARRAY[
  'purge_expired_waitlist_entries()',
  'purge_old_app_logs(integer)',
  'expire_stale_standby_queue(integer, uuid)',
  'release_expired_holds()'
]) AS fn;

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.' || fn, 'execute'),
  fn || ' denied for authenticated'
) FROM unnest(ARRAY[
  'purge_expired_waitlist_entries()',
  'purge_old_app_logs(integer)',
  'expire_stale_standby_queue(integer, uuid)',
  'release_expired_holds()'
]) AS fn;

SELECT ok(
  has_function_privilege('service_role', 'public.' || fn, 'execute'),
  fn || ' granted to service_role'
) FROM unnest(ARRAY[
  'purge_expired_waitlist_entries()',
  'purge_old_app_logs(integer)',
  'expire_stale_standby_queue(integer, uuid)',
  'release_expired_holds()'
]) AS fn;

-- -----------------------------------------------------------------------------
-- 7. CATEGORY F: Test Clock Fixtures (service_role only)
-- -----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.' || fn, 'execute'),
  fn || ' denied for anon'
) FROM unnest(ARRAY[
  'get_test_clock(uuid)',
  'get_test_clock_for_prefix(text)',
  'set_test_clock(text, timestamp with time zone)',
  'advance_test_clock(text, integer)',
  'reset_test_bookings(uuid, uuid)',
  'reset_test_customer_strikes(uuid, integer)',
  'reset_test_provider_strikes(uuid, integer)'
]) AS fn;

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.' || fn, 'execute'),
  fn || ' denied for authenticated'
) FROM unnest(ARRAY[
  'get_test_clock(uuid)',
  'get_test_clock_for_prefix(text)',
  'set_test_clock(text, timestamp with time zone)',
  'advance_test_clock(text, integer)',
  'reset_test_bookings(uuid, uuid)',
  'reset_test_customer_strikes(uuid, integer)',
  'reset_test_provider_strikes(uuid, integer)'
]) AS fn;

SELECT ok(
  has_function_privilege('service_role', 'public.' || fn, 'execute'),
  fn || ' granted to service_role'
) FROM unnest(ARRAY[
  'get_test_clock(uuid)',
  'get_test_clock_for_prefix(text)',
  'set_test_clock(text, timestamp with time zone)',
  'advance_test_clock(text, integer)',
  'reset_test_bookings(uuid, uuid)',
  'reset_test_customer_strikes(uuid, integer)',
  'reset_test_provider_strikes(uuid, integer)'
]) AS fn;

-- -----------------------------------------------------------------------------
-- 8. DEFAULT PRIVILEGES: Newly created function in schema public fails closed
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sample_unadorned_future_function()
RETURNS boolean
LANGUAGE sql
AS $$ SELECT true; $$;

SELECT ok(
  NOT has_function_privilege('anon', 'public.sample_unadorned_future_function()', 'execute'),
  'Newly defined function in public is denied for anon under default privileges'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.sample_unadorned_future_function()', 'execute'),
  'Newly defined function in public is denied for authenticated under default privileges'
);

SELECT * FROM finish();
ROLLBACK;
