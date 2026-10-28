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

## Step 3: Params and Events Results
- Migration: `supabase/migrations/20261029000002_whatsapp_params_and_events.sql` (applied and verified).
- Single source of truth parameter builder implemented: `public.build_template_params(event_type, booking)`:
  - Strict parameter order per registry:
    - `booking_confirmed`: `[1 customer first name, 2 provider name, 3 slot date-time, 4 reference]`
    - `reminder_1h`: `[1 provider name, 2 slot time, 3 reference]`
    - `booking_cancelled`: `[1 provider name, 2 slot date-time, 3 reference]`
    - `refund_processed`: `[1 amount, 2 reference]`
    - `auth_code`: `[1 one-time code]`
  - Parameter formatting verified:
    - Slot date-time formatted in `Asia/Kolkata` as `"30 Oct 2026, 5:30 PM"` (handles UTC conversion across day/midnight boundaries).
    - Slot time formatted in `Asia/Kolkata` as `"5:30 PM"`.
    - Customer first name: extracted via `split_part(trim(name), ' ', 1)`; empty or whitespace defaults to `"there"`.
    - Amount: formatted as plain number without currency symbols or commas, converting from paise when specified.
    - Reference: formatted exactly as stored (`TPT-XXXXXX`).
  - Parameter sanitization helper `public.sanitize_template_param` trims, collapses tabs/newlines/multiple spaces into a single space, limits length to 100 characters, and guarantees non-empty values.
  - Opt-in consent enforcement: `dispatch_booking_notification` checks `user_consents` for `purpose = 'whatsapp_notifications'`. If consent is missing, writes a record with `status = 'SKIPPED'` and `last_error = 'Customer has not granted whatsapp_notifications consent'` (`ON CONFLICT DO NOTHING`).
  - Mobile UI updated: `apps/customer-mobile/src/screens/ConsentScreen.tsx` updated to make `whatsapp_notifications` un-ticked by default (`default: false`).
  - Automated 1-hour reminders: `public.check_and_send_booking_reminders()` scheduled via `pg_cron` every minute (`* * * * *`). Scans for `CONFIRMED` bookings starting in 55-65 minutes, skipping cancelled bookings and bookings created <60 minutes before slot start.
  - All 30-minute reminder code paths removed from reminder scheduler.
  - Event triggers on `public.bookings`: `CONFIRMED` -> `BOOKING_CONFIRMED`, `CANCELLED` -> `BOOKING_CANCELLED`, `payment_status = 'REFUNDED'` -> `REFUND_PROCESSED`.

## Step 4: Sender and Webhook Results
- Created Edge Function: `supabase/functions/whatsapp-sender/index.ts`:
  - Claims up to 20 notifications per execution via `claim_queued_notifications` RPC (`FOR UPDATE SKIP LOCKED`).
  - Pre-flight parameter contract validation: validates parameter count against template registry (e.g. 4 for `booking_confirmed`, 3 for `reminder_1h`, 3 for `booking_cancelled`, 2 for `refund_processed`, 1 for `auth_code`).
  - Strict phone format validation (`^91\d{10}$`); invalid formats marked `FAILED` immediately without calling Meta API.
  - Formats payload per Meta Graph API specs with components `type: 'body'`.
  - Dispatches `POST https://graph.facebook.com/${GRAPH_API_VERSION}/${WA_PHONE_NUMBER_ID}/messages` with Bearer auth.
  - On HTTP 200: captures `messages[0].id` and sets `status = 'SENT'`, `sent_at = NOW()`, `last_error = null`.
  - On failure / network error: implements exponential retry backoff (1m, 5m, 15m) up to 3 attempts, then transitions to `FAILED`.
  - Scheduled via `supabase/migrations/20261029000003_whatsapp_sender_cron.sql` using `pg_cron` (`process-whatsapp-queue`, `* * * * *`) and `pg_net`. Reads Supabase URL and service role key securely from vault or DB settings.
- Created Edge Function: `supabase/functions/whatsapp-webhook/index.ts`:
  - GET endpoint handles Meta challenge handshake with `hub.mode = 'subscribe'` and `hub.verify_token = WA_VERIFY_TOKEN`.
  - POST endpoint extracts raw request body and performs HMAC-SHA256 signature verification (`X-Hub-Signature-256`) with `WA_APP_SECRET` using constant-time comparison. Rejects unauthorized / invalid payloads with HTTP 401.
  - Parses delivery and read receipts (`delivered`, `read`, `failed`), updating `notification_logs` by matching `provider_message_id`. Sets `delivered_at`, `read_at`, and `last_error`.
  - Harmless on duplicates (idempotent UPDATE). Ignores unknown IDs without errors.
