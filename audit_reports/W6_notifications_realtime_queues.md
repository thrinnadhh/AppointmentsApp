# QA Audit Report: W6 - Notifications, Realtime & Background Queues

- **Workstream:** W6 - Notifications, Realtime & Background Queues
- **Status:** COMPLETE
- **Started:** 2026-11-17T17:07:00+05:30
- **Finished:** 2026-11-17T17:25:00+05:30
- **Target Branch:** `refactor/arch-cleanup-and-security-hardening` (`phase-security-hardening-bola`)
- **Output File:** `audit_reports/W6_notifications_realtime_queues.md`
- **Files & Areas Examined:**
  - `apps/customer-mobile/src/services/notifications.ts`
  - `apps/customer-mobile/src/screens/BookingPassModal.tsx`
  - `apps/customer-mobile/src/screens/MyBookingsScreen.tsx`
  - `apps/customer-mobile/src/screens/HomeScreen.tsx`
  - `apps/customer-mobile/src/screens/AccountScreen.tsx`
  - `apps/customer-mobile/src/screens/ConsentScreen.tsx`
  - `apps/customer-mobile/src/App.tsx`
  - `apps/customer-mobile/src/services/api.ts`
  - `apps/merchant-web/src/app/bookings/page.tsx`
  - `apps/merchant-web/src/app/ticket/[id]/page.tsx`
  - `apps/merchant-web/src/app/page.tsx`
  - `apps/merchant-web/src/app/resources/page.tsx`
  - `apps/merchant-web/src/lib/supabase.ts`
  - `apps/merchant-web/src/lib/auth-admin.ts`
  - `apps/merchant-web/src/lib/hospital-access.ts`
  - `apps/merchant-web/src/app/api/queue/broadcast/route.ts`
  - `apps/merchant-web/src/app/api/notifications/push/route.ts`
  - `apps/merchant-web/src/app/api/bookings/hold/route.ts`
  - `apps/merchant-web/src/app/api/bookings/confirm/route.ts`
  - `apps/merchant-web/src/app/api/bookings/checkin/route.ts`
  - `apps/merchant-web/src/app/api/bookings/start/route.ts`
  - `apps/merchant-web/src/app/api/bookings/complete/route.ts`
  - `apps/merchant-web/src/app/api/bookings/no-show/route.ts`
  - `apps/merchant-web/src/app/api/bookings/cancel/route.ts`
  - `apps/merchant-web/src/app/api/bookings/reschedule/route.ts`
  - `apps/merchant-web/src/app/api/doctor/emergency-cancel/route.ts`
  - `apps/merchant-web/src/app/api/payments/verify/route.ts`
  - `apps/merchant-web/src/app/api/webhooks/cashfree/route.ts`
  - `packages/shared/src/queue-engine.ts`
  - `supabase/functions/send-booking-notification/index.ts`
  - `supabase/functions/process-notification-queue/index.ts`
  - `supabase/functions/process-refund-queue/index.ts`
  - `supabase/functions/whatsapp-sender/index.ts`
  - `supabase/functions/whatsapp-webhook/index.ts`
  - `supabase/functions/whatsapp-auth-hook/index.ts`
  - `supabase/migrations/20260908000001_initial_schema.sql`
  - `supabase/migrations/20260910000002_phase2_realtime_and_postgis.sql`
  - `supabase/migrations/20260912000003_phase4_notifications.sql`
  - `supabase/migrations/20260929000003_fix_dispatch_booking_notification.sql`
  - `supabase/migrations/20261024181400_push_tokens_and_notification_delivery.sql`
  - `supabase/migrations/20261028000001_real_whatsapp_notification_queue.sql`
  - `supabase/migrations/20261029000001_whatsapp_queue_foundation.sql`
  - `supabase/migrations/20261029000003_whatsapp_sender_cron.sql`
  - `supabase/migrations/20261104000001_reconcile_merged_stored_procedures.sql`
  - `supabase/migrations/20261105100003_pgmq_queues_and_helpers.sql`
  - `supabase/migrations/20261105100004_pg_net_booking_triggers.sql`
  - `supabase/migrations/20261105100005_cron_lifecycle_jobs.sql`
  - `supabase/migrations/20261107000001_production_readiness_audit_hardening.sql`
  - `supabase/migrations/20261107000007_fix_push_tokens_updated_at_search_path.sql`
  - `supabase/migrations/20261110000002_dispatch_notification_recipient_phone.sql`
  - `supabase/migrations/20261111000002_pg_cron_background_jobs.sql`
  - `supabase/migrations/20261114000003_scale_100k_rls_and_hold_batching.sql`
  - `docs/hospital/SPEC.md`
  - PostgreSQL live state (`cron.job`, `pgmq.list_queues()`, `pgmq.q_notifications`, `notification_logs`, `push_tokens`, `vault.decrypted_secrets`)

---

## Executive Summary

This report provides a forensic, end-to-end technical audit of the notification lifecycle, push token management, Supabase Realtime synchronization across customer mobile and merchant web, and background queues (`pgmq`, `pg_cron`, Deno Edge Functions).

### High-Level Findings & Verdicts:
1. **Critical Silent Queue Failure (Blocker):** `vault.decrypted_secrets` contains `REPLACE_ME` placeholders for `edge_functions_base_url` and `internal_webhook_secret`. As a result, database triggers (`handle_booking_event_webhook_trigger()`) and `pg_cron` jobs (`cron_trigger_queue_consumers()`) silently exit without executing `net.http_post`. In our live inspection of the local database, **420 messages are currently stalled in `pgmq.q_notifications` with `read_ct: 0`**.
2. **Silent WhatsApp Cron Failure (High):** `trigger_whatsapp_sender_cron()` queries `vault.decrypted_secrets` for `supabase_url` and `service_role_key` (which do not exist in the vault) and falls back to `app.settings.supabase_url` (which is `NULL`). The job runs every minute via `pg_cron`, but exits silently on line 32 (`RETURN;`) without dispatching the `whatsapp-sender` edge function.
3. **Ghost Notification Events (High):** The database trigger `handle_booking_event_webhook_trigger()` contains logic for `NEW.status = 'UP_NEXT'`. However, in the application architecture, `UP_NEXT` is an in-memory client-side view state; no API endpoint or stored procedure ever writes `status = 'UP_NEXT'` to the `bookings` table. Consequently, the `"You are next"` alert is never triggered or dispatched. Similarly, `ETA_LEFT_WINDOW` and `EARLY_ARRIVAL_INVITE` exist only as string literals in route allowlists and are never triggered anywhere in the codebase.
4. **Push Token Lifecycle Security Leaks (High):** Push tokens are never invalidated or deleted upon user logout (`AccountScreen.tsx` / `signOutCustomer()`), leading to cross-user device notification leakage. Furthermore, token rotation (`Notifications.addPushTokenListener`) is completely unimplemented.
5. **Realtime RLS & Replica Identity Defects (Medium):** The public ticket pass (`ticket/[id]/page.tsx`) attempts a `postgres_changes` subscription on `public.bookings`. Because `bookings_select_policy` restricts SELECT strictly to `authenticated` users, anonymous viewers receive zero change payloads. Furthermore, `public.bookings` lacks `REPLICA IDENTITY FULL`, causing Postgres WAL to drop non-PK columns on `DELETE` events, which silently breaks Realtime filters (`customer_id=eq...` and `provider_id=eq...`).
6. **Fake "SENT" Logs in Doctor Emergency Cancellation (Medium):** `cancel_doctor_emergency` inserts a notification log with `channel = 'SMS'` and `status = 'SENT'` without integrating with any SMS gateway or queue, giving a false indication of message delivery.

