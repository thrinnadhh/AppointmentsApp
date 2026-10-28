# Autonomous Overnight Run Report: WhatsApp Notifications Transition

## Summary
Execution report for the transition of messaging infrastructure from SMS/mock notifications to a genuine production-ready Meta WhatsApp Business API queue and webhook system in `thrinnadhh/AppointmentsApp`.
- Branch: `feat/whatsapp-notifications` (branched from `refactor/arch-cleanup-and-security-hardening`)
- Date: 2026-10-29

---

## Step 1: Discovery Results

### 1. File Paths and State
| Component | File Path | State | Notes |
| :--- | :--- | :--- | :--- |
| `notification_logs` columns | `supabase/migrations/20260912000003_phase4_notifications.sql` | **Partial** | Table exists with `id`, `booking_id`, `recipient_phone`, `recipient_name`, `event_type`, `channel`, `status`, `message_content`, `provider_response`, `sent_at`, `created_at`. Missing queue columns (`provider_message_id`, `template_name`, `template_params jsonb`, `attempts`, `last_error`, `delivered_at`, `read_at`, `next_attempt_at`, and `SKIPPED` status). |
| `dispatch_booking_notification` | `supabase/migrations/20260912000003_phase4_notifications.sql`, `20260928000003_multi_tenant_isolation_and_boundary_hardening.sql`, `20260929000003_fix_dispatch_booking_notification.sql` | **Partial** | Stored procedure previously inserted fake immediate `'SENT'` records into both `'whatsapp'` and `'sms'` channels with simulated Twilio IDs. Needs rewrite to insert genuine `'QUEUED'` (or `'SKIPPED'`) rows for `'whatsapp'` only. |
| Queue-Claim RPC (`claim_queued_notifications`) | Untracked draft `supabase/migrations/20261028000001_real_whatsapp_notification_queue.sql` | **Missing in migrations** | Needs official tracked migration with `FOR UPDATE SKIP LOCKED`, restricted to `service_role` and `postgres`. |
| `whatsapp-sender` Edge Function | `supabase/functions/whatsapp-sender/index.ts` | **Missing** | Needs implementation: batch claim (up to 20), calls Meta Graph API with exponential backoff (1m, 5m, 15m), records `provider_message_id` on HTTP 200, sets `FAILED` after 3 attempts. |
| `whatsapp-webhook` Edge Function | `supabase/functions/whatsapp-webhook/index.ts` | **Partial** | Function exists untracked: handles GET challenge handshake and POST with HMAC-SHA256 signature verification. Needs verification against `WA_VERIFY_TOKEN` and `WA_APP_SECRET`, updating status to `DELIVERED`, `READ`, `FAILED`. |
| `send-booking-notification` Edge Function | `supabase/functions/send-booking-notification/index.ts` | **Exists** | Currently invokes `dispatch_booking_notification` and dispatches Expo push notifications. Needs cleanup to ensure it only queues notifications and records channel `'push'` with genuine delivery status. |

### 2. Every pg_cron Job Touching Notifications
1. **`check-booking-reminders`** (`supabase/migrations/20260912000003_phase4_notifications.sql` lines 292–303):
   - Schedule: `*/5 * * * *` (every 5 minutes).
   - SQL: `SELECT public.check_and_send_booking_reminders();`.
   - Behavior: Scanned for 1-hour reminders (40–75 min window) AND 30-minute reminders (10–35 min window). Must be updated/replaced to unschedule the 30-minute reminder and run every minute for the 1-hour reminder (55–65 min window).
2. **`process-whatsapp-queue`** (to be added in Step 4):
   - Scheduled via `pg_cron` + `pg_net` to call `whatsapp-sender` every minute using vault or database settings for the service key.

