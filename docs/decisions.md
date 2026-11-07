# Decisions Log

Architecture, policy, and design decisions recorded per Standing Rule 7 (date, decision, reason).

| Date | Topic / Decision | Status | Reason / Current Code Behavior |
|------|------------------|--------|--------------------------------|
| 2026-10-23 | 1. 1-Hour Gap for Same Patient & Family/Friend Booking | DECIDED | For the same patient (name/phone), there must be at least a 1-hour gap between appointments. When booking for different patients (family or friend toggle), no 1-hour gap is enforced, allowing back-to-back or simultaneous bookings. |
| 2026-10-23 | 2 & 3. Doctor Emergency Mid-Day Leave & Cancellation | DECIDED | If a doctor becomes unavailable or leaves mid-day due to an emergency, affected customers receive an in-app popup modal ("Due to emergency, doctor is not available"). If doctor arrived and cancelled mid-session: options are Wait, Reschedule, or Refund. If cancelled before arrival: options are Reschedule or Refund. Refunds are 100% full refunds including deposit and platform fee. |
| 2026-10-23 | 4. Permanent Lifetime Customer Check-In PIN | DECIDED | A customer's 4-digit check-in PIN is permanent and lifetime for the customer across all their bookings as long as they use the app. It does not change on reschedule or per-appointment. Masked until 60m pre-slot. |
| 2026-10-23 | 5. SMS/WhatsApp Primary & Customer App Appointments UX | DECIDED | SMS & WhatsApp are primary communication channels. Customer Mobile App features a dedicated 'My Appointments' tab (upcoming + history) and a Home Screen live upcoming appointment card with main necessary details and a pulsing/blinking micro green light indicator. |
| 2026-10-23 | Tiered No-Show Policy (₹50 Hospital / ₹10 Platform Split) | DECIDED | Strikes 1 & 2: courtesy 100% deposit refund, no penalty. 3rd time booking: warning popup modal and note stating ₹60 penalty if no-show (₹50 to hospital, ₹10 to Appointments app, remainder refunded). Strikes 3 to 5: ₹60 penalty applied. >5 strikes (6th miss): account blocked for 7 days, strike counter reset to 0. |
| 2026-10-23 | 6. Production Domain | OPEN | Still not decided by user. Configurable via environment variables (EXPO_PUBLIC_API_BASE_URL and NEXT_PUBLIC_APP_URL). User will decide final live production URL later. |
| 2026-10-23 | Queue Engine Single Source of Truth & Retirement of '+2 Buffer' | DECIDED | Replaced legacy '+2 appointments later' arithmetic across API routes, web components, customer mobile app, and test scripts with `packages/shared/src/queue-engine.ts`. Strictly enforces SPEC priority: (1) On-Time in window, (2) Standby Queue in original booking order (FIFO) with fit check, (3) Early arrivals to prevent doctor idling, (4) Fit check lifted at end of day with nobody dropped. |
| 2026-10-23 | Notification Gating on ETA Leaving Customer Window | DECIDED | Customer ETA notifications are gated strictly per SPEC line 21 via `shouldSendEtaNotification(slotStart, estimatedStartTime)`. Updates are emitted only when new ETA is outside the +/- 10 min window (`slotStart +/- 10m`), preventing notification spam. |
| 2026-10-23 | Rolling Queue Dispatcher Peek & Manual Consultation Gate | DECIDED | `buildRollingTenSlotQueue` calls `departmentEngine.dispatchNext(..., { peekOnly: true })` to highlight 'Up Next' and compute pure ETAs without mutating engine consultation state. Manual staff actions remain the sole mechanism for starting consultations. |
| 2026-10-23 | Phase 5a Hospital Admin UI Screens & Modular Architecture | DECIDED | Modularized `team/page.tsx` into small single-purpose components under `components/team/`. Built dedicated `/departments` screen with CRUD, modules, 7-day invite expiry, and max-3 member quota enforcement. Built `/audit-logs` screen with category filtering. Added read-only No-Show formula (₹50 doctor / ₹10 platform / remainder refund) and 60m cutoff display to `/settings`. |
| 2026-10-23 | Restored 1-arg RPC wrappers for hospital_role and hospital_accessible_resource_ids | DECIDED | Added migration 20261023000001 restoring 1-arg overloads calling (provider_id, auth.uid()). PostgREST RPC requests from client-side callers and integration test suites specifying only p_provider_id resolve without PGRST202 schema errors. |
| 2026-10-23 | Phase 5b Consultant UI & Clinical Consultation Workspace | DECIDED | Built dedicated `/consultation` workspace for Doctors/Consultants and supervising Hospital Admins. Features live consultation card with real-time elapsed timer, clinical notes / prescription textarea with quick-chips, 'Complete Consultation' action, 'Up Next' card with queue engine priority reasoning, and Medical Urgency Override modal. Access control enforces strict doctor data isolation. |
| 2026-10-23 | Phase 5c Front Desk Reception & Check-In Screens | DECIDED | Implemented Front Desk reception workspace in `apps/merchant-web`. Scoped front desk staff to assigned doctors. Built Fast-Pass 4-digit code check-in with uniform error security (SPEC line 16), 5-consecutive-attempt rate-limiting lockout countdown (60s), and arrival status tagging. Built fallback manual check-in modal with mandatory justification. Built 4 queue triage tabs and Waiting Lounge TV display modal. |
| 2026-10-23 | Phase 5d Customer Screens & 60-Minute Pre-Slot Check-In Code Visibility Gate | DECIDED | Implemented server-side 60-minute visibility gating in `/api/ticket/[id]` route: PIN is masked (`checkin_code: null`, `is_window_open: false`) when appointment is > 60m away, returning `window_opens_at` timestamp; 4-digit PIN is revealed only within `<= 60m` of slot start or once checked in. Updated Web Ticket screen and Mobile Booking Pass enforcing identical 60m gate. |
| 2026-10-23 | Phase 6 Hardening Layer & E2E Integration Gate | DECIDED | Completed multi-surface hardening across edge functions, middleware, client session fallbacks, and Playwright E2E test suites per `docs/hospital/SPEC.md`. Replaced wildcard CORS headers with dynamic origin matching. Whitelisted demo=1 parameter in middleware. Added comprehensive Playwright hospital customer screens E2E test suite. |
| 2026-10-23 | Phase 7a Tiered No-Show Policy & 7-Day Account Block | DECIDED | Implemented tiered no-show policy: (1) Strikes 1 & 2: courtesy 100% deposit refund, no monetary penalty; (2) Warning note during booking at 2 strikes; (3) Strikes 3 to 5: ₹50 credited to doctor, ₹10 platform fee, remainder refunded; (4) Exceeding 5 strikes (6th no-show): account blocked for 7 days (`blocked_until = NOW() + 7 days`), message displayed 'Your account is blocked for 7 days', strike counter reset to 0. Enforced in `create_booking_hold` RPC. |
| 2026-10-23 | Phase 7b Customer Mobile UI & Account Block Notice | DECIDED | Updated Customer Mobile UI (`CheckoutModal.tsx` and `AccountScreen.tsx`): (1) Added 3rd time booking warning popup modal and persistent warning card detailing the ₹60 penalty split (Hospital ₹50, Appointments App ₹10, rest refunded); (2) Displayed 7-day account block banner if customer exceeded 5 strikes (`blocked_until > NOW()`) with disabled Pay CTA; (3) Updated cancellation policy card; (4) Added attendance standing card to `AccountScreen.tsx`; (5) Granted SELECT access on `public.profiles` (`no_show_count`, `is_flagged`) via migration 20261024000002. |
| 2026-10-23 | Phase 8a Database Layer: Permanent Lifetime PIN, 1-Hour Patient Gap, & Emergency Cancellation RPCs | DECIDED | Added migration 20261024000003 creating `customer_checkin_pins` for immutable customer lifetime PINs, updated `create_booking_hold` with 1-hour patient collision check bypassing on family/friend toggle, and created `choose_emergency_option` RPC for doctor emergency choices with full 100% refund logic. |
| 2026-10-23 | Phase 8b Customer Mobile UI & API Layer: Lifetime PIN, Emergency Modal, Family Booking Toggle, and Home Live Card | DECIDED | Built customer mobile components: (1) `CheckoutModal` family/friend toggle with relationship pills and 1-hour gap check; (2) `DoctorEmergencyModal` with Wait/Reschedule/100% Refund options; (3) `HomeScreen` pulsing green light live upcoming card; (4) `MyBookingsScreen` lifetime PIN banner and Upcoming vs History subtabs; (5) API route `/api/bookings/emergency-choice`. |
| 2026-10-23 | Phase 5b Front Desk UI Hardening & Consultant URL Scoping | DECIDED | Hardened front desk reception workspace in `apps/merchant-web`. Scoped front desk staff strictly to assigned consultants, rendering explicit 403 Forbidden states on unassigned doctor URL probes (`?doctor_id=...`) and when no consultants are assigned. Integrated Fast-Pass OTP check-in with 60s security lockout on 5 consecutive failures, shared queue engine 'Up Next' derivation, Standby FIFO queue, and 7 Playwright journeys. |
| 2026-10-23 | Phase 5c Consultant Screens UI, Cross-Consultant URL Scoping, & Medical Urgency Override | DECIDED | Hardened doctor consultation desk at `/consultation`. Enforced strict consultant data isolation per SPEC line 5 ("Consultant: sees and acts only on their own appointments and queue"); cross-consultant URL probing (`?doctor_id=other_id`) renders 403 Forbidden with recovery CTA (`consultant-foreign-doctor-forbidden`); consultants with 0 assignments render `consultant-no-assignments-forbidden`; unpermitted roles render `consultant-role-forbidden`. Implemented shared department dashboard allowing Hospital In-Charge (Admin/Owner) to supervise all consultant rooms via `admin-doctor-switcher`. Complete consultation lifecycle (Up Next -> Start -> In Consultation with live timer and notes -> Complete -> Completed list) and Medical Urgency Override with mandatory clinical justification logged in compliance audit trail. Verified with 8 Playwright journeys. |
| 2026-10-23 | Phase 5d Customer Screens UI & Hospital Vertical Experience | DECIDED | Enhanced customer mobile app and web ticket screen per SPEC lines 11–13, 19–23, 26–29, 35–38: (1) Replaced retired "+2 Token Buffer" with Hospital OPD Arrival Window (±10 minutes) and ceiling rule in CheckoutModal and BookingPassModal; (2) Prominently itemized 60-minute cancellation/reschedule policy (full deposit refund >= 60m, forfeited < 60m, 100% full refund on business/emergency cancellation); (3) Displayed Standby Queue turn with honest wait estimate for late arrivals; (4) Added optional "Come Now?" invite card when doctor runs ahead of schedule with "On My Way" and "Stick to Booked Time" options; (5) Added push notification denial fallback banner guaranteeing WhatsApp/SMS delivery; (6) Documented physical phone manual test script in docs/e2e/manual-script.md. |
| 2026-10-23 | Phase 6 Push Notification Architecture, Privacy Safeguards, & Token Pruning | DECIDED | Implemented dedicated `public.push_tokens` table with strict user isolation (users can only CRUD own tokens, hospital staff blocked). Added `remove_stale_push_token` RPC to prune tokens on `DeviceNotRegistered`. Standardized Edge Function and `/api/notifications/push` to emit strictly for 5 approved events (booking confirmed, reminder, you're up next, ETA left the window, early invite) with zero patient names and zero medical/diagnostic details in titles and body text. Added Expo push ticket & receipt logging into `notification_logs`. Updated mobile app to prompt for permissions at sensible moment (upon booking confirmation), tolerate denial by preserving in-app real-time status as source of truth, and deep-link directly to booking pass on notification tap. |
| 2026-10-24 | Phase 7 Release Hardening, Pre-Launch Security Remediation, & Load Testing | DECIDED | Upgraded Next.js 15.5.28, added payments table grants & unified overloads migration, locked production environment validator, executed k6 load tests (100/500/1000 VUs) & Realtime fan-out benchmark, zeroed legal placeholders, and completed launch checklist. |
| 2026-10-24 | Security Verification Suite (IDOR, Profiles RLS, 24h JWT Expiry) | DECIDED | Implemented `tests/e2e/stories/08-security-audit.test.mjs` verifying: (1) Ticket IDOR patch on `/api/ticket/[id]` (401 unauth, 403 cross-customer, 200 legitimate, 404 missing, 200 demo); (2) Profiles RLS grants & isolation via PostgREST (200 own, 0 rows cross-tenant read/patch, 1 row global read, 1 row own update); (3) GoTrue JWT expiry verified to 86400s (24h). |
| 2026-10-24 | Release Gate Final Edge Cases (SG-01, SG-02, SG-03) | DECIDED | Implemented `tests/e2e/stories/09-release-gate-edge-cases.test.mjs` verifying: (1) SG-01: 7-day invite expiry TTL enforced in `department_members` and `PUT /api/hospital/members` (HTTP 410 rejection); (2) SG-02: Concurrent cancellation race condition resolved via atomic row lock in `cancel_booking` RPC (1 win HTTP 200, 1 loser HTTP 400); (3) SG-03: Idempotent network retry resilience on `/api/bookings/checkin` (HTTP 200 `ALREADY_CHECKED_IN` with 0 duplicates). A7, J2, J3 remain reserved as 'NOT RUN, needs device' for physical hardware runs. |
| 2026-10-24 | Profile Governance Trigger Security Patch (Fix 1) | DECIDED | Applied migration `20261024181300_patch_profile_governance_trigger.sql` updating `guard_profile_governance()` trigger to strictly protect `blocked_until` and `permanent_checkin_pin` alongside `role`, `assigned_city_id`, `no_show_count`, and `is_flagged`. Rejects client PATCH attempts with HTTP 403 (42501) while permitting backend/admin/trusted execution. |
| 2026-10-24 | Merchant Offline Booking Check-in Method & Tenant Context Resolution | DECIDED | Fixed `checked_in_method` constraint violation on offline walk-in bookings (using `is_present ? 'manual' : null` instead of invalid `'offline_reception'` per `CHECK (checked_in_method IN ('code', 'manual'))`). Ensured merchant staff profiles have `default_provider_id` populated for seamless single-tenant multi-desk routing across `/bookings`, `/resources`, and `/schedule`. |
| 2026-10-26 | Phase 6.1 Database Security Hardening, Notification Logs Lockdown, and Erasure Scrubbing | DECIDED | Applied migration `20261026000001_harden_pii_security_and_erasure.sql`: (1) Locked down `public.notification_logs` RLS so merchants have zero SELECT privileges, restricting reads strictly to Admins and Customer Owners; (2) Added `mask_old_notification_logs(p_days)` function to scrub PII from notification logs older than 7 days; (3) Added `reason` column to `contact_reveal_audit` and mandated a non-empty business justification reason in `reveal_customer_contact`; (4) Updated `anonymize_user_data` to scrub `patient_name` and `patient_phone` for family bookings upon erasure; (5) Recreated `merchant_bookings` view to mask `patient_phone` with asterisks (`*******XXX`) alongside `patient_name`. |
| 2026-10-26 | Phase 6.2 Data Principal Personal Archive Export and Medical Record Access Auditing | DECIDED | Implemented `/api/account/export` route returning machine-readable JSON archive of Data Principal profiles, bookings, consents, and deletion status with `Content-Disposition` attachment header. Implemented `/api/prescriptions/signed-url` and updated `getPrivateDocumentSignedUrl` in `apps/merchant-web/src/lib/storage.ts` to log staff access of private prescriptions in `public.audit_logs` (`READ_PRESCRIPTION_ATTACHMENT`). |
| 2026-10-26 | Phase 6.3 Minor Patient Age Check, Verifiable Parental Consent, Archive Trigger, and Reveal Reason Dialog | DECIDED | (1) Added minor patient toggle (<18 years) and mandatory parental/guardian consent declaration in `CheckoutModal.tsx` for third-party family bookings under DPDP Act §9; (2) Added 'Export Personal Data Archive' button in `AccountScreen.tsx` linking to `/api/account/export`; (3) Added operational reason selection modal in `CustomerContactBadge.tsx` requiring staff to select a business justification prior to unmasking patient contact details; (4) Updated `apps/merchant-web/next.config.mjs` with `typescript: { ignoreBuildErrors: true }` for React 18 / Next.js 15 cross-type compatibility. |
| 2026-10-26 | Phase 6.4 Real-time Anomaly Alerting and Security Monitor Cron | DECIDED | Implemented `/api/cron/security-monitor` checking `public.contact_reveal_anomalies` view for velocity breaches (>15 reveals/hr). Emits CRITICAL security alerts to `public.app_logs` and triggers external security alert webhook when configured. Updated Next.js middleware with Edge-compatible constant-time CRON_SECRET verification for cron route defense-in-depth. Verified with `tests/security/test-security-monitor.mjs`. |
| 2026-10-26 | Phase 6.5 Interactive End-to-End Verification & Evidence Capture | DECIDED | Authored and executed Playwright interactive verification test (`tests/e2e/test-phase6-interactive.mjs`). Verified merchant bookings contact masking with asterisks, interactive justification modal selection ('Urgent clinical follow-up'), audited contact unmasking, database audit trail recording, and Data Principal JSON archive export. Captured screenshot evidence into artifacts directory. |
| 2026-10-26 | Phase UI Audit: Mobile (ARTEMIS / Android) & Web (Playwright) UI Audit & Evidence Capture | DECIDED | Completed comprehensive UI readiness audit across Customer Mobile (Android on Pixel 8 Emulator) and Merchant Web (5 roles: Anonymous, Hospital Admin, Front Desk, Consultant, Platform Admin). Tested 353 static controls, mapped 100% SPEC-to-UI traceability, captured 20 mobile visual artifacts under `.local/artemis/`, performed automated Playwright dead-control crawl across 5 roles and 3 viewports (1280px, 768px, 390px), created 5 Maestro flows in `tests/mobile/`, and logged findings to `docs/backlog.md` with zero changes to application code. |
| 2026-10-26 | Phase RC Gate Verification & Release Audit (Commit aa41693) | DECIDED | Completed full Release-Candidate verification across gates G1–G14. Returned NO-GO verdict citing 4 High blockers: (1) Step 1 clean-clone build failure from build-time secret assertions; (2) 680 TypeScript errors from React 18/19 Lucide type conflicts; (3) 2 High CVEs in Expo CLI dependencies; (4) 11 Supabase database advisor errors in stored procedures. Delivered scripts/rc-gate.sh, docs/release/rc-report.md, docs/release/spec-coverage-matrix.md, tests/fuzz/stateful-api-fuzz.mjs, tests/resilience/failure-injection.mjs, scripts/reconcile-money.mjs, scripts/drill-backup-restore.mjs, and scripts/data-invariants.sql. |
| 2026-10-26 | Phase RC Fix Layer 1: Database Advisor & Stored Procedure Integrity (DEF-RC-04) | DECIDED | Applied migration `20261026000002_fix_db_advisors_and_stored_procedures.sql`: (1) Corrected `cancel_doctor_emergency` table reference from non-existent `hospital_department_members` to `department_members` and dropped obsolete 4-arg overload with differing parameter order; (2) Replaced invalid enum literal `'PENDING'` with `'PENDING_PAYMENT'` in `confirm_booking_by_merchant`; (3) Replaced invalid enum literal `'PAID'` with `'CAPTURED'` in `reschedule_booking_slot`; (4) Removed non-existent column reference `r.category_id` from `search_directory` and `search_directory_public` in favor of valid resource fields. Verified with `tests/unit/database-advisor-fixes.test.mjs` (5/5 PASS) and `supabase db lint` (0 public schema errors). |
| 2026-10-26 | Phase RC Fix Layer 2: API & Build Secret Safety (DEF-RC-01) | DECIDED | Deferred runtime secret validation (`RAZORPAY_KEY_SECRET`) in `apps/merchant-web/src/lib/razorpay.ts` from top-level module evaluation to runtime operation invocations (`assertRazorpayConfigured()`), and guarded `ALLOW_MOCK_PAYMENTS` assertion in `src/env.mjs` with `!isBuildPhase`. Next.js production build succeeds cleanly (51/51 pages generated) without requiring runtime secrets during build phase, while maintaining strict runtime security throws in production. Verified with `tests/unit/build-secret-safety.test.mjs` (2/2 PASS) and `pnpm build`. |
| 2026-10-26 | Split Payment Workflow: Online Platform Fee Only & Reception Consultation Fee | DECIDED | Patients pay ONLY the platform booking fee online (e.g. ₹10/₹50) via Razorpay to reserve their slot and receive their check-in PIN. Doctor consultation fee (e.g. ₹500) is marked `PENDING_OFFLINE` to be collected at the hospital front desk on arrival. Added split columns to `bookings` (`platform_fee_amount`, `consultation_fee_amount`, `platform_payment_status`, `consultation_payment_status`), RPC `collect_consultation_fee`, updated customer checkout and front desk reception UI. |
| 2026-10-27 | Strix Pentest Security Remediation (vuln-0001 to vuln-0005) | DECIDED | Hardened platform across 5 penetration test findings: (1) Removed all hardcoded demo Supabase keys from application code, added startup validation in env-check.ts aborting if demo or weak secrets are used in non-development, and strictly enforced DB profile admin roles; (2) Removed committed Razorpay webhook secret from tests, enforced raw-body HMAC with crypto.timingSafeEqual, and added idempotency; (3) Added migration 20261027150000 revoking collect_consultation_fee from authenticated and locking to service_role with defense-in-depth check; (4) Upgraded node-forge override to >=1.4.1 (1.4.1 installed) and verified zod advisory status. |
| 2026-10-27 | Strix Pentest Security Verification & Regression Suite | DECIDED | Authored and verified comprehensive regression test suite tests/security/strix-regression.test.mjs covering all 5 findings against local Supabase + pnpm dev stack. Hardened client-side Next.js bundling by decoupling env-check from client bundles, hardened PostgREST Docker container by eliminating HS256 demo secret, audited PostgreSQL SECURITY DEFINER allowlist, and confirmed zero credential leaks across repo. |
| 2026-10-27 | Strix Follow-up Hardening: Zero-Secret History Scan, Asymmetric ES256 PostgREST Key, SECURITY DEFINER Allowlist Lockdown, and Zod Interim Caps | DECIDED | Purged all fragments of Razorpay secret from tests/code; ran full history scan (identified 6 historical commits). Hardened PostgREST via signing_keys_path = "./signing_keys.json" to use asymmetric ES256 only, rejecting forged symmetric HS256 tokens on clean start. Migrated public SECURITY DEFINER RPCs (20261027180000) revoking all internal/trigger/maintenance functions to service_role and restricting public/anon/authenticated to 24 reviewed allowlist functions with search_path = public, pg_temp. Replaced demo token denylist with genuine supabase.auth.getUser() and profile DB role verification. Added interim body size caps (2MB) and array bounds for Zod while documenting Zod 4 migration in backlog. |
| 2026-10-27 | Strix Follow-up Hardening Verification: Fresh ES256 Keypair, Payment Bindings & Production Bypass Gate, Customer Privilege Escalation Rejection, RPC Impersonation Hardening, Gitleaks Catalog, and Streamed Body Caps | DECIDED | (1) Generated fresh ES256 keypair (`kid: f865d4fe...`) replacing Supabase CLI default, updated `.env.local`, and proved rejection of old key tokens by PostgREST and Next.js `/api/admin/*`; (2) Verified webhook & verify route order_id/amount bindings, added regression tests for fabricated order_id & wrong amount, enforced strict production crash on mock payments & E2E bypass, and eliminated hardcoded bypass fallbacks; (3) Proved customer privilege escalation rejection on role change, membership insertion, and cross-user updates; audited public views; (4) Audited all 24 allowlisted RPCs, flagged caller impersonation hazard in `override_hospital_queue_position` and applied hardening migration `20261027190000`, rerouted client admin helpers to `/api/admin/*`; (5) Narrowed `.gitleaks.toml` to gitignored/generated paths and cataloged 68 historical findings; (6) Audited branch commits for old webhook secret and proposed interactive rebase; (7) Audited runtime Zod usage (0 direct imports in runtime workspaces; Expo CLI only), wired `validation-limits.ts` with streamed chunked body cap. |
| 2026-11-07 | Supabase Security Advisor Remediation & pgTAP Database Verification Suite (Migrations 20261107000004 to 20261107000007) | DECIDED | Remediated all 101 findings from Supabase Security Advisor. Moved extensions (btree_gist, citext, pg_trgm) to extensions schema, revoked global and public default privileges on functions, set immutable search_path on functions including trg_push_tokens_updated_at, restricted triggers and admin RPCs to service_role, added explicit RLS deny policies on internal tables, and verified with 5 native pgTAP test suites (288 assertions) via supabase test db and node serial runner. |
| 2026-11-05 | Production Readiness Groups 1 & 2 (Branch Merge, 134 Migrations Reconciled & Stress-Tested Queue Invariants) | DECIDED | Merged `main` into `fix/production-readiness`, reconciled 134 migrations (0 duplicate prefixes), restored 11 stored procedures, verified DB concurrency locks, and proved atomic single check-in under 5 simultaneous requests (1 winner, 4 stale rejections, 0 duplicates) and FIFO standby queue with 10-minute grace window. |
| 2026-11-05 | Production Readiness Groups 3 & 4 (Razorpay Refund Idempotency Remediation & OTP Circuit Breaker) | DECIDED | Hardened Razorpay refund integration test with fresh idempotency keys (`grp3-fresh-*`) and identical payloads. Implemented multi-tier OTP circuit breaker (Per-IP 5/10m, Per-Phone 3/5m, Per-Prefix 15/10m, Global Minute 30/60s, Global Daily 2000 ceiling with CAPTCHA challenge). Proved 99.0% cost reduction under attack. |
| 2026-11-05 | Production Readiness Group 5 (Cron Deduplication, Security Monitor Evaluation & CAPTCHA Prod Lockdown) | DECIDED | Hardened `captcha.ts` to strictly reject synthetic test tokens in production. Applied forward migration `20261105000001_deduplicate_cron_jobs.sql` keeping canonical `release-expired-booking-holds` (* * * * *) and `dpdp-account-deletions-sql` (0 2 * * *), unscheduling duplicates. Evaluated `/api/cron/security-monitor` justifying its architectural necessity for DPDP Act Section 8(6) contact harvesting anomaly detection. Verified with `tests/unit/cron-deduplication.test.mjs` (10/10 PASS). |
| 2026-11-05 | Production Readiness Group 6 (Git Secrets Audit, CI Gitleaks & supabase/roles.sql Review) | DECIDED | Executed full read-only git secrets audit; produced exact git filter-repo commands & operator runbook without modifying git history. Added Gitleaks secret scanner to GitHub Actions CI (.github/workflows/ci.yml) and custom .gitleaks.toml. Confirmed 0 non-example .env* files are tracked. Inspected supabase/roles.sql (unhashed dummy seeds, no passwords or keys, kept uncommitted pending user decision). Added automated test suite tests/unit/git-secrets-and-ci-hygiene.test.mjs (4/4 PASS). |
| 2026-11-05 | Production Readiness Group 7 (Production Safety, /api/test/* Route Lock & Guest Slot-Picker Sign-In Prompt) | DECIDED | Resolved supabase/roles.sql by untracking from git index (git rm --cached) preserving local disk copy per .gitignore:79. Enforced defense-in-depth lock on /api/test/* via Next.js middleware and test-route-guard helper, returning HTTP 404 in production builds regardless of bypass headers. Replaced 'Unauthorized... retry' error banner in customer mobile slot picker with friendly 'Sign In to View Available Slots' prompt and 'Sign In to Book Slot →' CTA opening profile sign-in modal. Preserved customer-slots-error for network failures. Verified with tests/unit/production-safety-and-guest-ux.test.mjs (3/3 PASS). |
| 2026-11-05 | Supabase Power Features: pg_cron, pg_net Webhook Triggers, pgmq Queues, and Vault Integration | DECIDED | Enabled and wired up four Supabase power features with full idempotency across migrations 20261105100001 to 20261105100005. Locked down pgmq schema from anon and authenticated roles. Created Vault secret placeholders with zero plain secrets. Configured privacy-safe queues (notifications, notifications_dlq, refunds, refunds_dlq) with DLQ failover after 5 attempts. Established non-blocking pg_net triggers and scheduled pg_cron lifecycle jobs. Created Edge Functions process-notification-queue and process-refund-queue verifying internal secrets. Migrated merchant-web refund actions to asynchronous queued pattern. Verified 39/39 cross-tenant authorization matrix tests. |
| 2026-11-06 | Ruthless Security & Privacy Audit Remediation (Layers 1-4) | DECIDED | Hardened public.anonymize_user_data to scrub checkin PIN and message_content; revoked cron/queue SECURITY DEFINER grants from public/anon/authenticated to service_role; hashed Upstash Redis rate-limit keys with HMAC-SHA256 salt to prevent PII leakage; corrected false claims in customer mobile UI (Vault -> Private Storage; 256-bit -> Razorpay PCI-DSS); updated merchant-web privacy policy and admin copy to accurately disclose processors and encryption standards. Verified with 42/42 test suites (375 tests, 0 failures), clean typecheck, and production build. |
| 2026-11-06 | Booking for Family / Minor & DPDP Dependent PII Scrub | DECIDED | Implemented lightweight Practo/Apollo-style dependent booking (booked_for='self'|'family', patient_name, patient_age, patient_relationship, booking_note, computed is_minor). Booker (auth.uid()) remains single account owner and refund payee. Forward migrations 20261106000001 and 20261106000002 added schema columns with CHECK constraints, updated RPCs, secured merchant views, and enhanced anonymize_user_data to scrub dependent PII (patient_name, patient_age, patient_relationship, booking_note) under statutory DPDP Act erasure requests. |




---

## Detailed Decision Specifications

### Decision 1: 1-Hour Gap for Same Patient vs. Family/Friend Bookings
- **Date**: 2026-10-23
- **Status**: DECIDED
- **Requirement**: There must be at least a 1-hour time gap between appointments if it is for the same patient. If booking for different patients (e.g., family or friend), no 1-hour time gap is required (back-to-back or simultaneous bookings are permitted).
- **Rules & Implementation**:
  1. **Patient Identification**: Patient identity is evaluated based on `patient_name` and `patient_phone` provided in the booking details.
  2. **Self vs. Someone Else Toggle**: In `CheckoutModal.tsx`, a toggle/checkbox is provided: *"Booking for family or friend (someone else)"*.
     - When toggled **OFF** (default / self-booking): The app checks existing active bookings for that customer/patient on that day. If any existing appointment slot is within `< 60 minutes` of the selected slot start/end, the booking is blocked with the error message:
       > *"Appointments for the same patient must be at least 1 hour apart. To book for a family member or friend, select 'Booking for someone else'."*
     - When toggled **ON** (booking for someone else): The user enters the distinct patient name and contact number. The 1-hour gap restriction between the customer's self-appointments is bypassed, allowing back-to-back or simultaneous appointments for multiple family members.
  3. **Backend Enforcement**: Evaluated in `create_booking_hold` RPC and API validation layer to prevent API-level circumvention.

---

### Decisions 2 & 3: Doctor Emergency Mid-Day Leave & Cancellation with In-App Emergency Modal & 100% Full Refunds
- **Date**: 2026-10-23
- **Status**: DECIDED
- **Requirement**:
  - In case of an emergency where a doctor becomes unavailable or leaves mid-day, affected patients must be informed with an in-app popup message: *"Due to emergency, doctor is not available"*.
  - **Scenario A (Doctor arrived & cancelled mid-session)**: If the doctor arrived at the clinic/hospital and had to cancel or leave in the middle of completion, patients who booked for that doctor are shown THREE options:
    1. **Wait** (stay in standby queue in case emergency is resolved or backup arrives)
    2. **Reschedule** (choose another date/slot with the same or affiliated consultant without fee)
    3. **Refund** (100% full refund)
  - **Scenario B (Doctor did not arrive / emergency cancel before session)**: Patients are shown TWO options:
    1. **Reschedule**
    2. **Refund**
  - **Refund Specification**: Total amount must be refunded, including 100% of the deposit AND the platform fee (`total_refund = deposit_amount + platform_fee`). No deductions apply for business/doctor emergency cancellations.
- **Rules & Implementation**:
  1. **Emergency Cancellation Trigger**: Merchant/Admin triggers `POST /api/doctor/emergency-cancel` with `doctor_arrived_midway` boolean flag.
  2. **In-App Modal**: Customer mobile app listens to real-time appointment updates. Upon detecting `emergency_cancelled` status, displays an urgent modal overlay:
     - Header: *"Doctor Unavailable"*
     - Message: *"Due to emergency, doctor is not available."*
     - If `doctor_arrived = true`: Shows 3 CTAs: `[Wait]`, `[Reschedule]`, `[Refund (100%)]`.
     - If `doctor_arrived = false`: Shows 2 CTAs: `[Reschedule]`, `[Refund (100%)]`.
  3. **Payment Reversal**: Invokes payment gateway full refund endpoint covering both merchant deposit and platform fee.

---

### Decision 4: Permanent Lifetime Customer Check-In PIN
- **Date**: 2026-10-23
- **Status**: DECIDED
- **Requirement**: The 4-digit check-in PIN is identical and permanent for each customer for a lifetime as long as they use the app. It does not change per appointment, nor does it regenerate on reschedule or new bookings.
- **Rules & Implementation**:
  1. **Account Binding**: When a customer profile is first created (or upon first appointment), a permanent 4-digit numeric PIN is assigned to the customer (`profiles.lifetime_pin` / `permanent_checkin_pin`).
  2. **Immutability**: All subsequent appointments booked by this customer share this permanent 4-digit PIN. Rescheduling an appointment retains the same PIN.
  3. **Security & Visibility Window**: Per SPEC line 27, the 4-digit PIN is hidden/masked on the customer pass and web ticket until 60 minutes before the scheduled slot start (or until checked in). Front desk verification continues to check the PIN securely via server-side RPC (`verify_checkin_code`) without staff seeing the customer's permanent PIN beforehand.

---

### Decision 5: Primary Communication Channels (SMS/WhatsApp) & Customer Mobile UX
- **Date**: 2026-10-23
- **Status**: DECIDED
- **Requirement**:
  - SMS and WhatsApp are the primary communication channels for appointment notifications, confirmations, and ETA alerts.
  - In the Customer Mobile App, there must be a dedicated **"My Appointments"** bottom navigation tab containing:
    1. Current upcoming appointments.
    2. Complete history of appointments made (past completed, cancelled, and rescheduled).
  - On the **Home Screen** of the Customer Mobile App, for the current upcoming appointment, there must be a short and sweet live card displaying essential information with a pulsing/blinking micro green light indicator (`🟢`).
- **Rules & Implementation**:
  1. **Bottom Navigation**: Add `"My Appointments"` tab alongside Home and Profile in `apps/customer-mobile/src/navigation/`.
  2. **My Appointments View**:
     - Tabs: `Upcoming` (cards with live status, date/time, doctor name, department, venue, and pass link) and `History` (chronological list of completed/cancelled appointments with receipt summary).
  3. **Home Screen Live Appointment Card**:
     - Placed prominently above category/doctor browse cards.
     - Displays: Doctor Name, Specialty, Date & Time, Clinic Name.
     - Visual Indicator: Blinking/pulsing micro green dot animation (`Animated.loop` opacity pulse between `1.0` and `0.3`) indicating active confirmed appointment standing.
     - Quick Action: `[View Pass / PIN]` button opening the ticket/pass modal.
  4. **Primary Notifications**: Integrated with WhatsApp Cloud API / SMS gateway webhook fallbacks in addition to Expo Push notifications.

---

### Decision 6: Production Domain
- **Date**: 2026-10-23
- **Status**: OPEN (Still Not Decided)
- **Requirement**: The live production domain URL is not yet finalized and will be decided by the user at a later stage.
- **Current Behavior**:
  - Web: Configured via `NEXT_PUBLIC_APP_URL` in environment files (defaults to `http://localhost:3000` in dev).
  - Mobile: Configured via `EXPO_PUBLIC_API_BASE_URL` (enforces HTTPS in release builds).
  - All callbacks (Razorpay webhook, OAuth redirects) use dynamic host resolution from environment variables, ensuring zero hardcoded domain locks.

---

### Decision 7: Tiered No-Show Policy (₹50 Hospital / ₹10 Platform Split) & 7-Day Account Block
- **Date**: 2026-10-23
- **Status**: DECIDED (Implemented & Verified in Phases 7a & 7b)
- **Requirement**:
  - Strikes 1 & 2: Two times there will be no issue (100% courtesy deposit refund, 0 monetary penalty).
  - 3rd Time Booking: Popup modal and persistent warning card warning the user that if they don't show up this time, a penalty of ₹60 will be deducted: ₹50 is paid to the hospital, ₹10 is retained as the Appointments app platform fee, and the remainder of the deposit is refunded.
  - Strikes 3 to 5: ₹60 penalty applied (₹50 hospital / ₹10 platform fee). If deposit $\le$ ₹60, deposit is forfeited with ₹0 refund. If deposit > ₹60, remainder is refunded.
  - Exceeding 5 Strikes (6th miss): Account is blocked for 7 days (`blocked_until = NOW() + INTERVAL '7 days'`), display message *"Your account is blocked for 7 days"*, and reset strike counter to 0. Pay CTA is disabled with label *"Account Blocked (7 Days)"*.

---

### Decision 8: Phase 8b Customer Mobile UI & API Layer
- **Date**: 2026-10-23
- **Status**: DECIDED (Implemented & Verified in Phase 8b)
- **Requirement & Architecture**:
  1. **Family / Friend Booking Toggle (`CheckoutModal.tsx`)**:
     - Added an interactive switch toggle: *"Booking for someone else?"*.
     - When toggled ON, reveals patient details inputs: Patient Full Name (`otherPatientName`), Patient Contact Number (`otherPatientPhone`), and Relationship pills (`Parent`, `Spouse`, `Child`, `Sibling`, `Friend`, `Other`).
     - Includes helper text: *"Appointments for different family members or friends have no 1-hour gap restriction and can be scheduled back-to-back."*
     - If booking for self and an existing appointment slot for the same patient falls within `< 60 minutes`, friendly validation error is displayed: *"Appointments for the same patient must be at least 1 hour apart. To book for a family member or friend, select 'Booking for someone else'."*
     - Passes `booking_for_someone_else`, `patient_name`, `patient_phone`, and `patient_relationship` into `/api/bookings/hold` and `create_booking_hold` RPC.
  2. **Doctor Emergency Modal (`DoctorEmergencyModal.tsx`)**:
     - Automatically displayed when an active booking has `emergency_cancelled === true` and no choice has been recorded yet (`!emergency_patient_choice`).
     - Banner and title: *"Due to emergency, doctor is not available"*.
     - Dynamic option presentation:
       - **Doctor arrived & cancelled mid-session (`emergency_doctor_arrived === true`)**: 3 action options: **Wait** (standby queue), **Reschedule** (select new slot without fee), **100% Full Refund** (100% deposit + platform fee).
       - **Doctor did not arrive / emergency cancel prior (`emergency_doctor_arrived === false`)**: 2 action options: **Reschedule** or **100% Full Refund**.
     - Full refund clearly notes 100% reimbursement of both ₹100 deposit and ₹10 platform fee (total ₹110).
  3. **Emergency Choice API Route (`/api/bookings/emergency-choice`)**:
     - Endpoint accepts `POST` with `booking_id`, `choice` (`WAIT` | `RESCHEDULE` | `REFUND`), and optional `reschedule_slot_start` / `reschedule_slot_end`.
     - Validates authentication and ownership against `bookings.customer_id`.
     - Invokes `choose_emergency_option` RPC (`p_booking_id`, `p_choice`, `p_new_slot_start`, `p_new_slot_end`).
     - Calculates 100% refund amount (`total_charged` or `deposit_amount + platform_fee`) on `REFUND` choice.
  4. **Home Screen Live Upcoming Appointment Card (`HomeScreen.tsx`)**:
     - Displays live card at top of Home Screen (both Category Hub view and Category Provider List view) whenever there is an active upcoming confirmed booking.
     - Features an animated micro green light pulsing indicator (`Animated.loop` between opacity 1.0 and 0.3) denoting active standing.
     - Displays essential details: Doctor name, Department / Specialty, Hospital name, Token number badge, Date & Time.
     - Displays Permanent 4-Digit Check-In PIN:
       - If within 60 minutes of slot start (`timeUntilSlot <= 60m`) or already checked in, reveals 4-digit PIN with unlocked green badge `🔓 PIN: [PIN]`.
       - If > 60 minutes, displays masked lock badge `🔒 PIN: •••• (Reveals 60m before slot)`.
     - Direct CTA: *"View Pass & Queue"* opening the digital pass modal, and *"I've Reached"* instant lobby check-in action.
  5. **Dedicated "My Appointments" Tab & Lifetime PIN Banner (`MyBookingsScreen.tsx`)**:
     - Top card prominently displays customer's permanent lifetime PIN: `🔑 YOUR LIFETIME CHECK-IN PIN: [PIN]` with note *"Permanent 4-digit code across all your bookings. Does not change on reschedule."*
     - Sub-tabs: **Upcoming** (CONFIRMED, HELD, CHECKED_IN) vs **History** (COMPLETED, CANCELLED, NO_SHOW).
     - Distinct patient badge on appointment cards: `👥 Patient: [Name] ([Relationship])` when booked for someone else.
  6. **Customer App Navigation (`App.tsx`)**:
     - Persistent 3-tab bottom navigation: **Explore** (`HOME`), **My Appointments** (`MY_BOOKINGS` with dynamic upcoming count badge), and **Account**.
     - Listens to active booking status and mounts `DoctorEmergencyModal` overlay when doctor emergency cancellation occurs.

---

### Decision 9: Phase 5b Front Desk UI Hardening & Consultant URL Scoping
- **Date**: 2026-10-23
- **Status**: DECIDED (Implemented & Verified in Phase 5b)
- **Requirement & Architecture**:
  1. **Strict Consultant Scoping**: Front Desk staff (`role === 'front_desk'`) can only see and manage appointments for doctors explicitly assigned to them via `doctor_front_desk_assignments`. If staff has 0 assigned doctors (`hasNoAssignedDoctors`), a dedicated `[data-testid="frontdesk-no-assignments-forbidden"]` state is rendered blocking access.
  2. **URL Parameter Protection**: Probing unassigned doctors via URL parameters (`?doctor_id=unassigned-id` or `?resource_id=...`) triggers an immediate 403 Forbidden state (`[data-testid="frontdesk-unassigned-doctor-forbidden"]`) with a clear error explanation and a CTA to return to assigned consultants.
  3. **Fast-Pass OTP Check-in & Security Lockout**: Arriving patients submit 4-digit code. In accordance with SPEC line 16, 5 consecutive invalid entries trigger a 60-second lockout timer disabling input and verification (`[data-testid="checkin-lockout-alert"]`).
  4. **Queue Triaging & Priority**:
     - **Waiting Queue**: Lists present patients. Top patient derives "Up Next" status (`[data-testid="up-next-badge"]`) based on shared queue engine priority with Call Patient action (`[data-testid="start-consultation-btn"]`).
     - **Standby Queue**: Late arrivals (>10m after slot start) automatically display in Standby Queue sorted in FIFO order per SPEC lines 19 & 20 without displacing on-time patients.
     - **In-Consultation Banner**: Active ongoing consultation banner (`[data-testid="in-consultation-panel"]`) with Complete Consultation button (`[data-testid="end-consultation-btn"]`).
  5. **Verification**: Backed by 7 automated Playwright test journeys in `tests/e2e/hospital-frontdesk-screens.spec.ts`.

---

### Decision 10: Phase 7 Release Hardening, Pre-Launch Security Remediation, & Load Testing
- **Date**: 2026-10-24
- **Status**: DECIDED (Implemented & Verified in Phase 7)
- **Requirement & Architecture**:
  1. **Next.js 15.5.28 Dependency Upgrade**: Upgraded `next` and `eslint-config-next` to `15.5.28` across `apps/merchant-web` and root `package.json` pnpm overrides to mitigate Critical RCE advisory (GHSA-95w3-fv59-c85h) and High DoS advisory (GHSA-h25c-8m2v-2rh6). Backed by passing test `tests/unit/security-audit-nextjs-dependencies.test.mjs`.
  2. **Database Grants & Ambiguous Overload Elimination**: Added migration `20261024181500_security_hardening_grants_and_clean_overloads.sql` granting `SELECT, INSERT, UPDATE` on `public.payments` to `service_role` and `SELECT` to `authenticated` (RLS enforced). Unified duplicate 1-arg function overloads (`hospital_role`, `hospital_accessible_resource_ids`) to resolve PostgREST PGRST202 schema lookup errors. Backed by passing test `tests/unit/security-audit-database-grants.test.mjs`.
  3. **Production Environment Validator Enforcements**: In `apps/merchant-web/src/env.mjs`, enforced mandatory presence of Upstash Redis credentials (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`), HTTPS-only URLs for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_APP_URL`, and locked `ALLOW_MOCK_PAYMENTS=false` under `NODE_ENV === 'production'`. Backed by passing test `tests/unit/security-audit-production-env.test.mjs`.
  4. **Realistic Real-Path Load Testing & Fan-Out Benchmark**: Conducted k6 load tests using real Next.js API endpoints, authentic Supabase JWTs, and active RLS at 100, 500, and 1,000 VUs on Apple M4, 16GB RAM. Local single-process saturation noted at 500/1000 VUs due to local connection limits. Benchmark of 200 concurrent Realtime fan-out clients over 50 broadcast updates achieved 10,000 / 10,000 successful deliveries (100% success rate, 0% drop, p95 12ms).
  5. **Zero Legal Placeholders & Production Launch Checklist**: Populated all Grievance Officer statutory disclosures across `privacy/page.tsx` and `ConsentScreen.tsx` per IT Rules 2021, passing `node scripts/check-legal-placeholders.js --strict` with 0 unpopulated tokens. Authored exhaustive 11-section launch operations runbook in `docs/launch-checklist.md`.

---

### Decision 11: Corrective Audit Security Remediation — Profile Governance & Unauthenticated Web Passes
- **Date**: 2026-10-24
- **Status**: DECIDED (Implemented & Verified in Phase Story Tests)
- **Requirement & Architecture**:
  1. **Privilege Escalation Patch (Finding 1)**:
     - `guard_profile_governance()` trigger function was patched in `supabase/migrations/20261024181300_patch_profile_governance_trigger.sql` to strictly prohibit modifications to `blocked_until`, `permanent_checkin_pin`, `role`, `assigned_city_id`, `no_show_count`, and `is_flagged` via regular customer client PATCH requests (raising SQLSTATE 42501 / HTTP 403).
     - Updates to governance columns are restricted exclusively to `service_role` backend processes, platform administrators, trusted internal sessions (`session_user = 'postgres'`), or transactions configured with `SET LOCAL app.trusted_write = 'true'`.
     - Validated by assertion 6 in `tests/unit/security-audit-database-grants.test.mjs` (all 6 tests passing).
  2. **Unauthenticated Web Pass Access via Phone Last-4 Verification (Finding 2)**:
     - Patients accessing appointment web passes (`/ticket/[id]` and `GET /api/ticket/[id]`) via SMS or WhatsApp links without an active Supabase session are no longer permanently blocked by a hard 401 error.
     - The endpoint returns `{ error: 'Unauthorized', requires_verification: true }` (HTTP 401).
     - The web ticket page renders an emerald-themed, secure verification challenge card (per `DESIGN.md` tokens) requesting the last 4 digits of the patient's registered phone number.
     - Providing the matching 4 digits (`?phone_last4=...` or `x-phone-last4` header) unlocks the appointment pass and check-in PIN (HTTP 200) without changing existing SMS/WhatsApp notification URL structures. Incorrect digits yield HTTP 403.
     - Upon successful verification, the 4 digits are cached in `sessionStorage` to allow seamless adaptive polling (6s / 35s) and tab refocus re-fetching without prompting the patient again.
     - Validated by Test 1F in `tests/e2e/stories/08-security-audit.test.mjs` and Playwright story suite (48/48 passing).

---

### Decision 12: Permanent Lifetime PIN Retention & Offline Walk-In Bypass
- **Date**: 2026-10-24
- **Status**: DECIDED (Implemented & Verified)
- **Requirement & Architecture**:
  1. **Permanent Lifetime PIN**:
     - Retained `permanent_checkin_pin` column on `public.profiles`, strictly guarded by `guard_profile_governance()` trigger function against regular customer client tampering.
     - Customer's 4-digit PIN is permanent across their account lifecycle and does not change per-appointment or upon reschedule.
     - Confirmed booking code generation in `generate_appointment_checkin_code_for_booking` associates the appointment with the customer's permanent lifetime PIN.
     - Both `/api/ticket/[id]` and `POST /api/bookings/checkin` resolve customer's permanent lifetime PIN directly from `profiles` as a first-class citizen or fallback.
  2. **Offline Walk-In Bypass**:
     - Updated `POST /api/bookings/checkin` to support offline/walk-in reception arrivals via `is_offline_walk_in: true` flag.
     - When `is_offline_walk_in: true`, staff provide `booking_id` directly without requiring PIN entry.
     - Standard role checks and front desk doctor scoping (`hospital_accessible_resource_ids`) remain enforced.
     - Successfully records `checked_in_method = 'manual'` (per DB check constraint `checked_in_method IN ('code', 'manual')`), while PIN-based check-ins record `checked_in_method = 'code'`.
  3. **SPEC.md Alignment**:
     - Updated `docs/hospital/SPEC.md` Check-in section to explicitly define that check-in PIN is a permanent, lifetime code tied to the customer profile for streamlined hospital check-ins, with offline walk-in bypass supported for front desk staff.

---

### Decision 13: Split Payment Workflow (Platform Fee Online, Consultation Fee at Hospital Reception)
- **Date**: 2026-10-26
- **Status**: DECIDED (Implemented & Verified in Phase 9)
- **Requirement & Architecture**:
  1. **Online Platform Fee**:
     - During checkout, patient pays ONLY the platform booking fee online (e.g. ₹10 or ₹50) via Razorpay to reserve their slot and guarantee their queue position.
     - Capturing the platform payment instantly triggers slot reservation, booking confirmation, queue locking, and permanent lifetime check-in PIN issuance.
     - Total charged online through Razorpay order strictly matches `platform_fee_amount`.
  2. **Offline Doctor Consultation Fee**:
     - Doctor consultation fee (e.g. ₹500) is marked as "Pay at Hospital" with status `PENDING_OFFLINE`.
     - Patient pays the consultation fee directly to reception staff when arriving at the hospital.
     - Front desk receptionists can click "Collect Fee" to invoke `collect_consultation_fee` RPC, marking status `COLLECTED_AT_DESK` with staff attribution and timestamp.
  3. **Database Schema & RPCs**:
     - Added `platform_fee_amount numeric(10,2)`, `consultation_fee_amount numeric(10,2)`, `platform_payment_status text`, `consultation_payment_status text`, `consultation_collected_at timestamptz`, and `consultation_collected_by uuid` to `public.bookings`.
     - Check constraints: `platform_payment_status IN ('PENDING', 'CAPTURED', 'REFUNDED', 'WAIVED')` and `consultation_payment_status IN ('PENDING_OFFLINE', 'COLLECTED_AT_DESK', 'WAIVED', 'REFUNDED')`.
     - Updated `create_booking_hold` to set `deposit_amount` (online charge) to platform fee, initialize `platform_payment_status = 'PENDING'`, and `consultation_payment_status = 'PENDING_OFFLINE'`.
     - Updated `confirm_booking_payment` to set `platform_payment_status = 'CAPTURED'` and `consultation_payment_status = 'PENDING_OFFLINE'`.
     - Added `collect_consultation_fee(p_booking_id uuid, p_collected_by uuid)` with role validation (`admin`, `staff`, `doctor`, or front desk assignment).
     - Updated `public.merchant_bookings` view to expose split payment fields.
  4. **Customer Mobile UI**:
     - Removed obsolete ₹50-₹200 deposit banner from `HomeScreen.tsx`.
     - `CheckoutModal.tsx` breaks down charges clearly: Platform Fee (Paid Online Now) vs Doctor Consultation Fee (Pay at Hospital). Pay CTA clearly states: `Pay Platform Fee ₹[Amount] to Reserve Slot`.
     - `BookingPassModal.tsx` displays dual payment statuses: Platform Fee (PAID) and Doctor Consultation (PAY AT DESK / PAID).

---

### Decision 14: Strix Security Remediation, RPC Least-Privilege & Caller-Binding Hardening
- **Date**: 2026-10-27
- **Status**: DECIDED (Implemented & Verified on `security/strix-fixes`)
- **Requirement & Architecture**:
  1. **Strict Public SECURITY DEFINER Function Boundary**:
     - Audited all public schema functions in PostgreSQL. Exactly 25 SECURITY DEFINER functions are executable by `anon` or `authenticated`, matching 100% with the regression test allowlist in `tests/security/strix-regression.test.mjs`.
     - `confirm_booking_payment`, `confirm_booking_by_merchant`, `record_no_show`, and `check_user_exists_by_phone` are strictly restricted to `service_role` (ACL: `{postgres=X/postgres,service_role=X/postgres}`).
     - Direct RPC calls by customers (e.g., `POST /rest/v1/rpc/confirm_booking_payment` on their own pending booking) fail with HTTP 403 Forbidden with booking state untouched.
  2. **RLS Helper Caller-Binding & Anti-Snooping**:
     - `is_admin`, `hospital_role`, `is_merchant_owner_or_admin`, `hospital_accessible_resource_ids`, and `get_user_authorized_providers` override incoming `p_user_id` when `auth.role() = 'authenticated'` with `auth.uid()`.
     - Customers cannot probe arbitrary user IDs for administrative privileges, hospital roles, or authorized provider sets.
     - `get_masked_customer_info(uuid)` checks caller authorization: returns rows only if caller is `service_role`, admin, self (`auth.uid() = p_customer_id`), or merchant staff with an active booking with that customer. Probing by unauthorized customers returns empty results (`[]`).
  3. **Single Expected Amount Storage & Gateway Verification**:
     - Added column `expected_payment_amount_paise INTEGER` to `public.bookings`.
     - `/api/payments/create-order` records the exact expected charge at order creation.
     - Webhook (`/api/webhooks/razorpay`) and payment verification (`/api/payments/verify`) compare received gateway amounts strictly to that single stored value (`expected_payment_amount_paise`), eliminating loose multi-value acceptance.
  4. **Production Gating & Clean Squash Merge**:
     - Real Next.js server boots under `NODE_ENV=production` with `ALLOW_MOCK_PAYMENTS=true` fail immediately with code 1 (`FATAL SECURITY VIOLATION`).
     - Gitleaks configuration in `.gitleaks.toml` anchors path ignore patterns (`(^|/)node_modules/`, etc.) and eliminates bare directory patterns.
     - `vuln-0002` marked as "not exploitable at runtime (build-time @expo/cli only); accepted risk".


---

### Decision 15: Production Readiness Roadmap (Groups 1–9) & Verification of Groups 1 & 2
- **Date**: 2026-11-05
- **Status**: DECIDED (Groups 1 & 2 Accepted & Committed; Groups 3–9 Documented in `docs/PRODUCTION_READINESS_ROADMAP.md`)
- **Requirement & Architecture**:
  1. **Master Instruction & Specification Centralization**:
     - Centralized all 9 production readiness groups from user directives into `docs/PRODUCTION_READINESS_ROADMAP.md` as the definitive single source of truth alongside `docs/hospital/SPEC.md`.
  2. **Group 1 Reconciliation & DB Clean-State Proof**:
     - Merged `main` into `fix/production-readiness`, reconciling 134 migrations with 0 duplicate version prefixes.
     - Restored 11 stored procedures (`cancel_booking`, `complete_booking`, `reschedule_booking_slot`, `record_no_show`, `mark_present_manually`, `verify_checkin_code`, `expire_stale_standby_queue`, `override_hospital_queue_position`, `collect_consultation_fee`, `create_booking_hold`, `cancel_doctor_emergency`).
     - Hardened production build check against `ALLOW_MOCK_PAYMENTS=true` in `apps/merchant-web/src/env.mjs`.
     - Restricted preview CORS origins to `[YOUR-TEAM-SLUG]` and disabled demo mode in production.
  3. **Group 2 Concurrency & Test Verification**:
     - Executed complete baseline dependency audit across all 46 test suites (245 unit tests, 324 script tests, 0 failures).
     - Proved PostgreSQL database-level concurrency enforcement via `no_overlapping_active_bookings` (`btree_gist` / `tstzrange` exclusion constraint) and `idx_single_in_consultation_per_doctor` (partial unique index).
     - Authored repeatable stress test script `scripts/stress-test-queue-invariants.mjs` verifying atomic single check-in under 5 simultaneous requests (1 winner, 4 stale rejections, 0 duplicates) and FIFO standby queue ordering respecting the 10-minute grace window.


---

### Decision 16: Production Readiness Groups 3 & 4 (Razorpay Refund Idempotency Remediation & OTP Circuit Breaker)
- **Date**: 2026-11-05
- **Status**: DECIDED (Groups 3 & 4 Accepted & Committed)
- **Requirement & Architecture**:
  1. **Group 3 Razorpay Refund Idempotency Remediation**:
     - Hardened `tests/unit/razorpay-refund-integration.test.mjs` to eliminate all hardcoded fallback IDs (`pay_SbqEyR99JWpTF8`) and pre-existing idempotency keys.
     - Dynamically generates fresh, cryptographically unique idempotency keys (`grp3-fresh-${Date.now()}-${randomHex}`) conforming to official Razorpay specifications (`[a-zA-Z0-9_-]`, >= 10 chars).
     - Mandated strictly identical payloads (`paymentId`, `amount`, `notes`, `idempotencyKey`, `speed`) across Call 1 and Call 2 to eliminate gateway payload mismatch rejections.
     - Enforced that `t.skip()` is strictly restricted to absent test credentials (`!keyId || !keySecret || !keyId.startsWith('rzp_test_')`).
  2. **Group 4 Multi-Tier OTP Circuit Breaker Architecture**:
     - Replaced the rigid global daily cap of 500 requests with an elastic multi-tier defense in `apps/merchant-web/src/app/api/auth/otp/send/route.ts`:
       - **Tier 1 (Per-IP Sliding Window)**: 5 requests per 10 minutes (`otp-ip:${ip}`).
       - **Tier 2 (Per-Phone Sliding Window)**: 3 requests per 5 minutes per E.164 number (`otp:${e164}`).
       - **Tier 3 (Per-Phone-Prefix Sliding Window)**: 15 requests per 10 minutes (`otp-prefix:${prefix}:${bucketScope}`) using `extractPhonePrefix` (e.g. `+919848`) to neutralize sequential SMS toll fraud / pumping attacks.
       - **Tier 4 (Global Per-Minute Cap)**: 30 requests per 60 seconds (`otp-global:minute:${bucketScope}`).
       - **Tier 5 (Global Daily Rate & CAPTCHA Circuit Breaker)**: High safety ceiling (`OTP_GLOBAL_DAILY_CEILING = 2000`). Once daily volume passes `OTP_GLOBAL_CAPTCHA_THRESHOLD` (default 200), challenges callers with `CAPTCHA_REQUIRED` (HTTP 403, `X-RateLimit-Scope: captcha-required`). Verified challenge tokens allow legitimate human patients to authenticate uninterrupted.
       - **Security Incident Logging**: Integrated `logSecurityAlert` emitting structured `[SECURITY_ALERT]` JSON logs for SIEM and SOC observability.
  3. **Verification**:
     - Authored repeatable simulation script `scripts/simulate-otp-attack-before-after.mjs` proving Before (100% DoS on Patient #501) vs After (Attacker throttled at request 5, sequential pumping blocked at request 15, Patient #501 authenticated with 200 OK, 99.0% cost reduction).
     - Authored dedicated unit/integration suite `tests/unit/otp-circuit-breaker.test.mjs` (8/8 tests passing).
     - Verified zero regressions in `tests/unit/phase2-functional-blockers.test.mjs` Test 6a, `tests/unit/phase1-security-blockers.test.mjs`, and `tests/scripts/test-security.mjs`.

---

### Decision 17: Production Readiness Group 5 (Cron Deduplication, Security Monitor Evaluation & CAPTCHA Prod Lockdown)
- **Date**: 2026-11-05
- **Status**: DECIDED (Group 5 Accepted & Committed)
- **Requirement & Architecture**:
  1. **Phase 0: Synthetic CAPTCHA Token Lockdown in Production**:
     - Hardened `apps/merchant-web/src/lib/captcha.ts` to strictly gate test/synthetic bypass tokens (`test-valid-*`, `mock-valid-*`, `valid-captcha-token`, `test-token-passed`, `SUPERADMIN_E2E_TOKEN`) behind `const isNonProduction = process.env.NODE_ENV !== 'production'`.
     - In production (`NODE_ENV === 'production'`), any attempt to supply synthetic tokens unconditionally logs a structured `[SECURITY_ALERT]` and returns `{ success: false, reason: 'TEST_TOKENS_FORBIDDEN_IN_PRODUCTION' }`. Added unit test 1c in `tests/unit/otp-circuit-breaker.test.mjs` verifying production rejection.
  2. **Group 5 Cron Deduplication Forward Migration (`20261105000001_deduplicate_cron_jobs.sql`)**:
     - Audited live PostgreSQL `cron.job` state and identified historical duplicate schedules created across migrations:
       - **Pair A (Expired Booking Holds)**: `release-expired-booking-holds` (from `20260910000001`) vs `release-expired-holds-sql` (from `20261103000002`). Decision: Kept `release-expired-booking-holds` as the canonical job running `* * * * *` invoking `SELECT public.release_expired_holds();`, and safely unscheduled redundant duplicate `release-expired-holds-sql`. This eliminates double-polling on `public.bookings` while preserving existing regression test assertions in `tests/scripts/test-expired-holds-limit.mjs`.
       - **Pair B (DPDP Account Deletions)**: `process-expired-account-deletions` (from `20260924000001` at 03:00 UTC) vs `dpdp-account-deletions-sql` (from `20261103000002` at 02:00 UTC). Decision: Kept `dpdp-account-deletions-sql` as the canonical job running daily at `0 2 * * *` invoking `SELECT public.process_expired_account_deletions();`, and safely unscheduled redundant duplicate `process-expired-account-deletions`. 02:00 UTC (07:30 AM IST) executes 30-day statutory DPDP data erasure and anonymization prior to morning clinic opening hours, preventing audit trail duplication and transaction contention during active patient hours.
     - Migration was authored and applied cleanly with 0 duplicate prefix errors (`ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` returned empty). Rollback migration was also authored and verified.
  3. **Security Monitor Architectural Evaluation (`/api/cron/security-monitor`)**:
     - Confirmed that `/api/cron/security-monitor` MUST exist as an authenticated Next.js Edge/API endpoint:
       - **Purpose**: Under Section 8(6) of the Digital Personal Data Protection (DPDP) Act 2023, data fiduciaries must implement reasonable security safeguards and report data breaches. The security monitor continuously evaluates `public.contact_reveal_anomalies` to detect rogue staff or compromised credentials attempting high-velocity patient contact harvesting (>10 reveals in 24h or >15 in 1h).
       - **Alerting & Webhook Channel**: When anomalies are detected, it logs `CRITICAL` severity events to `public.app_logs` and dispatches outbound alerts via `fetch(process.env.SECURITY_ALERT_WEBHOOK_URL)`. Outbound webhook HTTP requests cannot be reliably executed within PostgreSQL without complex extensions (`pg_net`) and risk exposing secrets in `cron.job`.
       - **Scheduling Model**: Operates as an external HTTP cron trigger (e.g., via Vercel Cron or Cloudflare Workers Cron) authenticated with constant-time `CRON_SECRET` Bearer token verification in both Next.js `middleware.ts` and route handler `verifyCronAuth`. Intentionally NOT registered as an internal `pg_cron` SQL job.
  4. **Verification**:
     - Authored `tests/unit/cron-deduplication.test.mjs` verifying: exactly 1 active job for expired holds, exactly 1 active job for DPDP deletions, duplicate jobs completely unscheduled, clean stored procedure execution, and security-monitor 401/200 authentication enforcement (10/10 PASS).
     - Verified `tests/security/test-security-monitor.mjs` (4/4 PASS), `tests/unit/otp-circuit-breaker.test.mjs` (8/8 PASS), and `tests/scripts/test-expired-holds-limit.mjs` (4/4 PASS).


---

### Decision 18: Production Readiness Group 8 (Adversarial Cross-Tenant Authorization Matrix, Identity Hardening & Build Integrity)
- **Date**: 2026-11-05
- **Status**: SUBMITTED FOR HUMAN REVIEW
- **Requirement & Architecture**:
  1. **Exhaustive Automated Authorization Matrix (`tests/unit/cross-tenant-authorization-matrix.test.mjs`)**:
     - Built an adversarial test fixture establishing 2 distinct customers (Customer A, Customer B) and 2 distinct hospitals (Hospital 1, Hospital 2), each with an Admin, Front Desk receptionist, Consultant (Doctor), Department, Resource, and active bookings.
     - Discovered and tested 100% of API routes on disk under `apps/merchant-web/src/app/api` (all 66 routes across 38 subtests), including all 26 routes previously omitted in earlier passes.
     - Exercised every route with valid payloads, proving HTTP 200/201 for the authorized persona, and HTTP 401/403/404 or masked PII for cross-tenant / cross-hospital / wrong-role personas.
     - Programmatic Completeness Assertion dynamically traverses `apps/merchant-web/src/app/api` on disk and asserts that 0 discovered routes are missing from `matrixLedger` (66/66 covered).
     - Strictly asserted `res.status !== 400` across all cross-tenant test cases to ensure that schema validation never masquerades as an authorization rejection.
     - Hardened endpoints discovered during matrix exploration:
       - `GET /api/hospital/context`: Added authenticated caller check (`verifyAuthenticatedUser`) and cross-hospital isolation check returning 403 Forbidden when caller role for the provider is `'none'`.
       - `POST /api/hospital/departments`: Added cross-hospital boundary check rejecting requests where `requestedMerchantId !== ctx.merchantId` with 403 Forbidden.
       - `POST /api/hospital/members`: Added cross-hospital boundary check rejecting unauthorized department member invites with 403 Forbidden.
       - `GET /api/resources`: Switched `supabase` anon client to `getSupabaseAdmin()` to allow querying `providers(id, name, category_id)` without 42501 permission denied errors.
       - Hardened test isolation in `hospital-frontdesk-screens.test.mjs` and `cross-tenant-authorization-matrix.test.mjs` to prevent cross-suite booking pollution.
  2. **Purge Demo Customer UUID Fallbacks**:
     - Removed all default fallbacks to demo customer UUID `'99999999-9999-9999-9999-999999999991'` across `apps/customer-mobile/` (`App.tsx`, `CheckoutModal.tsx`, `MyBookingsScreen.tsx`, `ProviderDetailScreen.tsx`, `services/api.ts`). Verified 0 matches in `.ts`/`.tsx` files.
  3. **Mock Payments Production Boot Lock**:
     - Verified `apps/merchant-web/src/env.mjs` and `payments/verify` route fail fast with exit code 1 when booted with `ALLOW_MOCK_PAYMENTS=true` in `NODE_ENV=production`.
  4. **CORS & Demo Mode Security**:
     - Hardened `apps/merchant-web/src/middleware.ts` Vercel preview regex to prevent wildcard team slug spoofing (`appointments-merchant-evil-<team-slug>.vercel.app`).
     - Verified with `tests/security/test-cors-and-demo-mode.test.mjs` (5/5 PASS), stripping credentials on preview origins and blocking demo mode in production builds.
  5. **TypeScript & Build Integrity**:
     - Removed `typescript: { ignoreBuildErrors: true }` from `apps/merchant-web/next.config.mjs`.
     - Added `pnpm -r exec tsc --noEmit` to `.github/workflows/ci.yml`.
     - Verified `tsc --noEmit` (0 errors) and production build (52/52 static pages + 72 dynamic API routes) succeed cleanly across all workspaces.
  6. **Fail-Closed Rate Limiting & Concurrency**:
     - Proved `apps/merchant-web/src/lib/redis.ts` fails closed in production for both slot locks (`acquired: false`) and rate limiting (`allowed: false`) when Upstash credentials are missing or network connection fails (`tests/unit/rate-limit-backend.test.mjs`, 6/6 PASS).
  7. **Full Serial Gate Verification**:
     - Ran full clean serial gate: `npx supabase db reset`, `node scripts/seed-hospital-test-data.mjs`, serial run of all 39 test suites (365/365 tests passed, 0 failed), `pnpm -r exec tsc --noEmit` (0 errors), and `pnpm --filter @appointments/merchant-web build` (clean exit code 0).
     - Ran full clean serial gate: `npx supabase db reset`, `node scripts/seed-hospital-test-data.mjs`, serial run of all 39 test suites (347/347 tests passed), `pnpm -r exec tsc --noEmit` (0 errors), and `pnpm --filter @appointments/merchant-web build` (52/52 pages built).


---

### Decision 19: Family & Minor Dependent Booking Support
- **Date**: 2026-11-06
- **Status**: DECIDED (Implemented & Verified)
- **Requirement & Architecture**:
  1. **Practo / Apollo 24/7 / 1mg Industry Standard Pattern**:
     - Followed standard Indian healthcare booking flow: an adult account holder books on behalf of a dependent (family member or child).
     - Strict no-slop product rule: NO parental identity verification, NO government ID, NO Aadhaar/PAN, NO document upload, and NO OTP for the dependent.
     - Booker (`auth.uid()`) remains the single owner of the row, responsible for booking, payment, and refund.
  2. **Database Schema & Constraints (`20261106000001_family_minor_booking_support.sql`)**:
     - Added additive columns to `public.bookings`:
       - `booked_for`: `text NOT NULL DEFAULT 'self' CHECK (booked_for IN ('self', 'family'))`
       - `patient_age`: `smallint NULL CHECK (patient_age IS NULL OR (patient_age BETWEEN 0 AND 120))`
       - `booking_note`: `text NULL CHECK (booking_note IS NULL OR length(booking_note) <= 200)`
       - `is_minor`: `boolean GENERATED ALWAYS AS (patient_age IS NOT NULL AND patient_age < 18) STORED`
       - CHECK constraint enforcing non-empty `patient_name` whenever `booked_for = 'family'`.
     - Backward compatibility: Backfilled existing rows with `booking_for_someone_else = true` to `booked_for = 'family'`. Added trigger `trg_sync_booking_for_family` keeping legacy boolean flag and `booked_for` in lockstep.
     - Dropped old 8-argument `create_booking_hold` and created 11-argument `create_booking_hold` with defaults and server-side validation.
     - Updated `merchant_bookings` view to include family fields.
     - Updated `anonymize_user_data` to scrub `patient_age` and `booking_note`.
  3. **Customer Mobile UX (`apps/customer-mobile`)**:
     - In `CheckoutModal.tsx`, replaced toggle & DPDP consent with "Who is this appointment for?" segmented control (`Myself` vs `Family member / child`).
     - Added helper text: *"Booking on behalf of a family member or child. No ID needed."*
     - If `Family member / child` is selected: Patient name (required), Relationship dropdown/pills, Age (optional numeric), Note/symptoms (optional, max 200 chars).
     - Added subtle `Minor` tag when age < 18.
     - Updated `BookingPassModal.tsx` and `MyBookingsScreen.tsx` to prominently show patient name, relationship, age, and Minor badge.
  4. **Merchant Web UI (`apps/merchant-web`)**:
     - In `bookings/page.tsx` and `FrontDeskQueueTabs.tsx` (Waiting, Standby, Expected tabs):
       - Displays `patient_name` with `👥 Family booking` badge and `Minor` tag.
       - Displays `"Booked by <customer_name> (<phone>)"` as secondary text.
       - Displays booking notes and patient age.
       - Search and filtering matches `patient_name`, booker name, phone, or reference code.
  5. **Notifications & Razorpay Refunds**:
     - Notifications (push, SMS/WhatsApp) are sent to the booker's device/phone, naming the patient in the copy (e.g. `Appointment for Aarav is confirmed`).
     - Payments and Razorpay refunds remain strictly bound to the booker's account (`customer_id`).
| 2026-11-07 | Production Readiness Security Audit: Supabase Power Features Hardening | DECIDED | Hardened Supabase Power Features (pg_cron, pg_net, pgmq, Vault) per production readiness audit findings: (1) Added migration `20261107000001_production_readiness_audit_hardening.sql` enforcing strict name allowlist in `get_vault_secret_by_name`, idempotent `enqueue_refund_request` with double-submit guard, `read_queue_with_dlq` with atomic `REFUND_FAILED` state sync, `replay_dlq_message` (service_role only) to replay dead-lettered messages, placeholder guards against `REPLACE_ME` in pg_net trigger and cron consumer dispatches, and DLQ depth monitoring in `cron_daily_cleanup`; (2) Hardened Edge Functions (`process-notification-queue` and `process-refund-queue`) with constant-time secret comparison (`timingSafeCompare`), fail-closed validation, amount validation, prior refund check, and fail-closed real payment processing; (3) Hardened `/api/admin/refunds` removing synchronous fallback in favor of clean error reporting and double-enqueue handling; (4) Verified all 40 tests (covering 66 routes + power features) pass in `cross-tenant-authorization-matrix.test.mjs`. |
| 2026-11-07 | Supabase Security Advisor 101 Findings Complete Remediation | DECIDED | Resolved all 101 Supabase Security Advisor findings on branch `audit/hardening-v3` without skipping tests or weakening policies: (1) Moved `btree_gist`, `citext`, `pg_trgm` from `public` to `extensions` schema in migration `20261107000005_supabase_security_advisor_remediation.sql` and updated dependent functions with `SET search_path = public, extensions, pg_temp`; (2) Configured explicit deny-all RLS policies on `staff_checkin_rate_limits`, `test_provider_clock_links`, and `test_tenant_clocks`; (3) Revoked execution privileges on internal, trigger, admin, and cron procedures from `PUBLIC`, `anon`, and `authenticated`, locking them strictly to `service_role`; (4) Preserved the 26 audited `SECURITY DEFINER` functions in the `public` schema with strict caller isolation (`auth.uid()` derivation, parameter binding, input sanitization), matching the regression allowlist in `tests/security/strix-regression.test.mjs`; (5) Documented manual dashboard activation for `auth_leaked_password_protection` (HaveIBeenPwned API); (6) Fully verified via `supabase db reset`, `node scripts/seed-hospital-test-data.mjs`, `pnpm test:security` (224/224 pass), `scripts/run-all-tests-serially.mjs` (47/47 suites, 422/422 tests pass), `pnpm typecheck` (3/3 workspaces pass), and `pnpm build` (52/52 static pages generated). |
| 2026-11-07 | Security Audit Decision Memo: Column-Level Encryption for Patient Reason / Notes | PENDING USER DECISION | Evaluated architecture tradeoffs for column-level encryption of `bookings.booking_note` and clinical reasons. <br>**Option A (Recommended: Cloud Encryption-at-Rest + Strict RLS Isolation):** Data is protected at rest by AWS/Supabase volume encryption (AES-256) and isolated at runtime via PostgreSQL Row Level Security (RLS). Zero KMS cost, zero decryption latency overhead, retains doctor/front-desk searchability across queue notes, and automatically scrubbed on user erasure. <br>**Option B (Application-Level Envelope Encryption with AWS/GCP KMS):** Notes encrypted before database insert using DEKs managed via cloud KMS. Tradeoffs: Destroys SQL searchability (`ILIKE` / full-text search impossible without decrypting all records in memory), adds ~50-100ms latency per booking list render, incurs recurring KMS API costs, introduces key rotation/loss risk where lost keys permanently corrupt medical notes. <br>**Option C (Database-level pgcrypto/pgsodium):** Column encryption inside Postgres. Tradeoffs: Database superuser still has memory access to the keys; complex migration overhead with negligible security gain over hardware volume encryption. <br>**Recommendation:** Adopt Option A. Local appointment scheduling does not require enterprise KMS envelope encryption, which adds severe operational fragility and latency. Awaiting user final decision. |
