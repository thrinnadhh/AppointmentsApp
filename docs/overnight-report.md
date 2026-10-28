# Autonomous Overnight Run Report: WhatsApp Notifications Transition

## 1. Summary
Autonomous overnight execution report for transitioning all customer and merchant messaging from SMS/mock notifications to a genuine production-grade Meta WhatsApp Business Platform queue, sender worker, webhook handler, and login code hook in `thrinnadhh/AppointmentsApp`.
- **Target Branch**: `feat/whatsapp-notifications` (branched from base `refactor/arch-cleanup-and-security-hardening` at `4766fe9`).
- **Date**: 2026-10-29
- **Product Decisions Implemented**:
  1. WhatsApp is the ONLY messaging channel. SMS has been completely deprecated and removed across database triggers, stored procedures, types, UI, and test suites. Existing Expo push notifications are retained under channel `'push'`.
  2. Only WhatsApp users are supported. No SMS fallback.
  3. Booking check-in code is shown strictly inside the mobile/merchant applications and is never transmitted by message.
  4. The 30-minute reminder (`BOOKING_REMINDER_30M` / `reminder_30m`) is completely removed. Only the 1-hour prior reminder (`reminder_1h`) is active and scheduled via `pg_cron` every minute.
  5. Never mark a notification `SENT` unless Meta's Graph API accepted it with a valid message ID (`messages[0].id`).
  6. Zero secrets committed to the repository or printed in server logs. All phone numbers masked to display only the last 4 digits.
  7. WhatsApp authentication code hook implemented with feature flag default `OFF` (`ENABLE_WHATSAPP_AUTH_HOOK = false`).

---

## 2. Files Changed Per Step

### Step 1: Discovery
- `.env.example`: Added empty environment variable definitions: `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `GRAPH_API_VERSION`, `SEND_SMS_HOOK_SECRET`, and `ENABLE_WHATSAPP_AUTH_HOOK`.
- `.gitignore`: Added `.system_generated/` to ignore local IDE agent telemetry artifacts.
- `docs/overnight-report.md`: Documented all findings on `notification_logs` columns, writers, cron jobs, table.column mappings, SMS/30m reminder residue, and phone login/toll-fraud defenses.

### Step 2: Queue Foundation
- `supabase/migrations/20261028000001_real_whatsapp_notification_queue.sql`: Tracked initial queue foundation draft.
- `supabase/migrations/20261029000001_whatsapp_queue_foundation.sql`: Created and applied migration adding `provider_message_id`, `template_name`, `template_params jsonb`, `attempts int default 0`, `last_error`, `delivered_at`, `read_at`, `next_attempt_at`, and `status` values `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`, `SKIPPED` (default `QUEUED`). Added partial polling index `idx_notification_logs_claim_queue`, unique index `uq_idx_notification_logs_booking_event_channel`, and claim RPC `claim_queued_notifications(p_limit)` using `FOR UPDATE SKIP LOCKED` (restricted strictly to `service_role` and `postgres`).

### Step 3: Params and Events
- `supabase/migrations/20261029000002_whatsapp_params_and_events.sql`: Created single source-of-truth parameter builder `public.build_template_params(event_type, booking)` adhering strictly to the 5 template contracts. Implemented `public.sanitize_template_param` (trims, collapses whitespace, truncates to 100 chars, guarantees non-empty value). Updated `public.dispatch_booking_notification` to check `user_consents` for `whatsapp_notifications` (queues `QUEUED` row if consented, or `SKIPPED` row with reason if unconsented, with `ON CONFLICT DO NOTHING`). Updated 1-hour reminder scheduler `check_and_send_booking_reminders` (55-65 min window, skips cancelled bookings and bookings created <60 min before slot start) and scheduled via `pg_cron` every minute. Attached triggers on `bookings` for `BOOKING_CONFIRMED`, `BOOKING_CANCELLED`, and `REFUND_PROCESSED`.
- `apps/customer-mobile/src/screens/ConsentScreen.tsx`: Updated `whatsapp_notifications` consent setting to be un-ticked by default (`default: false`).
- `apps/customer-mobile/src/screens/AccountScreen.tsx`: Added WhatsApp Appointment Updates consent toggle allowing users to manage WhatsApp notification preferences.

### Step 4: Sender and Webhook
- `supabase/functions/whatsapp-sender/index.ts`: Autonomous queue worker edge function. Claims up to 20 rows, validates template registry counts and phone numbers, dispatches Meta Graph API POST requests, records `provider_message_id` on HTTP 200, handles Meta 4xx client errors as immediate `FAILED`, and retries 5xx server/network errors with exponential backoff (1m, 5m, 15m) up to 3 attempts then `FAILED`.
- `supabase/functions/whatsapp-webhook/index.ts`: Webhook receiver edge function. Verifies GET challenge handshake against `WA_VERIFY_TOKEN`. Validates POST payloads using HMAC-SHA256 (`X-Hub-Signature-256`) against `WA_APP_SECRET` using constant-time comparison. Processes delivery/read/failure receipts (`delivered`, `read`, `failed`), updating `notification_logs` by matching `provider_message_id`. Idempotent and safe on duplicate deliveries.
- `supabase/functions/send-booking-notification/index.ts`: Removed obsolete 30-minute reminder code paths. Preserved Expo push notifications, recording genuine push execution in `notification_logs` under channel `'push'`.
- `supabase/migrations/20261029000003_whatsapp_sender_cron.sql`: Scheduled `process-whatsapp-queue` via `pg_cron` (`* * * * *`) and `pg_net` to trigger `whatsapp-sender` every minute.
- `supabase/config.toml`: Configured edge functions `whatsapp-sender`, `whatsapp-webhook`, and `whatsapp-auth-hook` with `verify_jwt = false`.

### Step 5: WhatsApp Login Code (Feature Flag Default OFF)
- `supabase/functions/whatsapp-auth-hook/index.ts`: Edge function handling Supabase Auth "Send SMS" webhook hook. Feature flagged with default `OFF` (`ENABLE_WHATSAPP_AUTH_HOOK = false`). Verifies Standard Webhooks signature headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`) with 5-minute replay tolerance. Dispatches template `auth_code`. Enforces 60-second resend cooldown. Never logs or stores raw OTP codes (`[redacted]`). Masks phone numbers. Returns customer-facing friendly error on failure: `"We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again."`.
- `supabase/migrations/20261029000004_allow_null_booking_id_for_auth_notifications.sql`: Altered `notification_logs.booking_id` to allow `NULL` so pre-booking authentication code deliveries can be logged safely.
- `apps/customer-mobile/src/services/api.ts`: Updated mobile auth failure handler to surface friendly WhatsApp error message.
- `apps/customer-mobile/App.tsx`: Added alert handling for WhatsApp login code failures.
- `apps/merchant-web/src/app/api/auth/otp/send/route.ts`: Updated merchant web OTP route to surface the required WhatsApp error message.

