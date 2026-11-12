-- Rollback Migration: 20261031000001_rollback.sql
-- Description: Restores the exact pre-20261031000001 table, view, sequence, and default
-- privileges for anon and authenticated in schema public.
-- Note per Step 3: Function grant rollbacks and cancel_doctor_emergency function
-- restoration are documented manually in docs/audit/GRANTS_LOCKDOWN_REPORT.md.

BEGIN;

-- 1. Restore default privileges for role postgres in schema public
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- 2. Restore TRUNCATE, REFERENCES, TRIGGER (and MAINTAIN on PG17+) where previously held
GRANT REFERENCES, TRIGGER, TRUNCATE ON TABLE
  public.account_deletion_requests,
  public.admin_audit_logs,
  public.app_logs,
  public.bookings,
  public.categories,
  public.cities,
  public.city_settlements,
  public.crash_alert_dedup,
  public.department_members,
  public.departments,
  public.doctor_front_desk_assignments,
  public.merchant_memberships,
  public.notification_logs,
  public.payments,
  public.platform_config,
  public.providers,
  public.resource_availability,
  public.resources,
  public.sub_categories,
  public.user_consents
TO anon;

GRANT REFERENCES, TRIGGER ON TABLE public.audit_logs TO anon;

GRANT REFERENCES, TRIGGER, TRUNCATE ON TABLE
  public.account_deletion_requests,
  public.admin_audit_logs,
  public.app_logs,
  public.appointment_checkin_codes,
  public.bookings,
  public.categories,
  public.cities,
  public.city_settlements,
  public.city_waitlist,
  public.crash_alert_dedup,
  public.department_members,
  public.departments,
  public.doctor_front_desk_assignments,
  public.merchant_memberships,
  public.notification_logs,
  public.payments,
  public.platform_config,
  public.providers,
  public.resource_availability,
  public.resources,
  public.sub_categories,
  public.user_consents
TO authenticated;

GRANT REFERENCES, TRIGGER ON TABLE public.audit_logs TO authenticated;

DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'GRANT MAINTAIN ON TABLE
      public.account_deletion_requests,
      public.admin_audit_logs,
      public.app_logs,
      public.audit_logs,
      public.bookings,
      public.categories,
      public.cities,
      public.city_settlements,
      public.crash_alert_dedup,
      public.department_members,
      public.departments,
      public.doctor_front_desk_assignments,
      public.merchant_memberships,
      public.notification_logs,
      public.payments,
      public.platform_config,
      public.providers,
      public.resource_availability,
      public.resources,
      public.sub_categories,
      public.user_consents
    TO anon';

    EXECUTE 'GRANT MAINTAIN ON TABLE
      public.account_deletion_requests,
      public.admin_audit_logs,
      public.app_logs,
      public.appointment_checkin_codes,
      public.audit_logs,
      public.bookings,
      public.categories,
      public.cities,
      public.city_settlements,
      public.city_waitlist,
      public.contact_reveal_audit,
      public.crash_alert_dedup,
      public.department_members,
      public.departments,
      public.doctor_front_desk_assignments,
      public.merchant_memberships,
      public.notification_logs,
      public.payments,
      public.platform_config,
      public.providers,
      public.resource_availability,
      public.resources,
      public.sub_categories,
      public.user_consents
    TO authenticated';
  END IF;
END $$;

-- 3. Restore exact DML privileges per table for anon
GRANT SELECT ON TABLE
  public.bookings,
  public.categories,
  public.resources
TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_logs TO anon;

GRANT SELECT (
  address, category_id, city, closing_time, cooling_period_days, created_at,
  description, email, id, is_active, latitude, longitude, name, opening_time,
  owner_id, phone, photos, status, sub_category_id, updated_at, weekly_hours
) ON TABLE public.providers TO anon;

-- 4. Restore exact DML privileges per table for authenticated
GRANT SELECT, INSERT ON TABLE public.account_deletion_requests TO authenticated;
GRANT SELECT ON TABLE public.app_logs TO authenticated;
GRANT SELECT ON TABLE public.appointment_checkin_codes TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_logs TO authenticated;
GRANT SELECT ON TABLE public.bookings TO authenticated;
GRANT UPDATE (attachment_url) ON TABLE public.bookings TO authenticated;
GRANT SELECT ON TABLE public.categories TO authenticated;
GRANT SELECT ON TABLE public.city_settlements TO authenticated;
GRANT SELECT ON TABLE public.city_waitlist TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.department_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.departments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.doctor_front_desk_assignments TO authenticated;
GRANT SELECT ON TABLE public.merchant_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_logs TO authenticated;
GRANT SELECT (
  created_at, email, expo_push_token, full_name, id, phone, updated_at
) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (
  expo_push_token, full_name, phone
) ON TABLE public.profiles TO authenticated;
GRANT SELECT (
  address, category_id, city, closing_time, cooling_period_days, created_at,
  description, email, id, latitude, longitude, name, opening_time, phone,
  photos, status, sub_category_id, updated_at, weekly_hours
) ON TABLE public.providers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resources TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_consents TO authenticated;

-- 5. Restore view privileges on merchant_bookings
GRANT SELECT ON TABLE public.merchant_bookings TO authenticated, service_role;

COMMIT;

