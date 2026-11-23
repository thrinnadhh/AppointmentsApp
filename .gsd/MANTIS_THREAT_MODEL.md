# Mantis Living Threat Model & Attack Surface Discovery — Appointments Platform

**Date:** 2026-11-21  
**Audit Target:** Appointments Monorepo (`apps/merchant-web`, `apps/customer-mobile`, `packages/shared`, `supabase/migrations`, `supabase/functions/`)  
**Branch:** `security/window-closure-20261121` (Base HEAD: `99d1b6c`)  
**Methodology:** Google Mantis Autonomous Threat Hunting Framework (`.agents/skills/mantis-*`) & Security Audit Verification Standard (`.agents/skills/security-audit/`)  
**Status:** COMPLETE — STAGE 1 TRACK A DISCOVERY & THREAT MODEL  

---

## 1. Executive Summary & Architectural Overview

The **Appointments Platform** provides high-reliability, hyperlocal appointment booking, queue management, and digital OPD triage across multi-specialty hospitals, healthcare clinics, and service venues in India. The monorepo incorporates:
- **Merchant Web Portal (`apps/merchant-web`)**: Next.js 15 App Router application supporting Hospital Administrators, Doctors/Consultants, and Front Desk Staff.
- **Customer Mobile Application (`apps/customer-mobile`)**: React Native & Expo SDK 58 application providing slot booking, digital OPD pass rendering, and live queue tracking.
- **Shared Business Engine (`packages/shared`)**: Queue scheduling engines, TypeScript schema contracts, and common utilities.
- **Data & Compute Plane (`supabase/`)**: PostgreSQL 17 engine with 158 migrations, 31 RLS-enforced tables, 57 hardened `SECURITY DEFINER` RPCs, and 9 Supabase Edge Functions (Deno Runtime).
- **Payment & Settlement Infrastructure**: Cashfree Payment Gateway & EasySplit automated marketplace splits; decommissioned legacy Razorpay endpoints.
- **Notification Engine**: Meta WhatsApp Business Cloud API & Expo Push Notifications.

---

## 2. Trust Boundaries & Privilege Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PUBLIC INTERNET (UNTRUSTED)                      │
│   - Anonymous Visitors, External Search Bots, Unauthenticated Web Users      │
│   - Mobile Clients prior to OTP Authentication                              │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                        [Next.js Edge Middleware]
                                       │
        ┌──────────────────────────────┴──────────────────────────────┐
        ▼                                                             ▼
┌──────────────────────────────┐              ┌───────────────────────────────┐
│     ANONYMOUS TIER (anon)    │              │   AUTHENTICATED CUSTOMER      │
│ - Public Catalog (Clinics)   │              │   (auth.uid() = customer_id)  │
│ - Waitlist Submission        │              │ - Own Booking Holds & Passes  │
│ - Webhook Ingestion Gates    │              │ - 4-Digit Check-in PIN Reveal │
└──────────────────────────────┘              │ - Profile & Family Booking    │
                                              └───────────────┬───────────────┘
                                                              │
                     ┌────────────────────────────────────────┴───────────────┐
                     ▼                                                        ▼
┌─────────────────────────────────────────────┐ ┌─────────────────────────────┐
│        HOSPITAL FRONT DESK STAFF            │ │      CONSULTANT DOCTOR      │
│ (department_members.role = 'front_desk')    │ │ (department_members.role =  │
│ - Doctor Front Desk Mapping Required        │ │   'consultant' OR resource) │
│ - Token Check-In & Arrival Triage           │ │ - Own Patient Queue Only    │
│ - Manual Admit & Queue Reordering           │ │ - Start/End Consultation    │
│ - Offline Consultation Fee Collection       │ │ - Emergency Clinic Cancel   │
└──────────────────────┬──────────────────────┘ └──────────────┬──────────────┘
                       │                                       │
                       └───────────────────┬───────────────────┘
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 HOSPITAL ADMINISTRATOR (TENANT BOUNDARY)                    │
│   - providers.owner_id OR merchant_memberships.role = 'hospitalAdmin'       │
│   - Full Administrative Authority over Departments, Doctors, Staff, & Rules  │
│   - STRICT ISOLATION: Zero read/write authority across other hospital IDs   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 PLATFORM SUPERADMIN (GOVERNANCE BOUNDARY)                   │
│   - public.is_admin(auth.uid()) = TRUE                                      │
│   - Cross-Tenant Dispute Resolution, Territory/City Activation, Refunds     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  DATABASE SERVICE ROLE (INTERNAL TRUSTED)                   │
│   - service_role key OR current_setting('app.trusted_write') = 'true'       │
│   - Background PgNet webhooks, PgQueues, Refund Processing, System Crons    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Role Invariants & Permissions Matrix