### Step 6: Tests and Cleanup
- `apps/merchant-web/src/app/bookings/page.tsx`: Removed 30-minute reminder button, badge, and updated labels from "WA/SMS Logs" to "WhatsApp Logs".
- `apps/merchant-web/src/lib/supabase.ts`: Removed `reminder_30m_sent_at` from `MerchantBookingWithDetails` interface and select queries.
- `packages/shared/src/types.ts`: Removed `BOOKING_REMINDER_30M` and `reminder_30m_sent_at`. Updated `NotificationChannel` (`'whatsapp' | 'push'`) and `NotificationLog` interface.
- `apps/customer-mobile/tsconfig.json`: Added `"ignoreDeprecations": "6.0"`.
- `apps/merchant-web/src/app/api/bookings/late-queue/route.ts`: Updated notification channel to `'whatsapp'` and status to `'QUEUED'`.
- `apps/merchant-web/src/app/api/bookings/reach/route.ts`: Updated notification channel to `'whatsapp'` and status to `'QUEUED'`.
- `audit-tests/test_deletion_lifecycle.js`: Updated fixture from `channel: 'sms', status: 'SENT'` to `channel: 'whatsapp', status: 'QUEUED'`.
- `tests/e2e/fixtures/test-fixtures.ts`: Removed `BOOKING_REMINDER_30M` and `'sms'` channel from `BookingApiHelper`.
- `tests/e2e/customer-reflection.spec.ts`: Removed SMS assertions and 30-minute reminder test assertions; updated modal selector to "WhatsApp Notifications".
- `tests/e2e/customer-hospital-full-lifecycle.spec.ts`: Removed SMS channel assertions from booking confirmed, reminder, and completion logs.
- `tests/e2e/edge-integrations.spec.ts`: Removed `BOOKING_REMINDER_30M` from queued reminder query assertion.
- `tests/scripts/test-real-notification-queue.mjs`: Updated consent test to assert `status = 'SKIPPED'` with reason, and increased test fixture loop to 6 bookings.
- `tests/scripts/test-whatsapp-integration.mjs`: Authored comprehensive test suite covering all 11 required scenarios.
- `docs/whatsapp-setup.md`: Authored complete operational setup guide for Meta WhatsApp Business Platform, templates, webhooks, secrets, and feature flag instructions.

