# Codebase Architecture & Design Drift Report — 2026-11-08

> **Audit Scope**: Complete Codebase Design Documents, Technical Specifications, Architecture PRDs, Security Remediation Plans, Operational Runbooks, and Package READMEs against PostgreSQL Migrations (155 files), Next.js 15 App Router (`apps/merchant-web`), React Native / Expo SDK 58 (`apps/customer-mobile`), Shared Libraries (`packages/shared`), and Test Suites.  
> **Date**: 2026-11-08  
> **Auditor**: Pedantic Technical Quality Auditor (`@egm-codebase-details`)  
> **Format Standard**: Strictly adhering to `egm-drift-report` specification (`## <DESIGN_DOC_NAME>` followed by bulleted divergences or "No drift detected").

---

## docs/hospital/SPEC.md

- **In-App Pass UI Terminology Divergence**: SPEC line 26 mandates a "4-digit check-in PIN", but `apps/customer-mobile/src/screens/BookingPassModal.tsx` line 419 continues to label and describe the code to the customer as an OTP (*"Tell your OTP code below to the front desk upon reaching"*).
- **Previous Documentation Conflicts (Reconciled in this session)**:
  - *No-Show Implementation Status*: Lines 49–50 and 54–56 previously described the no-show policy as pending implementation. SPEC.md has now been updated to document that migration `20261024000001_no_show_tiered_policy_and_account_block.sql` is fully applied and active in `record_no_show`.
  - *Check-in 60m Pre-Slot Gate*: Lines 57–59 previously listed a conflict regarding missing 60m pre-slot visibility. SPEC.md has now been updated to document that server-side masking in `/api/ticket/[id]` and client gating in `BookingPassModal.tsx` are fully resolved.
  - *Retired "+2" Rule*: Conflict 3 in SPEC.md has been reconciled with the formal retirement of `docs/architecture/late-arrival-queue.md`.

---

## docs/hospital/screens-admin.md

- **Missing Dedicated `/hospital` Route**: Section 2 Screen 1 lists Route as `/` (or `/hospital`). In reality, `apps/merchant-web` handles routing through the root route `/` dynamically based on tenant vertical and user role (`apps/merchant-web/src/app/page.tsx`); no dedicated `/hospital` route directory or page exists in `apps/merchant-web/src/app/`.
- **Missing DELETE Method Handler on Departments API**: Screen 2 lists `DELETE /api/hospital/departments` for deleting empty departments. In actual implementation, `apps/merchant-web/src/app/api/hospital/departments/route.ts` only exports `GET`, `POST`, and `PATCH`. The `DELETE` handler is absent from the API route.
- **Roster Revocation Parameter Contract**: Screen 2 lists `DELETE /api/hospital/members?id={id}` as a query parameter request. In reality, `apps/merchant-web/src/app/api/hospital/members/route.ts` parses a JSON request body `{ member_id, provider_id }`. Calling it with query parameters fails with HTTP 400 (`Missing required parameter: member_id`).

---

## docs/hospital/screens-consultant.md

- No drift detected.

---

## docs/hospital/screens-frontdesk.md

- **Direct PostgREST RPC Invocation Divergence**: Screen 1 lists `POST /rest/v1/rpc/mark_present_manually` and `POST /rest/v1/rpc/record_no_show` as directly called by the front desk UI client. In actual implementation, front-desk client interactions are routed through Next.js API endpoints (`POST /api/bookings/reach` and `POST /api/bookings/no-show`), where caller roles and per-consultant assignment gates are evaluated before executing database operations via `supabaseAdmin`.
- **Legacy Parameter in Late-Queue Endpoint**: In `apps/merchant-web/src/app/api/bookings/late-queue/route.ts` (lines 19, 166), request body parsing and responses retain the legacy `buffer_offset = 2` parameter, even though the frontdesk triage spec and shared queue engine operate on dynamic time-fitting gaps without fixed offsets.

---

## docs/hospital/screens-customer.md