| Principal Role | PostgREST DB Privileges | Permitted API Scope | Prohibited Actions |
|:---|:---|:---|:---|
| **`anon` (Public)** | `SELECT` on `categories`, `cities`, `resource_availability`, `resources`, `sub_categories`. Zero write privileges. | `/api/cities/waitlist`, `/api/health`, `/api/auth/otp/*`, `/api/ticket/[id]` (public preview), `/api/webhooks/*` | Cannot create bookings directly, cannot read customer PII or notes, cannot view queue tickets. |
| **`customer`** | `SELECT` on own `profiles`, own `bookings`, own `payments`, `appointment_checkin_codes`. Direct `INSERT/UPDATE` on `bookings` is REVOKED. | `/api/bookings/hold` (via RPC), `/api/payments/*`, `/api/customer/*`, `/api/account/export`, `/api/account/delete` | Cannot view other patients' bookings, cannot modify booking status, cannot admit or override queues. |
| **`front_desk`** | PostgREST table access strictly mediated via RLS policies checking `doctor_front_desk_assignments`. | `/api/bookings/checkin`, `/api/bookings/admit`, `/api/bookings/reorder`, `/api/bookings/override`, `/api/bookings/collect-fee` | Cannot access queues or doctors to which they are not assigned. Cannot alter hospital payout settings. |
| **`consultant`** | Scoped exclusively to `resources` where `user_id = auth.uid()` or assigned department doctor. | `/api/bookings/start`, `/api/bookings/end`, `/api/doctor/emergency-cancel`, `/api/queue/broadcast` | Cannot view or modify queues belonging to other doctors or other hospital departments. |
| **`hospitalAdmin`** | Management over own `departments`, `department_members`, `doctor_front_desk_assignments`, and `resources`. | `/api/hospital/*`, `/api/admin/doctor-assignments`, `/api/merchants/cashfree-vendor` | Cannot modify platform governance fields (`city`, `cashfree_vendor_status`) protected by trigger. Cannot access other tenants. |
| **`superadmin`** | Evaluated via `public.is_admin(auth.uid())` reading `platform_config` or admin profiles. | `/api/admin/*`, `/api/cron/*` | Actions audited in `public.admin_audit_logs`. |
| **`service_role`** | Bypasses PostgreSQL Row Level Security. | Backend asynchronous queue processors, Supabase Edge Functions. | Never exposed to client bundles or unauthenticated callers. |

---

## 3. Authentication & Session Architecture

### 3.1 Next.js Edge Middleware (`apps/merchant-web/src/middleware.ts`)
- **Strict Route Classification**: Enforces allowlist gating (`PUBLIC_ROUTES`, `PUBLIC_API_ROUTES`).
- **Session Resolution**: Dual authentication parser supporting:
  1. `Authorization: Bearer <jwt>` headers (validated format: 3-part base64 JWT).
  2. Ambient Supabase session cookies (`sb-*-auth-token`).
  3. `CRON_SECRET` constant-time buffer verification (`crypto.timingSafeEqual`) on `/api/cron/*`.
- **Payload Size Capping**: Rejects requests exceeding 2MB (`MAX_API_BODY_BYTES`) before body parsing to mitigate memory exhaustion risks (GHSA-mrhx-c7xc-m3w5).
- **Origin & CORS Validation**: Dynamic origin validation against verified platform hosts (`appointments4u.in`, `*.appointments4u.in`, explicit Vercel preview team slugs). Wildcard CORS headers are strictly forbidden.

### 3.2 Check-In PIN & Offline Presence Gating
- **4-Digit Check-in PIN**: Generated server-side upon booking confirmation and stored in `public.appointment_checkin_codes`.
- **Time Window Gate**: Masked from the customer mobile interface and public ticket endpoint until $\le 60$ minutes prior to `slot_start`.
- **Brute-Force Lockout Defense**: Enforced by `public.staff_checkin_rate_limits` (5 failed validation attempts triggers a 60-second hardware and staff lockout).
- **Zero Merchant Read**: Hospital staff cannot query plaintext PINs; check-in requires interactive patient presentation.

---

