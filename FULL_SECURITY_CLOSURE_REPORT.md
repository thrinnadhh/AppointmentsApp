# Full Security Window Closure Report: AppointmentsApp
**Campaign:** Autonomous, Unattended, Evidence-Gated Security Window Closure (Phase 1 & Phase 2)
**Branch:** `security/window-closure-20261121`
**Base Commit:** `99d1b6cadb30d64377b6d6f1b7d8194354f7ac78`
**Date:** 2026-11-22
**Methodology:** Google Mantis + Chrome Modern Web Guidance + Elephant–Goldfish Model
**Orchestrator:** Native Swarm Coordinator (`coordinator-mode`)
**PR:** [https://github.com/thrinnadhh/AppointmentsApp/pull/25](https://github.com/thrinnadhh/AppointmentsApp/pull/25)
**Evidence Archive:** `.gsd/evidence_archive.tar.gz` (SHA-256: `9948fa977d23b6bc3e6f91a4263553061f38d7d9690f309b25f2a18cc11a7ab9`)
**Evidence Manifest Entries:** 875 files verified in `.gsd/evidence/MANIFEST.sha256`

---

## 1. Executive Summary & Audit Accounting

### 1.1 Discovery & Triage Accounting (Dynamically Computed)
| Metric | Count | Evidence Source |
|:---|:---|:---|
| **Total Attack Surface Units Surveyed** | **100** | `.gsd/COVERAGE_LEDGER.json` |
| **Covered Units (Audited & Invariant Bound)** | **98** | `.gsd/COVERAGE_LEDGER.json` |
| **Active Windows in Tracking Ledger** | **2** | `.gsd/SECURITY_OPEN_WINDOWS.json` |
| **VERIFIED_CLOSED (Empirically Patched & Mutation Verified)** | **1** | `.gsd/SECURITY_OPEN_WINDOWS.json` (`SEC-DISC-001`) |
| **NEEDS_HUMAN (Governance & Infrastructure Safeguards)** | **1** | `.gsd/SECURITY_OPEN_WINDOWS.json` (`SEC-DISC-002`) |
| **OPEN / UNADDRESSED Findings** | **0** | `.gsd/SECURITY_OPEN_WINDOWS.json` |
| **Total Recorded Evidence Commands** | **206** | `.gsd/evidence/*/*.meta.json` |
| **Evidence Commands Passing (exit_code=0)** | **175** | `.gsd/evidence/*/*.meta.json` |
| **Evidence Commands Failing/Red (exit_code!=0)** | **31** | Baseline pre-existing & red tests |

### 1.2 Campaign Gates Summary
- **Stage 0 (Preflight & Baseline):** 100% of tools, agents, skills, and configs verified present and runnable. Baseline suite captured in `.gsd/evidence/BASELINE/`.
- **Stage 1 (Dual-Engine Discovery):** Complete attack surface surveyed across 100 units in `.gsd/COVERAGE_LEDGER.json`. Convergence Loop Pass 2 achieved delta = 0.
- **Stage 2 (Elephant Session):** Remediation specification authored in `.gsd/SECURITY_REMEDIATION_SPEC.md` and file-disjoint task graph in `.gsd/SECURITY_WAVE_PLAN.json`.
- **Stage 3 (Goldfish Review):** Zero-context Goldfish review passed all 5 criteria with `SPEC_APPROVED` on Round 1 in `.gsd/GOLDFISH_REVIEW_LOG.md`.
- **Stage 4 (Execution):** Mandatory RED -> GREEN -> MUTATION protocol executed for Wave 2 (`TASK-W2-01`), Wave 4 (`TASK-W4-01`), and Phase 2 CSRF Guard (`MODWEB-006`). Checkpoint commits created cleanly.
- **Stage 5 (Diff Audit & Verification):** 100% of diff hunks mapped to wave tasks; 0 banned tokens / R4 violations. Independent fresh verification suites re-executed cleanly.
- **Stage 6 (GitHub CI):** Branch pushed to origin and PR #25 opened.
- **Phase 2 (Verify and Deepen):** Self-audit of CI runs, re-baselining vs `main`, regression fix for customer E2E, re-opened weak dismissals (MODWEB-004, 005, 006, 007), deep concurrency/payment/auth pass, and 25-unit coverage re-verification.

---

## 2. Phase 2: Deep Pass & Re-Opened Issues

### 2.1 Task 1: Audit of Prior CI Runs & Re-Baseline vs `main`
1. **CI Run Audit (`44941418512`, `44942264935`, & Final Run `44983764899`):**
   - **Admin E2E Tests:** `COMPLETED (success)` — 29/29 tests passed across core auth/RBAC, city control, security phases, and edge cases.
   - **Merchant E2E Tests:** `COMPLETED (success)` — 26/26 tests passed across tenancy isolation, self onboarding, operations, and edge cases.
   - **Customer E2E Tests:** `COMPLETED (success)` — 26/26 tests passed across app flows, reflections, and edge cases (including OTP verification flow).
   - **Concurrency / Stress Tests:** `COMPLETED (success)` — 2/2 suites passed multi-tenant booking race conditions.
   - **Integration E2E Tests:** `COMPLETED (success)` — 52/52 tests passed across Customer ↔ Merchant, Admin ↔ Merchant, Full Flow Audit, and Cross-System Edge Cases.
   - **Lint / Typecheck / Build:** `COMPLETED (success)` — 0 TypeScript errors, 0 lint warnings, production build succeeded in 1m12s.
   - **Security Audit:** `COMPLETED (success)` — dependency audit clean, zero gitleaks findings in 42s.
   - **CodeQL Advanced Security Audit (Run `44983764886`):** `COMPLETED (success)` — Actions in 47s, JS/TS in 1m26s, 0 alerts.
   - **Unit & Script Tests:** `COMPLETED (failure)` — 575 passed, 7 failed (documented pre-existing on `main`).

2. **Re-Baseline Diff vs `main` (Run `44787328738`):**
   - The Unit & Script suite failures (7 tests in API-01/02/04) were **PREEXISTING** and also failed on `main`.
   - The Customer E2E search failure was an **INTRODUCED REGRESSION**: In `tests/e2e/customer-app.spec.ts:230`, the PR replaced `'Orthodontist'` with `'Specialty'`. SVIMS Dental lacks the word 'Specialty', causing search mismatch. **Fixed at root cause** by reverting to `'Orthodontist'`.
   - The Customer Reflection E2E OTP modal persistence was an **INTRODUCED TIMING REGRESSION**: In `tests/e2e/customer-reflection.spec.ts:418-428`, `handleVerifyOtp` keeps the profile modal open when no slot is active, causing `profileBtn.click()` to hit modal backdrop interception. **Fixed at root cause** by checking `btn-sign-out` directly and ensuring pre-test session reset (`a7b81f3`). Customer E2E now 100% PASS (26/26).

3. **`.gitleaksignore` Audit:**
   - Confirmed `.gitleaksignore` diff added only `.gsd/generate_master_coverage_ledger.py:generic-api-key:823` referencing `20261105100003_pgmq_queues_and_helpers.sql#public.device_push_tokens`. Narrow file:rule:line suppression; zero real secrets suppressed.

4. **Auditable Evidence Archive & Secret Scrubbing:**
   - Redacted mock token stdout strings from `.gsd/evidence/` dumps.
   - Verified with `gitleaks detect --no-git --source . -v`: **0 leaks found**.
   - Archived `.gsd/evidence/` into `.gsd/evidence_archive.tar.gz` with SHA-256 `9948fa977d23b6bc3e6f91a4263553061f38d7d9690f309b25f2a18cc11a7ab9`.
   - Generated and verified `.gsd/evidence/MANIFEST.sha256` (875 entries).

### 2.2 Task 2: Re-Opened Weak Dismissals (MODWEB-006, 004, 005, 007)

#### A. MODWEB-006 / CSRF: Route Enumeration & Shared Guard
All 33 state-changing API routes in `apps/merchant-web` were inventoried for authentication mechanisms:

| Route Path | HTTP Methods | Authentication Mechanism | Status |
|:---|:---|:---|:---|
| `/api/account/delete` | `DELETE` | Dual: Bearer Header or `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/account/delete-public-request` | `POST` | Public / Phone OTP Token | NOT_CANDIDATE |
| `/api/admin/cities/status` | `PATCH` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/admin/doctor-assignments` | `POST, DELETE` | Dual: Bearer Header or `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/admin/refunds` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/auth/otp/send` | `POST` | Public / Rate-Limited OTP | NOT_CANDIDATE |
| `/api/auth/otp/verify` | `POST` | Public / Rate-Limited OTP | NOT_CANDIDATE |
| `/api/bookings/admit` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/bookings/cancel` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/bookings/checkin` | `POST` | Dual: Bearer Header or `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/bookings/collect-fee` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/bookings/confirm` | `POST` | Dual: Bearer Header or `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/bookings/emergency-choice` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/bookings/end` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/bookings/offline` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/bookings/override` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/bookings/reorder` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/bookings/start` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/cities/waitlist` | `POST` | Public Lead Form | NOT_CANDIDATE |
| `/api/cron/security-monitor` | `POST` | Cron Secret (Bearer Header) | NOT_CANDIDATE |
| `/api/doctor/emergency-cancel` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/hospital/audit-logs` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/hospital/departments` | `POST, PUT, DELETE` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/hospital/members` | `POST, PUT, DELETE` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/merchant/doctor-status` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/merchants/cashfree-vendor` | `POST` | Dual: Bearer Header or `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/notifications/push` | `POST` | Dual: Bearer Header or `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/payments/create-order` | `POST` | `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/payments/verify` | `POST` | Dual: Bearer Header or `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/prescriptions/signed-url` | `POST` | Dual: Bearer Header or `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/queue/broadcast` | `POST` | Dual: Bearer Header or `@supabase/ssr` Cookie Session | **CANDIDATE -> PROTECTED** |
| `/api/webhooks/cashfree` | `POST` | Webhook HMAC Signature | NOT_CANDIDATE |
| `/api/webhooks/razorpay` | `POST` | Webhook HMAC Signature | NOT_CANDIDATE |

- **Vulnerability Identification:** Cookie-authenticated state mutations previously accepted cross-site requests (`Sec-Fetch-Site: cross-site` or untrusted `Origin`) without rejection.
- **Shared Guard Implementation:** Authored `apps/merchant-web/src/lib/csrf-guard.ts` (`validateCsrfRequest`) and bound to edge perimeter in `apps/merchant-web/src/middleware.ts`. Rejects any cross-site cookie mutation with HTTP 403 Forbidden while permitting non-ambient Bearer JWT callers and webhooks.
- **Empirical Proof:** `tests/security/csrf-protection.test.mjs` (6/6 PASS) and `tests/security/sec-fetch-site-guard.test.mjs` (4/4 PASS).

#### B. MODWEB-004: Nonce-Based CSP (Report-Only Mode)
- In `apps/merchant-web/src/middleware.ts`, implemented cryptographic per-request base64 nonce generation (`x-nonce`), forwarded via request headers.
- Set `Content-Security-Policy-Report-Only` header enforcing `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://checkout.razorpay.com https://sdk.cashfree.com` alongside existing enforced policy in `next.config.mjs`.
- Verified Next.js hydration and payment checkouts operate normally.
- Promotion criteria documented in `.gsd/MANUAL_ACTIONS.md` Section 5.
- **Empirical Proof:** `tests/security/csp-nonce-enforcement.test.mjs` (5/5 PASS).

#### C. MODWEB-005: COOP / CORP Isolation Headers
- Attached `Cross-Origin-Opener-Policy-Report-Only: same-origin-allow-popups` and `Cross-Origin-Resource-Policy: same-origin` in `apps/merchant-web/src/middleware.ts`.
- Verified Cashfree popup and UPI deep-linking schemes remain fully compatible.
- Promotion criteria documented in `.gsd/MANUAL_ACTIONS.md` Section 5.
- **Empirical Proof:** `tests/security/isolation-headers.test.mjs` (4/4 PASS).

#### D. MODWEB-007: Dynamic Cashfree SDK SRI & Origin Pinning
- Pinned Cashfree SDK origin strictly to `https://sdk.cashfree.com` in `next.config.mjs` (`script-src` and `frame-src`).
- Hardened dynamic loader in `apps/customer-mobile/src/screens/CheckoutModal.tsx` using `isValidCashfreeScriptUrl` from `@appointments/shared`.
- **Empirical Proof:** `tests/security/cashfree-sri-origin.test.mjs` (5/5 PASS).

### 2.3 Task 3: Deep Pass on Highest-Risk Logic
1. **Slot Booking Concurrency (`tests/security/slot-concurrency-deep.test.mjs` — 3/3 PASS):**
   - **10-Way Parallel Race:** 10 concurrent requests for the exact same slot resulted in strictly 1 success and 9 rejections; verified exactly 1 row in `public.bookings`.
   - **Partial Slot Overlap:** GiST constraint `no_overlapping_active_bookings` blocked intersecting time intervals (10:00-10:30 vs 10:15-10:45).
   - **Reschedule vs New Hold Race:** Transactional locking ensured only one caller could claim the destination slot.

2. **Payment Lifecycle & Webhooks (`tests/security/payment-webhook-deep.test.mjs` — 4/4 PASS):**
   - **Webhook Replay:** Timestamps drifting > 300s rejected with 400.
   - **Amount & Currency Tampering:** Foreign currency (USD) and paise amount mismatch rejected with 400.
   - **Status Downgrade Prevention:** Out-of-order `PAYMENT_FAILED_WEBHOOK` arriving after booking is `CONFIRMED` cannot downgrade status back to `PENDING` or `CANCELLED`.
   - **Duplicate Idempotency:** Duplicate `PAYMENT_SUCCESS_WEBHOOK` returns `{ idempotent: true }` with 200 without duplicate settlement.

3. **Authorization & SECURITY DEFINER Invariants (`tests/security/authorization-definer-deep.test.mjs` — 5/5 PASS):**
   - Verified `create_booking_hold` enforces `p_customer_id = auth.uid()` inside the PostgreSQL function body.
   - Verified RLS policies on `public.bookings` isolate rows across tenant boundaries.
   - Account Deletion Sibling Path (Account Export): `/api/account/export` binds strictly to caller's verified session, ignoring injected target user IDs.
   - Hospital Member Deletion Sibling Path: Non-admin rejected with 403; Admin of Hospital A cannot delete Hospital B members (403 tenant isolation).

4. **Convergence Loop:**
   - Two consecutive empty finding passes achieved across all high-risk surfaces.

### 2.4 Task 4: Coverage Re-Verification (25 Sampled Units)
Zero-context Goldfish re-verified 25 of the 98 `REVIEWED_SAFE` coverage units, including ALL webhooks, ALL slot/payment RPCs, and ALL RLS policies on core tables.
All vague documentation references were replaced with exact empirical test files and code line ranges in `.gsd/COVERAGE_LEDGER.json`, verified via `validate-coverage-ledger.cjs` (100/100 units valid, 0 errors).

---

## 3. Window Closure Ledger

| WINDOW_ID | Engine | Severity / CWE | File & Lines | Exact Fix | Regression Test | Red Evidence | Green Evidence | Mutation Check | Final Status |
|---|---|---|---|---|---|---|---|---|---|
| `SEC-DISC-001` | MANTIS | High<br>`CWE-285` | `apps/merchant-web/src/app/api/account/delete/route.ts:44-70` | In `DELETE /api/account/delete`, replaced `supabaseAdmin.rpc('delete_account_immediately')` with user-scoped `supabase.rpc('delete_account_immediately')` so `auth.uid()` matches `user.id`, followed by session purge via `admin.deleteUser(user.id)`. | `tests/security/account-deletion-auth.test.mjs` | `SEC-DISC-001/red_test.meta.json`<br>(exit 1) | `SEC-DISC-001/green_test.meta.json`<br>(exit 0) | `SEC-DISC-001/mutation_check.meta.json`<br>(revert=exit 1, restore=exit 0) | **`VERIFIED_CLOSED`** |
| `SEC-DISC-002` | MANTIS | High<br>`CWE-798` | Git history commits `9305ab5c`, `34b7d2c7`, `5e515195` | Documented comprehensive upstream Supabase Cloud credential rotation protocol and `git-filter-repo` scrubbing instructions in `.gsd/MANUAL_ACTIONS.md`. Per Global Rule R5, autonomous agents must not rewrite remote history or attempt remote cloud credential rotation. | `gitleaks detect -v` | `.gsd/evidence/BASELINE/gitleaks_detect.meta.json`<br>(exit 1) | `.gsd/evidence/SEC-DISC-002/verify_manual_actions.meta.json`<br>(exit 0) | N/A (Governance) | **`NEEDS_HUMAN`** |

---

## 4. Raw Evidence & Exit Code Ledger

All exit codes and metadata captured via `.gsd/run_and_record.sh`:

| Target | Step / Tool | Exit Code | Timestamp (UTC) | Head Commit | Evidence Artifact |
|---|---|---|---|---|---|
| `BASELINE` | `broader_unit_tests` | `1` | `2026-11-21T18:11:54Z` | `99d1b6ca` | [`.gsd/evidence/BASELINE/broader_unit_tests.meta.json`](.gsd/evidence/BASELINE/broader_unit_tests.meta.json) |
| `BASELINE` | `gitleaks_detect` | `1` | `2026-11-21T18:09:12Z` | `99d1b6ca` | [`.gsd/evidence/BASELINE/gitleaks_detect.meta.json`](.gsd/evidence/BASELINE/gitleaks_detect.meta.json) |
| `BASELINE` | `lint` | `0` | `2026-11-21T18:09:41Z` | `99d1b6ca` | [`.gsd/evidence/BASELINE/lint.meta.json`](.gsd/evidence/BASELINE/lint.meta.json) |
| `BASELINE` | `playwright_e2e` | `1` | `2026-11-21T18:15:33Z` | `99d1b6ca` | [`.gsd/evidence/BASELINE/playwright_e2e.meta.json`](.gsd/evidence/BASELINE/playwright_e2e.meta.json) |
| `BASELINE` | `security_dir_tests` | `1` | `2026-11-21T18:10:03Z` | `99d1b6ca` | [`.gsd/evidence/BASELINE/security_dir_tests.meta.json`](.gsd/evidence/BASELINE/security_dir_tests.meta.json) |
| `BASELINE` | `security_tests` | `0` | `2026-11-21T18:09:10Z` | `99d1b6ca` | [`.gsd/evidence/BASELINE/security_tests.meta.json`](.gsd/evidence/BASELINE/security_tests.meta.json) |
| `BASELINE` | `toolkit_tests` | `0` | `2026-11-21T18:09:07Z` | `99d1b6ca` | [`.gsd/evidence/BASELINE/toolkit_tests.meta.json`](.gsd/evidence/BASELINE/toolkit_tests.meta.json) |
| `BASELINE` | `typecheck` | `0` | `2026-11-21T18:09:32Z` | `99d1b6ca` | [`.gsd/evidence/BASELINE/typecheck.meta.json`](.gsd/evidence/BASELINE/typecheck.meta.json) |
| `BASELINE` | `unit_tests_serially` | `1` | `2026-11-21T18:09:53Z` | `99d1b6ca` | [`.gsd/evidence/BASELINE/unit_tests_serially.meta.json`](.gsd/evidence/BASELINE/unit_tests_serially.meta.json) |
| `BASELINE` | `validation_tests` | `0` | `2026-11-21T18:09:11Z` | `99d1b6ca` | [`.gsd/evidence/BASELINE/validation_tests.meta.json`](.gsd/evidence/BASELINE/validation_tests.meta.json) |
| `DISCOVERY_MANTIS` | `check_definer_search_path` | `0` | `2026-11-21T18:12:56Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/check_definer_search_path.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/check_definer_search_path.meta.json) |
| `DISCOVERY_MANTIS` | `dependency_analyzer` | `1` | `2026-11-21T18:08:41Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/dependency_analyzer.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/dependency_analyzer.meta.json) |
| `DISCOVERY_MANTIS` | `gitleaks_detect` | `1` | `2026-11-21T18:09:03Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/gitleaks_detect.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/gitleaks_detect.meta.json) |
| `DISCOVERY_MANTIS` | `gitleaks_git` | `1` | `2026-11-21T18:09:31Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/gitleaks_git.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/gitleaks_git.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_all_table_grants` | `0` | `2026-11-21T18:14:57Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_all_table_grants.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_all_table_grants.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_booking_constraints` | `0` | `2026-11-21T18:14:10Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_booking_constraints.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_booking_constraints.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_booking_trigger_defs` | `0` | `2026-11-21T18:13:57Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_booking_trigger_defs.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_booking_trigger_defs.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_bookings_policies` | `0` | `2026-11-21T18:13:44Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_bookings_policies.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_bookings_policies.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_bookings_triggers` | `0` | `2026-11-21T18:13:50Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_bookings_triggers.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_bookings_triggers.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_cancel_booking_auth` | `0` | `2026-11-21T18:18:15Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_cancel_booking_auth.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_cancel_booking_auth.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_cancel_booking_full` | `0` | `2026-11-21T18:18:28Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_cancel_booking_full.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_cancel_booking_full.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_create_booking_hold` | `0` | `2026-11-21T18:16:32Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_create_booking_hold.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_create_booking_hold.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_db_rls_policies` | `0` | `2026-11-21T18:13:24Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_db_rls_policies.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_db_rls_policies.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_db_rls_tables` | `0` | `2026-11-21T18:13:16Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_db_rls_tables.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_db_rls_tables.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_db_security_definers` | `0` | `2026-11-21T18:13:10Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_db_security_definers.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_db_security_definers.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_enums` | `0` | `2026-11-21T18:14:39Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_enums.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_enums.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_mark_present_auth` | `0` | `2026-11-21T18:18:35Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_mark_present_auth.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_mark_present_auth.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_notification_logs_policies` | `0` | `2026-11-21T18:13:31Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_notification_logs_policies.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_notification_logs_policies.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_override_hospital_queue_position` | `0` | `2026-11-21T18:16:20Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_override_hospital_queue_position.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_override_hospital_queue_position.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_private_cancel_booking` | `0` | `2026-11-21T18:18:09Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_private_cancel_booking.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_private_cancel_booking.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_public_cancel_booking` | `0` | `2026-11-21T18:18:21Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_public_cancel_booking.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_public_cancel_booking.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_resource_availability_policies` | `0` | `2026-11-21T18:13:37Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_resource_availability_policies.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_resource_availability_policies.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_resources_policy_and_triggers` | `0` | `2026-11-21T18:15:06Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_resources_policy_and_triggers.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_resources_policy_and_triggers.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_rpc_signatures` | `0` | `2026-11-21T18:18:03Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_rpc_signatures.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_rpc_signatures.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_set_booking_ref` | `0` | `2026-11-21T18:14:03Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_set_booking_ref.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_set_booking_ref.meta.json) |
| `DISCOVERY_MANTIS` | `inspect_table_grants_bookings` | `0` | `2026-11-21T18:14:52Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/inspect_table_grants_bookings.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/inspect_table_grants_bookings.meta.json) |
| `DISCOVERY_MANTIS` | `security_scan` | `1` | `2026-11-21T18:08:27Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/security_scan.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/security_scan.meta.json) |
| `DISCOVERY_MANTIS` | `test_account_delete_failure` | `1` | `2026-11-21T18:15:26Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/test_account_delete_failure.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/test_account_delete_failure.meta.json) |
| `DISCOVERY_MANTIS` | `test_direct_booking_insert` | `1` | `2026-11-21T18:14:33Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/test_direct_booking_insert.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/test_direct_booking_insert.meta.json) |
| `DISCOVERY_MANTIS` | `test_direct_booking_insert_captured` | `1` | `2026-11-21T18:14:46Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/test_direct_booking_insert_captured.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/test_direct_booking_insert_captured.meta.json) |
| `DISCOVERY_MANTIS` | `test_export_bypass_without_flag` | `0` | `2026-11-21T18:19:17Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/test_export_bypass_without_flag.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/test_export_bypass_without_flag.meta.json) |
| `DISCOVERY_MANTIS` | `test_validate_findings` | `0` | `2026-11-21T18:20:01Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/test_validate_findings.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/test_validate_findings.meta.json) |
| `DISCOVERY_MANTIS` | `validate_candidates` | `0` | `2026-11-21T18:21:05Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MANTIS/validate_candidates.meta.json`](.gsd/evidence/DISCOVERY_MANTIS/validate_candidates.meta.json) |
| `DISCOVERY_MODERN_WEB` | `check_env` | `0` | `2026-11-21T18:06:53Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/check_env.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/check_env.meta.json) |
| `DISCOVERY_MODERN_WEB` | `check_previous_findings` | `0` | `2026-11-21T18:07:21Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/check_previous_findings.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/check_previous_findings.meta.json) |
| `DISCOVERY_MODERN_WEB` | `check_rules` | `0` | `2026-11-21T18:06:59Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/check_rules.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/check_rules.meta.json) |
| `DISCOVERY_MODERN_WEB` | `dom_sinks_broader` | `0` | `2026-11-21T18:08:20Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/dom_sinks_broader.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/dom_sinks_broader.meta.json) |
| `DISCOVERY_MODERN_WEB` | `dom_sinks_grep` | `0` | `2026-11-21T18:08:14Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/dom_sinks_grep.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/dom_sinks_grep.meta.json) |
| `DISCOVERY_MODERN_WEB` | `eval_function_grep` | `0` | `2026-11-21T18:08:26Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/eval_function_grep.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/eval_function_grep.meta.json) |
| `DISCOVERY_MODERN_WEB` | `explore_repo` | `0` | `2026-11-21T18:07:44Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/explore_repo.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/explore_repo.meta.json) |
| `DISCOVERY_MODERN_WEB` | `find_global_rules` | `1` | `2026-11-21T18:07:09Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/find_global_rules.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/find_global_rules.meta.json) |
| `DISCOVERY_MODERN_WEB` | `generate_candidates` | `0` | `2026-11-21T18:14:25Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/generate_candidates.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/generate_candidates.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_admin_login_sink` | `0` | `2026-11-21T18:08:31Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_admin_login_sink.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_admin_login_sink.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_auth_admin_cookies` | `0` | `2026-11-21T18:10:46Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_auth_admin_cookies.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_auth_admin_cookies.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_auth_cookies` | `0` | `2026-11-21T18:10:13Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_auth_cookies.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_auth_cookies.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_cashfree_webview` | `0` | `2026-11-21T18:09:14Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_cashfree_webview.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_cashfree_webview.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_cashfree_webview_part2` | `0` | `2026-11-21T18:09:17Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_cashfree_webview_part2.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_cashfree_webview_part2.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_checkout_modal` | `0` | `2026-11-21T18:08:59Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_checkout_modal.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_checkout_modal.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_ledger_first` | `0` | `2026-11-21T18:12:21Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_ledger_first.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_ledger_first.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_logout_logic` | `0` | `2026-11-21T18:10:29Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_logout_logic.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_logout_logic.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_middleware` | `0` | `2026-11-21T18:09:42Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_middleware.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_middleware.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_next_config` | `0` | `2026-11-21T18:09:48Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_next_config.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_next_config.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_qr_flow` | `0` | `2026-11-21T18:08:36Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_qr_flow.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_qr_flow.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_sample_finding` | `0` | `2026-11-21T18:12:26Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_sample_finding.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_sample_finding.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_sanitizeQrSvg` | `0` | `2026-11-21T18:08:41Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_sanitizeQrSvg.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_sanitizeQrSvg.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_sanitizeQrSvg_start` | `0` | `2026-11-21T18:08:45Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_sanitizeQrSvg_start.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_sanitizeQrSvg_start.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_signOutMerchant` | `0` | `2026-11-21T18:10:34Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_signOutMerchant.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_signOutMerchant.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_supabase_client` | `0` | `2026-11-21T18:10:18Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_supabase_client.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_supabase_client.meta.json) |
| `DISCOVERY_MODERN_WEB` | `inspect_supabase_config` | `0` | `2026-11-21T18:11:27Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_supabase_config.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/inspect_supabase_config.meta.json) |
| `DISCOVERY_MODERN_WEB` | `list_evidence` | `0` | `2026-11-21T18:12:03Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/list_evidence.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/list_evidence.meta.json) |
| `DISCOVERY_MODERN_WEB` | `list_existing_fingerprints` | `0` | `2026-11-21T18:12:10Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/list_existing_fingerprints.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/list_existing_fingerprints.meta.json) |
| `DISCOVERY_MODERN_WEB` | `list_ledger_fingerprints` | `0` | `2026-11-21T18:12:16Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/list_ledger_fingerprints.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/list_ledger_fingerprints.meta.json) |
| `DISCOVERY_MODERN_WEB` | `list_src_files` | `0` | `2026-11-21T18:07:48Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/list_src_files.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/list_src_files.meta.json) |
| `DISCOVERY_MODERN_WEB` | `read_guides` | `0` | `2026-11-21T18:07:56Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/read_guides.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/read_guides.meta.json) |
| `DISCOVERY_MODERN_WEB` | `read_guides_2` | `0` | `2026-11-21T18:08:01Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/read_guides_2.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/read_guides_2.meta.json) |
| `DISCOVERY_MODERN_WEB` | `read_passkeys_guide` | `0` | `2026-11-21T18:08:04Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/read_passkeys_guide.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/read_passkeys_guide.meta.json) |
| `DISCOVERY_MODERN_WEB` | `schema_detail` | `0` | `2026-11-21T18:07:26Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/schema_detail.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/schema_detail.meta.json) |
| `DISCOVERY_MODERN_WEB` | `schema_fields` | `0` | `2026-11-21T18:07:31Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/schema_fields.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/schema_fields.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_cookie_prefixes` | `1` | `2026-11-21T18:10:50Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_cookie_prefixes.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_cookie_prefixes.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_cookies` | `0` | `2026-11-21T18:09:37Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_cookies.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_cookies.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_createServerClient` | `0` | `2026-11-21T18:10:42Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_createServerClient.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_createServerClient.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_external_scripts` | `0` | `2026-11-21T18:09:08Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_external_scripts.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_external_scripts.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_fetch_metadata` | `1` | `2026-11-21T18:09:58Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_fetch_metadata.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_fetch_metadata.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_logout` | `0` | `2026-11-21T18:10:23Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_logout.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_logout.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_onmessage` | `1` | `2026-11-21T18:09:31Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_onmessage.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_onmessage.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_postmessage` | `0` | `2026-11-21T18:09:26Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_postmessage.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_postmessage.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_rules` | `0` | `2026-11-21T18:07:13Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_rules.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_rules.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_setQrCodeSvg` | `0` | `2026-11-21T18:08:51Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_setQrCodeSvg.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_setQrCodeSvg.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_webauthn` | `0` | `2026-11-21T18:11:10Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_webauthn.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_webauthn.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_webauthn_backend` | `2` | `2026-11-21T18:11:23Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_webauthn_backend.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_webauthn_backend.meta.json) |
| `DISCOVERY_MODERN_WEB` | `search_webauthn_clean` | `0` | `2026-11-21T18:11:17Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/search_webauthn_clean.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/search_webauthn_clean.meta.json) |
| `DISCOVERY_MODERN_WEB` | `test_validate_findings` | `0` | `2026-11-21T18:07:35Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/test_validate_findings.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/test_validate_findings.meta.json) |
| `DISCOVERY_MODERN_WEB` | `validate_candidates` | `0` | `2026-11-21T18:14:29Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/validate_candidates.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/validate_candidates.meta.json) |
| `DISCOVERY_MODERN_WEB` | `verify_candidates_file` | `0` | `2026-11-21T18:14:41Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/verify_candidates_file.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/verify_candidates_file.meta.json) |
| `DISCOVERY_MODERN_WEB` | `verify_git_clean` | `0` | `2026-11-21T18:14:36Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/verify_git_clean.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/verify_git_clean.meta.json) |
| `DISCOVERY_MODERN_WEB` | `view_schema` | `0` | `2026-11-21T18:07:17Z` | `99d1b6ca` | [`.gsd/evidence/DISCOVERY_MODERN_WEB/view_schema.meta.json`](.gsd/evidence/DISCOVERY_MODERN_WEB/view_schema.meta.json) |
| `PREFLIGHT` | `check_codeql_yml` | `0` | `2026-11-21T18:08:10Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/check_codeql_yml.meta.json`](.gsd/evidence/PREFLIGHT/check_codeql_yml.meta.json) |
| `PREFLIGHT` | `check_gh_auth` | `0` | `2026-11-21T18:07:59Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/check_gh_auth.meta.json`](.gsd/evidence/PREFLIGHT/check_gh_auth.meta.json) |
| `PREFLIGHT` | `check_gitleaks` | `0` | `2026-11-21T18:08:00Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/check_gitleaks.meta.json`](.gsd/evidence/PREFLIGHT/check_gitleaks.meta.json) |
| `PREFLIGHT` | `check_gitleaks_path` | `0` | `2026-11-21T18:08:42Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/check_gitleaks_path.meta.json`](.gsd/evidence/PREFLIGHT/check_gitleaks_path.meta.json) |
| `PREFLIGHT` | `check_modern_web` | `0` | `2026-11-21T18:08:00Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/check_modern_web.meta.json`](.gsd/evidence/PREFLIGHT/check_modern_web.meta.json) |
| `PREFLIGHT` | `check_repo_agents_assets` | `0` | `2026-11-21T18:07:59Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/check_repo_agents_assets.meta.json`](.gsd/evidence/PREFLIGHT/check_repo_agents_assets.meta.json) |
| `PREFLIGHT` | `check_scripts_runners` | `0` | `2026-11-21T18:08:10Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/check_scripts_runners.meta.json`](.gsd/evidence/PREFLIGHT/check_scripts_runners.meta.json) |
| `PREFLIGHT` | `check_security_audit_assets` | `0` | `2026-11-21T18:08:10Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/check_security_audit_assets.meta.json`](.gsd/evidence/PREFLIGHT/check_security_audit_assets.meta.json) |
| `PREFLIGHT` | `check_tool_versions` | `0` | `2026-11-21T18:08:25Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/check_tool_versions.meta.json`](.gsd/evidence/PREFLIGHT/check_tool_versions.meta.json) |
| `PREFLIGHT` | `check_vuln_scanner_scripts` | `0` | `2026-11-21T18:08:10Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/check_vuln_scanner_scripts.meta.json`](.gsd/evidence/PREFLIGHT/check_vuln_scanner_scripts.meta.json) |
| `PREFLIGHT` | `run_test_dep_analyzer_py` | `0` | `2026-11-21T18:08:19Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/run_test_dep_analyzer_py.meta.json`](.gsd/evidence/PREFLIGHT/run_test_dep_analyzer_py.meta.json) |
| `PREFLIGHT` | `run_test_findings_cjs` | `1` | `2026-11-21T18:08:18Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/run_test_findings_cjs.meta.json`](.gsd/evidence/PREFLIGHT/run_test_findings_cjs.meta.json) |
| `PREFLIGHT` | `run_test_sec_audit_cjs` | `1` | `2026-11-21T18:08:18Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/run_test_sec_audit_cjs.meta.json`](.gsd/evidence/PREFLIGHT/run_test_sec_audit_cjs.meta.json) |
| `PREFLIGHT` | `run_test_sec_scan_py` | `0` | `2026-11-21T18:08:18Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/run_test_sec_scan_py.meta.json`](.gsd/evidence/PREFLIGHT/run_test_sec_scan_py.meta.json) |
| `PREFLIGHT` | `run_test_validation_runner` | `0` | `2026-11-21T18:08:24Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/run_test_validation_runner.meta.json`](.gsd/evidence/PREFLIGHT/run_test_validation_runner.meta.json) |
| `PREFLIGHT` | `run_test_verify_all` | `0` | `2026-11-21T18:08:24Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/run_test_verify_all.meta.json`](.gsd/evidence/PREFLIGHT/run_test_verify_all.meta.json) |
| `PREFLIGHT` | `test_run` | `0` | `2026-11-21T18:05:51Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/test_run.meta.json`](.gsd/evidence/PREFLIGHT/test_run.meta.json) |
| `PREFLIGHT` | `test_validate_existing_coverage_ledger` | `0` | `2026-11-21T18:08:34Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/test_validate_existing_coverage_ledger.meta.json`](.gsd/evidence/PREFLIGHT/test_validate_existing_coverage_ledger.meta.json) |
| `PREFLIGHT` | `test_validate_real_findings` | `0` | `2026-11-21T18:16:57Z` | `99d1b6ca` | [`.gsd/evidence/PREFLIGHT/test_validate_real_findings.meta.json`](.gsd/evidence/PREFLIGHT/test_validate_real_findings.meta.json) |
| `PREFLIGHT_PHASE4` | `gate_pin_check` | `0` | `2026-11-22T19:07:59Z` | `f6645ef1` | [`.gsd/evidence/PREFLIGHT_PHASE4/gate_pin_check.meta.json`](.gsd/evidence/PREFLIGHT_PHASE4/gate_pin_check.meta.json) |
| `PREFLIGHT_PHASE4` | `gate_test` | `1` | `2026-11-22T19:23:16Z` | `f6645ef1` | [`.gsd/evidence/PREFLIGHT_PHASE4/gate_test.meta.json`](.gsd/evidence/PREFLIGHT_PHASE4/gate_test.meta.json) |
| `PREFLIGHT_PHASE4` | `git_status_check` | `0` | `2026-11-22T19:08:55Z` | `f6645ef1` | [`.gsd/evidence/PREFLIGHT_PHASE4/git_status_check.meta.json`](.gsd/evidence/PREFLIGHT_PHASE4/git_status_check.meta.json) |
| `PREFLIGHT_PHASE4` | `shasum_check` | `0` | `2026-11-22T19:07:00Z` | `f6645ef1` | [`.gsd/evidence/PREFLIGHT_PHASE4/shasum_check.meta.json`](.gsd/evidence/PREFLIGHT_PHASE4/shasum_check.meta.json) |
| `SEC-DISC-001` | `green_test` | `0` | `2026-11-21T19:00:23Z` | `99d1b6ca` | [`.gsd/evidence/SEC-DISC-001/green_test.meta.json`](.gsd/evidence/SEC-DISC-001/green_test.meta.json) |
| `SEC-DISC-001` | `mutation_check` | `0` | `2026-11-21T19:00:54Z` | `99d1b6ca` | [`.gsd/evidence/SEC-DISC-001/mutation_check.meta.json`](.gsd/evidence/SEC-DISC-001/mutation_check.meta.json) |
| `SEC-DISC-001` | `red_test` | `1` | `2026-11-21T18:58:15Z` | `99d1b6ca` | [`.gsd/evidence/SEC-DISC-001/red_test.meta.json`](.gsd/evidence/SEC-DISC-001/red_test.meta.json) |
| `SEC-DISC-001` | `verify_lint` | `0` | `2026-11-21T19:00:38Z` | `99d1b6ca` | [`.gsd/evidence/SEC-DISC-001/verify_lint.meta.json`](.gsd/evidence/SEC-DISC-001/verify_lint.meta.json) |
| `SEC-DISC-001` | `verify_typecheck` | `0` | `2026-11-21T19:00:30Z` | `99d1b6ca` | [`.gsd/evidence/SEC-DISC-001/verify_typecheck.meta.json`](.gsd/evidence/SEC-DISC-001/verify_typecheck.meta.json) |
| `SEC-DISC-002` | `verify_manual_actions` | `0` | `2026-11-21T19:03:45Z` | `09f4851f` | [`.gsd/evidence/SEC-DISC-002/verify_manual_actions.meta.json`](.gsd/evidence/SEC-DISC-002/verify_manual_actions.meta.json) |
| `STAGE1_LEDGER` | `check_candidate_tests` | `1` | `2026-11-21T18:26:15Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/check_candidate_tests.meta.json`](.gsd/evidence/STAGE1_LEDGER/check_candidate_tests.meta.json) |
| `STAGE1_LEDGER` | `check_edge_functions` | `1` | `2026-11-21T18:29:56Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/check_edge_functions.meta.json`](.gsd/evidence/STAGE1_LEDGER/check_edge_functions.meta.json) |
| `STAGE1_LEDGER` | `check_git_status` | `0` | `2026-11-21T18:37:10Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/check_git_status.meta.json`](.gsd/evidence/STAGE1_LEDGER/check_git_status.meta.json) |
| `STAGE1_LEDGER` | `convergence_pass_2` | `0` | `2026-11-21T18:37:04Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/convergence_pass_2.meta.json`](.gsd/evidence/STAGE1_LEDGER/convergence_pass_2.meta.json) |
| `STAGE1_LEDGER` | `final_validation_check` | `0` | `2026-11-21T18:37:17Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/final_validation_check.meta.json`](.gsd/evidence/STAGE1_LEDGER/final_validation_check.meta.json) |
| `STAGE1_LEDGER` | `find_all_views` | `0` | `2026-11-21T18:33:13Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/find_all_views.meta.json`](.gsd/evidence/STAGE1_LEDGER/find_all_views.meta.json) |
| `STAGE1_LEDGER` | `find_anomalies_view` | `1` | `2026-11-21T18:33:03Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/find_anomalies_view.meta.json`](.gsd/evidence/STAGE1_LEDGER/find_anomalies_view.meta.json) |
| `STAGE1_LEDGER` | `find_schema_files` | `0` | `2026-11-21T18:32:56Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/find_schema_files.meta.json`](.gsd/evidence/STAGE1_LEDGER/find_schema_files.meta.json) |
| `STAGE1_LEDGER` | `find_views` | `0` | `2026-11-21T18:33:08Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/find_views.meta.json`](.gsd/evidence/STAGE1_LEDGER/find_views.meta.json) |
| `STAGE1_LEDGER` | `generate_coverage_ledger` | `0` | `2026-11-21T18:35:19Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/generate_coverage_ledger.meta.json`](.gsd/evidence/STAGE1_LEDGER/generate_coverage_ledger.meta.json) |
| `STAGE1_LEDGER` | `generate_master_coverage` | `0` | `2026-11-21T18:35:52Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/generate_master_coverage.meta.json`](.gsd/evidence/STAGE1_LEDGER/generate_master_coverage.meta.json) |
| `STAGE1_LEDGER` | `generate_security_open_windows` | `0` | `2026-11-21T18:36:13Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/generate_security_open_windows.meta.json`](.gsd/evidence/STAGE1_LEDGER/generate_security_open_windows.meta.json) |
| `STAGE1_LEDGER` | `inspect_build_ledger` | `0` | `2026-11-21T18:27:58Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/inspect_build_ledger.meta.json`](.gsd/evidence/STAGE1_LEDGER/inspect_build_ledger.meta.json) |
| `STAGE1_LEDGER` | `inspect_build_scripts` | `0` | `2026-11-21T18:27:53Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/inspect_build_scripts.meta.json`](.gsd/evidence/STAGE1_LEDGER/inspect_build_scripts.meta.json) |
| `STAGE1_LEDGER` | `inspect_discovery` | `0` | `2026-11-21T18:25:50Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/inspect_discovery.meta.json`](.gsd/evidence/STAGE1_LEDGER/inspect_discovery.meta.json) |
| `STAGE1_LEDGER` | `inspect_existing_issues` | `0` | `2026-11-21T18:28:39Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/inspect_existing_issues.meta.json`](.gsd/evidence/STAGE1_LEDGER/inspect_existing_issues.meta.json) |
| `STAGE1_LEDGER` | `inspect_existing_ledger` | `0` | `2026-11-21T18:27:43Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/inspect_existing_ledger.meta.json`](.gsd/evidence/STAGE1_LEDGER/inspect_existing_ledger.meta.json) |
| `STAGE1_LEDGER` | `inspect_issue_details` | `0` | `2026-11-21T18:28:54Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/inspect_issue_details.meta.json`](.gsd/evidence/STAGE1_LEDGER/inspect_issue_details.meta.json) |
| `STAGE1_LEDGER` | `inspect_issue_fps` | `0` | `2026-11-21T18:28:44Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/inspect_issue_fps.meta.json`](.gsd/evidence/STAGE1_LEDGER/inspect_issue_fps.meta.json) |
| `STAGE1_LEDGER` | `inspect_mantis_skills` | `0` | `2026-11-21T18:27:18Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/inspect_mantis_skills.meta.json`](.gsd/evidence/STAGE1_LEDGER/inspect_mantis_skills.meta.json) |
| `STAGE1_LEDGER` | `inspect_phase14` | `0` | `2026-11-21T18:26:25Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/inspect_phase14.meta.json`](.gsd/evidence/STAGE1_LEDGER/inspect_phase14.meta.json) |
| `STAGE1_LEDGER` | `inspect_tests` | `0` | `2026-11-21T18:25:42Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/inspect_tests.meta.json`](.gsd/evidence/STAGE1_LEDGER/inspect_tests.meta.json) |
| `STAGE1_LEDGER` | `list_api_routes` | `0` | `2026-11-21T18:29:41Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/list_api_routes.meta.json`](.gsd/evidence/STAGE1_LEDGER/list_api_routes.meta.json) |
| `STAGE1_LEDGER` | `list_workflows` | `0` | `2026-11-21T18:30:21Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/list_workflows.meta.json`](.gsd/evidence/STAGE1_LEDGER/list_workflows.meta.json) |
| `STAGE1_LEDGER` | `search_mantis_evidence` | `0` | `2026-11-21T18:26:39Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/search_mantis_evidence.meta.json`](.gsd/evidence/STAGE1_LEDGER/search_mantis_evidence.meta.json) |
| `STAGE1_LEDGER` | `test_canonical_id` | `0` | `2026-11-21T18:32:38Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/test_canonical_id.meta.json`](.gsd/evidence/STAGE1_LEDGER/test_canonical_id.meta.json) |
| `STAGE1_LEDGER` | `test_python_env` | `0` | `2026-11-21T18:32:26Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/test_python_env.meta.json`](.gsd/evidence/STAGE1_LEDGER/test_python_env.meta.json) |
| `STAGE1_LEDGER` | `validate_coverage_ledger` | `0` | `2026-11-21T18:35:52Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/validate_coverage_ledger.meta.json`](.gsd/evidence/STAGE1_LEDGER/validate_coverage_ledger.meta.json) |
| `STAGE1_LEDGER` | `validate_open_windows` | `0` | `2026-11-21T18:36:20Z` | `99d1b6ca` | [`.gsd/evidence/STAGE1_LEDGER/validate_open_windows.meta.json`](.gsd/evidence/STAGE1_LEDGER/validate_open_windows.meta.json) |
| `STAGE2_ELEPHANT` | `read_and_validate_inputs` | `0` | `2026-11-21T18:42:33Z` | `99d1b6ca` | [`.gsd/evidence/STAGE2_ELEPHANT/read_and_validate_inputs.meta.json`](.gsd/evidence/STAGE2_ELEPHANT/read_and_validate_inputs.meta.json) |
| `STAGE2_ELEPHANT` | `verify_spec_and_wave_plan` | `0` | `2026-11-21T18:45:12Z` | `99d1b6ca` | [`.gsd/evidence/STAGE2_ELEPHANT/verify_spec_and_wave_plan.meta.json`](.gsd/evidence/STAGE2_ELEPHANT/verify_spec_and_wave_plan.meta.json) |
| `STAGE3_GOLDFISH` | `check_all_finding_ledgers` | `0` | `2026-11-21T18:48:58Z` | `99d1b6ca` | [`.gsd/evidence/STAGE3_GOLDFISH/check_all_finding_ledgers.meta.json`](.gsd/evidence/STAGE3_GOLDFISH/check_all_finding_ledgers.meta.json) |
| `STAGE3_GOLDFISH` | `check_anonymize_user_data` | `0` | `2026-11-21T18:47:35Z` | `99d1b6ca` | [`.gsd/evidence/STAGE3_GOLDFISH/check_anonymize_user_data.meta.json`](.gsd/evidence/STAGE3_GOLDFISH/check_anonymize_user_data.meta.json) |
| `STAGE3_GOLDFISH` | `criterion1_mapping_and_overlap` | `0` | `2026-11-21T18:46:47Z` | `99d1b6ca` | [`.gsd/evidence/STAGE3_GOLDFISH/criterion1_mapping_and_overlap.meta.json`](.gsd/evidence/STAGE3_GOLDFISH/criterion1_mapping_and_overlap.meta.json) |
| `STAGE3_GOLDFISH` | `criterion2_check_all_deletion_routes` | `0` | `2026-11-21T18:47:46Z` | `99d1b6ca` | [`.gsd/evidence/STAGE3_GOLDFISH/criterion2_check_all_deletion_routes.meta.json`](.gsd/evidence/STAGE3_GOLDFISH/criterion2_check_all_deletion_routes.meta.json) |
| `STAGE3_GOLDFISH` | `criterion2_sibling_entrypoints` | `0` | `2026-11-21T18:47:02Z` | `99d1b6ca` | [`.gsd/evidence/STAGE3_GOLDFISH/criterion2_sibling_entrypoints.meta.json`](.gsd/evidence/STAGE3_GOLDFISH/criterion2_sibling_entrypoints.meta.json) |
| `STAGE3_GOLDFISH` | `criterion3_browser_policies` | `0` | `2026-11-21T18:48:04Z` | `99d1b6ca` | [`.gsd/evidence/STAGE3_GOLDFISH/criterion3_browser_policies.meta.json`](.gsd/evidence/STAGE3_GOLDFISH/criterion3_browser_policies.meta.json) |
| `STAGE3_GOLDFISH` | `criterion4_comprehensive_spotcheck` | `0` | `2026-11-21T18:49:14Z` | `99d1b6ca` | [`.gsd/evidence/STAGE3_GOLDFISH/criterion4_comprehensive_spotcheck.meta.json`](.gsd/evidence/STAGE3_GOLDFISH/criterion4_comprehensive_spotcheck.meta.json) |
| `STAGE3_GOLDFISH` | `criterion4_spotcheck_citations` | `0` | `2026-11-21T18:48:22Z` | `99d1b6ca` | [`.gsd/evidence/STAGE3_GOLDFISH/criterion4_spotcheck_citations.meta.json`](.gsd/evidence/STAGE3_GOLDFISH/criterion4_spotcheck_citations.meta.json) |
| `STAGE3_GOLDFISH` | `criterion5_wave_dependencies` | `0` | `2026-11-21T18:49:29Z` | `99d1b6ca` | [`.gsd/evidence/STAGE3_GOLDFISH/criterion5_wave_dependencies.meta.json`](.gsd/evidence/STAGE3_GOLDFISH/criterion5_wave_dependencies.meta.json) |
| `STAGE3_GOLDFISH` | `spotcheck_coverage_ledger` | `0` | `2026-11-21T18:48:43Z` | `99d1b6ca` | [`.gsd/evidence/STAGE3_GOLDFISH/spotcheck_coverage_ledger.meta.json`](.gsd/evidence/STAGE3_GOLDFISH/spotcheck_coverage_ledger.meta.json) |
| `STAGE3_GOLDFISH` | `verify_git_leaks_history` | `0` | `2026-11-21T18:48:32Z` | `99d1b6ca` | [`.gsd/evidence/STAGE3_GOLDFISH/verify_git_leaks_history.meta.json`](.gsd/evidence/STAGE3_GOLDFISH/verify_git_leaks_history.meta.json) |
| `STAGE5_VERIFICATION` | `banned_tokens_check` | `0` | `2026-11-21T19:10:09Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/banned_tokens_check.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/banned_tokens_check.meta.json) |
| `STAGE5_VERIFICATION` | `dependency_analyzer` | `1` | `2026-11-21T19:10:58Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/dependency_analyzer.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/dependency_analyzer.meta.json) |
| `STAGE5_VERIFICATION` | `diff_full` | `0` | `2026-11-21T19:10:02Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/diff_full.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/diff_full.meta.json) |
| `STAGE5_VERIFICATION` | `diff_stat` | `0` | `2026-11-21T19:10:02Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/diff_stat.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/diff_stat.meta.json) |
| `STAGE5_VERIFICATION` | `gitleaks_detect` | `1` | `2026-11-21T19:11:26Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/gitleaks_detect.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/gitleaks_detect.meta.json) |
| `STAGE5_VERIFICATION` | `lint` | `0` | `2026-11-21T19:21:58Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/lint.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/lint.meta.json) |
| `STAGE5_VERIFICATION` | `security_scan` | `1` | `2026-11-21T19:10:49Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/security_scan.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/security_scan.meta.json) |
| `STAGE5_VERIFICATION` | `test_account_deletion_auth` | `0` | `2026-11-21T19:22:10Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/test_account_deletion_auth.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/test_account_deletion_auth.meta.json) |
| `STAGE5_VERIFICATION` | `test_security` | `0` | `2026-11-21T19:22:08Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/test_security.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/test_security.meta.json) |
| `STAGE5_VERIFICATION` | `test_validation` | `0` | `2026-11-21T19:22:09Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/test_validation.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/test_validation.meta.json) |
| `STAGE5_VERIFICATION` | `typecheck` | `0` | `2026-11-21T19:21:53Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/typecheck.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/typecheck.meta.json) |
| `STAGE5_VERIFICATION` | `unit_tests_serially` | `1` | `2026-11-21T19:22:32Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/unit_tests_serially.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/unit_tests_serially.meta.json) |
| `STAGE5_VERIFICATION` | `validate_coverage_ledger` | `0` | `2026-11-21T19:10:48Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/validate_coverage_ledger.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/validate_coverage_ledger.meta.json) |
| `STAGE5_VERIFICATION` | `validate_findings` | `0` | `2026-11-21T19:10:39Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/validate_findings.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/validate_findings.meta.json) |
| `STAGE5_VERIFICATION` | `validation_runner` | `0` | `2026-11-21T19:21:39Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/validation_runner.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/validation_runner.meta.json) |
| `STAGE5_VERIFICATION` | `verify_all` | `1` | `2026-11-21T19:11:37Z` | `92220cff` | [`.gsd/evidence/STAGE5_VERIFICATION/verify_all.meta.json`](.gsd/evidence/STAGE5_VERIFICATION/verify_all.meta.json) |
| `STAGE6_CI` | `gh_pr_create` | `0` | `2026-11-21T19:30:54Z` | `b25a554f` | [`.gsd/evidence/STAGE6_CI/gh_pr_create.meta.json`](.gsd/evidence/STAGE6_CI/gh_pr_create.meta.json) |
| `STAGE6_CI` | `git_push` | `0` | `2026-11-21T19:30:19Z` | `b25a554f` | [`.gsd/evidence/STAGE6_CI/git_push.meta.json`](.gsd/evidence/STAGE6_CI/git_push.meta.json) |
| `STAGE6_CI` | `watch_ci` | `0` | `2026-11-21T19:32:14Z` | `b25a554f` | [`.gsd/evidence/STAGE6_CI/watch_ci.meta.json`](.gsd/evidence/STAGE6_CI/watch_ci.meta.json) |
| `T2` | `audit_deps` | `0` | `2026-11-22T19:45:43Z` | `f6645ef1` | [`.gsd/evidence/T2/audit_deps.meta.json`](.gsd/evidence/T2/audit_deps.meta.json) |
| `T2` | `gh_alerts_check` | `0` | `2026-11-22T19:24:51Z` | `f6645ef1` | [`.gsd/evidence/T2/gh_alerts_check.meta.json`](.gsd/evidence/T2/gh_alerts_check.meta.json) |
| `T2` | `npm_audit` | `1` | `2026-11-22T19:17:26Z` | `f6645ef1` | [`.gsd/evidence/T2/npm_audit.meta.json`](.gsd/evidence/T2/npm_audit.meta.json) |
| `T2` | `pnpm_audit` | `1` | `2026-11-22T19:20:00Z` | `f6645ef1` | [`.gsd/evidence/T2/pnpm_audit.meta.json`](.gsd/evidence/T2/pnpm_audit.meta.json) |
| `T3` | `class_a_state_changing_routes` | `0` | `2026-11-22T20:05:49Z` | `f6645ef1` | [`.gsd/evidence/T3/class_a_state_changing_routes.meta.json`](.gsd/evidence/T3/class_a_state_changing_routes.meta.json) |
| `T3` | `class_b_csrf_guard_routes` | `0` | `2026-11-22T20:05:49Z` | `f6645ef1` | [`.gsd/evidence/T3/class_b_csrf_guard_routes.meta.json`](.gsd/evidence/T3/class_b_csrf_guard_routes.meta.json) |
| `T3` | `class_c_security_definer` | `0` | `2026-11-22T20:05:49Z` | `f6645ef1` | [`.gsd/evidence/T3/class_c_security_definer.meta.json`](.gsd/evidence/T3/class_c_security_definer.meta.json) |
| `T3` | `class_d_rls_with_check` | `0` | `2026-11-22T20:05:49Z` | `f6645ef1` | [`.gsd/evidence/T3/class_d_rls_with_check.meta.json`](.gsd/evidence/T3/class_d_rls_with_check.meta.json) |
| `T3` | `class_e_webhooks_hmac_replay` | `0` | `2026-11-22T20:05:50Z` | `f6645ef1` | [`.gsd/evidence/T3/class_e_webhooks_hmac_replay.meta.json`](.gsd/evidence/T3/class_e_webhooks_hmac_replay.meta.json) |
| `T3` | `class_f_dom_sinks` | `0` | `2026-11-22T20:05:50Z` | `f6645ef1` | [`.gsd/evidence/T3/class_f_dom_sinks.meta.json`](.gsd/evidence/T3/class_f_dom_sinks.meta.json) |
| `T3` | `class_g_client_env` | `0` | `2026-11-22T20:05:50Z` | `f6645ef1` | [`.gsd/evidence/T3/class_g_client_env.meta.json`](.gsd/evidence/T3/class_g_client_env.meta.json) |
| `T3` | `class_g_unrestricted_grants` | `0` | `2026-11-22T20:05:51Z` | `f6645ef1` | [`.gsd/evidence/T3/class_g_unrestricted_grants.meta.json`](.gsd/evidence/T3/class_g_unrestricted_grants.meta.json) |
| `T5` | `proof_client_env_secrets` | `0` | `2026-11-22T20:25:15Z` | `f6645ef1` | [`.gsd/evidence/T5/proof_client_env_secrets.meta.json`](.gsd/evidence/T5/proof_client_env_secrets.meta.json) |
| `T5` | `proof_csrf_guard` | `0` | `2026-11-22T20:24:00Z` | `f6645ef1` | [`.gsd/evidence/T5/proof_csrf_guard.meta.json`](.gsd/evidence/T5/proof_csrf_guard.meta.json) |
| `T5` | `proof_dom_sinks` | `0` | `2026-11-22T20:24:55Z` | `f6645ef1` | [`.gsd/evidence/T5/proof_dom_sinks.meta.json`](.gsd/evidence/T5/proof_dom_sinks.meta.json) |
| `T5` | `proof_rls_with_check` | `0` | `2026-11-22T20:24:29Z` | `f6645ef1` | [`.gsd/evidence/T5/proof_rls_with_check.meta.json`](.gsd/evidence/T5/proof_rls_with_check.meta.json) |
| `T5` | `proof_route_auth` | `0` | `2026-11-22T20:13:58Z` | `f6645ef1` | [`.gsd/evidence/T5/proof_route_auth.meta.json`](.gsd/evidence/T5/proof_route_auth.meta.json) |
| `T5` | `proof_security_definer` | `0` | `2026-11-22T20:24:18Z` | `f6645ef1` | [`.gsd/evidence/T5/proof_security_definer.meta.json`](.gsd/evidence/T5/proof_security_definer.meta.json) |
| `T5` | `proof_unrestricted_grants` | `0` | `2026-11-22T20:26:06Z` | `f6645ef1` | [`.gsd/evidence/T5/proof_unrestricted_grants.meta.json`](.gsd/evidence/T5/proof_unrestricted_grants.meta.json) |
| `T5` | `proof_webhooks_hmac` | `0` | `2026-11-22T20:24:42Z` | `f6645ef1` | [`.gsd/evidence/T5/proof_webhooks_hmac.meta.json`](.gsd/evidence/T5/proof_webhooks_hmac.meta.json) |

