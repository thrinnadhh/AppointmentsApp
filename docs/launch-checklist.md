# Appointments4u — Pre-Launch Operational Checklist & Production Runbook

> **Target Vertical:** Hyperlocal Healthcare & Multi-Vertical Appointments (Hospital, Clinic, Salon, Turf, Dining)  
> **Platform Version:** Phase 7 Release Hardening (`phase-7-release`)  
> **Compliance:** DPDP Act 2023 (India), IT Act 2000 §79, TRAI DLT Guidelines, Razorpay Live Payment Mandates  
> **Verification Gate:** Serially passing across database, API routes, k6 load testing, and security matrices.

---

## 1. Environment Variable Matrix (Names Only)

| Environment Variable | Local (`.env.local`) | Staging | Production | Scope / Layer | Required for Launch? |
| :--- | :---: | :---: | :---: | :--- | :---: |
| `DATABASE_URL` | Yes | Yes | Yes | Backend / Postgres Pooler | Yes |
| `DIRECT_URL` | Yes | Yes | Yes | Database Migrations | Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Yes | Yes | Web / Client PostgREST (`https://`) | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes | Yes | Web / Client RLS | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Yes | Yes | Next.js Server Admin / Cron | Yes |
| `SUPABASE_JWT_SECRET` | Yes | Yes | Yes | Auth / JWT verification | Yes |
| `NEXT_PUBLIC_APP_URL` | Yes | Yes | Yes | Web Base URL (`https://`) | Yes |
| `ALLOW_MOCK_PAYMENTS` | Optional (`true`) | Optional (`false`) | Required (`false`) | Web / Payment Gateways | Yes (Must be `false`) |
| `RAZORPAY_KEY_ID` | Optional | Yes | Yes | Web / Razorpay Orders API | Yes |
| `RAZORPAY_KEY_SECRET` | Optional | Yes | Yes | Web / Razorpay Signature | Yes |
| `RAZORPAY_WEBHOOK_SECRET` | Optional | Yes | Yes | Web / Webhook Validation | Yes |
| `UPSTASH_REDIS_REST_URL` | Optional | Yes | Yes | Rate Limiting & Lock Manager | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Yes | Yes | Rate Limiting & Lock Manager | Yes |
| `SMS_PROVIDER_API_KEY` | Optional | Yes | Yes | Edge Function / SMS Gateway | Yes |
| `SMS_PROVIDER_ENTITY_ID` | Optional | Yes | Yes | DLT Telecom Entity | Yes |
| `SMS_PROVIDER_TEMPLATE_ID` | Optional | Yes | Yes | DLT Approved Template | Yes |
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Yes | Yes | Customer Mobile App | Yes |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes | Yes | Customer Mobile App | Yes |
| `EXPO_PUBLIC_API_BASE_URL` | Yes | Yes | Yes | Customer Mobile API Base (`https://`) | Yes |
| `SENTRY_DSN` | Optional | Yes | Yes | Web & Mobile Error Tracking | Yes |
| `LOG_LEVEL` | Optional (`debug`) | Optional (`info`) | Required (`warn` / `error`) | Server Observability | Yes |

*Security Rule: Secrets and private keys are never committed to version control. Production values are injected via encrypted secrets managers (Vercel Secrets, Supabase Vault, EAS Secrets).*

---

## 2. Backups and Point-in-Time Recovery (PITR)

### 2.1 Continuous Archiving (WAL-G / Supabase PITR)
- **Engine:** PostgreSQL continuous Write-Ahead Log (WAL) archiving via WAL-G into encrypted cloud object storage.
- **Granularity:** Second-level point-in-time recovery window up to 7 days.
- **Target RPO (Recovery Point Objective):** < 1 minute of transactional data.
- **Target RTO (Recovery Time Objective):** < 30 minutes to provision a replica and restore service.

### 2.2 Automated Base Backups & Offsite Snapshots
- **Daily Physical Backup:** Automated daily snapshot executed at 03:00 IST during low-traffic windows.
- **Weekly Offsite Logical Dump:** Scripted `pg_dump` with schema and data encrypted with AES-256 and pushed to AWS S3 / Cloudflare R2 bucket in the `ap-south-1` (Mumbai) region. Retention: 30 days rolling.
- **Recovery Drill Protocol:** Pre-launch dry-run restoring the logical dump onto a staging test cluster to verify foreign key integrity, sequence consistency, and RLS policy retention.