## 4. Entrypoint Surface Analysis (Server Actions, REST, & RPCs)

### 4.1 Server Actions vs. Route Handlers Audit
- **Audit Result**: Zero Next.js Server Actions exist in the codebase (`grep -rn "use server" apps/` returns 0 hits).
- **Architecture**: 100% of server-side operations are cleanly encapsulated in explicit Next.js Route Handlers (`apps/merchant-web/src/app/api/**/route.ts`).
- **Input Sanitization**: Request bodies are parsed via safe JSON parsers with payload limit checks (`assertSafePayloadStructure`, `PayloadLimitExceededError`).

### 4.2 Comprehensive REST API Inventory & Auth Controls

| Route Path | Methods | Auth Guard Mechanism | Privilege Level | Concurrency / Replay Controls |
|:---|:---:|:---|:---|:---|
| `/api/account/delete` | `DELETE` | `verifyAuthenticatedUser` | User Self-Service | Immediate atomic erasure via `delete_account_immediately` |
| `/api/account/delete-public-request` | `POST` | IP Rate Limit + Signed Token / Caller JWT | Public / User | Signed HMAC deletion token verification |
| `/api/account/export` | `GET` | `verifyAuthenticatedUser` | User Self-Service | Exports machine-readable DPDP §11 archive |
| `/api/admin/cities/status` | `POST` | `verifyAdminRequest` | Platform Admin | Transactional RPC `update_city_status` |
| `/api/admin/doctor-assignments` | `GET`, `POST` | `verifyStaffManagerRequest` | Hospital Admin | Single-admin 409 check; resource department sync |
| `/api/admin/refunds` | `GET`, `POST` | `verifyAdminRequest` | Platform Admin | Audited via `public.admin_audit_logs` |
| `/api/auth/otp/send` | `POST` | IP & Phone Rate Limiting | Public | Libphonenumber verification, SMS gateway dispatch |
| `/api/auth/otp/verify` | `POST` | Phone Rate Limiting | Public | Supabase GoTrue Auth token exchange |
| `/api/bookings/admit` | `POST` | `isCallerAuthorizedForBooking` | Staff / Admin | Optimistic locking (`version`, `updated_at`) |
| `/api/bookings/cancel` | `POST` | `isCallerAuthorizedForBooking` | Owner / Staff | `cancel_booking` RPC with 60m fee retention |
| `/api/bookings/checkin` | `POST` | `isCallerAuthorizedForProvider` | Front Desk | 5-fail lockout in `staff_checkin_rate_limits` |
| `/api/bookings/collect-fee` | `POST` | `isCallerAuthorizedForBooking` | Front Desk | `collect_consultation_fee` RPC, updates ledger |
| `/api/bookings/confirm` | `POST` | `isCallerAuthorizedForBooking` | Customer / Webhook | `confirm_booking_payment` transactional RPC |
| `/api/bookings/emergency-choice`| `POST` | `isCallerAuthorizedForBooking` | Customer / Admin | `choose_emergency_option` RPC |
| `/api/bookings/offline` | `POST` | `isCallerAuthorizedForProvider` | Front Desk | Transactional offline slot reservation |
| `/api/bookings/override` | `POST` | `verifyAuthenticatedUser` | Staff / Doctor | Transactional `override_hospital_queue_position` |
| `/api/bookings/reorder` | `POST` | `verifyAuthenticatedUser` | Staff / Doctor | Transactional `reorder_hospital_queue` |
| `/api/cities/waitlist` | `POST` | IP (10/hr) & Phone (3/day) Rate Limit | Public | Libphonenumber-js normalization, DB deduplication |
| `/api/cron/security-monitor` | `GET`, `POST`| `verifyCronAuth` (`CRON_SECRET`) | Cron / System | Timing-safe secret check, reads anomalies view |
| `/api/customer/queue-and-history`| `GET` | `verifyAuthenticatedUser` | Customer | Customer-isolated appointment & queue status |
| `/api/customers/[id]/profile` | `GET` | `verifyAdminRequest` | Platform Admin | Admin profile inspection |
| `/api/doctor/emergency-cancel` | `POST` | Consultant or Hospital Admin | Doctor / Admin | Bulk cancellation, 100% refund, strike increment |
| `/api/hospital/context` | `GET` | `verifyAuthenticatedUser` | Staff / Doctor / Admin | Resolves hospital role, accessible doctor IDs |
| `/api/hospital/departments` | `GET`, `POST`, `PATCH`, `DELETE` | `isHospitalAdmin` | Hospital Admin | Cascade protection (blocks delete if active slots exist) |
| `/api/hospital/members` | `GET`, `POST`, `PATCH`, `DELETE` | `isHospitalAdmin` / `verifyStaffManagerRequest` | Hospital Admin | Roster invite, cancellation, revocation |
| `/api/merchants/cashfree-vendor`| `GET`, `POST`| `isCallerAuthorizedForProvider` | Hospital Owner | Masked bank/PAN verification, EasySplit onboarding |
| `/api/notifications/push` | `POST` | `verifyAuthenticatedUser` / `service_role` | Internal / Caller | Privacy-preserving copy (zero patient health data) |
| `/api/payments/create-order` | `POST` | `verifyAuthenticatedUser` (First) | Customer | Rate limited (30/min IP, 10/min booking); held slot check |
| `/api/payments/verify` | `POST` | `verifyAuthenticatedUser` | Customer | Cryptographic HMAC validation via gateway adapter |
| `/api/prescriptions/signed-url` | `POST`| `getAuthenticatedUser` | Doctor / Staff | Path ownership check (`${booking.id}/`), audit logged |
| `/api/queue/broadcast` | `POST` | `authorizeHospitalResourceOrMerchant` | Doctor / Staff | Realtime ephemeral channel broadcast |
| `/api/slots/availability` | `GET` | `verifyAuthenticatedUser` | Customer | Zero PII returned; only slot_start/slot_end |
| `/api/ticket/[id]` | `GET` | Optional Token / Phone Last-4 | Public / Customer | PII masking; 60m pre-slot PIN gating |
| `/api/webhooks/cashfree` | `POST` | HMAC-SHA256 (`x-webhook-signature`)| Cashfree Gateway | 300s timestamp tolerance, integer paise verification |
| `/api/webhooks/razorpay` | `POST`, `GET`| None (Decommissioned) | None | Unconditionally returns HTTP 410 Gone |