---

## 1. Notification Matrix

Below is the comprehensive audit of all system lifecycle events across recipients and communication channels.

| Event | Recipient | Channel | Implemented? | Trigger Location | Delivery Mechanism | Status | Notes |
|---|---|---|---|---|---|---|---|
| **Booking Confirmed** | Customer | In-App | Yes | `App.tsx:281` | Supabase Realtime (`customer-bookings-${id}`) | **PASS** | Traced end-to-end; shows confirmation toast and updates booking state. |
| **Booking Confirmed** | Customer | Push | Partial | `20261107000001:353` | `pgmq.notifications` -> `process-notification-queue` | **FAIL** | Trigger enqueues, but consumer is blocked by `REPLACE_ME` vault secret; 420 messages stalled. |
| **Booking Confirmed** | Customer | WhatsApp | Partial | `20261114000003:252` | `dispatch_booking_notification` -> `notification_logs` (QUEUED) -> `whatsapp-sender` | **FAIL** | Queued correctly with template `booking_confirmed`, but `trigger_whatsapp_sender_cron` aborts silently due to missing vault `supabase_url`. |
| **Booking Confirmed** | Customer | SMS / Email | No | N/A | None | **FAIL** | SMS logging was transitioned to WhatsApp queue in `20261028000001`. No real SMS provider is integrated. |
| **New Slot Booked** | Merchant / Staff | In-App | Yes | `bookings/page.tsx:178` | Supabase Realtime (`bookings-mgmt-realtime-${providerId}`) | **PASS** | Dashboard displays toast `Realtime Sync: Slot CONFIRMED` and inserts booking into queue. |
| **New Slot Booked** | Merchant / Staff | Push / WA / Email | No | N/A | None | **FAIL** | Not implemented. No push token, WhatsApp template, or email alert exists for merchants on new bookings. |
| **Payment Received** | Customer / Merchant | In-App / Push / WA | Partial | `cashfree/route.ts:218` | Subsumed under Booking Confirmed | **PASS** | Successful Cashfree webhook invokes `confirm_booking_payment`, setting status to `CONFIRMED`. |
| **Payment Failed** | Customer | In-App / Push / WA | Partial | `cashfree/route.ts:260` | Webhook sets status to `CANCELLED` | **FAIL** | Triggers `BOOKING_CANCELLED` notification instead of a dedicated payment failure alert with retry link. |
| **Upcoming Reminder (24h)** | Customer | All Channels | No | N/A | None | **FAIL** | Not implemented. No `reminder_24h_sent_at` column, cron job, or template exists in the codebase. |
| **Upcoming Reminder (2h)** | Customer | All Channels | No | N/A | None | **FAIL** | Not implemented. `providers.reminder_offset_hours` column exists, but no cron job evaluates it. |
| **Upcoming Reminder (1h)** | Customer | WhatsApp | Partial | `20260912000003:251` | `check_and_send_booking_reminders` -> `dispatch_booking_notification` -> `whatsapp-sender` | **FAIL** | Cron job scans 40-75m window; template `reminder_1h` exists, but worker is blocked by silent cron abort. |
| **Upcoming Reminder (30m)** | Customer | Push | Partial | `20261105100005:86` | `enqueue_booking_reminders` -> `pgmq.notifications` -> `process-notification-queue` | **FAIL** | Enqueued via pg_cron every 5m, but consumer execution is stalled by vault placeholder. |
| **Upcoming Reminder (30m)** | Customer | WhatsApp | No | `20261110000002:23` | `dispatch_booking_notification` | **FAIL** | Explicitly rejected by `dispatch_booking_notification` allowlist (only `CONFIRMED`, `REMINDER_1H`, `CANCELLED`, `REFUND_PROCESSED` allowed). |
| **"You Are Next" / Queue Advance** | Customer | Push / WA | No | `20261107000001:366` | `handle_booking_event_webhook_trigger` (`UP_NEXT`) | **FAIL** | Broken link. `UP_NEXT` is an in-memory client state; database never receives `status = 'UP_NEXT'`, trigger never fires. |
| **"You Are Next" / Queue Advance** | Customer | In-App Broadcast | Partial | `ticket/[id]/page.tsx:275` | Supabase Realtime Broadcast (`doctor-queue-${id}-${date}`) | **PASS** | Anonymous-safe broadcast updates waiting counts; does not send personalized alert. |
| **Doctor Delay / ETA Left Window** | Customer | Push / WA | No | `push/route.ts:155` | Unreferenced route | **FAIL** | Supported in type definitions (`ETA_LEFT_WINDOW`), but no calculation, cron job, or trigger dispatches it. |
| **Early Arrival Invite** | Customer | Push / WA | No | `push/route.ts:159` | Unreferenced route | **FAIL** | Supported in type definitions (`EARLY_ARRIVAL_INVITE`), but never called anywhere in the application. |
| **Customer Cancellation** | Customer | In-App | Yes | `App.tsx:281` | Supabase Realtime | **PASS** | State updates and removes booking or badges it as `CANCELLED`. |
| **Customer Cancellation** | Customer | Push / WA | Partial | `20261114000003:257` | `dispatch_booking_notification` (`BOOKING_CANCELLED`) & `pgmq.notifications` | **FAIL** | WhatsApp and Push queued, but delivery blocked by unconfigured vault secrets. |
| **Customer Cancellation** | Merchant | All Channels | Partial | `bookings/page.tsx:178` | Supabase Realtime only | **FAIL** | Merchant web updates live if open; no Push, SMS, WhatsApp, or Email is sent to merchant staff. |
| **Merchant / Doctor Emergency Cancellation** | Customer | Push / WA / SMS | Partial | `20261104000001:755` | `cancel_doctor_emergency` -> `notification_logs` | **FAIL** | Inserts fake `SMS` log with status `SENT`; no real SMS gateway dispatch; no WhatsApp/Push triggered. |
| **Appointment Reschedule** | Customer / Merchant | All Channels | No | `20261104000001:1047` | `reschedule_booking_slot` | **FAIL** | Not implemented. RPC updates `slot_start` but sends no notification and does NOT reset reminder flags. |
| **No-Show Flagged (Strike Update)** | Customer | All Channels | No | `20261113000002:8` | `record_no_show` RPC | **FAIL** | Not implemented. Increments profile strikes and updates booking, but dispatches ZERO notifications. |
| **Refund Processed** | Customer | WhatsApp | Partial | `20261114000003:262` | `handle_booking_notification_trigger` -> `dispatch_booking_notification` -> `whatsapp-sender` | **FAIL** | Trigger enqueues `REFUND_PROCESSED` with template params, but delivery blocked by cron secret defect. |
| **Refund Processed** | Customer | Push | Partial | `20261107000001:383` | `pgmq.notifications` -> `process-notification-queue` | **FAIL** | Enqueued into `pgmq.notifications` on `payment_status = 'REFUNDED'`, stalled behind vault secret defect. |
| **Check-in Verified** | Customer | In-App | Yes | `BookingPassModal.tsx:172` | Supabase Realtime (`modal-checkin-${id}`) | **PASS** | Pass transitions to checked-in state with timestamp and queue position. |
| **Check-in Verified** | Merchant / Front Desk | In-App | Yes | `bookings/page.tsx:178` | Supabase Realtime (`bookings-mgmt-realtime-${providerId}`) | **PASS** | Moves card from Booked to Waiting Queue with `Realtime Sync: Slot CHECKED_IN`. |
| **Check-in Verified** | Customer | Push / WA | No | N/A | None | **PASS** | Conforms to SPEC: check-in is an on-premise interaction; in-app screen reflects state without spamming external push/SMS. |