- **In-App Presence Badge Terminology**: Section 2 Item 4 and SPEC L26–27 specify a permanent 4-digit check-in PIN, but `apps/customer-mobile/src/screens/BookingPassModal.tsx` (line 419) displays the instruction: *"Tell your OTP code below to the front desk upon reaching"*.
- **Split Payment Fee Structure Omission**: Section 3 Screen 1 (lines 69–71) specifies a single upfront checkout itemizing *"Refundable Booking Deposit: ₹100"* and *"Platform Convenience Fee: ₹25"*. In actual code, split payment was introduced (`bookings.platform_fee_amount`, `bookings.consultation_fee_amount`, and RPC `collect_consultation_fee`), where only the platform booking fee is collected online, and the consultation fee is marked `PENDING_OFFLINE` to be collected at the hospital front desk.

---

## docs/architecture/PRD-hyperlocal-booking-mvp.md

- **Outdated No-Show Threshold**: Section 7 line 114 specifies repeat no-shows as: *"after 4 no-shows within 12 months... a customer's account is flagged and may require phone re-verification or a temporary booking block."* In current reality, this was superseded by the 6-strike tiered policy in `docs/hospital/SPEC.md` and migration `20261024000001_no_show_tiered_policy_and_account_block.sql` (strikes 1–2 courtesy refund, strikes 3–5 ₹60 penalty split ₹50/₹10, 6th strike triggers a 7-day account block with counter reset to 0).
- **Missing Hospital Vertical Personas & Boundaries**: Section 4 lists only Customer, Business/Provider, and Admin personas. It omits the Hospital Admin (owner/in-charge), Front Desk (assigned per doctor), and Consultant roles, as well as the 3-member-per-department limit established in `docs/hospital/SPEC.md`.
- **Category ID Mismatch**: Section 3 lists category name "Hospitals/Clinics", but database seeds (`supabase/seed.sql`) and schema migrations define the canonical primary key as `'clinics'` (with backward-compatible aliasing to `'hospital'` in merchant web).
- **Cancellation & Deposit Terms Divergence**: Section 7 lines 106–108 states that cancellation $>1$ hour before slot start refunds the deposit in full. In the hospital vertical implementation, the platform convenience fee is retained on customer cancellations, and 100% full refunds (deposit + platform fee) are strictly reserved for clinic/doctor emergency cancellations.

---

## docs/architecture/Architecture-hyperlocal-booking-mvp.md

- **Incomplete Monorepo Directory Tree**: Section 6 lines 94–105 omits `apps/backend/` (the Spring Boot backend package present in the workspace).
- **Incorrect Relative Documentation Paths**: Section 6 lines 106–108 lists `PRD-hyperlocal-booking-mvp.md`, `Architecture-hyperlocal-booking-mvp.md`, and `API-Spec-hyperlocal-booking-mvp.md` directly at the repository root, whereas they reside under `docs/architecture/`.
- **Payment Webhook Architectural Divergence**: Section 2 and Section 5 state that payment webhook handling is performed by Supabase Edge Function `handle-payment-webhook`. In actual implementation, Razorpay webhook processing is handled by the Next.js App Router API route `apps/merchant-web/src/app/api/webhooks/razorpay/route.ts`. No `handle-payment-webhook` Edge Function exists in `supabase/functions/`.
- **Missing Supabase Edge Functions Inventory**: Section 5 lists only three functions (`handle-payment-webhook`, `process-booking-cancellation`, `send-notification`). It fails to document the actual deployed Edge Functions in `supabase/functions/`: `crash-alert`, `generate-invoice`, `process-notification-queue`, `process-refund-queue`, `release-expired-holds`, `send-booking-notification`, `whatsapp-auth-hook`, `whatsapp-sender`, and `whatsapp-webhook`.
- **Outdated Double-Booking Constraint Specification**: Section 4 step 5 cites a partial unique index on `(resource_id, slot_start)`. The codebase has upgraded this to a PostgreSQL GiST range exclusion constraint `no_overlapping_active_bookings` on `public.bookings` using `btree_gist` (`resource_id WITH =, tstzrange(slot_start, slot_end) WITH &&`).

---

## docs/architecture/API-Spec-hyperlocal-booking-mvp.md

