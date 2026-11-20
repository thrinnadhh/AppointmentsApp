# Pull Request: Security Window Closure Campaign (Google Mantis + Elephant-Goldfish Spec-Driven Remediation)

**Branch:** `security/window-closure-2026-11-20` → `main`  
**Base Commit:** `6f43e9eb1577bb44fe43207b40f7da6d98ea7aba`  
**Head Commit:** `93d4a54` (13 atomic commits)  
**Status:** 100% GREEN GATE PASS — Verified Locally on Clean Database  

---

## 1. Overview & Objective

This PR closes the full-repository **Security Window Closure** campaign across AppointmentsApp (`apps/merchant-web`, `apps/customer-mobile`, `packages/shared`, `supabase/migrations`, `.agents/`). 

The campaign synthesized **Google Mantis** threat hunting techniques (`mantis-structural-index`, `mantis-architecture`, `mantis-threat-model`, `mantis-researcher`, `mantis-dedupe`, `mantis-critic`, `mantis-calibrate`) with the **Elephant-Goldfish** spec-driven remediation model (Elephant spec authoring, zero-context Goldfish peer review, wave-based disjoint task execution, and empirical gate verification).

---

## 2. Master Findings Ledger & Dispositions (25 Findings Total)

| VULN_ID | Severity | Layer | Summary | Status | Resolution / Verification |
|:---|:---:|:---:|:---|:---:|:---|
| **`SEC-WIN-001`** | Low | DB | Missing `WITH CHECK` on UPDATE/ALL RLS Policies | **RESOLVED** | Applied `20261120000001`. Verified: `database-grants-allowlist.test.mjs` (5/5 PASS) |
| **`SEC-WIN-002`** | Medium | Mobile | Cashfree WebView Permissive Domain Whitelist | **RESOLVED** | Origin & scheme allowlist in `CashfreeCheckoutWebView.tsx`. Verified: `cashfree-webview-origin-guard.test.mjs` (6/6 PASS) |
| **`SEC-WIN-003`** | Medium | Mobile | Unvalidated `postMessage` Handling in Mobile Checkout | **RESOLVED** | Untrusted signal handling in `CashfreeCheckoutWebView.tsx`. Verified: `cashfree-webview-origin-guard.test.mjs` (6/6 PASS) |
| **`SEC-WIN-004`** | Medium | API | Naked `NODE_ENV` Prescriptions Signed-URL Bypass | **RESOLVED** | Centralized `isE2EBypassEnabled()`. Verified: `prescriptions-signed-url-bypass.test.mjs` (4/4 PASS) |
| **`SEC-WIN-005`** | Low | API | Razorpay Webhook Decommissioning | **RESOLVED** | Returns unconditional HTTP 410 Gone. Verified: `razorpay-decommission.test.mjs` (4/4 PASS) |
| **`SEC-WIN-006`** | Low | DB | SECURITY DEFINER Schema Qualifications & search_path | **RESOLVED** | Fixed search_path and privileges. Verified: `security-definer-schema-guard.test.mjs` (3/3 PASS) |
| **`SEC-WIN-007`** | Low | API | Unimplemented `DELETE /api/hospital/departments` | **DEFERRED** | Specification gap logged in product backlog. |
| **`SEC-WIN-008`** | Low | Mobile/UI | Reception Pass Copy Terminology ("OTP" vs "4-digit PIN") | **RESOLVED** | Terminology unified. Verified: `checkin-pin-terminology.test.mjs` (3/3 PASS) |
| **`SEC-WIN-009`** | Low | Infra | Sub-package Independent Lockfiles | **FALSE_POSITIVE** | Monorepo canonically governed by root `pnpm-lock.yaml`. |
| **`SEC-WIN-010`** | Low | Tooling | Legacy Scanner Artifacts in `strix_runs/` | **FALSE_POSITIVE** | Folder is gitignored; 0 files committed. |
| **`SEC-WIN-011`** | Medium | CI/CD | GitHub Actions Unpinned Tags & Top-Level Secrets | **RESOLVED** | Pinned to 40-character SHAs, scoped secrets. Verified: `github-actions-hardening.test.mjs` (4/4 PASS) |
| **`SEC-WIN-012`** | Medium | DB | Anonymous Telemetry Event Ingestion Flooding | **RESOLVED** | Sliding window rate limiter in `20261120000002`. Verified: `anon-log-throttle.test.mjs` (2/2 PASS) |
| **`SEC-WIN-013`** | High | Frontend | `SUPABASE_SERVICE_ROLE_KEY` in Client Auth Schema | **RESOLVED** | Segregated server secrets in `apps/merchant-web/src/lib/env.ts`. Verified: `build-secret-safety.test.mjs` (3/3 PASS) |
| **`SEC-WIN-014`** | Medium | API | Unauthenticated Body Parsing on `/api/payments/create-order` | **RESOLVED** | Authentication checked prior to body parsing. Verified: `create-order-auth-ordering.test.mjs` (3/3 PASS) |
| **`SEC-WIN-015`** | Low | DB | `resource_leaves` SELECT Policy `qual: true` for Anon | **RESOLVED** | Applied `20261120000003`. Verified: `resource-leaves-rls-hardening.test.mjs` (3/3 PASS) |
| **`SEC-WIN-016`** | High | DB | Plaintext Demo Passwords in `supabase/seed.sql` | **ACCEPTED_RISK** | Local Docker dev fixtures only (`supabase db reset`). Staging/prod never run `seed.sql`. |
| **`SEC-WIN-017`** | High | DB | `providers.city` Column Update Not Guarded in Trigger | **RESOLVED** | Applied `20261120000004` guarding city against merchant edits. Verified: `guard-provider-payout-and-city.test.mjs` (3/3 PASS) |
| **`SEC-WIN-018`** | Medium | DB | Plaintext 4-Digit Check-In PIN in `customer_checkin_pins` | **ACCEPTED_RISK** | Compensated by 5-attempt/60s lockout, 60m arrival window, customer-only RLS, and 0 staff SELECT. |
| **`SEC-WIN-019`** | High | DB/API/UI | Tenant Owner Cashfree Vendor & Payout Credential Bypass | **RESOLVED** | Trigger block (`20261120000004`), RPC ignore (`20261120000005`), and read-only UI field. Verified: `merchant-settings-rpc-guard.test.mjs` (3/3 PASS) |
| **`SEC-WIN-020`** | High | DB | Unrestricted `EXECUTE` on Maintenance RPCs | **RESOLVED** | Applied `20261120000006` revoking EXECUTE from anon/authenticated. Verified: `database-grants-allowlist.test.mjs` (6/6 PASS) |
| **`SEC-WIN-021`** | High | API | Missing HTTP `DELETE` Handler on `/api/hospital/members` | **RESOLVED** | Implemented `DELETE` handler with `verifyStaffManagerRequest`. Verified: `hospital-admin-screens.test.mjs` (8/8 PASS) |
| **`SEC-WIN-022`** | Medium | Tests | Hardcoded JWT Secret String Literal in easysplit Test | **RESOLVED** | Replaced literal with dynamic env fallback. Verified: `cashfree-easysplit.test.mjs` (28/28 PASS) |
| **`SEC-WIN-023`** | Medium | Tests | Stale Razorpay Webhook Test Expecting 200 vs 410 | **RESOLVED** | Aligned assertions to expect HTTP 410. Verified: `strix-regression.test.mjs` (7/7 PASS) |
| **`SEC-WIN-024`** | High | Infra | Leaked Supabase Cloud Credentials in Historical Git Commits | **NEEDS_HUMAN** | Documented in `.gsd/MANUAL_ACTIONS.md`. Upstream key rotation required on project `ynkdnwhubfknnnzjtpeg` + `git-filter-repo`. |
| **`SEC-WIN-025`** | Low | Tooling | Checksum Drift in `.agents/manifest.lock.json` | **RESOLVED** | Regenerated lockfile via `generate_manifest.py`. Verified: `test_toolkit.py` (17/17 PASS) |