---

## 3. Monitoring and Alerts

### 3.1 Error Tracking & Exception Monitoring
- **Sentry:** Enabled across both `apps/merchant-web` (Next.js server & client) and `apps/customer-mobile` (React Native Expo).
- **Sampling Rates:** 100% on payment errors, webhook failures, and queue state inconsistencies; 10% on general API transactions.

### 3.2 Health Checks & Synthetic Monitoring
- **Endpoint:** `GET /api/health` monitored every 60 seconds from multi-region probe locations (Mumbai, Singapore, Frankfurt).
- **Checks:** Database latency, Redis ping, active connection pool headroom.
- **Thresholds:**
  - Alert Warning: Response time > 800ms for 3 consecutive checks.
  - Alert Critical (Sev-1): HTTP != 200 or timeout (> 3000ms) for 2 consecutive checks.

### 3.3 Database Connection Headroom & Saturation
- Alert fires if active connections exceed 80% of `max_connections` (Supavisor / PgBouncer pooler threshold).
- Buffer cache hit ratio alert if hit ratio drops below 98%.

### 3.4 On-Call & Escalation Routing
- **Sev-1 Alerts (Deadlock, Payment Down, Auth Down):** PagerDuty on-call phone escalation + Slack `#ops-critical`.
- **Sev-2 Alerts (Rate-limit spikes, 4xx bursts):** Slack `#ops-alerts` notification.

---

## 4. Webhook Retries & Dead-Letter Handling

### 4.1 Ingress Verification & Idempotency
- **HMAC Signature Check:** Every incoming Razorpay webhook must provide `X-Razorpay-Signature`. Verified against `RAZORPAY_WEBHOOK_SECRET` using timing-safe `crypto.timingSafeEqual`.
- **Idempotency Guard:** Webhook events are tracked in table `public.webhook_events` by `event_id`. Duplicate webhook deliveries within 24 hours immediately return HTTP 200 without re-executing booking mutations.

### 4.2 Retry Strategy
- Razorpay webhook automatic retry schedule: Initial attempt, followed by exponential backoff retries at 5m, 10m, 30m, 1h, 3h, 6h, 12h, 24h.
- If processing fails due to temporary database locks or transient network drops, endpoint returns HTTP 500 to solicit Razorpay retry.

### 4.3 Dead-Letter Queue (DLQ) & Reconciliation
- Webhook payloads failing validation or triggering unhandled exceptions are persisted to `payment_events` with `status = 'FAILED'` and error diagnostics.
- An hourly reconciliation worker inspects unresolved `FAILED` events and triggers notification to finance ops for manual order capture or refund reconciliation.

---

## 5. Rollback Steps

### 5.1 Database Migrations (Zero-Downtime Expand/Contract)
- **Principle:** All schema migrations must be strictly backward compatible. Columns are never dropped or renamed in the same release as application code changes.
- **Rollback Procedure:**
  1. Identify migration revision via `supabase migration list`.
  2. If a migration needs reversal, apply a new forward-compensating rollback migration (never modify past migrations per Standing Rule 5).
  3. If catastrophic database corruption occurs, initiate Supabase PITR to a timestamp immediately preceding the migration deployment.

### 5.2 Next.js Web Application (Merchant & Admin)
- Deployments use immutable container / Vercel deployment hashes.
- Instant rollback: Revert production traffic alias to the previous verified deployment SHA (< 30 seconds).

### 5.3 Mobile Application (Customer App)
- **OTA CodePush / EAS Update:** For Javascript-only regressions, publish emergency rollback update via EAS Update channel `production`.
- **Native Binary Issues:** Emergency version bump with expedited review submission to Google Play Console and Apple App Store Connect. In the interim, set `minimum_supported_version` in Supabase remote config to prompt users to update.

---

## 6. Razorpay Live-Mode Requirements

1. **Business KYC & Activation:** Completed entity verification, bank account linkage, and PAN/GST validation on Razorpay Dashboard.
2. **Enabled Payment Methods:**
   - UPI Intent (Google Pay, PhonePe, Paytm, BHIM)
   - UPI Collect & QR
   - Domestic Debit/Credit Cards & Net Banking (all major Indian scheduled banks)