- **Non-Existent Route Paths & Missing `/api/` Prefix**: Endpoints are documented as root-level paths (e.g. `POST /auth/otp/request`, `POST /bookings/hold`, `POST /business/onboard`, `POST /webhooks/payment`). In the current Next.js full-stack implementation, all endpoints are mounted under `/api/` in `apps/merchant-web/src/app/api/` (e.g. `POST /api/auth/otp/send`, `POST /api/bookings/hold`, `POST /api/merchant/onboard`, `POST /api/webhooks/razorpay`).
- **Complete Omission of Hospital Vertical API Suite**: The specification omits all 20+ hospital vertical routes currently active in `apps/merchant-web/src/app/api/`:
  - `GET /api/hospital/context`
  - `GET`, `POST`, `PATCH` `/api/hospital/departments`
  - `GET`, `POST`, `PUT`, `DELETE` `/api/hospital/members`
  - `POST /api/doctor/emergency-cancel`
  - `POST /api/bookings/emergency-choice`
  - `POST /api/bookings/override`
  - `POST /api/bookings/late-queue`
  - `POST /api/bookings/offline`
  - `POST /api/bookings/reach`
  - `POST /api/bookings/checkin`
  - `POST /api/bookings/reassign`
  - `POST /api/bookings/reorder`
  - `POST /api/bookings/collect-fee`
  - `GET /api/slots/availability`, `GET /api/slots/booked`
  - `POST /api/prescriptions/signed-url`
  - `GET /api/ticket/[id]`
  - `GET /api/customer/queue-and-history`
  - `POST /api/cron/security-monitor`
  - `POST /api/cron/release-holds`
  - `POST /api/account/delete`, `POST /api/account/export`
- **Booking Status Transition Contract**: Documents `POST /business/bookings/{bookingId}/status` taking a status body `{ status: "ACCEPTED" | "REJECTED" | "COMPLETED" | "NO_SHOW" }`. In actual code, state transitions are handled via discrete RPC-backed route handlers: `/api/bookings/admit`, `/api/bookings/start`, `/api/bookings/end`, `/api/bookings/complete`, and `/api/bookings/no-show`.
- **Payment Redirection Contract**: Documents `POST /bookings/{bookingId}/pay` returning `{ paymentUrl, paymentId }` for external gateway redirect. In actual code, payment order creation and signature verification use client-side Razorpay SDK flows via `POST /api/payments/create-order` and `POST /api/payments/verify`.

---

## docs/architecture/late-arrival-queue.md

- **Entire Document Governed Retired "+2 Buffer" System (Formally Retired in this session)**: The document specified placing late patients after a static 2-appointment buffer (`ongoing + 2`), sending notification *"You will be sent after 2 member appointments (Estimated wait: ~X mins)"*, and displaying `⏰ Late Arrival (+2 Buffer: Turn #X)` in the UI.
  - Per `docs/hospital/SPEC.md` line 40: *"The old '+2 appointments later' late-queue rule is retired."*
  - The document has now been formally marked as `[RETIRED / DEPRECATED]`, with explicit reference to `HospitalDepartmentQueueEngine.ts` and `evaluateConsultantQueue` in `@appointments/shared`.
- **Legacy Parameters Persisting in Route**: `apps/merchant-web/src/app/api/bookings/late-queue/route.ts` (lines 19, 166) retains `buffer_offset = 2` as a request parameter and return payload even though the underlying queue logic delegates to `evaluateConsultantQueue`.

---

## docs/architecture/concurrency-and-financial-state-machine.md

- **Historical Migration Modification Proposal**: Lines 44–45 proposed *"Synchronizing historical migrations 20260908000001_initial_schema.sql and 20260924000003_remediation_fixes_and_grants.sql"*. This directly violates Standing Rule 5 (*"Never edit an old migration. Every database change is a new migration or seed"*). The actual codebase implemented the constraint via forward migration `20260929000001_concurrency_and_financial_state_machine.sql`.
- **Test Suite Path Divergence**: Section "Verification Plan" line 98 references running `node test-concurrency.mjs` at repository root. The test suite is located at `tests/scripts/test-concurrency.mjs`.

---

## docs/architecture/merchant-tenant-isolation.md