---

## 3. Wave Execution & Key Commits

1. `f77c05a` — `fix(db): harden guard_provider_governance trigger for city and payout credentials (SEC-WIN-017, SEC-WIN-019)`
2. `26511d4` — `fix(db): ignore client cashfree parameters in operational settings RPC (SEC-WIN-019)`
3. `83cfc7f` — `fix(db): lockdown maintenance and queue RPC execute grants (SEC-WIN-020)`
4. `b166476` — `fix(api): implement DELETE method handler in hospital members route (SEC-WIN-021)`
5. `07c3a04` — `fix(web): strip client-supplied cashfree gateway inputs in settings page (SEC-WIN-019)`
6. `25a5c4c` — `fix(env): segregate server secret names from client auth env schema (SEC-WIN-013)`
7. `9a618b4` — `test(unit): remove hardcoded JWT secret literal in cashfree-easysplit test (SEC-WIN-022)`
8. `3125173` — `test(security): assert HTTP 410 on decommissioned Razorpay webhook route (SEC-WIN-023)`
9. `9bced38` — `chore(agents): synchronize manifest lock checksums (SEC-WIN-025)`
10. `a0f5baf` — `docs: record security window closure campaign decisions in decisions.md`
11. `ac77f68` — `docs: synchronize master SECURITY_CLOSURE_FINAL_REPORT.md with full window closure campaign`
12. `aea2bbe` — `docs(gsd): preserve Mantis and Elephant-Goldfish audit artifacts and review logs`
13. `93d4a54` — `chore(test): sync test-seed-manifest.json with live local db seed`