---

## 5. PostgreSQL Database Layer & RLS Matrix

### 5.1 Tables & Row Level Security Status
Every single one of the **31 tables** in the `public` schema has `rowsecurity = true` (RLS enabled):
1. `account_deletion_requests` (RLS active, user-isolated SELECT, zero public INSERT)
2. `admin_audit_logs` (RLS active, service_role ALL, admin SELECT)
3. `app_logs` (RLS active, service_role ALL, admin SELECT)
4. `appointment_checkin_codes` (RLS active, customer-only SELECT)
5. `audit_logs` (RLS active, authenticated insert/select scoped to merchant/actor)
6. `bookings` (RLS active, authenticated SELECT; direct INSERT/UPDATE revoked)
7. `categories` (RLS active, public catalog read-only)
8. `cities` (RLS active, public read-only, admin manage)
9. `city_settlements` (RLS active, admin-only manage)
10. `city_waitlist` (RLS active, authenticated manage, ingest via RPC)
11. `contact_reveal_audit` (RLS active, admin read-only)
12. `crash_alert_dedup` (RLS active, service_role ALL, admin SELECT)
13. `department_members` (RLS active, hospital-scoped SELECT, INSERT, UPDATE, DELETE)
14. `departments` (RLS active, hospital-scoped SELECT, INSERT, UPDATE, DELETE)
15. `doctor_front_desk_assignments` (RLS active, hospital-scoped manage)
16. `merchant_memberships` (RLS active, merchant-scoped manage, partial unique admin index)
17. `merchant_vendor_splits` (RLS active, service_role ALL, owner SELECT)
18. `notification_logs` (RLS active, service_role / trusted_write manage, customer SELECT)
19. `payments` (RLS active, customer-only read, service_role manage)
20. `platform_config` (RLS active, service_role only)
21. `profiles` (RLS active, owner-only read/write, admin manage)
22. `providers` (RLS active, public read, owner UPDATE guarded by governance trigger)
23. `push_tokens` (RLS active, owner-only manage)
24. `resource_availability` (RLS active, public read, owner manage)
25. `resource_leaves` (RLS active, owner/hospital admin manage)
26. `resources` (RLS active, public read, owner/hospital admin manage)
27. `staff_checkin_rate_limits` (RLS active, deny all to client roles)
28. `sub_categories` (RLS active, public read-only)
29. `test_provider_clock_links` (RLS active, deny all to client roles)
30. `test_tenant_clocks` (RLS active, deny all to client roles)
31. `user_consents` (RLS active, owner-only manage)

