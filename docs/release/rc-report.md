# Release-Candidate (RC) Verification Master Report

> **Audit Target Commit SHA:** `aa416932dbe00fcfa36233f71e6048612d334347` (Branch: `rc-gate`)  
> **Source of Truth:** `docs/hospital/SPEC.md`, `docs/decisions.md`, Standing Rules in `AGENTS.md`  
> **Auditor / Protocol:** Antigravity Autonomous Orchestrator (`@orchestrator`)  
> **Date / Time:** 2026-10-26 15:40:00 IST  
> **Execution Mode:** Local Stack Only (`127.0.0.1:54322`, Next.js 3000, Pixel 8 Emulator) — Zero Application Code Modified  

---

## 1. Executive Verdict: 🔴 NO-GO

**Final Gate Assessment:** **NO-GO FOR PRODUCTION RELEASE AT COMMIT `aa41693`**

### Summary of Blockers Requiring User Decision & Approval
Per Standing Rule 5 and the Release Criteria (*"GO only if there are zero open Critical or High defects, every gate PASS or an explicit waiver from me"*), the release is blocked by the following four High-severity findings:

1. **Step 1 (Clean Git Clone Proof): FAIL (High)**
   - A fresh clone at `aa41693` fails `pnpm build` and `pnpm typecheck`.
   - `next build` crashes during build-time page data collection because route handlers (`src/lib/razorpay.ts`, `src/app/api/auth/otp/verify/route.ts`) execute top-level code that throws if runtime secrets (`RAZORPAY_KEY_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`) are absent.
   - Strict `tsc --noEmit` in `apps/merchant-web` fails with 680 compiler errors (`TS2786`) due to React 18 / Lucide React 19 type definitions hoisting.
2. **Gate 5 (Security Dependency Audit): FAIL (High)**
   - `pnpm audit --prod` detects **2 High-severity vulnerabilities** in production mobile dependencies (`node-forge <=1.4.0` GHSA-86w9-cpqp-85rv with no upstream patch released, and `zod <4.6.6` GHSA-mrhx-c7xc-m3w5 via `@expo/cli`).
3. **Gate 14 (Supabase Database Advisors): FAIL (High)**
   - `supabase db lint` reveals critical errors in active stored procedures:
     - `cancel_doctor_emergency`: queries non-existent table `public.hospital_department_members` (instead of `department_members`).
     - `reschedule_booking_slot`: checks `payment_status != 'PAID'` (invalid enum value; enum is `'CAPTURED'`).
     - `confirm_booking_by_merchant`: checks `v_booking.status NOT IN ('HELD', 'PENDING_PAYMENT', 'PENDING')` (invalid enum value `'PENDING'`).
     - `search_directory_public` & `search_directory`: queries non-existent column `r.category_id` on table `resources`.
4. **Gate 9 (Performance Load Test): FAIL (Medium)**
   - At 100 virtual users (VUs), read p95 latency is **4,900.83 ms** (threshold: 500 ms) and write p95 is **5,488.65 ms** (threshold: 1,000 ms).
   - Under 500 and 1,000 VUs, 2,160 and 7,660 requests dropped on local dev server.

---

## 2. Gate Verification Scoreboard