---

## 2. Detailed Flow Audits

### FLOW-W6-01: Booking Confirmed Notification Chain
- **Flow ID:** FLOW-W6-01
- **Name:** Booking Confirmed Notification Chain
- **Actor:** Customer & Merchant Staff
- **Status:** FAIL (Partial implementation; blocked by background worker configuration)
- **Severity:** High
- **Chain Traced:**
  1. *UI Action:* Customer completes payment on checkout modal (`CheckoutModal.tsx`).
  2. *API / Gateway:* Cashfree webhook (`api/webhooks/cashfree/route.ts:218`) receives `PAYMENT_SUCCESS_WEBHOOK` and invokes `confirm_booking_payment` RPC.
  3. *DB Write:* `confirm_booking_payment` sets `bookings.status = 'CONFIRMED'`.
  4. *DB Trigger (WhatsApp):* `handle_booking_notification_trigger()` (`20261114000003:252`) detects `NEW.status = 'CONFIRMED'` and executes `dispatch_booking_notification(NEW.id, 'BOOKING_CONFIRMED')`.
  5. *DB Trigger (PGMQ Push):* `handle_booking_event_webhook_trigger()` (`20261107000001:353`) enqueues `{ type: 'BOOKING_CONFIRMED', appointment_id: NEW.id, ... }` into `pgmq.notifications`.
  6. *Queue Worker (Push):* Trigger attempts `net.http_post` to `/functions/v1/process-notification-queue`. Blocked because `vault.decrypted_secrets` contains `REPLACE_ME` for `edge_functions_base_url`.
  7. *Queue Worker (WhatsApp):* Row is enqueued into `notification_logs` with status `'QUEUED'`, but `trigger_whatsapp_sender_cron` aborts on missing vault secrets.
  8. *Recipient UI (Customer Mobile):* `App.tsx:281` receives change via `customer-bookings-${activeCustomerId}` Realtime channel and displays confirmation toast.
  9. *Recipient UI (Merchant Web):* `bookings/page.tsx:178` receives change via `bookings-mgmt-realtime-${selectedProviderId}` and updates queue list.
- **Evidence:**
  - `apps/merchant-web/src/app/api/webhooks/cashfree/route.ts#L218-L247`
  - `supabase/migrations/20261114000003_scale_100k_rls_and_hold_batching.sql#L251-L255`
  - `supabase/migrations/20261107000001_production_readiness_audit_hardening.sql#L351-L445`
  - `apps/customer-mobile/App.tsx#L281-L305`
  - `apps/merchant-web/src/app/bookings/page.tsx#L178-L195`
- **Defect Description & Fix:**
  - *Reason:* While DB triggers and Realtime in-app delivery succeed, background Push and WhatsApp workers fail to dequeue due to missing secrets in `vault.decrypted_secrets` and `app.settings.supabase_url`.
  - *Likely Fix:* Configure valid secrets in `vault.decrypted_secrets` (`edge_functions_base_url`, `internal_webhook_secret`, `supabase_url`, `service_role_key`).

---

### FLOW-W6-02: Push Token Registration & User Isolation
- **Flow ID:** FLOW-W6-02
- **Name:** Push Token Registration & RLS Isolation
- **Actor:** Customer Mobile App
- **Status:** PASS
- **Severity:** None
- **Chain Traced:**
  1. *UI Action:* Customer confirms a booking pass or views booking details in `App.tsx:651`.
  2. *Client Service:* `registerForPushNotificationsAsync(activeCustomerId)` is invoked (`notifications.ts:69`).
  3. *Hardware & Channel Setup:* Sets Android notification channel `'default'` with high importance (`notifications.ts:87`).
  4. *Token Acquisition:* Calls `Notifications.getExpoPushTokenAsync()` to retrieve native Expo token. Validates non-mock format in production (`isValidProductionPushToken`).
  5. *DB Write:* Upserts token into `public.push_tokens` with `{ user_id: auth.uid(), token, device_type }`. Also syncs legacy `profiles.expo_push_token`.
  6. *RLS Isolation:* `push_tokens` table enforces RLS (`20261024181400:44-74`). Authenticated patients can ONLY select, insert, update, or delete their own tokens (`auth.uid() = user_id`). Hospital staff (Admin, Front Desk, Consultant) are strictly blocked from reading customer push tokens.
- **Evidence:**
  - `apps/customer-mobile/src/services/notifications.ts#L69-L196`
  - `apps/customer-mobile/App.tsx#L649-L653`
  - `supabase/migrations/20261024181400_push_tokens_and_notification_delivery.sql#L8-L79`
  - Verified by unit test: `tests/unit/hospital-push-notifications.test.mjs:64-96` (`✔ allows authenticated patient to insert and read their own push token`, `✔ blocks patient 2 from reading patient 1 push token via RLS`, `✔ strictly blocks hospital staff from reading customer push tokens`).

---

### FLOW-W6-03: Push Token Lifecycle - Missing Logout Removal & Token Rotation
- **Flow ID:** FLOW-W6-03
- **Name:** Push Token Lifecycle: Logout Cleanup & Token Rotation
- **Actor:** Customer Mobile App
- **Status:** FAIL
- **Severity:** High (DPDP Act / Privacy Leakage)
- **Chain Traced:**
  1. *UI Action:* Customer taps "Sign Out" in `AccountScreen.tsx:93` or `App.tsx:459`.
  2. *API / Service:* `signOutCustomer()` in `apps/customer-mobile/src/services/api.ts:1407` executes `supabase.auth.signOut()`.
  3. *State Cleanup:* Local React state is reset (profile, customer ID, bookings list).
  4. *Missing Invalidation:* Neither `public.push_tokens` nor `public.profiles.expo_push_token` is cleared or deleted.
  5. *Residual Association:* The device's Expo push token remains stored in the database associated with the logged-out customer's account.
  6. *Missing Token Refresh:* `notifications.ts` does not register `Notifications.addPushTokenListener`. When OS rotates the native push token, the DB retains the stale token until the user makes another booking.
- **Evidence:**
  - `apps/customer-mobile/src/screens/AccountScreen.tsx#L93-L96`
  - `apps/customer-mobile/src/services/api.ts#L1407-L1415`
  - `apps/customer-mobile/App.tsx#L459-L476`
  - `apps/customer-mobile/src/services/notifications.ts#L24-L280` (lacks `addPushTokenListener` and token removal export).