- **Omission of Hospital Department and Consultant Scoping**: The document models tenant isolation solely via `public.merchant_memberships` (`user_id -> provider_id`). It does not account for the hospital vertical's granular sub-tenant isolation: `public.department_members` (max 3 staff per department) and `public.doctor_front_desk_assignments` (front desk assigned exclusively to specific consultants) required by `docs/hospital/SPEC.md`.
- **E2E Test File Location**: Section "File Structure & Impact Matrix" line 85 lists `tests/e2e/merchant-tenancy-isolation.spec.ts`. In actual implementation, cross-tenant isolation is tested via `tests/unit/cross-tenant-authorization-matrix.test.mjs` and `tests/unit/hospital-per-consultant-gaps.test.mjs`.

---

## docs/architecture/admin-app-logging-system.md

- **Log Ingestion Mechanism**: Section 2 diagram and Section 3 Phase 1 describe log ingestion exclusively via PostgreSQL RPC `log_client_event`. In actual code, log ingestion is also exposed via Next.js server endpoints `POST /api/logs/ingest` and `POST /api/admin/app-logs`.
- **Retention Period Discrepancy**: Section 1 specifies a 30-day retention pruning for `app_logs`. In `docs/data-retention.md` Section 2 line 24, security and app logs are scheduled for 180 days rolling retention.

---

## docs/architecture/customer-booking-flow.md

- **Expo SDK and React Version Divergence**: Section "Project Type" line 13 specifies "React Native with Expo SDK 52 / React 19". In `apps/customer-mobile/package.json`, Expo is version `"~58.0.19"` (SDK 58).
- **Authentication Method Scope**: The document focuses exclusively on Google OAuth Sign-In (`signInWithGoogle`). In the current mobile and backend implementation, Phone OTP authentication (`/api/auth/otp/send` and `/api/auth/otp/verify`) serves as the primary authentication mechanism across the platform.

---

## docs/architecture/admin-cleanup.md

- No drift detected.

---

## docs/architecture/supabase-mobile-web-setup.md

- **Broken Specification File Links**: Phase 1 lines 19–21 link to `PRD-hyperlocal-booking-mvp.md`, `Architecture-hyperlocal-booking-mvp.md`, and `API-Spec-hyperlocal-booking-mvp.md` at the repository root (`file:///Users/trinadh/projects/Appointments/PRD-...`), whereas these files reside in `docs/architecture/`.

---

## docs/architecture/hospital-manual-testing-checklist.md

- **Check-In PIN Visibility Timing**: Test instructions indicate inspecting the 4-digit PIN on the booking pass immediately after booking confirmation. In the current production code, the PIN is masked until $\le 60$ minutes before the booked slot.

---

## docs/architecture/test-report-hospital.md

- **Historical Test Suite Metrics**: Documents a historical run on branch `fix/hospital-consultant-rbac-hardening` with 66 tests across 25 suites. The current test infrastructure contains 46 test files and over 569 automated tests.

---

## docs/PRODUCTION_READINESS_ROADMAP.md

- **Redundant "Upcoming Groups" Section**: Section 5 continues to list Groups 3 through 7 as "Upcoming Groups Execution Plan", even though Section 3 and Section 4 record Groups 1 through 7 as **ACCEPTED** with full execution receipts and commit SHAs.
- **Outdated Active Branch**: Line 4 specifies `Branch: fix/production-readiness`. The active git working branch is `phase-perf-advisor-hardening`.
- **Inconsistent Group 8 Status**: Section 3 and Section 5 document Group 8 as `SUBMITTED FOR HUMAN REVIEW 🔍` with 38 adversarial test scenarios passing, while line 6 in the header states `Groups 5–9 PENDING`.

---

## docs/security/auth-toll-fraud-gateway-defense.md

- No drift detected.

---

## docs/security/security-remediation-bola-tenant-isolation.md

- **Deprecated Spring Boot Architecture Scope**: Section "Architecture & Impact Matrix" and tasks 1.3–1.6 mandate security fixes on Kotlin / Spring Boot controllers (`apps/backend/src/main/kotlin/...`), which is deprecated and superseded by Supabase + Next.js App Router per `apps/backend/README.md`.

---

## docs/security/phase-6-remediation-plan.md

- **Notification Logs Retention Period**: Finding CRIT-01 and Task 6.1.2 specify a 7-day retention masking RPC (`mask_old_notification_logs(p_days)`). In `docs/data-retention.md` Section 2 line 17, notification logs are scheduled for immediate user erasure or 30-day statutory lifecycle.