### 3. Every Writer of `notification_logs`
- **Database Stored Procedures & Triggers**:
  - `public.dispatch_booking_notification(UUID, TEXT)` (`supabase/migrations/20260929000003_fix_dispatch_booking_notification.sql`)
  - `public.handle_booking_notification_trigger()` on `public.bookings` (`supabase/migrations/20260912000003_phase4_notifications.sql`)
  - `public.cancel_booking(UUID, TEXT, TEXT)` (`supabase/migrations/20261022000011_cancellation_cutoff_60m.sql`)
  - `public.reassign_booking_resource(UUID, UUID, TEXT)` (`supabase/migrations/20261001000002_reassign_auth_and_permission_lockdown.sql`)
  - `public.expire_standby_bookings(INT)` (`supabase/migrations/20261022000013_fix_standby_expiry_protect_on_time_patients.sql`)
- **Backend Application API Routes**:
  - `apps/merchant-web/src/app/api/bookings/no-show/route.ts` (inserts audit alert)
  - `apps/merchant-web/src/app/api/bookings/reach/route.ts` (upserts notification)
  - `apps/merchant-web/src/app/api/bookings/late-queue/route.ts` (upserts notification)
  - `apps/merchant-web/src/app/api/bookings/cancel/route.ts` (inserts audit alert)
- **Test Scripts & Fixture Cleaners**:
  - `audit-tests/test_deletion_lifecycle.js`
  - `audit-tests/test_live_refund_flow.js`
  - `scripts/clean-mock-data.mjs`
  - `scripts/wipe-all-venues.mjs`

### 4. Exact Table and Column Mapping
- **Booking Reference**: `public.bookings.reference_code` (`TEXT UNIQUE`, format `'TPT-XXXXXX'`).
- **Slot Start Time**: `public.bookings.slot_start` (`TIMESTAMPTZ`, stored in UTC; must be formatted in `'Asia/Kolkata'`).
- **Booking Status**: `public.bookings.status` (`public.booking_status` enum: `'HELD'`, `'PENDING_PAYMENT'`, `'CONFIRMED'`, `'CHECKED_IN'`, `'WAITING'`, `'UP_NEXT'`, `'IN_CONSULTATION'`, `'COMPLETED'`, `'CANCELLED'`, `'NO_SHOW'`, `'STANDBY'`).
- **Customer ID**: `public.bookings.customer_id` (`UUID` referencing `auth.users(id)`).
- **Customer Name**: `public.profiles.full_name` (`TEXT`).
- **Customer Phone**: `public.profiles.phone` (`TEXT`).
- **Provider Name**: `public.providers.name` (`TEXT`, referenced by `public.bookings.provider_id`).
- **Refund Amount & Status**:
  - Refund Amount: `public.bookings.deposit_amount` / `public.payments.amount` (`NUMERIC(10, 2)` stored in **Rupees (INR)**, NOT paise). Razorpay API interactions multiply by 100 to convert to paise only at network boundary.
  - Refund Status: `public.bookings.payment_status` (`public.payment_status` enum: `'REFUND_PENDING'`, `'REFUNDED'`, `'FORFEITED'`) / `public.payments.status`.

### 5. All Uses of 30-Minute Reminder and SMS Channel
- **30-Minute Reminder (`BOOKING_REMINDER_30M` / `reminder_30m`)**:
  - `public.bookings.reminder_30m_sent_at` column in `public.bookings` (`supabase/migrations/20260912000003_phase4_notifications.sql`).
  - `idx_bookings_reminder_30m` partial index.
  - Event scanning in `public.check_and_send_booking_reminders()`.
  - Stored proc branch in `public.dispatch_booking_notification()`.
  - Edge function type & event handling in `supabase/functions/send-booking-notification/index.ts`.
  - Types in `packages/shared/src/types.ts` (`BOOKING_REMINDER_30M`, `reminder_30m_sent_at`) and `packages/shared/src/database.types.ts`.
  - UI notification trigger in `apps/merchant-web/src/app/bookings/page.tsx`.
  - Tests in `tests/e2e/customer-hospital-full-lifecycle.spec.ts`.