### 5.2 SECURITY DEFINER RPCs & `search_path` Pinning
- **Audit Verification**: Querying `pg_proc` for `SECURITY DEFINER` functions in `public` and `private` schemas verified that **100% of definer functions have search_path pinned** (`search_path = ''` or `search_path = 'public', 'pg_temp'`). Zero functions have unpinned search paths.
- **RPC Wrappers (`20261118000012`)**: Public RPCs (`public.create_booking_hold`, `public.cancel_booking`, `public.complete_booking`, etc.) are thin SQL wrappers that delegate execution directly into the private schema (`private.*`) with `SET search_path TO ''`.

### 5.3 Concurrency & Slot Locking Defense
- **Advisory Locks**: `pg_advisory_xact_lock(hashtext('hold_limit:' || customer_id))` eliminates TOCTOU races in slot reservation.
- **Row-Level Locks**: `SELECT ... FOR UPDATE` is acquired on slot reservations and status transitions.
- **Database GiST Exclusion Constraint**: `public.bookings` enforces `no_overlapping_active_bookings` using `btree_gist`:
  `EXCLUDE USING gist (resource_id WITH =, tstzrange(slot_start, slot_end) WITH &&) WHERE (status = ANY (ARRAY['HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING', 'UP_NEXT']))`.

---

## 6. Storage Buckets & Policies

1. **`venue-assets` (Public)**:
   - Purpose: Provider venue photographs, doctor avatars, category icons.
   - Access: Public read (`anon` + `authenticated`); write restricted to verified hospital owners and platform administrators.
2. **`prescriptions-and-records` (Private)**:
   - Purpose: Highly confidential patient medical prescriptions, clinical notes, and diagnostic records (DPDP sensitive personal data).
   - Access: Zero public read policies.
   - Delivery: Direct access forbidden; all downloads require signed HMAC URLs generated via `/api/prescriptions/signed-url`.
   - Authorization: Verifies caller is either the patient who owns the booking (`caller.id === booking.customer_id`) or an authorized doctor/staff member for that specific booking. Validates that the requested storage path begins with `${booking.id}/` or `${booking.customer_id}/`. Every generation event is immutably logged in `public.audit_logs`.

---

## 7. Payment Gateway Integration & Webhook Security

### 7.1 Cashfree Gateway & EasySplit Marketplace
- **Ingestion Route**: `POST /api/webhooks/cashfree`
- **Cryptographic Signature**: Validates HMAC-SHA256 signature passed in `x-webhook-signature` using `crypto.timingSafeEqual` over `${timestamp}${rawBody}`.
- **Replay Protection**: Strict 300-second timestamp drift check (`Math.abs(nowMs - timestampMs) > 300_000` rejects stale requests).
- **Idempotency**: Evaluates payment event IDs against `public.payments.gateway_payment_id`. Subsequent duplicates return `{ status: 'OK', idempotent: true }` immediately.
- **Financial Validation**: Verifies integer paise amounts against `expected_payment_amount_paise`. Currency must be `INR`.
- **Late Payment Reclaim**: If payment arrives for an expired hold, executes `reclaim_expired_hold_or_refund` RPC; if the slot was reclaimed by another user, triggers automatic refund dispatch.

### 7.2 Decommissioned Razorpay Route
- **Ingestion Route**: `POST /api/webhooks/razorpay`, `GET /api/webhooks/razorpay`
- **Behavior**: Hardened in `SEC-WIN-005` to unconditionally return `HTTP 410 Gone` with `{ code: 'RAZORPAY_DECOMMISSIONED' }`. Zero secrets are read, zero request bodies are processed, and zero database queries are made.

---

## 8. WhatsApp Business Platform & Mobile Bridges

### 8.1 WhatsApp Cloud API Edge Functions
- **`whatsapp-webhook` (`supabase/functions/whatsapp-webhook`)**:
  - `GET`: Validates Meta verification token handshake (`hub.mode === 'subscribe'` && `hub.verify_token`).
  - `POST`: Validates `x-hub-signature-256` HMAC-SHA256 signature using `crypto.subtle` in constant time. Updates delivery/read status in `public.notification_logs`.