- **Defect Description & Fix:**
  - *Reason:* No token cleanup hook exists in the sign-out pipeline. Subsequent notifications destined for the logged-out user will continue to pop up on the physical device even after logout.
  - *Likely Fix:* In `notifications.ts`, export `unregisterPushTokenAsync()` that deletes the token from `public.push_tokens` and sets `profiles.expo_push_token = NULL`. Invoke this in `signOutCustomer()` prior to `supabase.auth.signOut()`. Add `Notifications.addPushTokenListener` in `setupNotificationListeners`.

---

### FLOW-W6-04: Upcoming Appointment Reminders (24h, 2h, 1h, 30m)
- **Flow ID:** FLOW-W6-04
- **Name:** Automated Appointment Reminders Matrix
- **Actor:** PostgreSQL pg_cron & Notification Queues
- **Status:** FAIL (Partial / Broken)
- **Severity:** High
- **Chain Traced:**
  1. *24-Hour Reminder:*
     - *Scan:* No column (`reminder_24h_sent_at`), no cron job, and no template exists.
     - *Status:* **FAIL (Not Implemented)**.
  2. *2-Hour Reminder:*
     - *Scan:* `providers.reminder_offset_hours` column exists (`20261115000002`), but no function or scheduler ever reads it to trigger 2h reminders.
     - *Status:* **FAIL (Not Implemented)**.
  3. *1-Hour Reminder:*
     - *Scheduler:* `check_and_send_booking_reminders()` (`20260912000003:251`) runs every 5 minutes via pg_cron `check-booking-reminders`.
     - *Target Window:* Confirmed bookings where `slot_start` is between 40 and 75 minutes from now and `reminder_1h_sent_at IS NULL`.
     - *Enqueue:* Calls `dispatch_booking_notification(v_rec.id, 'BOOKING_REMINDER_1H')`, which logs `reminder_1h` WhatsApp template into `notification_logs` (QUEUED) and sets `reminder_1h_sent_at = NOW()`.
     - *Worker:* Stalled because `trigger_whatsapp_sender_cron` cannot find `supabase_url`.
     - *Status:* **FAIL (Delivery Stalled)**.
  4. *30-Minute Reminder:*
     - *Scheduler:* `enqueue_booking_reminders()` (`20261105100005:86`) runs every 5 minutes via pg_cron `enqueue-reminders`.
     - *Target Window:* Confirmed bookings where `slot_start` is between 25 and 35 minutes from now and `reminder_30m_sent_at IS NULL`.
     - *Enqueue:* Sends `{ appointment_id, tenant_id, user_id, type: 'BOOKING_REMINDER_30M' }` to `pgmq.notifications` and sets `reminder_30m_sent_at = NOW()`.
     - *Worker:* Stalled in `pgmq.q_notifications` because `cron_trigger_queue_consumers` aborts on `REPLACE_ME` vault secret.
     - *WhatsApp Incompatibility:* If passed to `dispatch_booking_notification`, it is rejected by the strict allowlist in `20261110000002:23` (which omitted `BOOKING_REMINDER_30M`).
     - *Status:* **FAIL (Delivery Stalled)**.
- **Evidence:**
  - `supabase/migrations/20260912000003_phase4_notifications.sql#L251-L285`
  - `supabase/migrations/20261105100005_cron_lifecycle_jobs.sql#L86-L130`
  - `supabase/migrations/20261110000002_dispatch_notification_recipient_phone.sql#L23-L30`
  - Live query: `SELECT jobname, schedule, command FROM cron.job WHERE jobname IN ('check-booking-reminders', 'enqueue-reminders');` (both active).
- **Defect Description & Fix:**
  - *Reason:* 24h and 2h reminders are completely missing from the schema. 1h and 30m reminders enqueue into DB tables/queues but their downstream edge functions are never triggered due to unconfigured vault secrets. WhatsApp RPC allowlist lacks `BOOKING_REMINDER_30M`.
  - *Likely Fix:* Add `reminder_24h_sent_at` and `reminder_2h_sent_at` columns with corresponding cron scan routines. Add `BOOKING_REMINDER_30M` to `dispatch_booking_notification` allowlist. Fix vault secret resolution.

---

### FLOW-W6-05: Queue Position & "You Are Next" Alert
- **Flow ID:** FLOW-W6-05
- **Name:** Queue Position Advance & "You Are Next" Notification
- **Actor:** Front Desk / Hospital Operations & Patient App
- **Status:** FAIL
- **Severity:** High
- **Chain Traced:**
  1. *Queue Evaluation:* `packages/shared/src/queue-engine.ts:evaluateConsultantQueue()` evaluates queue positions (`active`, `upNext`, `waitingList`, `standbyList`).
  2. *UI Computation:* In `apps/merchant-web/src/app/page.tsx:749` and `WaitingLoungeDisplayModal.tsx:52`, the patient in position 1 is visually labelled `'UP_NEXT'`.
  3. *Broken DB Link:* No API route or database function updates `bookings.status = 'UP_NEXT'`. The column remains `'CHECKED_IN'` or `'CONFIRMED'`.
  4. *Dead Trigger:* `handle_booking_event_webhook_trigger()` (`20261107000001:366`) checks `ELSIF NEW.status = 'UP_NEXT' THEN v_event_type := 'PATIENT_UP_NEXT';`. Because the status is never written to PostgreSQL, this branch is unreachable.
  5. *Uncalled Push Endpoint:* `apps/merchant-web/src/app/api/notifications/push/route.ts:151` implements `case 'PATIENT_UP_NEXT'`, but this endpoint is never invoked by any client or server service.
  6. *Realtime Broadcast:* The anonymous-safe broadcast channel `doctor-queue-${doctorId}-${dateStr}` (`ticket/[id]/page.tsx:275`) updates the waiting count on ticket viewers when `/api/queue/broadcast` is called, but does not deliver a direct push or WhatsApp alert to the "Up Next" patient.
- **Evidence:**
  - `packages/shared/src/queue-engine.ts#L104-L145`
  - `apps/merchant-web/src/app/page.tsx#L749`
  - `supabase/migrations/20261107000001_production_readiness_audit_hardening.sql#L366-L368`
  - `apps/merchant-web/src/app/api/notifications/push/route.ts#L11-L14`
- **Defect Description & Fix:**
  - *Reason:* Disconnect between domain queue state machine (which computes `upNext` dynamically in memory) and database storage (which never persists `status = 'UP_NEXT'`).
  - *Likely Fix:* When consultation starts or completes, invoke a server routine that checks the next queued patient and calls `/api/notifications/push` or enqueues `PATIENT_UP_NEXT` to `pgmq.notifications`.

---

### FLOW-W6-06: Doctor Delay & Live ETA Adjustments (`ETA_LEFT_WINDOW`)
- **Flow ID:** FLOW-W6-06
- **Name:** Doctor Delay & ETA Schedule Shift Notifications
- **Actor:** Background Queue / Live Queue Scheduler
- **Status:** FAIL (Not Implemented)
- **Severity:** Medium
- **Chain Traced:**
  1. *Specification Requirement:* `docs/hospital/SPEC.md`: "Live ETA is recomputed on every check-in, start and end; the customer is notified only when the ETA leaves their window. When the doctor runs early an optional 'come now?' invite goes out; declining changes nothing."
  2. *Codebase Search:* `ETA_LEFT_WINDOW` and `EARLY_ARRIVAL_INVITE` exist only in:
     - `supabase/functions/send-booking-notification/index.ts:66-67`
     - `apps/merchant-web/src/app/api/notifications/push/route.ts:12-13`
  3. *Execution Path:* No background worker, cron job, or database function monitors whether recomputed ETAs deviate from the initial slot arrival window (±10 minutes).
  4. *Result:* No notification is ever dispatched to customers when doctor consultations run late or ahead of schedule.