- **SMS as a Channel**:
  - `public.notification_logs.channel`: previously accepted `'sms'`.
  - `packages/shared/src/types.ts`: `NotificationChannel = 'whatsapp' | 'sms' | 'email' | 'push'`.
  - `apps/merchant-web/src/app/api/auth/otp/send/route.ts` (`body: JSON.stringify({ phone: e164, channel: 'sms' })`).
  - `apps/merchant-web/src/app/api/auth/otp/verify/route.ts` (`type: 'sms'`).
  - `apps/customer-mobile/src/services/api.ts` (`type: 'sms'`).
  - `supabase/config.toml`: `[auth.sms]` and `[auth.sms.twilio]` configuration.
  - `tests/e2e/customer-reflection.spec.ts`, `tests/e2e/customer-hospital-full-lifecycle.spec.ts`, `tests/e2e/fixtures/test-fixtures.ts`.

### 6. Phone Login and Fraud Defenses Today
- **Supabase Phone Auth Configuration** (`supabase/config.toml`):
  - `[auth.sms]`: `enable_signup = false`, `enable_confirmations = false`, `max_frequency = "5s"`.
  - `[auth.rate_limit]`: `sms_sent = 30` per hour.
  - `[auth.sms.twilio]`: `enabled = false` (in local testing, mock phone OTP is used).
- **SMS Provider**: Twilio configured in Supabase Auth (disabled in local dev).
- **OTP Rate Limits**:
  - Per-phone: 3 OTP requests per phone per 5 minutes (`checkRateLimit('otp:${e164}', 3, 300)`).
  - Per-IP: 5 OTP attempts per IP per 10 minutes (`checkRateLimit('otp-ip:${ip}', 5, 600)`).
- **Toll-Fraud Defense**:
  - Strict E.164 phone normalization using `libphonenumber-js` with default country code `'IN'`.
  - Sliding-window Redis token bucket enforcing IP and phone rate limits to stop SMS pumping / international premium-rate toll fraud.

---

## Step 2: Queue Foundation Results
- Migration: `supabase/migrations/20261029000001_whatsapp_queue_foundation.sql` (applied and verified against local database).
- `notification_logs` schema verified:
  - Columns: `provider_message_id TEXT`, `template_name TEXT`, `template_params JSONB DEFAULT '[]'`, `attempts INT DEFAULT 0`, `last_error TEXT`, `delivered_at TIMESTAMPTZ`, `read_at TIMESTAMPTZ`, `next_attempt_at TIMESTAMPTZ DEFAULT NOW()`.
  - Status values enforced: `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`, `SKIPPED`. Default is `'QUEUED'`.
  - Check constraint verified: `chk_notification_logs_status`.
  - Safe row deduplication performed on `(booking_id, event_type, channel)`.
  - Unique index created: `uq_idx_notification_logs_booking_event_channel` on `(booking_id, event_type, channel)`.
  - Partial polling index created: `idx_notification_logs_claim_queue` on `(next_attempt_at ASC, created_at ASC) WHERE status = 'QUEUED'`.
  - Claim RPC `public.claim_queued_notifications(p_limit INT DEFAULT 20)` implemented with `FOR UPDATE SKIP LOCKED`. Security hardened with `SECURITY DEFINER SET search_path = public, pg_temp`, caller guard `auth.role() = 'service_role' OR SESSION_USER = 'postgres'`, execution revoked from `PUBLIC`, `anon`, and `authenticated`, and granted solely to `service_role`.

---

## Decisions
1. **Paise vs. Rupees**: Stored amounts (`bookings.deposit_amount`, `payments.amount`) are verified to be in standard INR (Rupees, `NUMERIC(10,2)`). The `refund_processed` template requires plain number without symbols or commas.
2. **Consent Default**: In accordance with user rules ("explicit un-ticked-by-default tick"), `ConsentScreen.tsx` will have `whatsapp_notifications` defaulted to `false`.
3. **Queue Deduplication**: To guarantee idempotency, notification logs deduplicate on `(booking_id, event_type, channel)`. Any duplicate dispatch triggers `ON CONFLICT DO NOTHING`.
4. **Strict Service Role**: In accordance with security conventions, `claim_queued_notifications` and `dispatch_booking_notification` are restricted to `service_role` and `postgres`.
5. **Status Enum Check**: Updated `chk_notification_logs_status` to include `'SKIPPED'` alongside `'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'`.