---

## 3. Tests Added and Results

### 1. WhatsApp Integration Test Suite (`tests/scripts/test-whatsapp-integration.mjs`)
Automated test harness verifying all Step 6 requirements against local Postgres and web standards:
- **Test 1: Exact Parameter Order Per Template**: Passed. Verified all 5 templates:
  - `booking_confirmed` (4 params): `['Aditya', 'Tirupati Super Specialty Clinic', '30 Oct 2026, 3:30 PM', 'REF-BOOKING-01']`
  - `reminder_1h` (3 params): `['Tirupati Super Specialty Clinic', '3:30 PM', 'REF-BOOKING-01']`
  - `booking_cancelled` (3 params): `['Tirupati Super Specialty Clinic', '30 Oct 2026, 3:30 PM', 'REF-BOOKING-01']`
  - `refund_processed` (2 params): `['250', 'REF-REFUND-99']`
  - `auth_code` (1 param): `['849201']`
- **Test 2: IST Conversion Across Day/Midnight Boundary**: Passed. Verified that UTC time `2026-10-30T19:30:00Z` (+05:30) correctly converts to `31 Oct 2026, 1:00 AM` (date-time) and `1:00 AM` (time-only) in `Asia/Kolkata`.
- **Test 3: Parameter Sanitization**: Passed. Verified collapse of runs of whitespace/newlines/tabs to a single space, truncation to 100 characters maximum, and non-empty fallback to `'there'`.
- **Test 4: Skipped Without Consent**: Passed. Verified that attempting to dispatch without user consent in `user_consents` results in `status = 'SKIPPED'` and `last_error = 'Customer has not granted whatsapp_notifications consent'`.
- **Test 5: Duplicate Event Idempotency**: Passed. Verified that duplicate dispatch attempts create exactly 1 row due to unique constraint `(booking_id, event_type, channel)`.
- **Test 6: Missing Data Fails Without Calling Meta**: Passed. Verified that parameter count mismatches or invalid phone formats mark the row `FAILED` with `last_error` and make zero calls to Meta API.
- **Test 7: Meta 4xx Immediate Failure vs 5xx Backoff**: Passed. Verified that client 4xx errors mark `FAILED` immediately with no retries, while 5xx errors retry with backoff intervals `[1m, 5m, 15m]` up to 3 attempts then mark `FAILED`.
- **Test 8: Webhook Signature Verification & Status Receipts**: Passed. Verified bad `X-Hub-Signature-256` header rejected; valid signature transitions row status from `SENT` -> `DELIVERED` (populates `delivered_at`) -> `READ` (populates `read_at`); duplicate delivery receipts are completely harmless and idempotent.
- **Test 9: Concurrent Claims Disjointness (`FOR UPDATE SKIP LOCKED`)**: Passed. Verified that two concurrent worker transactions calling `claim_queued_notifications(3)` claim completely disjoint sets of rows (0 overlap) and transition them to `SENDING` with `attempts = 1`.
- **Test 10: WhatsApp Login Code Hook**: Passed. Verified Standard Webhooks signature verification, bad signature rejection (401), strict redaction of OTP code from logs and database (`[redacted]`), and user-facing friendly error `"We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again."`.
- **Test 11: Zero `SENT` Rows Without Meta Success**: Passed. Verified that newly inserted rows start as `QUEUED`, transition to `SENDING` upon claim, and strictly require a verified HTTP 200 response with `messages[0].id` from Meta before transitioning to `SENT`.
- **Result**: `🎉 ALL 11 COMPREHENSIVE WHATSAPP INTEGRATION TESTS PASSED PERFECTLY!`

### 2. Real Notification Queue Test Suite (`tests/scripts/test-real-notification-queue.mjs`)
- Tested phone normalization helper (`public.normalize_phone_number`), consent guard (`SKIPPED` row), queue insertion (`QUEUED` status), duplicate idempotency, and concurrent worker claim safety.
- **Result**: `🎉 ALL PHASE 1 DATABASE QUEUE TESTS PASSED PERFECTLY!`

### 3. Existing Security & Route Suites (`test-security.mjs`, `test-routes.mjs`)
- Executed `node --test tests/scripts/test-security.mjs tests/scripts/test-routes.mjs`.
- **Result**: `139 passed, 0 failed` across 36 suites.