3. **Webhook Registration:** Registered endpoint `https://appointments4u.in/api/webhooks/razorpay` with secret key matching `RAZORPAY_WEBHOOK_SECRET`.
   - Subscribed Events:
     - `order.paid`
     - `payment.captured`
     - `payment.failed`
     - `refund.processed`
4. **Environment Assertion:** Set `ALLOW_MOCK_PAYMENTS=false` in production environment. Any attempt to boot merchant-web with `ALLOW_MOCK_PAYMENTS=true` in production will fail startup via `apps/merchant-web/src/env.mjs`.

---

## 7. SMS DLT Requirements (TRAI / Telecom Compliance)

1. **Principal Entity (PE) Registration:** Registered business entity on telecom DLT portal (Jio / Airtel / Vodafone Idea DLT).
2. **Approved Sender Headers:** 6-character registered alphanumeric headers:
   - Transactional / Service Implicit: `APTFOR`, `APPOINT`
3. **Registered DLT Content Templates:**
   - **Phone Auth OTP:**
     - Template ID: Registered numeric ID (e.g., `110716...`)
     - Message Format: `{#var#} is your verification code for Appointments4u. Valid for 10 minutes. Do not share this OTP with anyone.`
   - **Booking Confirmation & Check-in Pass:**
     - Message Format: `Your appointment with {#var#} on {#var#} at {#var#} is confirmed. Your check-in code is {#var#}. - Appointments4u`
   - **Reschedule / Delay Notification:**
     - Message Format: `Update: Your appointment with {#var#} is revised to {#var#}. Check live ETA in app. - Appointments4u`
4. **Scrubbing & Gateway Credentials:** `SMS_PROVIDER_ENTITY_ID` and `SMS_PROVIDER_TEMPLATE_ID` configured in Edge Functions to ensure zero dropped transactional OTPs.

---

## 8. Production Domain and API URL Location

1. **Primary Production Domain:** `https://appointments4u.in` (DNS managed via Cloudflare with TLS 1.3 Strict Mode).
2. **Merchant & Admin Webapp:** Hosted at root and `/admin`, `/merchant`.
3. **API Endpoints:**
   - Next.js Server API: `https://appointments4u.in/api/*`
   - PostgREST / Realtime: Supabase Production Project URL `https://<prod-project-ref>.supabase.co`
4. **Configuration Locations:**
   - **Webapp:** `apps/merchant-web/.env.production` (`NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SUPABASE_URL`).
   - **Customer Mobile:** `apps/customer-mobile/.env.production` (`EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_SUPABASE_URL`).
   - **Security Pre-Build Gate:** `apps/merchant-web/src/env.mjs` enforces `https://` protocol on all production API and Supabase URLs.

---

## 9. Google Play Store Data Safety Draft

*Based on actual codebase data inventory (DPDPA 2023 & Play Store policy compliant).*

| Data Category | Data Item | Purpose | Optional / Required | Shared with Third Parties? |
| :--- | :--- | :--- | :---: | :---: |
| **Personal Info** | Phone Number | Account authentication (OTP via Supabase Auth) & booking updates | Required | No |
| **Personal Info** | Name | Personalizing customer profile & front desk identification | Required | Shared only with booked hospital/clinic |
| **Location** | Approximate Location | Showing nearby healthcare providers & venues in Tirupati | Optional | No (Processed locally / query filter) |
| **Financial Info** | Payment Transaction Records | Tracking appointment deposit status, refunds, and receipts | Required | Razorpay (PCI-DSS Level 1 compliant gateway) |
| **App Activity** | Booking History & Status | Managing appointments, live queue positions, and check-in pass | Required | Shared with booked doctor / clinic staff |

### Security & Privacy Disclosures:
- **Data in Transit:** Encrypted using TLS 1.3 / HTTPS.
- **Data at Rest:** Encrypted using AES-256 in Supabase PostgreSQL and Vault.
- **Sensitive Health Diagnostic Records:** **NOT COLLECTED**. The app records service appointments and doctor slots; it does NOT collect medical diagnostic histories, prescription documents, or lab reports.
- **Account Deletion:** Supported directly in-app under **Settings → Account → Delete Account**. Deletion initiates a 30-day grace period followed by permanent anonymization.

---

## 10. Privacy Policy & Terms Pages (Zero Placeholders)