- Refactored `supabase/functions/send-booking-notification/index.ts`:
  - Removed obsolete 30-minute reminder code paths (`BOOKING_REMINDER_30M`).
  - Preserved Expo push notifications, and records genuine push execution in `notification_logs` with `channel = 'push'`, `status = 'SENT'`, and `provider_message_id = pushTicketId`.
- Configured Edge Functions in `supabase/config.toml` (`whatsapp-webhook`, `whatsapp-sender`, `whatsapp-auth-hook` with `verify_jwt = false`).

## Step 5: WhatsApp Login Code Results (Feature Flag: Default OFF)
- Created Edge Function: `supabase/functions/whatsapp-auth-hook/index.ts`:
  - Implements Supabase Auth "Send SMS" webhook hook.
  - Feature flag: Defaults to `OFF` via `ENABLE_WHATSAPP_AUTH_HOOK = 'false'`. If disabled, immediately short-circuits.
  - Standard Webhooks cryptographic signature validation: verifies `webhook-signature` using HMAC-SHA256 with `SEND_SMS_HOOK_SECRET` over `${webhook_id}.${webhook_timestamp}.${rawBody}` with a 5-minute replay tolerance window. Rejects invalid signatures with HTTP 401.
  - Meta Template shape: Dispatches believed authentication shape (UNVERIFIED) with body text parameter and URL button parameter for template `auth_code`.
  - Resend cooldown: Enforces a 60-second cooldown per phone number against rapid repeated code requests (returns HTTP 429).
  - Code confidentiality: Never logs or stores the raw OTP code anywhere. In `notification_logs`, `template_params` stores `['[redacted]']` and message content logs `[redacted]`.
  - Sensitive data masking: In console logs, phone numbers are masked to display only the last 4 digits (e.g. `********0001`).
  - Error abstraction: When dispatch fails, returns the exact customer-facing error message: `"We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again."` without leaking internal errors or trace data.
  - Customer mobile app updated: `apps/customer-mobile/src/services/api.ts` and `apps/customer-mobile/App.tsx` updated to surface this friendly error message.
  - Database schema: Created migration `supabase/migrations/20261029000004_allow_null_booking_id_for_auth_notifications.sql` allowing `booking_id` to be `NULL` in `notification_logs` to record authentication events before a booking exists.

---

## Decisions
1. **Paise vs. Rupees**: Stored amounts (`bookings.deposit_amount`, `payments.amount`) are verified to be in standard INR (Rupees, `NUMERIC(10,2)`). The `refund_processed` template requires plain number without symbols or commas.
2. **Consent Default**: In accordance with user rules ("explicit un-ticked-by-default tick"), `ConsentScreen.tsx` will have `whatsapp_notifications` defaulted to `false`.
3. **Queue Deduplication**: To guarantee idempotency, notification logs deduplicate on `(booking_id, event_type, channel)`. Any duplicate dispatch triggers `ON CONFLICT DO NOTHING`.
4. **Strict Service Role**: In accordance with security conventions, `claim_queued_notifications` and `dispatch_booking_notification` are restricted to `service_role` and `postgres`.
5. **Status Enum Check**: Updated `chk_notification_logs_status` to include `'SKIPPED'` alongside `'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'`.
6. **Single Parameter Builder**: `build_template_params` accepts both polymorphic `JSONB` and `UUID` overloads to allow execution from Postgres triggers, RPC calls, and external test harnesses.
7. **Secure Webhook HMAC**: Webhook enforces constant-time comparison against `X-Hub-Signature-256` using Web Crypto API. If `WA_APP_SECRET` is unset or invalid, payload is rejected with 401.
8. **Nullable booking_id for Auth Codes**: `notification_logs.booking_id` made nullable so authentication code events can be safely logged without violating foreign key constraints when no booking exists.
9. **Feature Flag Default OFF**: The WhatsApp login code hook is disabled by default (`ENABLE_WHATSAPP_AUTH_HOOK = false`) to guarantee zero unintended interference with existing SMS / local mock OTP authentication.