---

## docs/security/strix-remediation-plan.md

- **Historical Vulnerability Findings (Now Remediated)**:
  - Finding `vuln-0003` (CRITICAL) cites an exposed Supabase service role key in `scripts/e2e-trinadh-hospital-test.mjs`. This file was removed from git and the repository root.
  - Finding `vuln-0005` (HIGH) cites header impersonation via `x-customer-id` in `auth-admin.ts` and cookie length bypass in `middleware.ts`. In current code, bypasses are strictly locked down and disabled when `NODE_ENV === 'production'`.

---

## docs/security/strix-findings-plan.md

- Historical point-in-time planning document reflecting unpatched vulnerability state prior to Phase 7 and production readiness hardening.

---

## docs/security/strix-scan-remediation.md

- Historical point-in-time planning document reflecting unpatched vulnerability state prior to Phase 7 and production readiness hardening.

---

## docs/security/advisor-resolution.md

- **Outdated Advisor Counts**: Reflects earlier security advisor passes prior to the consolidation in `perf-advisor-resolution.md` and migrations `20261107000009` through `20261107000011`.

---

## docs/security/perf-advisor-resolution.md

- **External Target Project Reference**: Line 7 specifies `Target Project Ref: ynkdnwhubfknnnzjtpeg`, which is an external hosted Supabase project, whereas local development and gate enforcement operate against local Supabase at `127.0.0.1:54322`.
- **Unmerged `cities` Policy**: Section "Executive Summary" notes that `public.cities` multiple permissive policies consolidation was halted due to Rule 5 Security Gate because `Allow public read cities` contains `USING (true)`.

---

## docs/security/index-review.md

- **Obsolete Drop Candidates**: Lines 28 and 51 classify `idx_checkin_codes_booking_id` and `idx_bookings_reference_code` as `DROP-CANDIDATE / DROP`. In migration `20261107000010_perf_consolidate_multiple_permissive_policies.sql`, these duplicate indexes were dropped.

---

## docs/security/policy-merge-plan.md

- No drift detected.

---

## docs/security/data-protection-assessment.md

- No drift detected.

---

## docs/security/breach-runbook.md

- No drift detected.

---

## docs/security/vulnerability-waivers.md

- **Obsolete Active Risk Waiver WAV-2026-001**: Lists an active waiver for `node-forge` (`<=1.4.0`) citing "No upstream patch exists". In root `package.json` line 54, `pnpm.overrides` forces `"node-forge": ">=1.4.1"`, and `pnpm audit` verifies 0 advisories for `node-forge`. The waiver is resolved.

---

## docs/security/function-audit.md

- **Implemented Private Schema Recommendation**: Rows 35–42 recommended moving RLS helper functions (`is_admin`, `hospital_role`, `hospital_accessible_resource_ids`, etc.) to schema `private`. Migration `20261107000008_zero_advisor_warnings_schema_isolation.sql` has implemented this recommendation.

---

## docs/security/baseline.md

- Historical point-in-time snapshot of database advisor and schema state prior to hardening migrations.

---

## docs/data-retention.md

- No drift detected.

---

## docs/whatsapp-setup.md

- No drift detected.

---

## docs/launch-checklist.md

- **Platform Version in Header**: Line 4 specifies `Platform Version: Phase 7 Release Hardening (phase-7-release)`. The current platform is on `phase-perf-advisor-hardening` / `fix/production-readiness`.
- **SMS vs WhatsApp Primary Provider**: Section 1 lines 27–29 list `SMS_PROVIDER_API_KEY`, `SMS_PROVIDER_ENTITY_ID`, `SMS_PROVIDER_TEMPLATE_ID`. WhatsApp Business Cloud API (`WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_BUSINESS_ACCOUNT_ID`) has been established as the primary communication channel in `docs/whatsapp-setup.md`.

---

## docs/packaging-and-deployment.md

- **Outdated Database Migration Count**: Section 1 line 17 and Section 2 line 27 specify: *"Database Migrations: 20261024181600 (18 migrations)"* and *"18 migrations applied cleanly from clean slate via supabase db reset"*. In current reality, `supabase/migrations/` contains **155 migrations**.
- **Outdated Git Tag & Branch**: Header specifies `v1.0.0-rc.1` on branch `phase-7-release`. The repository has completed multiple subsequent hardening phases.

