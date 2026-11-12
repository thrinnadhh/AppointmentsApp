# Index Review & Advisor Classification

Per Phase 6 standing rules: Indexes with `idx_scan = 0` on local development represent pre-launch lack of traffic, NOT useless indexes. All indexes are audited and categorized into KEEP-A, KEEP-B, KEEP-C, and DROP-CANDIDATE.

| Index | Table | Columns | Class | Decision | Reason |
|---|---|---|---|---|---|
| `account_deletion_requests_pkey` | `account_deletion_requests` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_account_deletion_requests_user_id` | `account_deletion_requests` | `user_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): account_deletion_requests_user_id_fkey |
| `idx_deletion_requests_pending` | `account_deletion_requests` | `scheduled_for` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (timestamptz_ops) |
| `admin_audit_logs_pkey` | `admin_audit_logs` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_admin_audit_logs_action` | `admin_audit_logs` | `action` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_admin_audit_logs_admin_id` | `admin_audit_logs` | `admin_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): admin_audit_logs_admin_id_fkey |
| `idx_admin_audit_logs_created_at` | `admin_audit_logs` | `created_at` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (timestamptz_ops) |
| `app_logs_pkey` | `app_logs` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_app_logs_appointment_id` | `app_logs` | `appointment_id` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_app_logs_category` | `app_logs` | `category` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_app_logs_city_id` | `app_logs` | `city_id` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_app_logs_component` | `app_logs` | `component` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_app_logs_created_at` | `app_logs` | `created_at` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (timestamptz_ops) |
| `idx_app_logs_fingerprint` | `app_logs` | `fingerprint` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_app_logs_level` | `app_logs` | `level` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_app_logs_platform` | `app_logs` | `platform` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_app_logs_severity` | `app_logs` | `severity` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_app_logs_source` | `app_logs` | `source` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_app_logs_user_id` | `app_logs` | `user_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): app_logs_user_id_fkey |
| `appointment_checkin_codes_booking_id_key` | `appointment_checkin_codes` | `booking_id` | **KEEP-A** | `KEEP` | Backs u constraint appointment_checkin_codes_booking_id_key |
| `appointment_checkin_codes_pkey` | `appointment_checkin_codes` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_checkin_codes_booking_id` | `appointment_checkin_codes` | `booking_id` | **DROP-CANDIDATE** | `DROP` | Provably redundant duplicate of unique constraint unique_booking_checkin_code on (booking_id) |
| `idx_checkin_codes_customer_id` | `appointment_checkin_codes` | `customer_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): appointment_checkin_codes_customer_id_fkey |
| `idx_checkin_codes_lookup` | `appointment_checkin_codes` | `provider_id, appointment_date, code` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): appointment_checkin_codes_provider_id_fkey |
| `unique_booking_checkin_code` | `appointment_checkin_codes` | `booking_id` | **KEEP-A** | `KEEP` | Backs u constraint unique_booking_checkin_code |
| `audit_logs_pkey` | `audit_logs` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_audit_logs_action` | `audit_logs` | `action` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_audit_logs_actor_id` | `audit_logs` | `actor_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): audit_logs_actor_id_fkey |
| `idx_audit_logs_booking_id` | `audit_logs` | `booking_id` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (uuid_ops) |
| `idx_audit_logs_merchant_created` | `audit_logs` | `merchant_id, created_at` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): audit_logs_merchant_id_fkey |
| `bookings_invoice_number_key` | `bookings` | `invoice_number` | **KEEP-A** | `KEEP` | Backs u constraint bookings_invoice_number_key |
| `bookings_pkey` | `bookings` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `bookings_reference_code_key` | `bookings` | `reference_code` | **KEEP-A** | `KEEP` | Backs u constraint bookings_reference_code_key |
| `idx_bookings_checked_in_at` | `bookings` | `provider_id, checked_in_at` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): bookings_provider_id_fkey |
| `idx_bookings_checked_in_by` | `bookings` | `checked_in_by` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): bookings_checked_in_by_fkey |
| `idx_bookings_cooling_lookup` | `bookings` | `customer_id, provider_id, status, slot_start` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): bookings_customer_id_fkey |
| `idx_bookings_customer` | `bookings` | `customer_id, status` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): bookings_customer_id_fkey |
| `idx_bookings_customer_slot` | `bookings` | `customer_id, slot_start` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): bookings_customer_id_fkey |
| `idx_bookings_department_id` | `bookings` | `department_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): bookings_department_id_fkey |
| `idx_bookings_followup_orig` | `bookings` | `followup_original_booking_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): bookings_followup_original_booking_id_fkey |
| `idx_bookings_gateway_order_id` | `bookings` | `gateway_order_id` | **KEEP-A** | `KEEP` | Enforces uniqueness constraint |
| `idx_bookings_hold_expiry` | `bookings` | `hold_expires_at` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (timestamptz_ops) |
| `idx_bookings_is_present` | `bookings` | `provider_id, is_present` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): bookings_provider_id_fkey |
| `idx_bookings_provider` | `bookings` | `provider_id, slot_start` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): bookings_provider_id_fkey |
| `idx_bookings_reference_code` | `bookings` | `reference_code` | **DROP-CANDIDATE** | `DROP` | Provably redundant duplicate of unique constraint bookings_reference_code_key on (reference_code) |
| `idx_bookings_reminder_1h` | `bookings` | `status, slot_start` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (enum_ops, timestamptz_ops) |
| `idx_bookings_reminder_30m` | `bookings` | `status, slot_start` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (enum_ops, timestamptz_ops) |
| `idx_single_in_consultation_per_doctor` | `bookings` | `resource_id` | **KEEP-A** | `KEEP` | Enforces uniqueness constraint |
| `no_overlapping_active_bookings` | `bookings` | `resource_id, NULL` | **KEEP-A** | `KEEP` | Backs x constraint no_overlapping_active_bookings |
| `categories_pkey` | `categories` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `cities_pkey` | `cities` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_cities_status` | `cities` | `status` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `city_settlements_city_id_period_start_period_end_key` | `city_settlements` | `city_id, period_start, period_end` | **KEEP-A** | `KEEP` | Backs u constraint city_settlements_city_id_period_start_period_end_key |
| `city_settlements_pkey` | `city_settlements` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_city_settlements_approved_by` | `city_settlements` | `approved_by` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): city_settlements_approved_by_fkey |
| `city_waitlist_pkey` | `city_waitlist` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_city_waitlist_city` | `city_waitlist` | `city_name` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `contact_reveal_audit_pkey` | `contact_reveal_audit` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_contact_reveal_audit_booking` | `contact_reveal_audit` | `booking_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): contact_reveal_audit_booking_id_fkey |
| `idx_contact_reveal_audit_user` | `contact_reveal_audit` | `user_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): contact_reveal_audit_user_id_fkey |
| `crash_alert_dedup_pkey` | `crash_alert_dedup` | `fingerprint` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `department_members_pkey` | `department_members` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_department_members_invited_by` | `department_members` | `invited_by` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): department_members_invited_by_fkey |
| `idx_dept_members_department_id` | `department_members` | `department_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): department_members_department_id_fkey |
| `idx_dept_members_email` | `department_members` | `NULL` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_dept_members_merchant_id` | `department_members` | `merchant_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): department_members_merchant_id_fkey |
| `idx_dept_members_role` | `department_members` | `department_id, role` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): department_members_department_id_fkey |
| `idx_dept_members_unique_active_email` | `department_members` | `merchant_id, NULL` | **KEEP-A** | `KEEP` | Enforces uniqueness constraint |
| `idx_dept_members_user_id` | `department_members` | `user_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): department_members_user_id_fkey |
| `departments_pkey` | `departments` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_departments_is_active` | `departments` | `merchant_id, is_active` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): departments_merchant_id_fkey |
| `idx_departments_merchant_id` | `departments` | `merchant_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): departments_merchant_id_fkey |
| `idx_departments_merchant_lower_name` | `departments` | `merchant_id, NULL` | **KEEP-A** | `KEEP` | Enforces uniqueness constraint |
| `doctor_front_desk_assignments_doctor_id_user_id_key` | `doctor_front_desk_assignments` | `doctor_id, user_id` | **KEEP-A** | `KEEP` | Backs u constraint doctor_front_desk_assignments_doctor_id_user_id_key |
| `doctor_front_desk_assignments_pkey` | `doctor_front_desk_assignments` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_dfda_doctor_id` | `doctor_front_desk_assignments` | `doctor_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): doctor_front_desk_assignments_doctor_id_fkey |
| `idx_dfda_provider_id` | `doctor_front_desk_assignments` | `provider_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): doctor_front_desk_assignments_provider_id_fkey |
| `idx_dfda_user_id` | `doctor_front_desk_assignments` | `user_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): doctor_front_desk_assignments_user_id_fkey |
| `idx_merchant_memberships_provider_id` | `merchant_memberships` | `provider_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): merchant_memberships_provider_id_fkey |
| `idx_merchant_memberships_user_id` | `merchant_memberships` | `user_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): merchant_memberships_user_id_fkey |
| `merchant_memberships_pkey` | `merchant_memberships` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `merchant_memberships_user_id_provider_id_key` | `merchant_memberships` | `user_id, provider_id` | **KEEP-A** | `KEEP` | Backs u constraint merchant_memberships_user_id_provider_id_key |
| `idx_notification_logs_claim_queue` | `notification_logs` | `next_attempt_at, created_at` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (timestamptz_ops, timestamptz_ops) |
| `idx_notification_logs_sent_at` | `notification_logs` | `sent_at` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (timestamptz_ops) |
| `notification_logs_pkey` | `notification_logs` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `uq_idx_notification_logs_booking_event_channel` | `notification_logs` | `booking_id, event_type, channel` | **KEEP-A** | `KEEP` | Enforces uniqueness constraint |
| `idx_payments_booking_id` | `payments` | `booking_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): payments_booking_id_fkey |
| `idx_payments_gateway_payment_id_unique` | `payments` | `gateway_payment_id` | **KEEP-A** | `KEEP` | Enforces uniqueness constraint |
| `payments_gateway_payment_id_key` | `payments` | `gateway_payment_id` | **KEEP-A** | `KEEP` | Backs u constraint payments_gateway_payment_id_key |
| `payments_pkey` | `payments` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `platform_config_pkey` | `platform_config` | `key` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_profiles_assigned_city` | `profiles` | `assigned_city_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): profiles_assigned_city_id_fkey |
| `idx_profiles_default_provider_id` | `profiles` | `default_provider_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): profiles_default_provider_id_fkey |
| `idx_profiles_phone` | `profiles` | `phone` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `profiles_pkey` | `profiles` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_providers_category` | `providers` | `category_id, sub_category_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): providers_category_id_fkey |
| `idx_providers_city_id` | `providers` | `city_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): providers_city_id_fkey |
| `idx_providers_desc_trgm` | `providers` | `description` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (gin_trgm_ops) |
| `idx_providers_geo` | `providers` | `NULL` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (gist_geography_ops) |
| `idx_providers_name_trgm` | `providers` | `name` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (gin_trgm_ops) |
| `idx_providers_owner_id` | `providers` | `owner_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): providers_owner_id_fkey |
| `idx_providers_status` | `providers` | `status` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (enum_ops) |
| `idx_providers_sub_category_id` | `providers` | `sub_category_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): providers_sub_category_id_fkey |
| `providers_pkey` | `providers` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_push_tokens_token` | `push_tokens` | `token` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (text_ops) |
| `idx_push_tokens_user_id` | `push_tokens` | `user_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): push_tokens_user_id_fkey |
| `push_tokens_pkey` | `push_tokens` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `uq_user_push_token` | `push_tokens` | `user_id, token` | **KEEP-A** | `KEEP` | Backs u constraint uq_user_push_token |
| `idx_resource_availability_resource_id` | `resource_availability` | `resource_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): resource_availability_resource_id_fkey |
| `resource_availability_pkey` | `resource_availability` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_resources_department_id` | `resources` | `department_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): resources_department_id_fkey |
| `idx_resources_dept_trgm` | `resources` | `department` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (gin_trgm_ops) |
| `idx_resources_name_trgm` | `resources` | `name` | **KEEP-C** | `KEEP` | Purpose-built query accelerator (gin_trgm_ops) |
| `idx_resources_provider` | `resources` | `provider_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): resources_provider_id_fkey |
| `idx_resources_user_id` | `resources` | `user_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): resources_user_id_fkey |
| `resources_pkey` | `resources` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `staff_checkin_rate_limits_pkey` | `staff_checkin_rate_limits` | `user_id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_sub_categories_category_id` | `sub_categories` | `category_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): sub_categories_category_id_fkey |
| `sub_categories_pkey` | `sub_categories` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_test_provider_clock_links_tenant_prefix` | `test_provider_clock_links` | `tenant_prefix` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): test_provider_clock_links_tenant_prefix_fkey |
| `test_provider_clock_links_pkey` | `test_provider_clock_links` | `provider_id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `test_tenant_clocks_pkey` | `test_tenant_clocks` | `tenant_prefix` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `idx_user_consents_user` | `user_consents` | `user_id` | **KEEP-B** | `KEEP` | Supports Foreign Key(s): user_consents_user_id_fkey |
| `user_consents_pkey` | `user_consents` | `id` | **KEEP-A** | `KEEP` | Backs Primary Key constraint |
| `user_consents_user_id_purpose_version_key` | `user_consents` | `user_id, purpose, version` | **KEEP-A** | `KEEP` | Backs u constraint user_consents_user_id_purpose_version_key |

## Revisit Plan (2–4 Weeks Post-Launch)
1. Allow 2 to 4 weeks of continuous production traffic on cloud PostgreSQL.
2. Execute `SELECT schemaname, relname, indexrelname, idx_scan FROM pg_stat_user_indexes WHERE schemaname = 'public' AND idx_scan = 0;`
3. Filter out all `KEEP-A` (constraint-backing) and `KEEP-B` (foreign-key-supporting) indexes.
4. For remaining `KEEP-C` indexes that show `idx_scan = 0`, inspect application query plans before considering deprecation.