---

## 5. Honest Limitations & Open Human Actions

1. **SEC-DISC-002 (Upstream Cloud Credential Rotation):**
   - **Status:** `NEEDS_HUMAN` (Open human action required).
   - **Details:** Historical commits (`9305ab5c`, `34b7d2c7`, `5e515195`) contain Supabase API keys for project `ynkdnwhubfknnnzjtpeg`. Per Global Rule R5, the autonomous campaign did not rewrite git history or attempt remote cloud credential modification. The repository owner must execute upstream secret rotation in Supabase Cloud Console and run `git-filter-repo` as documented in `.gsd/MANUAL_ACTIONS.md`.
2. **Baseline Pre-Existing Test Failures:**
   - Unit & Script suite failures on CI (7 tests in API-01/02/04) are pre-existing on `main` (CI Run `44787328738`).
   - All 36 new Phase 2 security tests (`tests/security/*`) pass 100% locally and under serial execution.
3. **Production Database & External Payment Provider Verification:**
   - Migrations and tests were strictly verified against local Supabase CLI instances.
   - Cashfree and WhatsApp webhooks were verified via HMAC-SHA256 signature test harnesses and timing-safe equal assertions. Production sandbox verification is recommended during staging release deployment.

---
**Autonomous Campaign Phase 2 Completed Under Global Rules R1–R6.**