---

## docs/incident-response.md

- No drift detected.

---

## docs/audit/ATTACK.md

- **Outdated Attack Success Statuses (Now Remediated)**:
  - Attack 1.1a (`GET /api/customer/queue-and-history` PII harvest) is marked as `[SUCCEEDS]`. In the current codebase, `apps/merchant-web/src/app/api/customer/queue-and-history/route.ts` enforces caller authorization and masks PII for unowned bookings (`bookingId: null, referenceCode: null, patientName: null`).
  - Attack 1.1b (`build_template_params` RPC data leak) is marked as `[SUCCEEDS]`. Execution was revoked from `authenticated` and `anon` and restricted to `service_role` in migrations `20261031000001` and `20261103000002`.
  - Attack 2.5 (`cancel_doctor_emergency` unauthorized cancellation) is marked as `[SUCCEEDS]`. It now enforces in-function caller role verification and route guards.

---

## docs/audit/GRANTS_LOCKDOWN_REPORT.md

- No drift detected.

---

## docs/audit/CLIENT_DB_USAGE.md

- No drift detected.

---

## docs/backlog.md

- **Outdated Status on Resolved RC Blockers**:
  - Item 16 (`(DEF-RC-01) next build fails in clean clone without secrets due to build-time module evaluation`) is listed as `[OPEN]`, but was resolved in Phase RC Fix Layer 2 and Group 8.
  - Item 17 (`(DEF-RC-02) pnpm typecheck fails with 680 TS2786 errors due to React 18 / Lucide React 19 type hoisting`) is listed as `[OPEN]`, but was resolved by pinning `@types/react` to `18.3.18` and adding strict typecheck to CI.

---

## docs/decisions.md

- No drift detected.

---

## docs/release/rc-report.md

- **Historical Audit Snapshot**: Header specifies commit `859adb8` on branch `rc-gate` dated 2026-10-26 with 24 unit suites / 176 tests. The codebase currently contains 46 test suites and 155 migrations on branch `fix/production-readiness` / `phase-perf-advisor-hardening`.

---

## docs/release/spec-coverage-matrix.md

- Historical snapshot mapping tests at commit `859adb8`.

---

## docs/hospital-e2e-status.md & docs/hospital-e2e-report.md

- **Outdated Verdict**: Reports verdict as `NOT READY` (24 Oct 2026) due to 3 unrun tests on branch `phase-story-tests`. Superseded by `rc-report.md` and `PRODUCTION_READINESS_ROADMAP.md`.

---

## docs/hospital-test-report.md

- Historical test run from early branch `fix/hospital-consultant-rbac-hardening` reporting 66 tests across 25 suites.

---

## docs/overnight-report.md

- Historical snapshot of overnight test execution.

---

## README.md

- **Node.js Engine Version Mismatch**: Section "Prerequisites" line 35 states `- Node.js >= 18`. In `apps/merchant-web/package.json` line 14 and root `package.json` line 11, the required engine is `"node": ">=22.0.0"`.
- **Expo and React Native Version Mismatches**: Section "Tech Stack" table line 27 states `Expo 57, React Native 0.86`. In `apps/customer-mobile/package.json`, Expo is version `"~58.0.19"` (SDK 58), React Native is `"0.88.0"`, and React is `"19.3.0"`.
- **Monorepo Directory Tree Incompleteness**: Lines 7–20 omit `apps/backend/` (the legacy Spring Boot backend package), `scripts/`, `tests/unit/`, and `tests/scripts/`.
- **Test Commands Omission**: Section "Testing" lines 91–98 lists only Playwright E2E and TypeScript typecheck. It fails to document the unit and script test runners (`node scripts/run-all-unit-tests-serially.mjs` or `pnpm test:security`).

---

## apps/backend/README.md

- **Outdated Migration Count Reference**: Line 12 mentions *"superseded by the 80+ migrations in supabase/migrations/"*. There are currently **155 migrations** in `supabase/migrations/`.

---

## .agents/README.md

- No drift detected.