- **Evidence:**
  - `docs/hospital/SPEC.md#L30-L35`
  - `apps/merchant-web/src/app/api/notifications/push/route.ts#L155-L163`
  - `supabase/functions/send-booking-notification/index.ts#L108-L116`
- **Defect Description & Fix:**
  - *Reason:* Missing business logic and worker to evaluate `abs(estimated_start - slot_start) > 10 minutes`.
  - *Likely Fix:* In `queue-scheduler.ts` or after consultation transitions, evaluate ETA delta against previous notified ETA; if delta exceeds threshold, trigger `send-booking-notification` with `ETA_LEFT_WINDOW`.

---

### FLOW-W6-07: Customer Cancellation Notification & Merchant Sync
- **Flow ID:** FLOW-W6-07
- **Name:** Customer Cancellation Notification & Multi-Screen Sync
- **Actor:** Customer Mobile App & Merchant Web
- **Status:** FAIL (Merchant Alert Missing; Customer Push Stalled)
- **Severity:** Medium
- **Chain Traced:**
  1. *UI Action:* Customer initiates cancellation in `MyBookingsScreen.tsx` or `BookingPassModal.tsx`.
  2. *API Call:* Calls `cancel_booking` RPC (`20261028000001:417`).
  3. *DB Update:* Validates 60m cutoff window; sets `bookings.status = 'CANCELLED'`, `payment_status = 'REFUND_PENDING'` (if eligible) or `'FORFEITED'`.
  4. *Customer WhatsApp:* `handle_booking_notification_trigger()` invokes `dispatch_booking_notification(NEW.id, 'BOOKING_CANCELLED')`. Correctly queued with template `booking_cancelled`.
  5. *Customer Push:* `handle_booking_event_webhook_trigger()` enqueues to `pgmq.notifications`. Stalled behind vault placeholder.
  6. *Customer Mobile UI:* Realtime subscription updates bookings list and displays cancellation status.
  7. *Merchant Web UI:* `bookings/page.tsx:178` Realtime subscription updates card.
  8. *Merchant Push / Email:* ZERO alert dispatched to merchant, clinic manager, or doctor.
- **Evidence:**
  - `supabase/migrations/20261028000001_real_whatsapp_notification_queue.sql#L417-L573`
  - `supabase/migrations/20261114000003_scale_100k_rls_and_hold_batching.sql#L256-L259`
  - `apps/merchant-web/src/app/bookings/page.tsx#L178-L235`
- **Defect Description & Fix:**
  - *Reason:* Cancellation pipeline only addresses customer notifications; no merchant alert mechanism exists.
  - *Likely Fix:* Extend `handle_booking_event_webhook_trigger` or edge functions to lookup provider contact / owner user ID and enqueue a merchant cancellation alert.

---

### FLOW-W6-08: Doctor Emergency Cancellation & Fake "SENT" Logs
- **Flow ID:** FLOW-W6-08
- **Name:** Doctor Emergency Cancellation Notification
- **Actor:** Hospital Admin / Consultant
- **Status:** FAIL
- **Severity:** High
- **Chain Traced:**
  1. *UI Action:* Hospital Admin or Consultant triggers emergency cancellation on `/resources` page (`resources/page.tsx:127`).
  2. *API Route:* `POST /api/doctor/emergency-cancel` validates RBAC permissions (`emergency-cancel/route.ts:64`).
  3. *Database RPC:* Calls `cancel_doctor_emergency(doctor_id, effective_from, reason)`.
  4. *DB Updates:* Loops through remaining active bookings, sets `status = 'CANCELLED'`, `payment_status = 'REFUND_PENDING'`, `emergency_cancelled = TRUE`.
  5. *Fake Notification Log:* Lines 755-775 of `20261104000001_reconcile_merged_stored_procedures.sql`:
     ```sql
     INSERT INTO public.notification_logs (
       booking_id, recipient_phone, event_type, channel, status, message_content, created_at
     ) VALUES (
       v_booking.id, v_booking.customer_phone, 'DOCTOR_EMERGENCY_CANCELLED', 'SMS', 'SENT', ...
     );
     ```
  6. *No Provider Integration:* Status is hardcoded to `'SENT'`, channel is `'SMS'`. No external SMS API (Twilio/Gupshup) is called, no PGMQ message is enqueued, and no WhatsApp template is queued.
- **Evidence:**
  - `apps/merchant-web/src/app/api/doctor/emergency-cancel/route.ts#L85-L135`
  - `supabase/migrations/20261104000001_reconcile_merged_stored_procedures.sql#L754-L775`
- **Defect Description & Fix:**
  - *Reason:* Direct violation of the architectural mandate: "Stop fake 'SENT' logs; never mark a notification SENT unless an API accepted it." Customers whose appointments were cancelled due to doctor emergency receive no actual SMS or WhatsApp alert.
  - *Likely Fix:* Change status to `'QUEUED'`, channel to `'whatsapp'` (or integrate real SMS provider via Edge Function), and map to an approved Meta template for doctor emergency cancellation.

---

### FLOW-W6-09: Reschedule Notification & Reminder Timestamp Reset
- **Flow ID:** FLOW-W6-09
- **Name:** Appointment Reschedule Notification & Reminder State
- **Actor:** Customer Mobile App / Front Desk
- **Status:** FAIL
- **Severity:** Medium
- **Chain Traced:**
  1. *UI Action:* Customer reschedules appointment to a new slot via `MyBookingsScreen.tsx` or `/api/bookings/reschedule`.
  2. *Database RPC:* `reschedule_booking_slot` (`20261104000001:1047`) validates 60-minute cancellation/reschedule window and checks slot conflict.
  3. *DB Update:* Updates `slot_start = p_new_slot_start, slot_end = p_new_slot_end, updated_at = NOW()`.
  4. *Missing Notification:* No notification log is created, no WhatsApp is queued, and no push is enqueued.
  5. *Stale Reminder Lockout:* Because `reschedule_booking_slot` does NOT reset `reminder_1h_sent_at` or `reminder_30m_sent_at` to `NULL`, if a patient reschedules an appointment that had already received a reminder for the old slot, they will NEVER receive reminders for their new appointment slot.
- **Evidence:**
  - `supabase/migrations/20261104000001_reconcile_merged_stored_procedures.sql#L1047-L1053`
  - `supabase/migrations/20261107000008_zero_advisor_private_schema_architecture.sql#L2480-L2495`
- **Defect Description & Fix:**
  - *Reason:* Missing reschedule notification dispatch and failure to reset reminder timestamps.
  - *Likely Fix:* In `reschedule_booking_slot`, add `reminder_1h_sent_at = NULL, reminder_30m_sent_at = NULL` to the `UPDATE bookings` statement, and invoke `dispatch_booking_notification` with a reschedule event.

