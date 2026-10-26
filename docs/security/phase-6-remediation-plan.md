# Phase 6 Remediation Plan: Data Protection, Privacy & Resilience Hardening

> **ROADMAP REFERENCE**: Phase 6 (P1 Priority)  
> **ASSESSMENT SOURCE**: [`docs/security/data-protection-assessment.md`](file:///Users/trinadh/projects/Appointments/docs/security/data-protection-assessment.md)  
> **RUNBOOK REFERENCE**: [`docs/security/breach-runbook.md`](file:///Users/trinadh/projects/Appointments/docs/security/breach-runbook.md)  
> **OPERATIONAL CONSTRAINTS**:  
> - Standing Rule 1: `docs/hospital/SPEC.md` is the source of truth.  
> - Standing Rule 2: One layer per task (Database → API → UI → Hardening).  
> - Standing Rule 3: Every bug fix starts with a failing test.  
> - Standing Rule 4: Full gate verification (serial suites, typecheck, build).  
> - Standing Rule 5: New migrations only; never print secrets; local database only.

---

## 1. Executive Summary of Errors & Remediation Strategy

Phase 6 addresses the 8 architectural vulnerabilities and privacy gaps discovered during the comprehensive assessment:

| ID | Severity | Layer | Finding Description | Resolution Summary | Plan File |
|---|---|---|---|---|---|
| **CRIT-01** | **Critical** | Database / Hardening | `notification_logs` plaintext recipient phone numbers & merchant leak via RLS | Drop permissive RLS; restrict SELECT to admins & customer self; add 7-day retention masking RPC | Plan 6.1 |
| **CRIT-02** | **Critical** | Database / API | Direct `bookings` SELECT grant exposes `patient_phone` to staff via PostgREST | Revoke raw table SELECT on `bookings` for `authenticated`; route queries through `merchant_bookings` | Plan 6.1 |
| **HIGH-01** | **High** | Database / Logic | `anonymize_user_data` misses `patient_name` & `patient_phone` for family bookings | Update RPC to scrub third-party patient contact fields in `bookings` on account deletion | Plan 6.1 |
| **HIGH-02** | **High** | UI / Shared Logic | Absence of age check and verifiable parental consent (VPC) for minor bookings | Mobile Checkout: add minor toggle (<18) & mandatory parent/guardian declaration checkbox | Plan 6.3 |
| **HIGH-03** | **High** | Database & UI | Contact reveal does not record business justification reason | Add `reason` column to `contact_reveal_audit`; update RPC; add reason prompt modal in Merchant Web | Plan 6.1 & 6.3 |
| **MED-01** | **Medium** | API & UI | No automated "Export My Data" archive for Data Principals (DPDP Act §11) | Create `GET /api/account/export` JSON endpoint & mobile AccountScreen download trigger | Plan 6.2 & 6.3 |
| **MED-02** | **Medium** | Storage / Hardening | Routine staff reads of private medical attachments are not audited | Add audit log emission to `getPrivateDocumentSignedUrl` for staff role callers | Plan 6.2 |
| **MED-03** | **Medium** | Hardening / Ops | No automated real-time alerting on `contact_reveal_anomalies` velocity spikes | Scheduled security monitor endpoint logging CRITICAL events and triggering alert dispatch | Plan 6.4 |

---

## 2. Execution Waves & Task Breakdown

### Wave 1: Plan 6.1 — Database Layer (RLS, Erasure & Audit Schema)
*One layer: Database only. Zero UI or API changes.*

#### Task 6.1.1: Failing Test Suite for DB Security Defects
- **Target File**: `tests/security/test-db-security-remediation.mjs`
- **Action**:
  - Test 1: Assert merchant staff querying `notification_logs` receives 0 rows or 401/403.
  - Test 2: Assert merchant staff querying raw `bookings` directly cannot access unmasked `patient_phone`.
  - Test 3: Create family booking, run `anonymize_user_data`, assert `patient_name` and `patient_phone` are scrubbed.
  - Test 4: Assert `reveal_customer_contact` requires a reason and writes it to `contact_reveal_audit`.
- **Verify**: `node --test tests/security/test-db-security-remediation.mjs` (Fails on unpatched database).

#### Task 6.1.2: Database Migration (`20261026000001_harden_pii_security_and_erasure.sql`)
- **Target File**: `supabase/migrations/20261026000001_harden_pii_security_and_erasure.sql`
- **Action**:
  - Drop permissive policy `Merchants and customers read own booking notification logs` on `notification_logs`.
  - Add admin/self-only read policy on `notification_logs`.
  - Create `mask_old_notification_logs(p_days INT DEFAULT 7)`.
  - Revoke table-level `SELECT` on `bookings` for `authenticated`; ensure `merchant_bookings` view remains accessible.
  - Update `anonymize_user_data(p_user_id UUID)` to scrub `patient_name = 'Deleted Patient'`, `patient_phone = NULL`.
  - Alter `contact_reveal_audit` ADD COLUMN `reason TEXT`.
  - Update `reveal_customer_contact(p_booking_id UUID, p_reason TEXT DEFAULT 'Operational check-in')`.
- **Verify**: `node --test tests/security/test-db-security-remediation.mjs` (All tests pass).

---

### Wave 2: Plan 6.2 — API & Storage Auditing Layer
*One layer: Backend API & Storage service only.*

#### Task 6.2.1: Data Principal Archive Export Endpoint (`GET /api/account/export`)
- **Target Files**:
  - `apps/merchant-web/src/app/api/account/export/route.ts`
  - `tests/security/test-api-security-remediation.mjs`
- **Action**:
  - Create failing test in `test-api-security-remediation.mjs`.
  - Implement `/api/account/export` verifying caller JWT.
  - Collects profile, bookings history, payment receipts, and consent records.
  - Streams JSON attachment `appointments-data-export-{uid}.json` with `Cache-Control: no-store`.
- **Verify**: `node --test tests/security/test-api-security-remediation.mjs`.

#### Task 6.2.2: Prescription Signed-URL Access Auditing
- **Target File**: `apps/merchant-web/src/lib/storage.ts`
- **Action**:
  - When `getPrivateDocumentSignedUrl` is invoked by staff, write an entry to `public.audit_logs`:
    `actor_id: caller.id`, `action: 'READ_PRESCRIPTION_ATTACHMENT'`, `target: storagePath`.
- **Verify**: Call `getPrivateDocumentSignedUrl` and assert new row in `public.audit_logs`.

---

### Wave 3: Plan 6.3 — UI Layer (Customer Mobile & Merchant Web)
*One layer: User Interface components only.*

#### Task 6.3.1: Customer Mobile Minor Booking & Data Export
- **Target Files**:
  - `apps/customer-mobile/src/screens/CheckoutModal.tsx`
  - `apps/customer-mobile/src/screens/AccountScreen.tsx`
- **Action**:
  - In `CheckoutModal.tsx`: When `isBookingForSomeoneElse` is active, display toggle "Patient is a minor (<18 years)".
  - When active, mandate guardian checkbox: *"I am the parent/lawful guardian of this minor patient and consent to scheduling data processing under the DPDP Act."* Gate checkout submission until checked.
  - In `AccountScreen.tsx`: Add "Export Personal Data Archive" button triggering `/api/account/export`.
- **Verify**: Typecheck `customer-mobile` and verify interactive flow.

#### Task 6.3.2: Merchant Web Contact Reveal Reason Prompt
- **Target Files**:
  - `apps/merchant-web/src/components/BookingDetailsModal.tsx`
  - `apps/merchant-web/src/app/bookings/page.tsx`
- **Action**:
  - Update "Reveal Customer Contact" action: opens modal prompting for mandatory business justification:
    - "Patient Running Late / ETA Check"
    - "Urgent Clinical Query"
    - "Check-in / PIN Assistance"
    - "Emergency Rescheduling"
  - Pass `selectedReason` to `reveal_customer_contact(bookingId, selectedReason)`.
- **Verify**: `pnpm --filter @appointments/merchant-web build`.

---

### Wave 4: Plan 6.4 — Hardening, Alerting & Gate Verification
*One layer: Monitoring & Monorepo Verification.*

#### Task 6.4.1: Anomaly Alerting Cron (`/api/cron/security-monitor`)
- **Target File**: `apps/merchant-web/src/app/api/cron/security-monitor/route.ts`
- **Action**:
  - Periodically checks `public.contact_reveal_anomalies`.
  - If any user exceeds 15 reveals/hour, emits CRITICAL security log to `public.app_logs` and triggers alert webhook.
- **Verify**: Route returns 200 with anomaly check status.

#### Task 6.4.2: Full Security Gate Execution
- **Commands**:
  1. `node --test tests/security/log-pii-scan.test.mjs`
  2. `node --test tests/security/test-db-security-remediation.mjs`
  3. `node --test tests/security/test-api-security-remediation.mjs`
  4. `pnpm test:security`
  5. `node tests/e2e/stories/run-all-stories.mjs`
  6. `pnpm build`
- **Verify**: Zero failures, 100% test pass rate, clean monorepo compilation.
