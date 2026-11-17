# REPO MAP — Appointments Platform Architecture & Codebase Index

> **Audit Target Branch:** `refactor/arch-cleanup-and-security-hardening`  
> **Stack:** React Native (Expo) customer mobile app, Next.js 15 App Router merchant/admin web app, Supabase (PostgreSQL, RLS, DB functions, pg_cron queues, Edge Functions), Cashfree payments.

---

## 1. Directory & App Architecture

### Monorepo Layout
```
.
├── apps/
│   ├── customer-mobile/       # React Native / Expo Customer Mobile App
│   ├── merchant-web/          # Next.js 15 App Router (Merchant Web + Hospital Ops + Admin Portal + APIs)
│   └── backend/               # Kotlin/Gradle microservice (legacy / secondary backend)
├── packages/
│   └── shared/                # Shared domain logic, queue engine, schemas, types, constants
├── supabase/
│   ├── migrations/            # 171 SQL migrations (tables, RLS policies, triggers, RPCs, pg_cron)
│   ├── functions/             # Deno Edge Functions
│   └── seed.sql               # Seed data for development and testing
├── tests/
│   ├── unit/                  # Node.js native test runner unit tests (*.test.mjs)
│   ├── e2e/                   # Playwright E2E browser tests (*.spec.ts)
│   ├── security/              # Penetration tests, BOLA checks, RLS audits
│   ├── scripts/               # Test scripts (verification, route probes, load generation)
│   └── mobile/                # Mobile test specifications
├── audit_reports/             # AUDIT WORKSTREAM DELIVERABLES ONLY (W1-W8, REPO_MAP.md)
└── docs/
    ├── hospital/SPEC.md       # BINDING SOURCE OF TRUTH for Hospital vertical invariants
    └── architecture/          # PRD & Architectural designs
```

---

## 2. Customer Mobile App (`apps/customer-mobile`)

- **Root & Navigation:** `App.tsx` (Entry point, authentication state provider, tab/stack navigation).
- **Screens (`apps/customer-mobile/src/screens/`):**
  - `HomeScreen.tsx`: City selector (Tirupati default), Category cards (Hospitals, Salons, Vet Care, Turf/Gaming, Restaurants), Search bar, Filters, Provider cards list.
  - `ProviderDetailScreen.tsx`: Provider/Shop profile, services list, consultant/doctor profiles, department tabs, slot pickers, pricing and fee breakdown.
  - `CustomerDetailsModal.tsx`: Patient details input, family members / offline walk-in details, contact number.
  - `CheckoutModal.tsx`: Booking hold creation, deposit payment options (Pay full / Pay platform fee online + balance at hospital), Cashfree payment integration.
  - `BookingPassModal.tsx`: Booking pass, permanent 4-digit check-in PIN (revealed 60m before slot), QR code, Live queue tracker (Waiting, Up Next, In Consultation).
  - `MyBookingsScreen.tsx`: Upcoming & past appointments list, status badges, cancel & reschedule actions.
  - `AccountScreen.tsx`: Customer profile, saved details, data privacy, delete account request.
  - `ConsentScreen.tsx`: Terms of service & privacy consent modal.
- **Services (`apps/customer-mobile/src/services/`):**
  - `api.ts`: API client connecting to Next.js API endpoints (`apps/merchant-web/src/app/api`) and Supabase.
  - `notifications.ts`: Push token registration (Expo Push Notifications) & push message handling.
  - `logger.ts`: Client-side logging service.

---

## 3. Merchant Web & Admin Portal (`apps/merchant-web`)

### UI Pages & Routes (`apps/merchant-web/src/app/`)
- **Authentication & Registration:**
  - `login/page.tsx`: Unified login for Merchants, Hospital Staff (Hospital Admin, Front Desk, Consultant), and Admin.
  - `register/page.tsx`: Self-serve merchant onboarding & registration.
  - `auth/callback/route.ts`: Supabase Auth OAuth/magic link callback.