---

### FLOW-W6-10: No-Show Strike Flagging & Customer Block Warning
- **Flow ID:** FLOW-W6-10
- **Name:** No-Show Strike Penalties & Lockout Notification
- **Actor:** Hospital Staff (Front Desk) / pg_cron `expire-no-shows`
- **Status:** FAIL (Not Implemented)
- **Severity:** High
- **Chain Traced:**
  1. *Action:* Front Desk clicks "No Show" in `bookings/page.tsx`, or `cron_expire_no_shows()` runs 15m after slot end.
  2. *RPC Execution:* `record_no_show(booking_id)` (`20261113000002:8`) executes.
  3. *Profile Penalties:* Increments customer's `profiles.no_show_count`. If count reaches 6, sets `is_blocked = TRUE` and `blocked_until = NOW() + INTERVAL '7 days'`.
  4. *Financial Splitting:* Deducts ₹50 to doctor, ₹10 to platform; updates payment status to `FORFEITED` or `REFUND_PENDING`.
  5. *Trigger Evaluation:* `handle_booking_event_webhook_trigger()` does NOT include `NO_SHOW` in its list of meaningful transitions (`20261107000001:359-378`).
  6. *Missing Notification:* No notification of any kind (Push, WhatsApp, SMS, In-App toast) is sent to the customer informing them of the penalty strike, forfeited deposit, or 7-day account lockout.
- **Evidence:**
  - `supabase/migrations/20261113000002_reject_premature_noshow_and_present_patient.sql#L136-L163`
  - `supabase/migrations/20261107000001_production_readiness_audit_hardening.sql#L359-L379`
- **Defect Description & Fix:**
  - *Reason:* Complete absence of notification triggers for `NO_SHOW` lifecycle transitions.
  - *Likely Fix:* Add `ELSIF NEW.status = 'NO_SHOW'` to `handle_booking_event_webhook_trigger()` and create WhatsApp/Push template alerting the patient to their strike status and any booking lockout.

---

### FLOW-W6-11: Refund Processed Notification Chain
- **Flow ID:** FLOW-W6-11
- **Name:** Refund Processed Notification Chain
- **Actor:** Cashfree Webhook / Admin Refund / Cancellation
- **Status:** FAIL (Delivery Stalled)
- **Severity:** High
- **Chain Traced:**
  1. *Trigger Event:* Gateway completes refund or admin executes refund; `bookings.payment_status` transitions to `'REFUNDED'`.
  2. *DB Trigger (WhatsApp):* `handle_booking_notification_trigger()` (`20261114000003:262`):
     ```sql
     IF NEW.payment_status = 'REFUNDED' AND (TG_OP = 'UPDATE' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'REFUNDED')) THEN
       PERFORM public.dispatch_booking_notification(NEW.id, 'REFUND_PROCESSED');
     END IF;
     ```
  3. *DB Trigger (Push):* `handle_booking_event_webhook_trigger()` (`20261107000001:382`):
     `IF NEW.payment_status = 'REFUNDED' THEN v_event_type := 'REFUND_PROCESSED';` enqueues to `pgmq.notifications`.
  4. *WhatsApp Queue:* `dispatch_booking_notification` builds template params for `refund_processed` (amount, provider). Enqueues to `notification_logs` (QUEUED).
  5. *Delivery Failure:* Both WhatsApp worker and Push consumer fail to execute due to unconfigured vault secrets and missing `supabase_url`.
- **Evidence:**
  - `supabase/migrations/20261114000003_scale_100k_rls_and_hold_batching.sql#L261-L265`
  - `supabase/migrations/20261107000001_production_readiness_audit_hardening.sql#L382-L386`
  - `supabase/functions/process-notification-queue/index.ts#L85-L89`
  - `supabase/functions/whatsapp-sender/index.ts#L19` (`refund_processed: 2`)
- **Defect Description & Fix:**
  - *Reason:* End-to-end logic is fully coded on paper, but blocked at runtime by infrastructure credentials.
  - *Likely Fix:* Resolve vault placeholders.

---

### FLOW-W6-12: Check-in Verification & Screen Synchronization
- **Flow ID:** FLOW-W6-12
- **Name:** Check-in Verification & Screen Synchronization
- **Actor:** Customer Mobile App & Front Desk Web
- **Status:** PASS
- **Severity:** None
- **Chain Traced:**
  1. *UI Action:* Front Desk verifies customer's 4-digit PIN via `verify_checkin_pin` RPC or marks present manually via `mark_present_manually` RPC.
  2. *DB Update:* Atomically updates `bookings.status = 'CHECKED_IN'`, `is_present = TRUE`, `checked_in_at = NOW()`.
  3. *Customer Mobile App Sync:* `BookingPassModal.tsx:172` channel `modal-checkin-${booking.id}` receives `UPDATE` event:
     - `setLiveStatus(newRec.status)` updates status badge to "Checked In".
     - `setLiveCheckedInAt(newRec.checked_in_at)` displays arrival time.
     - `setLiveQueuePosition(newRec.queue_position)` displays assigned live token.
  4. *Merchant Web Sync:* `bookings/page.tsx:178` channel `bookings-mgmt-realtime-${selectedProviderId}` receives `UPDATE`:
     - Displays toast `Realtime Sync: Slot CHECKED_IN`.
     - Automatically moves appointment card from Booked to Waiting Queue.
  5. *No Spam:* As designed, no external push/SMS is sent for check-in; in-app UI transitions immediately.
- **Evidence:**
  - `apps/customer-mobile/src/screens/BookingPassModal.tsx#L169-L200`
  - `apps/merchant-web/src/app/bookings/page.tsx#L178-L235`
  - `tests/unit/hospital-lifetime-pin-and-patient-gap.test.mjs`

---

### FLOW-W6-13: Supabase Realtime Subscriptions, RLS & Replica Identity
- **Flow ID:** FLOW-W6-13
- **Name:** Realtime Subscriptions, RLS & Replica Identity
- **Actor:** Supabase Realtime Engine (wal2json) & Client Listeners
- **Status:** FAIL
- **Severity:** High
- **Chain Traced:**
  1. *Publication Setup:* `20260910000002:113` added `public.bookings` and `public.payments` to `supabase_realtime` publication.
  2. *Defect A - Anonymous Ticket Pass:*
     - Customer opens public ticket pass (`ticket/[id]/page.tsx:225`) without logging in.
     - Realtime client connects with anonymous role (`anon`).
     - PostgreSQL RLS policy `bookings_select_policy` (`20261114000003:99`) is granted ONLY `TO authenticated`.
     - Postgres RLS blocks `anon` from selecting from `bookings`, so Realtime server discards all `postgres_changes` events for anonymous ticket holders.
     - Ticket page only updates via secondary Broadcast or adaptive polling.
  3. *Defect B - Missing REPLICA IDENTITY FULL:*
     - Postgres defaults to `REPLICA IDENTITY DEFAULT` (only primary key `id` recorded in WAL for updates and deletes).
     - When a booking row is deleted, or when filtered non-PK columns are updated, WAL contains only `id`.
     - Subscriptions with column filters (`filter: customer_id=eq...` in `App.tsx:289` or `filter: provider_id=eq...` in `bookings/page.tsx:186`) cannot evaluate the filter on `DELETE` events.
     - Consequently, `DELETE` events are silently dropped by Supabase Realtime, leaving deleted cards lingering on screens until full manual reload.
