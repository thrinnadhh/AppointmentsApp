# Baseline Security State (Pre-Remediation)

Generated: 2026-11-07T08:38:12.199Z

## 1. Test Suite & Build Baseline

- **Unit / Security Suites**: 99 passing tests (0 failures, 2 skipped)
- **Typecheck**: 0 errors across packages/shared, apps/merchant-web, apps/customer-mobile
- **Builds**:
  - apps/merchant-web (Next.js): SUCCESS (52/52 static pages generated)
  - apps/customer-mobile (Expo Web Export): SUCCESS (dist exported)

## 2. PostgreSQL Function ACL Baseline (public schema)

| Function | Arguments | Security Definer | ACL | Search Path Config |
| :--- | :--- | :---: | :--- | :--- |
| `_handle_ddl_setup` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `_record_checkin_failure` | p_user_id uuid, p_now timestamp with time zone | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `admin_create_resource` | p_provider_id uuid, p_name text, p_type text, p_department text, p_price numeric, p_deposit_amount numeric, p_duration_minutes integer, p_capacity integer, p_attributes jsonb | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `admin_create_user` | p_email text, p_password text, p_full_name text, p_role text, p_phone text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `admin_create_venue` | p_name text, p_category_id text, p_address text, p_phone text, p_opening_time time without time zone, p_closing_time time without time zone, p_description text, p_email text, p_owner_id uuid, p_latitude numeric, p_longitude numeric | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `admin_delete_resource` | p_resource_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `admin_fetch_merchants` | p_city_id text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `admin_update_merchant_status` | p_provider_id uuid, p_status text, p_admin_token text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `admin_update_provider_operational_settings` | p_provider_id uuid, p_is_active boolean, p_auto_accept boolean, p_daily_limit integer, p_admin_token text, p_weekly_hours jsonb | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `admin_update_resource_status` | uuid, boolean, text | NO | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | none |
| `advance_test_clock` | p_prefix text, p_minutes integer | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `anonymize_user_data` | p_user_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `assert_booking_actor` | p_customer_id uuid, p_provider_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `assign_clinic_queue_position` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `atomic_assign_checkin_arrival` | p_booking_id uuid, p_arrived_at timestamp with time zone | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `auto_ensure_booking_customer` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `auto_link_merchant_by_email` | p_user_id uuid, p_email text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `build_template_params` | p_event_type text, p_booking jsonb | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `cancel_booking` | p_booking_id uuid, p_reason text, p_initiated_by text | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `cancel_doctor_emergency` | p_doctor_resource_id uuid, p_effective_from timestamp with time zone, p_reason text, p_doctor_arrived boolean | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `cancel_unpaid_pending_bookings` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `cash_dist` | money, money | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `check_and_send_booking_reminders` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `check_cooling_period_eligibility` | p_customer_id uuid, p_provider_id uuid, p_target_slot timestamp with time zone | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `check_department_member_limit` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `check_user_exists_by_phone` | p_phone text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `choose_emergency_option` | p_booking_id uuid, p_choice text, p_new_slot_start timestamp with time zone, p_new_slot_end timestamp with time zone | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `citext` | boolean | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext` | character | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext` | inet | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_cmp` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_eq` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_ge` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_gt` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_hash` | citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_hash_extended` | citext, bigint | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_larger` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_le` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_lt` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_ne` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_pattern_cmp` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_pattern_ge` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_pattern_gt` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_pattern_le` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_pattern_lt` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citext_smaller` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citextin` | cstring | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citextout` | citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citextrecv` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `citextsend` | citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `claim_queued_notifications` | p_limit integer | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `collect_consultation_fee` | p_booking_id uuid, p_collected_by uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `complete_booking` | p_booking_id uuid | YES | {postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres} | {"search_path=public, pg_temp"} |
| `compute_gst_for_booking` | p_booking_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `confirm_booking_by_merchant` | p_booking_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `confirm_booking_payment` | p_booking_id uuid, p_gateway_payment_id text, p_deposit_amount numeric | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `create_booking_hold` | p_resource_id uuid, p_slot_start timestamp with time zone, p_slot_end timestamp with time zone, p_customer_id uuid, p_booking_for_someone_else boolean, p_patient_name text, p_patient_phone text, p_patient_relationship text, p_booked_for text, p_patient_age smallint, p_booking_note text | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `cron_daily_cleanup` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, cron, pgmq, pg_temp"} |
| `cron_expire_no_shows` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `cron_trigger_queue_consumers` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, net, extensions, pg_temp"} |
| `date_dist` | date, date | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `dispatch_booking_notification` | p_booking_id uuid, p_event_type text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `enqueue_booking_reminders` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `enqueue_refund_request` | p_booking_id uuid, p_actor_id uuid, p_reason text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `expire_stale_standby_queue` | p_threshold_minutes integer, p_provider_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `float4_dist` | real, real | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `float8_dist` | double precision, double precision | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bit_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bit_consistent` | internal, bit, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bit_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bit_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bit_same` | gbtreekey_var, gbtreekey_var, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bit_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bool_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bool_consistent` | internal, boolean, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bool_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bool_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bool_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bool_same` | gbtreekey2, gbtreekey2, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bool_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bpchar_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bpchar_consistent` | internal, character, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bytea_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bytea_consistent` | internal, bytea, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bytea_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bytea_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bytea_same` | gbtreekey_var, gbtreekey_var, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_bytea_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_cash_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_cash_consistent` | internal, money, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_cash_distance` | internal, money, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_cash_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_cash_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_cash_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_cash_same` | gbtreekey16, gbtreekey16, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_cash_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_date_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_date_consistent` | internal, date, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_date_distance` | internal, date, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_date_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_date_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_date_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_date_same` | gbtreekey8, gbtreekey8, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_date_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_decompress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_enum_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_enum_consistent` | internal, anyenum, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_enum_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_enum_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_enum_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_enum_same` | gbtreekey8, gbtreekey8, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_enum_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float4_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float4_consistent` | internal, real, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float4_distance` | internal, real, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float4_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float4_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float4_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float4_same` | gbtreekey8, gbtreekey8, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float4_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float8_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float8_consistent` | internal, double precision, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float8_distance` | internal, double precision, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float8_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float8_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float8_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float8_same` | gbtreekey16, gbtreekey16, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_float8_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_inet_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_inet_consistent` | internal, inet, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_inet_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_inet_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_inet_same` | gbtreekey16, gbtreekey16, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_inet_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int2_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int2_consistent` | internal, smallint, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int2_distance` | internal, smallint, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int2_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int2_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int2_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int2_same` | gbtreekey4, gbtreekey4, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int2_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int4_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int4_consistent` | internal, integer, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int4_distance` | internal, integer, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int4_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int4_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int4_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int4_same` | gbtreekey8, gbtreekey8, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int4_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int8_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int8_consistent` | internal, bigint, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int8_distance` | internal, bigint, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int8_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int8_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int8_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int8_same` | gbtreekey16, gbtreekey16, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_int8_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_intv_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_intv_consistent` | internal, interval, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_intv_decompress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_intv_distance` | internal, interval, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_intv_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_intv_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_intv_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_intv_same` | gbtreekey32, gbtreekey32, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_intv_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad8_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad8_consistent` | internal, macaddr8, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad8_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad8_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad8_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad8_same` | gbtreekey16, gbtreekey16, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad8_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad_consistent` | internal, macaddr, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad_same` | gbtreekey16, gbtreekey16, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_macad_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_numeric_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_numeric_consistent` | internal, numeric, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_numeric_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_numeric_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_numeric_same` | gbtreekey_var, gbtreekey_var, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_numeric_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_oid_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_oid_consistent` | internal, oid, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_oid_distance` | internal, oid, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_oid_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_oid_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_oid_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_oid_same` | gbtreekey8, gbtreekey8, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_oid_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_text_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_text_consistent` | internal, text, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_text_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_text_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_text_same` | gbtreekey_var, gbtreekey_var, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_text_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_time_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_time_consistent` | internal, time without time zone, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_time_distance` | internal, time without time zone, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_time_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_time_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_time_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_time_same` | gbtreekey16, gbtreekey16, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_time_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_timetz_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_timetz_consistent` | internal, time with time zone, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_ts_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_ts_consistent` | internal, timestamp without time zone, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_ts_distance` | internal, timestamp without time zone, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_ts_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_ts_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_ts_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_ts_same` | gbtreekey16, gbtreekey16, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_ts_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_tstz_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_tstz_consistent` | internal, timestamp with time zone, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_tstz_distance` | internal, timestamp with time zone, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_uuid_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_uuid_consistent` | internal, uuid, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_uuid_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_uuid_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_uuid_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_uuid_same` | gbtreekey32, gbtreekey32, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_uuid_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_var_decompress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbt_var_fetch` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey16_in` | cstring | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey16_out` | gbtreekey16 | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey2_in` | cstring | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey2_out` | gbtreekey2 | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey32_in` | cstring | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey32_out` | gbtreekey32 | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey4_in` | cstring | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey4_out` | gbtreekey4 | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey8_in` | cstring | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey8_out` | gbtreekey8 | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey_var_in` | cstring | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gbtreekey_var_out` | gbtreekey_var | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `generate_appointment_checkin_code_for_booking` | p_booking_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, extensions, pg_temp"} |
| `generate_invoice_number` | p_booking_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_active_cities` | p_include_expanding boolean | YES | {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_admin_audit_logs` | p_limit integer, p_admin_token text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_admin_city_stats` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_admin_velocity_analytics` | p_time_window text, p_city_id text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_city_director_stats` | p_from date, p_until date | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_masked_customer_info` | p_customer_id uuid | YES | {postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres} | {"search_path=public, pg_temp"} |
| `get_merchant_bookings` | p_provider_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_nearby_providers` | p_lat numeric, p_lng numeric, p_category text, p_radius_meters integer | YES | {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_or_create_customer_checkin_pin` | p_customer_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, extensions, pg_temp"} |
| `get_provider_details` | p_provider_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_template_name` | p_event_type text | NO | (default/none) | none |
| `get_test_clock` | p_provider_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_test_clock_for_prefix` | p_prefix text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_user_authorized_providers` | p_user_id uuid | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, auth, pg_temp"} |
| `get_user_department_id` | p_user_id uuid, p_merchant_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `get_vault_secret_by_name` | p_secret_name text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, vault, pg_temp"} |
| `gin_extract_query_trgm` | text, internal, smallint, internal, internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gin_extract_value_trgm` | text, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gin_trgm_consistent` | internal, smallint, text, integer, internal, internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gin_trgm_triconsistent` | internal, smallint, text, integer, internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gtrgm_compress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gtrgm_consistent` | internal, text, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gtrgm_decompress` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gtrgm_distance` | internal, text, smallint, oid, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gtrgm_in` | cstring | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gtrgm_options` | internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gtrgm_out` | gtrgm | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gtrgm_penalty` | internal, internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gtrgm_picksplit` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gtrgm_same` | gtrgm, gtrgm, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `gtrgm_union` | internal, internal | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `guard_profile_governance` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `guard_provider_governance` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `handle_booking_checkin_code_trigger` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `handle_booking_event_webhook_trigger` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, net, extensions, pg_temp"} |
| `handle_booking_notification_trigger` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `handle_new_auth_user` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, extensions, pg_temp"} |
| `hospital_accessible_resource_ids` | p_provider_id uuid, p_user_id uuid | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `hospital_role` | p_provider_id uuid, p_user_id uuid | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `increment_booking_version` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `int2_dist` | smallint, smallint | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `int4_dist` | integer, integer | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `int8_dist` | bigint, bigint | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `interval_dist` | interval, interval | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `is_admin` | p_user_id uuid | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `is_caller_authorized_for_resource` | p_provider_id uuid, p_resource_id uuid, p_user_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, extensions, auth, pg_temp"} |
| `is_hospital_owner` | p_user_id uuid, p_merchant_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `is_hospital_provider` | p_provider_id uuid | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `is_merchant_owner_or_admin` | p_provider_id uuid, p_user_id uuid | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `log_admin_action` | p_action text, p_target_type text, p_target_id text, p_details jsonb | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `log_client_event` | p_platform text, p_level text, p_message text, p_component text, p_stack_trace text, p_metadata jsonb, p_device_info jsonb, p_session_id text, p_severity text, p_category text, p_source text, p_error_code text, p_role text, p_city_id text, p_vertical text, p_appointment_id text, p_app_version text, p_platform_os text, p_device_model text, p_environment text, p_fingerprint text | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,anon=X/postgres} | {"search_path=public, pg_temp"} |
| `mark_customer_reached` | p_booking_id uuid | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `mark_present_manually` | p_booking_id uuid | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, extensions, auth, pg_temp"} |
| `mask_customer_phone` | p_phone text | NO | {=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `mask_old_notification_logs` | p_days integer | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `max` | citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `merchant_register_shop_for_user` | p_user_id uuid, p_shop_name text, p_category_id text, p_phone text, p_address text, p_full_name text, p_photo_url text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `merchant_self_register` | p_full_name text, p_email text, p_password text, p_phone text, p_shop_name text, p_category_id text, p_address text, p_photo_url text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `merchant_update_cooling_period` | p_provider_id uuid, p_cooling_period_days integer | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `min` | citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `normalize_phone_number` | p_phone text | NO | (default/none) | none |
| `oid_dist` | oid, oid | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `override_hospital_queue_position` | p_booking_id uuid, p_override_position integer, p_caller_id uuid | YES | {postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres} | {"search_path=public, extensions, auth, pg_temp"} |
| `process_expired_account_deletions` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `protect_booking_payment_fields` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `purge_expired_waitlist_entries` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `purge_old_app_logs` | p_retention_days integer | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `read_queue_with_dlq` | p_queue text, p_dlq text, p_vt integer, p_qty integer, p_max_reads integer | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `reassign_booking_resource` | p_booking_id uuid, p_new_resource_id uuid, p_reason text | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `record_no_show` | p_booking_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `regexp_match` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `regexp_match` | citext, citext, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `regexp_matches` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `regexp_matches` | citext, citext, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `regexp_replace` | citext, citext, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `regexp_replace` | citext, citext, text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `regexp_split_to_array` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `regexp_split_to_array` | citext, citext, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `regexp_split_to_table` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `regexp_split_to_table` | citext, citext, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `release_expired_holds` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `remove_stale_push_token` | p_token text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `reorder_hospital_queue` | p_provider_id uuid, p_doctor_id uuid, p_booking_ids uuid[], p_caller_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, extensions, auth, pg_temp"} |
| `replace` | citext, citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `replay_dlq_message` | p_dlq text, p_target_queue text, p_dlq_msg_id bigint | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pgmq, pg_temp"} |
| `request_account_deletion` | p_reason text | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `reschedule_booking_slot` | p_booking_id uuid, p_new_slot_start timestamp with time zone, p_new_slot_end timestamp with time zone | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `reset_test_bookings` | p_provider_id uuid, p_customer_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `reset_test_customer_strikes` | p_customer_id uuid, p_count integer | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `reset_test_provider_strikes` | p_provider_id uuid, p_count integer | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `reveal_contact` | p_booking_id uuid | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `reveal_customer_contact` | p_booking_id uuid, p_reason text | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `sanitize_template_param` | p_val text, p_default text | NO | (default/none) | none |
| `search_directory` | p_query text | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `search_directory_public` | p_query text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `set_booking_reference_code` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `set_booking_slot_for_reminder` | p_booking_id uuid, p_minutes_from_now integer | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `set_limit` | real | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `set_test_clock` | p_prefix text, p_time timestamp with time zone | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `show_limit` | none | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `show_trgm` | text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `similarity` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `similarity_dist` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `similarity_op` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `split_part` | citext, citext, integer | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `strict_word_similarity` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `strict_word_similarity_commutator_op` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `strict_word_similarity_dist_commutator_op` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `strict_word_similarity_dist_op` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `strict_word_similarity_op` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `strpos` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `submit_city_waitlist` | p_city_name text, p_phone text, p_vertical_interest text, p_notes text | YES | {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `sync_booking_for_family` | none | NO | (default/none) | none |
| `sync_customer_profile` | p_full_name text, p_phone text, p_email text | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `sync_resource_user_id` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `texticlike` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `texticlike` | citext, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `texticnlike` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `texticnlike` | citext, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `texticregexeq` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `texticregexeq` | citext, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `texticregexne` | citext, citext | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `texticregexne` | citext, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `time_dist` | time without time zone, time without time zone | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `translate` | citext, citext, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `trg_audit_booking_status_change` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `trg_audit_doctor_assignments` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `trg_audit_resource_services` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `trg_push_tokens_updated_at` | none | NO | (default/none) | none |
| `trigger_whatsapp_sender_cron` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `ts_dist` | timestamp without time zone, timestamp without time zone | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `tstz_dist` | timestamp with time zone, timestamp with time zone | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `update_city_status` | p_city_id text, p_status text, p_target integer, p_admin_token text | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `validate_booking_update` | none | YES | {postgres=X/postgres,service_role=X/postgres} | {"search_path=public, pg_temp"} |
| `verify_checkin_code` | p_shop_id uuid, p_code text | YES | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | {"search_path=public, extensions, auth, pg_temp"} |
| `word_similarity` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `word_similarity_commutator_op` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `word_similarity_dist_commutator_op` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `word_similarity_dist_op` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |
| `word_similarity_op` | text, text | NO | {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin} | none |

## 3. Row Level Security (RLS) Policy Baseline (public schema)

| Table | Policy Name | Permissive | Roles | Command | Qual / With Check |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `account_deletion_requests` | Users see own deletion request | PERMISSIVE | {public} | SELECT | (( SELECT auth.uid() AS uid) = user_id) |
| `admin_audit_logs` | Admins can view audit logs | PERMISSIVE | {public} | SELECT | is_admin(( SELECT auth.uid() AS uid)) |
| `admin_audit_logs` | Service role full access to audit logs | PERMISSIVE | {service_role} | ALL | true |
| `app_logs` | Only admins can view app logs | PERMISSIVE | {authenticated} | SELECT | is_admin(( SELECT auth.uid() AS uid)) |
| `app_logs` | Service role full access to app logs | PERMISSIVE | {service_role} | ALL | true |
| `appointment_checkin_codes` | customers_read_own_checkin_codes | PERMISSIVE | {authenticated} | SELECT | (customer_id = ( SELECT auth.uid() AS uid)) |
| `audit_logs` | insert_audit_logs | PERMISSIVE | {authenticated,service_role} | INSERT | ((( SELECT auth.role() AS role) = 'service_role'::text) OR (( SELECT auth.uid()  |
| `bookings` | Customers can create bookings | PERMISSIVE | {public} | INSERT | (( SELECT auth.uid() AS uid) = customer_id) |
| `bookings` | allow_reading_bookings | PERMISSIVE | {authenticated} | SELECT | ((( SELECT auth.uid() AS uid) = customer_id) OR is_admin(( SELECT auth.uid() AS  |
| `bookings` | allow_updating_bookings | PERMISSIVE | {authenticated} | UPDATE | ((( SELECT auth.uid() AS uid) = customer_id) OR is_admin(( SELECT auth.uid() AS  |
| `categories` | Categories are readable by everyone | PERMISSIVE | {public} | SELECT | true |
| `cities` | Allow public read cities | PERMISSIVE | {anon,authenticated} | SELECT | true |
| `city_settlements` | Admins manage settlements | PERMISSIVE | {public} | ALL | is_admin() |
| `city_waitlist` | Admins only read city waitlist | PERMISSIVE | {authenticated} | SELECT | is_admin(( SELECT auth.uid() AS uid)) |
| `contact_reveal_audit` | Admins only read reveal audits | PERMISSIVE | {authenticated} | SELECT | is_admin(( SELECT auth.uid() AS uid)) |
| `crash_alert_dedup` | Admins and service role view dedup | PERMISSIVE | {authenticated} | SELECT | is_admin(( SELECT auth.uid() AS uid)) |
| `crash_alert_dedup` | Service role full access dedup | PERMISSIVE | {service_role} | ALL | true |
| `department_members` | members_view_own_membership | PERMISSIVE | {authenticated} | SELECT | ((user_id = ( SELECT auth.uid() AS uid)) OR (lower(email) = lower((auth.jwt() -> |
| `doctor_front_desk_assignments` | hospital_admin_manage_doctor_assignments | PERMISSIVE | {authenticated,service_role} | ALL | ((( SELECT auth.role() AS role) = 'service_role'::text) OR is_admin(( SELECT aut |
| `doctor_front_desk_assignments` | hospital_admin_read_doctor_assignments | PERMISSIVE | {authenticated,service_role} | SELECT | ((( SELECT auth.role() AS role) = 'service_role'::text) OR is_admin(( SELECT aut |
| `merchant_memberships` | members_view_own_memberships | PERMISSIVE | {public} | SELECT | ((user_id = ( SELECT auth.uid() AS uid)) OR is_admin(( SELECT auth.uid() AS uid) |
| `merchant_memberships` | store_owners_manage_memberships | PERMISSIVE | {authenticated} | ALL | is_merchant_owner_or_admin(provider_id, ( SELECT auth.uid() AS uid)) |
| `notification_logs` | Allow trusted and service role write to notification logs | PERMISSIVE | {public} | ALL | ((( SELECT auth.role() AS role) = 'service_role'::text) OR (current_setting('app |
| `platform_config` | service_role_only_platform_config | PERMISSIVE | {public} | ALL | (( SELECT auth.role() AS role) = 'service_role'::text) |
| `profiles` | Users can insert own profile | PERMISSIVE | {public} | INSERT | (( SELECT auth.uid() AS uid) = id) |
| `profiles` | users_update_own_profile | PERMISSIVE | {authenticated} | UPDATE | (auth.uid() = id) |
| `providers` | Active providers are readable by everyone | PERMISSIVE | {public} | SELECT | ((status = 'ACTIVE'::provider_status) OR (( SELECT auth.uid() AS uid) = owner_id |
| `providers` | Merchants can insert own provider | PERMISSIVE | {public} | INSERT | (( SELECT auth.uid() AS uid) = owner_id) |
| `providers` | Merchants can update own provider | PERMISSIVE | {public} | UPDATE | (( SELECT auth.uid() AS uid) = owner_id) |
| `providers` | merchants_update_own_provider | PERMISSIVE | {public} | UPDATE | ((id IN ( SELECT get_user_authorized_providers(( SELECT auth.uid() AS uid)) AS g |
| `push_tokens` | push_tokens_delete_own | PERMISSIVE | {authenticated} | DELETE | (auth.uid() = user_id) |
| `push_tokens` | push_tokens_insert_own | PERMISSIVE | {authenticated} | INSERT | (auth.uid() = user_id) |
| `push_tokens` | push_tokens_select_own | PERMISSIVE | {authenticated} | SELECT | (auth.uid() = user_id) |
| `push_tokens` | push_tokens_update_own | PERMISSIVE | {authenticated} | UPDATE | (auth.uid() = user_id) |
| `resource_availability` | Availability is readable by everyone | PERMISSIVE | {public} | SELECT | true |
| `resource_availability` | Merchants can insert availability | PERMISSIVE | {public} | INSERT | (resource_id IN ( SELECT r.id |
| `resources` | Merchants can insert resources | PERMISSIVE | {public} | INSERT | (provider_id IN ( SELECT p.id |
| `resources` | hospital_admin_manage_resources | PERMISSIVE | {authenticated,service_role} | ALL | ((( SELECT auth.role() AS role) = 'service_role'::text) OR is_admin(( SELECT aut |
| `resources` | merchants_delete_resources | PERMISSIVE | {public} | DELETE | ((NOT is_hospital_provider(provider_id)) AND ((provider_id IN ( SELECT get_user_ |
| `resources` | merchants_insert_resources | PERMISSIVE | {public} | INSERT | ((NOT is_hospital_provider(provider_id)) AND ((provider_id IN ( SELECT get_user_ |
| `resources` | merchants_update_resources | PERMISSIVE | {public} | UPDATE | ((NOT is_hospital_provider(provider_id)) AND ((provider_id IN ( SELECT get_user_ |
| `sub_categories` | Subcategories are readable by everyone | PERMISSIVE | {public} | SELECT | true |
| `user_consents` | Users manage own consents | PERMISSIVE | {public} | ALL | (( SELECT auth.uid() AS uid) = user_id) |