- **Merchant & Hospital Operations:**
  - `page.tsx`: Role-based redirect dashboard.
  - `venues/page.tsx`: Shop profile, locations, timings, category configuration.
  - `resources/page.tsx`: Services, consultants/doctors, pricing, buffer slots, slot interval setup.
  - `schedule/page.tsx`: Calendar, schedule slots, working hours.
  - `team/page.tsx`: Hospital team management:
    - Add/remove Front Desk staff, email invites.
    - Department assignments (max 3 staff per department rule).
    - Front Desk to Consultant mapping (`AssignFrontDeskModal.tsx`).
  - `bookings/page.tsx`: Unified Appointments & Queue Dashboard:
    - Check-in code verification modal.
    - Rolling 10-slot live queue, Waiting, and Standby queues.
    - Actions: `Start Consultation`, `Complete`, `No-Show`, `Admit`, `Cancel`, `Reschedule`.
  - `settings/page.tsx`: Merchant notification settings, payout details, account controls.
  - `ticket/[id]/page.tsx`: Publicly verifiable booking pass / ticket viewer.
- **Admin Portal (`apps/merchant-web/src/app/admin/`):**
  - `admin/page.tsx`: Multi-city metrics, merchant approval/suspension, shop placements.
  - `admin/login/page.tsx`: Admin-only secure login screen.
  - `admin/logs/page.tsx`: System audit logs, security event logs, issue problem logs.

### Server API Endpoints (`apps/merchant-web/src/app/api/`)
- **Payments & Webhooks (`api/payments/` & `api/webhooks/`):**
  - `payments/create-order/route.ts`: Initiates Cashfree payment order with split amount and platform fee validation.
  - `payments/verify/route.ts`: Verifies Cashfree payment signature and invokes booking confirmation RPC.
  - `webhooks/cashfree/route.ts`: Cashfree webhook handler with signature verification and idempotency keys.
  - `webhooks/razorpay/route.ts`: Legacy webhook fallback.
- **Bookings Lifecycle (`api/bookings/`):**
  - `hold/route.ts`: Places 5-minute concurrency hold on a slot via DB RPC `create_booking_hold`.
  - `confirm/route.ts`: Confirms booking upon successful payment via `confirm_booking_payment`.
  - `checkin/route.ts`: Validates permanent 4-digit check-in PIN; moves customer to Checked In / Waiting.
  - `start/route.ts` & `admit/route.ts`: Transitions appointment to `IN_CONSULTATION`.
  - `complete/route.ts` & `end/route.ts`: Completes consultation and marks appointment `COMPLETED`.
  - `no-show/route.ts`: Marks appointment `NO_SHOW`, triggers penalty split (₹50 doctor, ₹10 platform, rest refunded).
  - `cancel/route.ts`: Cancels booking; determines refund vs forfeited deposit based on 60m cancellation window.
  - `reschedule/route.ts`: Reschedules appointment to a new slot.
  - `reorder/route.ts`, `reassign/route.ts`, `override/route.ts`, `late-queue/route.ts`: Hospital queue reordering and late arrivals.
  - `offline/route.ts`: Receptionist/Front Desk offline walk-in booking creation without PIN.
- **Hospital Team & RBAC (`api/hospital/`):**
  - `context/route.ts`: Resolves caller's hospital identity, staff role, and assigned consultant IDs.
  - `departments/route.ts`: List and manage hospital departments.
  - `members/route.ts`: Add, invite, edit, and deactivate Front Desk / Consultant staff.
  - `audit-logs/route.ts`: Hospital-scoped administrative audit log.
- **Merchant Management (`api/merchant/`):**
  - `register-shop/route.ts`, `onboard/route.ts`: Merchant profile and shop setup.
  - `doctor-status/route.ts`: Consultant availability toggle (On Duty / Off Duty / Emergency).
  - `provider/route.ts`: Provider profile lookup.
  - `upload-image/route.ts`: Secure image upload for shop and doctor avatars.