- **Evidence:**
  - `supabase/migrations/20260910000002_phase2_realtime_and_postgis.sql#L111-L121`
  - `supabase/migrations/20261114000003_scale_100k_rls_and_hold_batching.sql#L99-L118`
  - `apps/merchant-web/src/app/ticket/[id]/page.tsx#L225-L264`
  - `apps/customer-mobile/App.tsx#L281-L308`
  - Live query: `SELECT relreplident FROM pg_class WHERE relname = 'bookings';` returns `'d'` (`DEFAULT`, not `'f'` `FULL`).
- **Defect Description & Fix:**
  - *Reason:* Missing `ALTER TABLE public.bookings REPLICA IDENTITY FULL;` and lack of safe anonymous RLS read policy for ticket pass.
  - *Likely Fix:* Execute `ALTER TABLE public.bookings REPLICA IDENTITY FULL;` so all columns are emitted in WAL changes. Replace anonymous `postgres_changes` on ticket with server-side broadcast or secure RPC.

---

### FLOW-W6-14: PGMQ Queue & Edge Function Worker Pipeline (`vault` Defect)
- **Flow ID:** FLOW-W6-14
- **Name:** PGMQ Queue & Edge Function Worker Pipeline
- **Actor:** Postgres PGMQ Extension, pg_net, Edge Functions
- **Status:** FAIL (Blocker)
- **Severity:** Blocker
- **Chain Traced:**
  1. *Queue Creation:* `20261105100003:10` creates `notifications`, `notifications_dlq`, `refunds`, `refunds_dlq`.
  2. *Enqueue:* Triggers on `bookings` insert JSON payloads into `pgmq.notifications`.
  3. *Immediate Trigger Attempt:* Trigger calls `SELECT decrypted_secret INTO v_edge_url FROM vault.decrypted_secrets WHERE name = 'edge_functions_base_url'`.
  4. *Vault Placeholder:* `v_edge_url` is `'REPLACE_ME'`. The guard `IF v_edge_url <> 'REPLACE_ME' AND v_edge_url NOT LIKE '%REPLACE_ME%'` triggers, skipping `net.http_post`.
  5. *Cron Fallback Attempt:* Every minute, pg_cron job `process-queues-cron` runs `SELECT public.cron_trigger_queue_consumers()`. It performs the same vault check, encounters `'REPLACE_ME'`, and exits with `{ dispatched: false, reason: 'Edge functions base URL not configured' }`.
  6. *Empirical Result:* Live query of `pgmq.q_notifications` reveals **420 unprocessed messages** sitting idle with `read_ct = 0`.
  7. *Consumer Idempotency Defect:* In `process-notification-queue/index.ts:253`, messages read from `read_queue_with_dlq` are directly sent to Expo Push API without an idempotency check. If the consumer retries or runs concurrently, duplicate push notifications will be delivered to devices.
- **Evidence:**
  - `supabase/migrations/20261105100003_pgmq_queues_and_helpers.sql#L10-L17`
  - `supabase/migrations/20261107000001_production_readiness_audit_hardening.sql#L412-L445`
  - `supabase/migrations/20261105100005_cron_lifecycle_jobs.sql#L192-L225`
  - `supabase/functions/process-notification-queue/index.ts#L182-L270`
  - Live query: `SELECT count(*) FROM pgmq.q_notifications;` -> **420**.
  - Live query: `SELECT name, decrypted_secret FROM vault.decrypted_secrets;` -> `edge_functions_base_url = 'REPLACE_ME'`.
- **Defect Description & Fix:**
  - *Reason:* Placeholder vault secret halts all automated queue consumers. Consumer lacks deduplication key.
  - *Likely Fix:* Update `vault.decrypted_secrets` with active local/production edge function URL and internal secret. Add idempotency check in `process-notification-queue` before calling Expo.

---

### FLOW-W6-15: WhatsApp Background Queue & pg_cron Execution Pipeline
- **Flow ID:** FLOW-W6-15
- **Name:** WhatsApp Queue, SKIP LOCKED Claim & pg_cron Pipeline
- **Actor:** PostgreSQL pg_cron, `notification_logs`, `whatsapp-sender`
- **Status:** FAIL
- **Severity:** High
- **Chain Traced:**
  1. *Queue Table:* `public.notification_logs` with unique constraint `(booking_id, event_type, channel)`.
  2. *Enqueue:* `dispatch_booking_notification` inserts row with `status = 'QUEUED'`, `channel = 'whatsapp'`.
  3. *Cron Invocation:* pg_cron job `process-whatsapp-queue` runs `* * * * *` executing `SELECT public.trigger_whatsapp_sender_cron();`.
  4. *Silent Abort:* `trigger_whatsapp_sender_cron` (`20261029000003:16-33`) looks for `supabase_url` and `service_role_key` in `vault.decrypted_secrets` (missing) and `current_setting('app.settings.supabase_url')` (`NULL`). Executes `RETURN;` without sending HTTP request.
  5. *Claim Function (Paper PASS):* `claim_queued_notifications(p_limit := 20)` (`20261029000001:58`) correctly uses `FOR UPDATE SKIP LOCKED`, increments `attempts`, and sets `status = 'SENDING'`.
  6. *Worker Implementation (Paper PASS):* `whatsapp-sender/index.ts` validates phone format (`^91\d{10}$`), template registry counts, handles exponential backoff (`[1, 5, 15]` minutes), and updates status to `'SENT'` only upon receiving valid Meta `wamid`.
  7. *Webhook Status Receipts (Paper PASS):* `whatsapp-webhook/index.ts` verifies HMAC-SHA256 (`x-hub-signature-256`), updates `notification_logs` to `'DELIVERED'` or `'READ'` on webhook callbacks.
- **Evidence:**
  - `supabase/migrations/20261029000001_whatsapp_queue_foundation.sql#L25-L100`
  - `supabase/migrations/20261029000003_whatsapp_sender_cron.sql#L5-L48`
  - `supabase/functions/whatsapp-sender/index.ts#L91-L300`
  - `supabase/functions/whatsapp-webhook/index.ts#L13-L220`
  - Live query: `SELECT current_setting('app.settings.supabase_url', true);` returns `NULL`.
- **Defect Description & Fix:**
  - *Reason:* Missing configuration for `supabase_url` and `service_role_key` causes `trigger_whatsapp_sender_cron` to bail out silently every minute.
  - *Likely Fix:* Insert `supabase_url` and `service_role_key` into `vault.decrypted_secrets` or configure them via database settings.

---