- **`whatsapp-sender` (`supabase/functions/whatsapp-sender`)**:
  - Autonomous queue worker claiming up to 20 notifications using `FOR UPDATE SKIP LOCKED`.
  - Authenticated via Bearer `SUPABASE_SERVICE_ROLE_KEY` or `CRON_SECRET`.
  - Enforces Meta template parameter registry contracts and exponential retry backoff (1m, 5m, 15m).

### 8.2 Mobile WebView Bridge (`CashfreeCheckoutWebView.tsx`)
- **Origin Whitelist**: Navigation strictly constrained to `https://sdk.cashfree.com`, `https://payments.cashfree.com`, and `cashfree.com` subdomains (`CASHFREE_ALLOWED_ORIGINS`).
- **Scheme Isolation**: Non-HTTP schemes strictly allowlisted to verified UPI applications (`upi://`, `phonepe://`, `tez://`, `paytmmp://`, `bhim://`, `credpay://`). Android `intent://` and dangerous arbitrary schemes are blocked.
- **Message Validation**: `handleMessage` rejects messages if `event.nativeEvent.url` is missing or not in the allowlist; treats postMessages strictly as notification hints and verifies payments server-side.

---

## 9. Reconciliation of 2026-11-08 Drift Report

Every item identified in `2026-11-08_DRIFT_REPORT.md` was audited against the current working tree:

| Drift Report Item | Initial Documented Drift | Current Codebase Status | Empirical Verification / File Location |
|:---|:---|:---|:---|
| **`docs/hospital/SPEC.md`** (Check-in PIN vs OTP) | Pass UI labeled check-in code as "OTP" | **RECONCILED / ALIGNED** | `apps/customer-mobile/src/screens/BookingPassModal.tsx:411` explicitly states *"Tell your 4-digit check-in PIN below"*. |
| **`docs/hospital/screens-admin.md`** (Route Path) | SPEC cited `/hospital` route | **RECONCILED / ALIGNED** | Dynamic routing in `apps/merchant-web/src/app/page.tsx` based on vertical and role. |
| **`docs/hospital/screens-admin.md`** (DELETE Departments) | Missing `DELETE` handler | **RECONCILED / ALIGNED** | `apps/merchant-web/src/app/api/hospital/departments/route.ts:300` implements full `DELETE` handler with active appointment checks. |
| **`docs/hospital/screens-admin.md`** (Member Revocation) | Parameter format divergence | **RECONCILED / ALIGNED** | `apps/merchant-web/src/app/api/hospital/members/route.ts:440` handles both query params (`id`, `member_id`) and JSON body. |
| **`docs/hospital/screens-frontdesk.md`** (Direct RPC) | UI calling PostgREST directly | **RECONCILED / ALIGNED** | Routed through Next.js API endpoints (`/api/bookings/reach`, `/api/bookings/admit`, `/api/bookings/collect-fee`). |
| **`docs/hospital/screens-frontdesk.md`** (Late Queue) | Legacy `+2` buffer rule | **RECONCILED / ALIGNED** | `late-arrival-queue.md` formally marked `[RETIRED]`; evaluated via dynamic time-fitting queue engine in `@appointments/shared`. |
| **`docs/hospital/screens-customer.md`** (Split Payment) | Split fee omitted in design docs | **RECONCILED / ALIGNED** | Documented and implemented (`platform_fee_amount`, `consultation_fee_amount`, `collect_consultation_fee` RPC). |
| **`docs/architecture/PRD`** (No-Show Policy) | Stale 4-strike threshold | **RECONCILED / ALIGNED** | 6-strike tiered policy active in migration `20261024000001_no_show_tiered_policy_and_account_block.sql`. |
| **`docs/architecture/Architecture`** (Edge Functions) | Incomplete Edge Function inventory | **RECONCILED / ALIGNED** | All 9 deployed Edge Functions cataloged in architecture and threat model. |
| **`docs/architecture/Architecture`** (Double Booking) | Obsolete partial index | **RECONCILED / ALIGNED** | Upgraded to PostgreSQL GiST range exclusion constraint `no_overlapping_active_bookings`. |

---

## 10. Threat Discovery Findings & Vulnerability Candidates

During Stage 1 Track A deep-dive exploration, three candidate findings were identified and recorded with raw evidence in `.gsd/evidence/DISCOVERY_MANTIS/` and cataloged in `.gsd/evidence/DISCOVERY_MANTIS/candidates.json`:

### Candidate Finding 1: `SEC-DISC-001` (Severity: High)
- **Title**: `[CWE-285] In-App Account Deletion Route Fails with HTTP 500 Due to Service-Role RPC Call Without User Context`
- **Location**: `apps/merchant-web/src/app/api/account/delete/route.ts:59`
- **Defect**: The route authenticates the caller via `getRouteSupabaseClient(req)`, but invokes `delete_account_immediately` using `supabaseAdmin.rpc('delete_account_immediately', { p_reason: reason })`. The SQL function checks `v_uid := (SELECT auth.uid()); IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;`. Under `supabaseAdmin` (service role), `auth.uid()` is `NULL`, causing every in-app account deletion request to unconditionally abort with HTTP 500 (`{"error": "Not authenticated"}`).
- **Impact**: Complete denial of service for mandatory right to erasure under DPDP Act 2023 §12 and Google Play Store account deletion compliance.
- **Empirical PoC Evidence**: Executed and recorded in `.gsd/evidence/DISCOVERY_MANTIS/test_account_delete_failure.*` (Exit code: 1, HTTP 500 returned).

### Candidate Finding 2: `SEC-DISC-002` (Severity: High)
- **Title**: `[CWE-798] Hardcoded Supabase Project Credentials in Historical Git Commits`
- **Location**: Historical commits (`9305ab5c`, `34b7d2c7`, `5e515195`) in `scripts/e2e-trinadh-hospital-test.mjs`, `tests/e2e/payment-full-flow.spec.ts`, `tests/e2e/compliance-pages.spec.ts`.
- **Defect**: Active/historical JWT tokens and project keys for remote Supabase project `ynkdnwhubfknnnzjtpeg` were detected in git log by `gitleaks detect` and `gitleaks git --log-opts="--all" -v`.
- **Disposition**: Tracked in `.gsd/MANUAL_ACTIONS.md` (`SEC-WIN-024`) as `NEEDS_HUMAN` for upstream Cloud Console secret rotation and `git-filter-repo` commit purge.

### Candidate Finding 3: `SEC-DISC-003` (Severity: Medium)
- **Title**: `[CWE-285] Inconsistent Test Bypass Guard in Account Export API Route`
- **Location**: `apps/merchant-web/src/app/api/account/export/route.ts:40-57`
- **Defect**: The route implements custom test bypass logic (`if (process.env.NODE_ENV !== 'production')`) reading `x-test-bypass-user` without importing or enforcing `isE2EBypassEnabled()` (which checks `ENABLE_E2E_BYPASS === 'true'`) and without emitting `logBypassAudit(...)`, unlike `apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts`.
- **Impact**: In staging or non-production deployments where `ENABLE_E2E_BYPASS` is intentionally false, sending `x-test-bypass-user` could bypass user verification.

---

## 11. Tool Discovery Execution Ledger

All tools specified in Track A were executed and logged via `.gsd/run_and_record.sh DISCOVERY_MANTIS <step> <command>`:

| Tool / Command | Step Name | Evidence Files | Findings Summary |
|:---|:---|:---|:---|
| `python3 .agents/skills/vulnerability-scanner/scripts/security_scan.py .` | `security_scan` | `security_scan.{stdout,stderr,exitcode,meta.json}` | Flagged demo secrets in `.env.local` & mock runs; RegExp `.exec()` false positives; DOM sink in admin login sanitized. |
| `python3 .agents/skills/vulnerability-scanner/scripts/dependency_analyzer.py .` | `dependency_analyzer` | `dependency_analyzer.{stdout,stderr,exitcode,meta.json}` | Flagged per-package lockfiles; dismissed as pnpm root workspace (`pnpm-lock.yaml`). |
| `gitleaks detect --source . -v` | `gitleaks_detect` | `gitleaks_detect.{stdout,stderr,exitcode,meta.json}` | 4 leaks detected in historical git commits (`scripts/`, `tests/e2e/`). |
| `gitleaks git --log-opts="--all" -v` | `gitleaks_git` | `gitleaks_git.{stdout,stderr,exitcode,meta.json}` | 4 leaks detected in historical branch commits. |
| `node validate-findings.cjs candidates.json` | `validate_candidates` | `validate_candidates.{stdout,stderr,exitcode,meta.json}` | **PASS: 3 findings valid** against `report-schema.json`. |
| In-App Account Deletion PoC Failure | `test_account_delete_failure`| `test_account_delete_failure.{stdout,stderr,exitcode,meta.json}` | HTTP 500 error reproduced on `DELETE /api/account/delete`. |