| Gate ID | Verification Gate | Evidence File & Line | Status | Notes & Test Counts |
| :--- | :--- | :--- | :---: | :--- |
| **G1** | **Spec Coverage Matrix** | [spec-coverage-matrix.md](file:///Users/trinadh/projects/Appointments/docs/release/spec-coverage-matrix.md) | **PASS** | 20 of 20 SPEC rules mapped to automated tests with 0 untested rules. |
| **G2** | **Full Suites (3-Run Flake Check)** | [run-three-suite-flake-check.mjs](file:///Users/trinadh/projects/Appointments/scripts/run-three-suite-flake-check.mjs) | **PASS** | 47 story cases, 22 unit suites (67 tests), and security tests ran 3x consecutively from clean reset with 0 flaky tests. |
| **G3** | **Stateful Invariant Fuzzing** | [stateful-api-fuzz.mjs](file:///Users/trinadh/projects/Appointments/tests/fuzz/stateful-api-fuzz.mjs) | **PASS** | 10,000 action sequences executed across 8 invariants; seed `63042`; 0 double bookings, 0 over-refunds. |
| **G4** | **Failure Injection & Resilience** | [failure-injection.mjs](file:///Users/trinadh/projects/Appointments/tests/resilience/failure-injection.mjs) | **PASS** | 6 fault tests passed (webhook replay, crash rollback, duplicate checkin idempotency, clock skew, rate limit lockout). |
| **G5** | **Security Audit & Secrets** | [audit-security-gate.mjs](file:///Users/trinadh/projects/Appointments/scripts/audit-security-gate.mjs) | **FAIL** | Grants & CORS pass; Fails on 2 High `pnpm audit` CVEs and test credential prefixes in git history commit `bff50315`. |
| **G6** | **Data Protection & Log PII** | [data-protection-assessment.md](file:///Users/trinadh/projects/Appointments/docs/security/data-protection-assessment.md) | **PASS** | Log PII scanner verified 0 leaked JWTs/secrets; DPDP assessment and breach runbook in place. |
| **G7** | **UI Audit (ARTEMIS & Web)** | [ui-audit/report.md](file:///Users/trinadh/projects/Appointments/docs/e2e/ui-audit/report.md) | **PASS** | 353 static controls audited, 20 mobile visual artifacts, 0 dead controls on core flows; 2 low defects backlogged. |
| **G8** | **Money & Ledger Reconciliation** | [reconcile-money.mjs](file:///Users/trinadh/projects/Appointments/scripts/reconcile-money.mjs) | **PASS** | ₹7,750.00 collected = ₹600 refunded + ₹7,150 retained across 2,348 bookings. Invariant held post-fuzz. |
| **G9** | **Performance Load Test** | [load-test-results.json](file:///Users/trinadh/projects/Appointments/tests/k6/load-test-results.json) | **FAIL** | 100 VU p95 is 4,900 ms (threshold 500 ms); 500 VU dropped 2,160 reqs; 1000 VU dropped 7,660 reqs. |
| **G10** | **Reliability & Operations** | [drill-backup-restore.mjs](file:///Users/trinadh/projects/Appointments/scripts/drill-backup-restore.mjs) | **PASS** | Backup/restore drill verified 100% data fidelity across 9 core tables in scratch database. |
| **G11** | **Data Invariants SQL** | [data-invariants.sql](file:///Users/trinadh/projects/Appointments/scripts/data-invariants.sql) | **PASS** | Read-only SQL queries executed against PostgreSQL returned 0 violation rows across all 8 checks. |
| **G12** | **Store & Legal Readiness** | [verify-store-legal.mjs](file:///Users/trinadh/projects/Appointments/scripts/verify-store-legal.mjs) | **PASS** | 4/4 passed: 0 legal placeholders in privacy/terms; Play Store package & notification permissions verified. |
| **G13** | **Environment Verification** | [verify-env.mjs](file:///Users/trinadh/projects/Appointments/scripts/verify-env.mjs) | **PASS** | Local passes; Production validator correctly identifies 11 missing production secrets. |
| **G14** | **Quality & Advisors** | [verify-quality.mjs](file:///Users/trinadh/projects/Appointments/scripts/verify-quality.mjs) | **FAIL** | Lint passes; Fails on 680 merchant-web TS errors and 11 `supabase db lint` advisor errors. |

---

## 3. Comprehensive Defect Register

| Defect ID | Severity | Layer | Summary & Symptoms | Concrete Evidence | Suggested Remediation | Decision Maker |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| **DEF-RC-01** | **High** | API / Web Build | `next build` fails in fresh clone without local secrets due to top-level module evaluation in route handlers | `apps/merchant-web/src/lib/razorpay.ts:L45`: `throw new Error('CRITICAL SECURITY CONFIGURATION ERROR...')` during page data collection | Defer runtime secret validation from top-level module load into request handlers, or mock during build phase | User |
| **DEF-RC-02** | **High** | Web Client / Types | `pnpm typecheck` fails with 680 TS2786 errors due to React 18 / Lucide React 19 typing collision | `tsc --noEmit` in `apps/merchant-web`: `Type 'bigint' is not assignable to type 'ReactNode'` in `TenantSelector.tsx:L39`, `UnifiedAddStaffModal.tsx:L245` | Align React types across monorepo or set `skipLibCheck: true` in `tsconfig.json` | User |
| **DEF-RC-03** | **High** | Dependencies | 2 High-severity CVEs in `@expo/cli` transitive dependencies (`node-forge` <=1.4.0 GHSA-86w9-cpqp-85rv, `zod` <4.6.6 GHSA-mrhx-c7xc-m3w5) | `pnpm audit --prod` exit code 1; 12 paths to `node-forge`, 6 paths to `zod@3.25.76` | Await upstream Expo CLI patch or submit formal risk waiver | User |
| **DEF-RC-04** | **High** | Database / Stored Procedures | `supabase db lint` reports broken table reference in `cancel_doctor_emergency` and invalid enum literals in `reschedule_booking_slot` and `confirm_booking_by_merchant` | `supabase db lint`: `relation "public.hospital_department_members" does not exist`, `invalid input value for enum payment_status: "PAID"` | Apply database migration correcting table name to `department_members` and enum checks to `'CAPTURED'` | User |
| **DEF-RC-05** | **Medium** | Backend / Infra | Local k6 load test p95 latency (4,900 ms at 100 VUs) exceeds 500 ms threshold; request dropping at 500+ VUs | `tests/k6/load-test-results.json`: `p95: 4900.83ms` (100 VUs), `errors: 2160` (500 VUs) | Deploy Redis connection pooling (`pgbouncer`), enable Next.js standalone server mode, optimize PostgREST worker pool | User |
| **DEF-RC-06** | **Medium** | CI / Git History | Dummy credentials with `rzp_live_` prefix in `security-audit-production-env.test.mjs` and test JWTs in `load-test-config.json` committed to git history | `git log -p bff50315`: `RAZORPAY_KEY_ID: 'rzp_live_realauthkey123'` | Redact strings to generic mocks and rotate any production secrets if reused | User |
| **DEF-RC-07** | **Low** | Customer Mobile | Android hardware back button backgrounds app instead of dismissing `CitySelectorModal` | `docs/backlog.md` (DEF-01); tested on Pixel 8 Emulator | Add `onRequestClose` prop to React Native `<Modal>` component in `CitySelectorModal.tsx` | User |
| **DEF-RC-08** | **Low** | Merchant Web | Front Desk / Consultant probing `/departments` redirects to `/register` instead of displaying 403 Forbidden | `docs/backlog.md` (DEF-02); tested with Playwright on Chrome | Update Next.js auth middleware to return HTTP 403 Forbidden for unpermitted staff roles on `/departments` | User |

---

## 4. Residual Risk Register

1. **Third-Party Payment Gateway Live Connectivity (Unverified)**
   - *Risk*: Local testing runs with mock payments (`ALLOW_MOCK_PAYMENTS=true`). While webhook HMAC signature verification and idempotency are proven, real live UPI, NetBanking, and Card transactions on Razorpay Production Gateway have not been processed.
   - *Mitigation*: Mandatory 10-minute manual test script using real test mode and penny-drop before hospital onboarding.
2. **Push Notification Delivery Latency (Unverified)**
   - *Risk*: Push notification delivery relies on Expo Push servers and Google FCM. Push receipt confirmation is mocked locally.
   - *Mitigation*: SMS/WhatsApp fallback channels are designated as primary per SPEC line 30; in-app live status is source of truth.
3. **Database Concurrency Under High Load (>500 VUs)**
   - *Risk*: Without external connection pooler (`pgbouncer`), PostgreSQL connection starvation occurs at >200 concurrent TCP connections on local infrastructure.
   - *Mitigation*: Ensure Supabase Cloud pooled connection string (`transaction` pool mode on port 6543) is configured for production Next.js environment.

---

## 5. First 72 Hours Monitoring Plan

During the first 72 hours of production traffic:

1. **Real-time Velocity & Anomaly Monitoring**:
   - Automated cron `/api/cron/security-monitor` runs every 10 minutes checking `public.contact_reveal_anomalies`.
   - Alert threshold: >15 contact reveals per hour per staff triggers CRITICAL alert in `public.app_logs`.
2. **Payment & Ledger Health Check**:
   - Run `node scripts/reconcile-money.mjs` every 6 hours.
   - Any discrepancy between Razorpay captured webhooks and `public.payments` triggers an immediate ops page.
3. **Error Rate & Invariant Surveillance**:
   - Execute `scripts/data-invariants.sql` as an hourly scheduled query.
   - Any non-zero row count triggers an immediate emergency stop.
4. **Log Scrubbing Validation**:
   - Nightly execution of `tests/security/log-pii-scan.test.mjs` ensuring zero plaintext customer phone numbers or JWTs appear in `app_logs`.

---

## 6. Staged Launch & Rollback Plan

### Pilot Deployment Architecture (Single Hospital)
1. **Pilot Venue**: Onboard exactly ONE pilot hospital venue in Tirupati (e.g. `H1: City Care Hospital`).
2. **Granular Kill Switch**:
   - Each hospital provider has an operational kill switch in `public.providers`:
     `UPDATE public.providers SET is_booking_enabled = false WHERE id = '<pilot_id>';`
   - Immediately disables online slot selection on the customer mobile app, returning *"Online booking temporarily paused by hospital administration"*.
3. **Rollback Procedures**:
   - **Application Rollback**: Vercel / Cloudflare instant rollback to preceding deployment hash. Mobile app updates managed via Expo EAS channel rollback.
   - **Database Rollback**:
     - Forward-only migrations for database schema.
     - In disaster scenarios, restore from point-in-time recovery (PITR) backup verified during Gate 10 drill.

---

## 7. User Manual Test Script (Estimated: 45 Minutes)

*This script contains ONLY verification items that cannot be verified by an automated machine test:*

| Step | Action Item | Target Surface | Verification Objective | Est. Mins |
| :---: | :--- | :--- | :--- | :---: |
| **M1** | **Real Phone Payment (Razorpay Test Mode)** | Physical Android Phone | Book slot, initiate UPI test intent, approve in sandbox UPI app, verify green checkmark and booking pass generation. | 8 mins |
| **M2** | **Real Push Delivery** | Physical Android Phone | Verify push notification arrives in Android system notification shade with green hospital logo and sound. | 5 mins |
| **M3** | **Real SMS / WhatsApp OTP** | Physical Phone | Enter real mobile number, receive 6-digit SMS OTP from real provider, confirm authentication within 30s. | 5 mins |
| **M4** | **TalkBack Accessibility Pass** | Android Phone | Enable TalkBack in Android Settings; swipe through Home Screen, Booking Pass, and Fast-Pass check-in dialog; verify clear spoken labels. | 10 mins |
| **M5** | **Visual & Wording Screen Review** | Phone & Desktop Web | Review Home Screen live upcoming appointment card, check-in PIN masking, and TV Waiting Lounge display modal. | 10 mins |
| **M6** | **Privacy Policy & Terms Read-Through** | Web Browser (`/privacy`) | Verify Grievance Officer details (N. Trinadh, Bhavani Nagar, Tirupati) and 48-hour response commitment. | 7 mins |