### FLOW-W6-16: Automated Slot Hold Release & Background Cleanup Jobs
- **Flow ID:** FLOW-W6-16
- **Name:** Slot Hold Auto-Release & Maintenance Jobs
- **Actor:** PostgreSQL pg_cron
- **Status:** PASS
- **Severity:** None
- **Chain Traced:**
  1. *Hold Expiry Cron:* Job `release-expired-booking-holds` runs every minute (`* * * * *`).
  2. *Stored Procedure:* `release_expired_holds()` (`20261114000003:158`) selects up to 1000 expired held bookings (`hold_expires_at <= NOW()`) using `FOR UPDATE SKIP LOCKED`.
  3. *Atomic Cancellation:* Updates status to `'CANCELLED'` and `payment_status = 'FORFEITED'`.
  4. *Trigger Optimization:* `assign_clinic_queue_position` and `handle_booking_notification_trigger` immediately exit for `OLD.status = 'HELD' AND NEW.status = 'CANCELLED'`, ensuring no fake notifications or queue recalculations occur.
  5. *Unpaid Pending Cleanup:* Job `cancel-unpaid-pending` runs every 5 minutes (`cancel_unpaid_pending_bookings()`).
  6. *No-Show Auto-Expiry:* Job `expire-no-shows` runs every minute (`cron_expire_no_shows()`), marking unarrived appointments 15m after slot end as `NO_SHOW`.
  7. *Daily Cleanup:* Job `daily-cleanup` runs daily at 21:30 UTC (03:00 IST), purging cron run details older than 7 days, pgmq archives, and old app logs.
- **Evidence:**
  - `supabase/migrations/20261111000002_pg_cron_background_jobs.sql#L7-L105`
  - `supabase/migrations/20261114000003_scale_100k_rls_and_hold_batching.sql#L158-L195`
  - `supabase/migrations/20261105100005_cron_lifecycle_jobs.sql#L8-L82`
  - Live query: `SELECT jobname, schedule, active FROM cron.job;` shows all 5 jobs active and healthy.
  - Verified by unit test: `tests/unit/cron-deduplication.test.mjs:63-70` (`✔ 1. Pair A: Exactly 1 active job for expired booking holds`, `✔ 2. Pair B: Exactly 1 active job for DPDP account deletions`, `✔ 3. Stored procedures execute cleanly without SQL errors`).

---

## 3. Push Token Lifecycle Audit Summary

1. **Registration:**
   - **Status:** PASS
   - **Verification:** Token retrieval via Expo Notifications API and upload to dedicated `public.push_tokens` table is properly gated behind physical device checks and explicit production token validation (`isValidProductionPushToken`). Table enforces strict user-level RLS (`auth.uid() = user_id`) and explicitly blocks hospital staff from reading customer tokens. Verified by unit tests.
2. **Refresh & Rotation:**
   - **Status:** FAIL
   - **Defect:** No listener for `Notifications.addPushTokenListener` exists in `apps/customer-mobile/src/services/notifications.ts`. If Expo or FCM rotates the device token while the app is running or between sessions, the database is never notified until another booking is completed.
3. **Removal on Logout:**
   - **Status:** FAIL
   - **Defect:** In `AccountScreen.tsx:94`, `handleSignOut` executes `supabase.auth.signOut()` without calling any token invalidation API or RPC. `public.push_tokens` and `public.profiles.expo_push_token` retain the token permanently, causing subsequent notifications for that account to leak to whoever uses the device next.
4. **Stale Token Pruning on Delivery Error:**
   - **Status:** PASS (Edge Function) / FAIL (PGMQ Consumer)
   - **Verification:** Edge Function `send-booking-notification` inspects Expo push tickets; on `DeviceNotRegistered`, it calls `public.remove_stale_push_token(token)` to delete the dead token. However, `process-notification-queue` ignores ticket responses and fails to prune dead tokens.

---

## 4. Supabase Realtime Subscriptions & RLS Audit Summary

1. **Active Realtime Channels:**
   - `customer-bookings-${customerId}`: `bookings` table changes filtered by `customer_id`. Functional for authenticated mobile app customers.
   - `modal-checkin-${bookingId}`: `bookings` table `UPDATE` changes filtered by `id`. Synchronizes check-in PIN validation, queue position, and wait times in real time.
   - `bookings-mgmt-realtime-${providerId}`: `bookings` table changes filtered by `provider_id`. Synchronizes merchant appointment dashboard.
   - `doctor-queue-${doctorId}-${date}`: Realtime Broadcast channel. Anonymous-safe, PII-free queue position broadcast.
2. **RLS Interaction Defects:**
   - **Anonymous Client Rejection:** `ticket/[id]/page.tsx` subscribes to `postgres_changes` on `bookings`. Because `bookings_select_policy` is granted only `TO authenticated`, anonymous users viewing their ticket via web link receive zero realtime updates.
   - **Missing REPLICA IDENTITY FULL:** `public.bookings` has default replica identity. When records are deleted or non-PK columns are updated, Postgres WAL does not include `customer_id` or `provider_id`. Supabase Realtime cannot evaluate topic filters on `DELETE` events, causing client screens to silently miss row deletion events.

---

## 5. Background Queues & Workers Audit Summary

1. **Enqueue Mechanisms:**
   - DB triggers (`handle_booking_event_webhook_trigger`, `handle_booking_notification_trigger`) reliably generate payloads on state transitions.
   - Strict idempotency exists for WhatsApp queue via unique constraint `uq_idx_notification_logs_booking_event_channel`.
   - PGMQ lacks an idempotency constraint on `(appointment_id, type)`.
2. **Dequeue & Concurrency:**
   - WhatsApp queue uses `claim_queued_notifications` with `FOR UPDATE SKIP LOCKED`, preventing race conditions across concurrent edge function workers.
   - PGMQ queue uses `read_queue_with_dlq` with 30s visibility timeout.
3. **Dead-Letter Queues:**
   - `read_queue_with_dlq` moves poisoned PGMQ messages with `read_ct >= 3` to `pgmq.notifications_dlq` and logs to `public.app_logs`.
   - WhatsApp queue marks records `status = 'FAILED'`, but does not route to a separate DLQ table or alert channel.
4. **Silent Failures & Queue Starvation:**
   - **Blocker:** Vault placeholder `'REPLACE_ME'` halts all automated triggers to `process-notification-queue`. Live database inspection proved that **420 messages are currently stalled in `pgmq.q_notifications`**.
   - **High:** `trigger_whatsapp_sender_cron` aborts silently due to unpopulated `vault.decrypted_secrets` (`supabase_url`).

---

## HANDOFF

- **[W1 - Bookings]:** In `supabase/migrations/20261104000001_reconcile_merged_stored_procedures.sql:1047` (`reschedule_booking_slot`), rescheduling an appointment fails to reset `reminder_1h_sent_at` and `reminder_30m_sent_at` to `NULL`, permanently suppressing reminders for the new slot.
- **[W2 - Payments]:** In `apps/merchant-web/src/app/api/doctor/emergency-cancel/route.ts:112`, the route iterates through refundable bookings and issues synchronous HTTP calls to Cashfree within a single Next.js request handler, creating severe serverless timeout risks during large hospital departures.
- **[W2 - Payments]:** In `cancel_booking` RPC (`20261028000001:554`), merchant cancellation penalty balance (`penalty_balance + 100.00`) is updated directly on `providers` without generating an immutable audit ledger row in a merchant financial transactions table.
- **[W3 - Hospital RBAC]:** In `apps/merchant-web/src/app/api/notifications/push/route.ts:100`, the route calls `get_user_authorized_providers` for staff authorization, but does not check hospital department module permissions (`appointments` / `queue_schedule`).