- **Admin Endpoints (`api/admin/`):**
  - `analytics/route.ts`: Platform and city-wide transaction volume, completed bookings, merchant counts.
  - `merchants/route.ts`: Merchant status update (APPROVED, REJECTED, SUSPENDED), placement score.
  - `venues/route.ts`, `resources/route.ts`, `bookings/route.ts`, `users/route.ts`: Platform oversight.
  - `cities/route.ts`: Add new city, toggle active status, manage waitlists (`cities/waitlist/route.ts`).
  - `refunds/route.ts`: Admin override refunds.
  - `notifications/route.ts`: Admin broadcast notifications.
  - `audit-logs/route.ts` & `app-logs/route.ts`: System audit trail.
- **Background & Cron (`api/cron/` & `api/queue/`):**
  - `cron/release-holds/route.ts`: Releases expired 5-minute checkout holds.
  - `queue/broadcast/route.ts`: Realtime queue position updates to subscribers.
- **Customer & Account APIs:**
  - `customer/queue-and-history/route.ts`: Customer live queue status and booking history.
  - `account/delete/route.ts` & `account/delete-public-request/route.ts`: DPDP Act / GDPR data erasure.

### Core Libraries (`apps/merchant-web/src/lib/`)
- `auth-admin.ts`: Authentication verification, token decode, `verifyAuthenticatedUser`, `isCallerAuthorizedForBooking`, role guards.
- `hospital-access.ts`: Critical RBAC logic:
  - Role hierarchy: `hospital_admin` > `front_desk` > `consultant`.
  - Front Desk scoping: checks `front_desk_consultants` table to ensure Front Desk can only read/write assigned consultants.
  - Module authorization mapping.
- `payment/`:
  - `cashfree-adapter.ts`: Official Cashfree PG adapter (order creation, signature verification, refunds).
  - `index.ts`: `getPaymentGateway()` factory selecting Cashfree or mock based on environment.
- `queue-scheduler.ts`: Evaluates rolling 10-slot queues, P1 on-time vs P2 standby patients, and estimated consultation start times.
- `supabase.ts`: Supabase admin client (`getSupabaseAdmin` using service role key) and client-safe instance.
- `redis.ts`: Rate limiting via Redis / in-memory store.

---

## 4. Shared Domain Logic (`packages/shared/src/`)

- `queue-engine.ts`: Core queue algorithm:
  - `HospitalDepartmentQueueEngine`: Pure state machine managing Live, Waiting, and Standby queues.
  - `evaluateConsultantQueue`: Calculates active patient, up next, waiting list, and standby list.
  - Priority logic: P1 On-Time patients retain original slot; P2 Late (>10m late) accommodated in gaps or at session end.
- `constants.ts`: System constants:
  - Arrival window: ±10 minutes of slot time.
  - Deposit amounts & platform fee (₹10 default platform fee).
  - No-show penalty split: ₹50 to Doctor/Hospital, ₹10 to Platform.
  - Hold expiry: 300 seconds (5 minutes).
  - Strike rules: Strikes 1–2 free, 3–5 penalized, Strike 6 7-day lockout.
- `schemas.ts`: Zod validation schemas for all API payloads.
- `types.ts`: TypeScript interfaces for Bookings, Providers, Resources, Payments, and Queues.
- `database.types.ts`: Auto-generated database schema types.

---

## 5. Supabase Database & Security Architecture (`supabase/`)