- **Validation Command:** `node scripts/check-legal-placeholders.js --strict`
- **Result:** **PASSED (0 unpopulated tokens found)**.
- **Published Grievance Officer Details:**
  - **Officer Name:** N. Trinadh
  - **Designation:** Grievance Officer & Data Protection Officer
  - **Address:** D.No 18-1-506, K.T. Road, Bhavani Nagar, Tirupati, Andhra Pradesh 517501, India
  - **Contact Email:** `grievance@appointments4u.in`
  - **SLA:** 48 hours acknowledgement and response (DPDPA §13 compliant).
- **Public URLs:**
  - Privacy Policy: `https://appointments4u.in/privacy`
  - Terms of Service: `https://appointments4u.in/terms`
  - Refund Policy: `https://appointments4u.in/refund-policy`

---

## 11. Open Decisions from SPEC.md & Current Code Behavior

| # | SPEC.md Topic | Current Code Behavior | Source of Truth / Code Reference |
| :--- | :--- | :--- | :--- |
| 1 | **Overlapping bookings by one customer with two doctors** | **ALLOWED**. Database range exclusion constraint (`no_overlapping_active_bookings`) strictly enforces no double bookings for the same `resource_id`. Cross-resource booking overlaps by the same customer ID are permitted by current schema. | `supabase/migrations/20261021000001_hospital_core.sql` |
| 2 | **Consultant on leave with existing bookings** | **PRESERVED IN CONFIRMED**. Marking a consultant on leave deactivates the resource (`is_active = false`), blocking future slot discovery. Pre-existing confirmed bookings remain intact in `CONFIRMED` status for manual reassignment or emergency-cancellation. | `apps/merchant-web/src/app/api/doctor/emergency-cancel/route.ts` |
| 3 | **Consultant unavailable mid-day** | **PRESERVED FOR REASSIGNMENT**. If a consultant becomes unavailable mid-day, active queue bookings remain in `CONFIRMED` status. The Hospital Admin can either reassign patients via `/api/bookings/reassign` or trigger `POST /api/doctor/emergency-cancel` for 100% customer refunds with 0 merchant strikes. | `tests/unit/e2e-j6-consultant-unavailable.test.mjs` |
| 4 | **Check-in code after reschedule** | **RETAINED WITHOUT REGENERATION**. `reschedule_booking_slot` RPC updates `slot_start`, `slot_end`, and `updated_at`. The initial 4-digit numeric `checkin_code` and its SHA-256 hash are preserved, ensuring customer's existing confirmation pass remains valid. | `supabase/migrations/20261022000011_cancellation_cutoff_60m.sql` |
| 5 | **Deposit below ₹60** | **COURTESY MODEL APPLIED**. `record_no_show` applies a 3-strike courtesy model (strikes 1-2 refund 100%, strike 3+ refunds 0%). Deposits under ₹60 are refunded or forfeited in full without fractional 50/10 platform splitting. | `supabase/migrations/20261023000001_no_show_strike_policy.sql` |
| 6 | **Push notifications at launch** | **EXPO PUSH API WITH NOTIFICATION LOG FALLBACK**. Implemented in Supabase Edge Function `send-booking-notification`. If customer profile has valid `ExponentPushToken`, push is dispatched via Expo API; otherwise, the event is recorded in `notification_logs` and falls back gracefully. | `supabase/functions/send-booking-notification/index.ts` |
| 7 | **Production domain and API URL configuration** | **CONFIGURED VIA ENVIRONMENT VARIABLES**. No production URL is hardcoded. Web reads `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SUPABASE_URL`. Mobile reads `EXPO_PUBLIC_API_BASE_URL`. Cleartext `http://` is rejected at build time in production mode. | `apps/merchant-web/src/env.mjs` |

---

## 12. Verification & Launch Gate Sign-off

- [x] Pre-launch security audit completed (zero Critical, zero High findings).
- [x] Dependency audit clean (`next@15.5.28` pinned, GHSA-2464-fhr4-w9xw & GHSA-p3m5-59mp-jv5r mitigated).
- [x] Database grants and policy matrices verified (service_role, authenticated, and function overloads unified).
- [x] k6 Load test through real path completed (100, 500, 1000 VUs and Realtime fan-out benchmark).
- [x] Legal placeholders checked and verified clean (`node scripts/check-legal-placeholders.js --strict`).
- [x] Full gate serial test run executed.