### 4. Codebase Verification Grep Checks
- **No unconditional 'SENT' inserts**: Verified. Only 4 occurrences exist in application code, each strictly conditional on external HTTP 200 acceptance with valid message ID:
  - `supabase/functions/whatsapp-sender/index.ts:231`: Only when Meta returns HTTP 200 and `messages[0].id`.
  - `supabase/functions/whatsapp-auth-hook/index.ts:303`: Only when Meta returns HTTP 200 and `messages[0].id`.
  - `supabase/functions/whatsapp-webhook/index.ts:196`: Only on inbound Meta status webhook receipt `status === 'sent'`.
  - `supabase/functions/send-booking-notification/index.ts:228`: Only when Expo push returns `ticket.status === 'ok'`.
- **No 'sms' channel writes**: Verified. Zero writes of `channel = 'sms'` into `notification_logs` or database tables.
- **No `reminder_30m` in codebase**: Verified. Zero occurrences in `apps/`, `supabase/functions/`, and `tests/`.
- **No tokens or codes in `console.log`**: Verified. Phone numbers are masked (`maskPhone`); authentication codes are redacted (`[redacted]`); tokens are never printed.
- **No secrets in the repository**: Verified. All API keys and secrets read from environment variables; `.env.example` contains empty keys only.

---

## 4. Decisions Made (With Rationale)

1. **Paise vs. Rupees Formatting**:
   - *Rationale*: Investigation in Step 1 confirmed that `public.bookings.deposit_amount` and `public.payments.amount` are stored in standard INR Rupees (`NUMERIC(10,2)`). The `refund_processed` template requires plain numeric formatting without currency symbols (e.g. `250`).
2. **Opt-in WhatsApp Consent Default**:
   - *Rationale*: To comply with DPDP Act 2023 and Meta WhatsApp Business Messaging Policy ("explicit un-ticked-by-default tick"), `ConsentScreen.tsx` defaults `whatsapp_notifications` to `false`. When a customer has not opted in, dispatch generates a row with `status = 'SKIPPED'` and logs the reason.
3. **Queue Deduplication via Composite Unique Index**:
   - *Rationale*: Created unique index `uq_idx_notification_logs_booking_event_channel` on `(booking_id, event_type, channel)`. This prevents duplicate messages if triggers fire multiple times or duplicate webhook receipts are received.
4. **Strict Database Authorization on RPCs**:
   - *Rationale*: `claim_queued_notifications` and `dispatch_booking_notification` are defined with `SECURITY DEFINER SET search_path = public, pg_temp`. Direct execution is revoked from `PUBLIC`, `anon`, and `authenticated`, granted solely to `service_role`.
5. **Separation of 4xx vs. 5xx Meta Errors**:
   - *Rationale*: Client 4xx errors (e.g. 400 Bad Request, 401 Unauthorized, 404 Template Not Found) are permanent and should never be retried; they are marked `FAILED` immediately. Server 5xx errors or network timeouts are transient and retry with exponential backoff (`[1m, 5m, 15m]`) up to 3 attempts.
6. **Nullable `booking_id` in `notification_logs`**:
   - *Rationale*: In migration `20261029000004_allow_null_booking_id_for_auth_notifications.sql`, `booking_id` was made nullable. This enables `whatsapp-auth-hook` to log authentication code dispatches before any booking exists without violating foreign key constraints.
7. **Feature Flag Default OFF for WhatsApp Login Hook**:
   - *Rationale*: In accordance with user rules, `ENABLE_WHATSAPP_AUTH_HOOK` defaults to `false`. It should never be enabled in production without dedicated sandbox testing.
8. **Removal of Invented `updated_at` Column**:
   - *Rationale*: `notification_logs` has `created_at` but no `updated_at` column in the base schema. Following the rule "Never invent column names", all update operations reference existing columns (`status`, `provider_message_id`, `delivered_at`, `read_at`, `last_error`, `attempts`).

---

## 5. NEEDS REVIEW Items

1. **Authentication Code Template Shape (Meta Side)**:
   - *Status*: Believed shape implemented per specification:
     `components: [{ type: 'body', parameters: [{ type: 'text', text: CODE }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: CODE }] }]`.
   - *Review Needed*: When creating the `auth_code` template in Meta Business Manager, verify whether the authentication button is configured as a `Copy Code` button (`type: 'button'`, `sub_type: 'url'`) or standard text button, and align parameter indices.
2. **Missing `whatsapp_notifications` Purpose in Older DBs**:
   - *Status*: `user_consents_purpose_check` constraint includes `'whatsapp_notifications'`. If deploying to an existing remote database that has an older check constraint, ensure migration `20261029000002_whatsapp_params_and_events.sql` is run to update the check constraint.

---

## 6. NOT VERIFIED / NOT RUN Items and Reasons