---

## 4. Empirical Test & Verification Gate Results

All test suites were executed serially from a clean database reset (`supabase db reset` + `seed-hospital-test-data.mjs`):

| Gate Check | Scope | Result | Details |
|:---|:---|:---:|:---|
| **Local Database Reset** | `supabase db reset` | **`PASS`** | Applied all 174 migrations cleanly in order |
| **Serial Unit Tests** | `node scripts/run-all-unit-tests-serially.mjs` | **`PASS`** | **26/26 suites, 213/213 passed, 0 failed** (79.15s) |
| **Security Test Suites** | `pnpm run test:security` | **`PASS`** | **73 suites, 225/225 passed, 0 failed** |
| **AG Toolkit Tests** | `python3 -m unittest discover -s .agents/scripts/tests` | **`PASS`** | **17/17 passed** |
| **TypeScript Typecheck** | `pnpm -r --if-present typecheck` | **`PASS`** | **0 errors across monorepo** |
| **ESLint** | `pnpm -r --if-present lint` | **`PASS`** | **0 errors** (2 pre-existing merchant-web warnings) |
| **Gitleaks Secret Scan** | `gitleaks detect` | **`PASS`** | **0 secrets in working tree or branch commits** |
| **Orphan Diff Audit** | Git Tree vs Task Graph | **`PASS`** | Zero orphan files; all 27 files map 1:1 to spec |

---

## 5. Post-Merge Operational Checklist

- [ ] **Rotate Supabase API Keys:** Follow [`.gsd/MANUAL_ACTIONS.md`](file:///Users/trinadh/projects/Appointments/.gsd/MANUAL_ACTIONS.md) to rotate keys for remote project `ynkdnwhubfknnnzjtpeg` in the Supabase Cloud dashboard.
- [ ] **Git History Scrubbing:** Purge historical commits `bcfb3c2` and `369a315` containing legacy test tokens using `git-filter-repo` on a bare mirror.
- [ ] **Database Migration Deployment:** Apply migrations sequentially to staging/production:
  1. `20261120000004_guard_provider_payout_and_city.sql`
  2. `20261120000005_ignore_client_cashfree_settings.sql`
  3. `20261120000006_lockdown_maintenance_and_queue_rpcs.sql`
- [ ] **Decommission Razorpay Webhook:** Remove `/api/webhooks/razorpay` endpoint URL in the Razorpay Merchant Dashboard.