### Key Database Tables
- `profiles`: User accounts, roles (`customer`, `merchant`, `hospital_admin`, `front_desk`, `consultant`, `admin`), phone, email, `permanent_checkin_pin`, `blocked_until`, strike counters.
- `providers` / `venues`: Shops, hospitals, clinics, salons, turfs.
- `resources`: Services, doctors, courts, tables.
- `departments`: Hospital departments (Cardiology, Orthopedics, etc.).
- `hospital_staff`: Staff member records linking users to providers and departments.
- `front_desk_consultants`: Mapping table linking Front Desk staff to assigned Consultants.
- `bookings`: Central appointment table with status: `HOLD`, `CONFIRMED`, `CHECKED_IN`, `IN_CONSULTATION`, `COMPLETED`, `CANCELLED`, `NO_SHOW`, `RESCHEDULED`.
- `payments`: Payment records, Cashfree order ID, payment ID, amount, status, gateway provider.
- `refunds`: Refund tracking, amounts, reason, gateway refund ID.
- `notification_logs`: Notification dispatch audit trail (recipient, channel, template, status).
- `cities`: Supported cities (Tirupati, etc.) and launch status.
- `audit_logs`: Immutable security and administrative actions log.

### Critical Database Functions & RPCs
- `create_booking_hold`: Atomically locks slot for 5 minutes; checks GiST exclusion constraint against overlapping active bookings.
- `confirm_booking_payment`: Confirms booking atomically after gateway payment verification.
- `verify_checkin_pin`: Validates customer's 4-digit PIN with brute-force lockout (5 attempts = 60s lockout).
- `process_hospital_no_show`: Flags no-show and calculates penalty split.
- `release_expired_holds`: Releases holds where `expires_at < now()`.

### Key Migrations for Reference
- `20261026190000_split_payment_platform_fee_and_consultation_fee.sql`: Split payment schema.
- `20261028000001_real_whatsapp_notification_queue.sql`: Real notification queue.
- `20261108000002_spec_arrival_window_and_trigger_privileges.sql`: ±10m arrival window & trigger grants.
- `20261111000002_pg_cron_background_jobs.sql`: pg_cron automated queue cleanup and hold releases.
- `20261114000001_production_hardening_and_cashfree.sql`: Cashfree payment schema and constraints.
- `20261114000002_forensic_hardening_and_cashfree_remediation.sql`: Cashfree webhook idempotency & refund logic.
- `20261115000001_harden_security_definer_caller_checks.sql`: SECURITY DEFINER authorization checks.

---

## 6. Edge Functions & Background Queues

- `supabase/functions/send-booking-notification/`: Edge function for dispatching notifications (WhatsApp, SMS, Push).
- `supabase/functions/release-expired-holds/`: Scheduled release of stale slot holds.
- `supabase/functions/process-cancellation/`: Handles cancellation refunds and provider notifications.
- `supabase/functions/generate-invoice/`: Invoicing generation for completed appointments.

---

## 7. Test Suite Index & Execution Instructions

### Running Tests
- **Run all unit tests:**
  ```bash
  node --test tests/unit/*.test.mjs
  ```
- **Run a specific unit test:**
  ```bash
  node --test tests/unit/<test-name>.test.mjs
  ```
- **Run lint & typecheck:**
  ```bash
  pnpm lint
  pnpm typecheck
  ```
- **Run E2E tests (Only if essential, on assigned ports):**
  ```bash
  pnpm test:e2e
  ```

### Key Existing Unit Tests
- `tests/unit/cashfree-adapter.test.mjs`: Cashfree payment integration & order hashing.
- `tests/unit/cashfree-webhook-idempotency.test.mjs`: Webhook signature & duplicate delivery idempotency.
- `tests/unit/cashfree-payment-verification.test.mjs`: Payment verification logic.
- `tests/unit/hospital-rbac-security.test.mjs`: Hospital Admin, Front Desk, Consultant privilege separation.
- `tests/unit/hospital-queue-engine.test.mjs`: On-time, late, standby queue transitions.
- `tests/unit/hospital-lifetime-pin-and-patient-gap.test.mjs`: Check-in PIN validation & lockout.
- `tests/unit/hospital-no-show-policy.test.mjs`: 6-strike rule and penalty calculations.
- `tests/unit/hospital-bookings-rls.test.mjs`: Row Level Security policies on bookings table.
- `tests/unit/hospital-split-payment.test.mjs`: Split payment math (platform fee vs consultation fee).
- `tests/unit/admin-city-matrix-transition.test.mjs`: City activation and customer visibility.