1. **Live Meta WhatsApp Business API Calls**:
   - *Status*: **NOT RUN**.
   - *Reason*: User rules strictly mandate: "This run NEVER calls the real Meta API and needs no real phone numbers. Tests mock fetch and use fake numbers like 919999900001. If you need a real value, read it from an env var; if the env var is missing, skip that check and record 'NOT VERIFIED: needs <ENV_NAME>' in the report."
   - *Needs*: `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`.
2. **Live Supabase Auth Send SMS Webhook Ingress**:
   - *Status*: **NOT RUN** (Tested via cryptographic mock in Node.js test harness).
   - *Reason*: `ENABLE_WHATSAPP_AUTH_HOOK` is set to `false` by default; requires configuring Supabase Auth custom hook in dashboard with `SEND_SMS_HOOK_SECRET`.

---

## 7. Unrelated Bugs Found (Not Fixed)

1. **`apps/customer-mobile/src/screens/HomeScreen.tsx:352` Type Mismatch**:
   - *Description*: `<StatusBar barStyle="dark-content" backgroundColor="#ffffff" />` causes TypeScript compilation error `TS2769: Property 'backgroundColor' does not exist on type 'IntrinsicAttributes...'` because the StatusBar component imported from react-native on iOS/Expo does not accept `backgroundColor` in the current type definitions.
   - *Action*: Not touched in accordance with "Do not touch unrelated code. Fix only what you broke."
2. **`tests/scripts/test-validation.mjs:169` Stale Realtime Channel Regex**:
   - *Description*: `test-validation.mjs` line 169 expects `apps/merchant-web/src/app/bookings/page.tsx` to match `/filter:\s*selectedProviderId \? \`provider_id=eq\.\$\{selectedProviderId\}\` : undefined/`. However, in commit `9594a5a` (`fix(realtime): update state directly from realtime payloads and enforce provider filter gating`), this was changed to guard at the top `if (!selectedProviderId) return;` and pass `filter: \`provider_id=eq.\${selectedProviderId}\``.
   - *Action*: Not touched in accordance with "Do not touch unrelated code."

---

## 8. Exact Next Manual Steps for User

When ready to test with real Meta WhatsApp credentials:

1. **Register WhatsApp Message Templates in Meta Business Manager**:
   - Go to [Meta WhatsApp Template Manager](https://business.facebook.com/wa/manage/message-templates/).
   - Create and submit the 5 approved templates in language `en`:
     - `booking_confirmed` (UTILITY): Body with 4 variables `{{1}}`, `{{2}}`, `{{3}}`, `{{4}}`.
     - `reminder_1h` (UTILITY): Body with 3 variables `{{1}}`, `{{2}}`, `{{3}}`.
     - `booking_cancelled` (UTILITY): Body with 3 variables `{{1}}`, `{{2}}`, `{{3}}`.
     - `refund_processed` (UTILITY): Body with 2 variables `{{1}}`, `{{2}}`.
     - `auth_code` (AUTHENTICATION): One-time password template with 1 variable `{{1}}` and button.
2. **Deploy Edge Functions to Supabase**:
   ```bash
   supabase functions deploy whatsapp-sender
   supabase functions deploy whatsapp-webhook --no-verify-jwt
   supabase functions deploy whatsapp-auth-hook --no-verify-jwt
   ```
3. **Configure Supabase Secrets**:
   ```bash
   supabase secrets set \
     WA_ACCESS_TOKEN="<YOUR_PERMANENT_META_SYSTEM_USER_TOKEN>" \
     WA_PHONE_NUMBER_ID="<YOUR_META_PHONE_NUMBER_ID>" \
     WA_APP_SECRET="<YOUR_META_APP_SECRET>" \
     WA_VERIFY_TOKEN="<CHOSEN_VERIFY_TOKEN>" \
     GRAPH_API_VERSION="v21.0"
   ```
4. **Subscribe Meta Webhook**:
   - In Meta App Dashboard under WhatsApp > Configuration, enter Webhook Callback URL:
     `https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook`
   - Enter your `WA_VERIFY_TOKEN` and click **Verify and Save**.
   - Under Webhook fields, subscribe to **`messages`**.
5. **Apply Database Migrations to Remote Supabase**:
   ```bash
   supabase db push
   ```
6. **(Optional) Enable WhatsApp Login Code Hook in Staging**:
   - Follow the detailed steps in [docs/whatsapp-setup.md](file:///Users/trinadh/projects/Appointments/docs/whatsapp-setup.md) Section 5 to configure the Send SMS Hook URL and set `ENABLE_WHATSAPP_AUTH_HOOK="true"`.
