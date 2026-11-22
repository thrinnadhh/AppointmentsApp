# Security Findings Recurrence Analysis — Phase 4 Root-Cause Investigation

**Repository:** `Appointments` (`apps/merchant-web`, `apps/customer-mobile`, `packages/shared`, `supabase/`)  
**Branch:** `security/window-closure-20261121` (PR #25)  
**Investigation Standard:** Standing Rules & Global Rule R2 (NO FABRICATION: every commit, file, line, and status empirically verified).  
**Generated At:** 2026-11-23T01:14:00Z (IST)

---

## 1. Executive Summary & Cause Distribution

To break the cycle of recurring security findings and ephemeral fixes, this investigation surveyed every ledger, audit report, drift analysis, and git historical artifact across all project campaigns (`.gsd/*`, `FULL_SECURITY_CLOSURE_REPORT.md`, `SECURITY_CLOSURE_FINAL_REPORT.md`, `2026-11-08_DRIFT_REPORT.md`, `docs/security/*`, `docs/decisions.md`, git commit history, and GitHub-native security alerts).

Findings are grouped strictly by **root cause class**, rather than individual symptom instances. Each group is classified with **exactly one** canonical recurrence cause:

| Recurrence Cause | Count | Description |
|:---|:---:|:---|
| `DISMISSED_NO_DECISION` | **5** | Issues dismissed as "unconfirmed" or "secondary defense" without automated test gates or formal human sign-off. |
| `SCANNER_NOISE` | **4** | Benign code patterns, test fixtures, or dead artifacts flagged repeatedly by heuristic scanners. |
| `NEW_CODE_SAME_CLASS` | **3** | A class was patched on existing files, but new migrations/routes reproduced the flaw due to lack of invariant gates. |
| `FIX_NEVER_TESTED` | **2** | Patches applied without a verified RED pre-test, causing immediate operational failure or test divergence. |
| `SIBLING_NOT_FIXED` | **2** | A fix addressed the primary instance but omitted adjacent sibling columns, procedures, or endpoints. |
| `REGRESSED_BY_LATER_COMMIT` | **2** | Legitimate security or functional behavior broken by a subsequent refactoring or cherry-pick commit. |
| `NEEDS_HUMAN_ACTION` | **2** | Issues requiring upstream cloud console action or human policy decisions that cannot be resolved in code alone. |
| `UNKNOWN` | **0** | Every single finding was definitively traced to an empirical root cause. |
| **Total Finding Groups** | **20** | **100% Accounted and Traceable** |

---

## 2. Root Cause Analysis by Group

### A. FIX_NEVER_TESTED (Count: 2)

#### Group 1: Service-Role Account Deletion Runtime Crash (`SEC-DISC-001`)
- **First Seen Commit:** `0dbcc32` (`20261121000002_immediate_account_deletion_and_single_admin.sql`)
- **Scans / Audits Reporting:** Stage 1 Discovery (`DISCOVERY_MANTIS`), Security Closure Gate Check 3.
- **Fix Tried:** In `apps/merchant-web/src/app/api/account/delete/route.ts:50-70`, `supabaseAdmin.rpc('delete_account_immediately')` was invoked without user context.
- **Why It Came Back:** `FIX_NEVER_TESTED`. The SQL migration enforced `v_uid := (SELECT auth.uid()); IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'`. The API handler was written to use `supabaseAdmin` (service role), where `auth.uid()` is null, without ever executing an automated pre-patch test against the live endpoint. When real callers requested account deletion, the route returned HTTP 500, violating DPDPA Section 12.
- **Citations:** `apps/merchant-web/src/app/api/account/delete/route.ts:50-70`, `supabase/migrations/20261121000002_immediate_account_deletion_and_single_admin.sql:40-60`.

#### Group 2: Decommissioned Razorpay Webhook Test Suite Divergence (`SEC-WIN-023`)
- **First Seen Commit:** `c31ae58` / `9d787f2`
- **Scans / Audits Reporting:** Mantis Wave 4 Audit, CI Security Suite.
- **Fix Tried:** Decommissioned the legacy route `apps/merchant-web/src/app/api/webhooks/razorpay/route.ts` to return HTTP 410 Gone unconditionally.
- **Why It Came Back:** `FIX_NEVER_TESTED`. The route handler was modified to return HTTP 410, but the existing regression test in `tests/security/strix-regression.test.mjs:30-40` was never updated to assert 410; it continued asserting 200, causing test failures until synchronized in commit `3125173`.
- **Citations:** `tests/security/strix-regression.test.mjs:30-40`, commit `3125173`.

---

### B. SIBLING_NOT_FIXED (Count: 2)

#### Group 3: Provider Governance & Payout Modification Bypass (`SEC-WIN-017` / `SEC-WIN-019`)
- **First Seen Commit:** `20261023` (Initial `guard_provider_governance()` trigger)
- **Scans / Audits Reporting:** Strix Deep Scan, Mantis Security Loop (`docs/security/SECURITY_LOOP_REPORT.md`).
- **Fix Tried:** Added trigger restrictions on `role` and `is_active` modifications in `providers`.
- **Why It Came Back:** `SIBLING_NOT_FIXED`. The initial trigger protected account status, but failed to protect sibling columns `providers.city`, `payout_upi_id`, `cashfree_app_id`, and `cashfree_vendor_id`. Merchants could still modify their payout routing and jurisdictional city via RPC `merchant_save_operational_settings`. Full resolution required migration `20261120000004_guard_provider_payout_and_city.sql:1-30` and `20261120000005_ignore_client_cashfree_settings.sql`.
- **Citations:** `supabase/migrations/20261120000004_guard_provider_payout_and_city.sql:1-30`.

#### Group 4: Inconsistent BOLA & Context Checks Across `SECURITY DEFINER` RPCs (`DB-01`)
- **First Seen Commit:** `20261001000002_reassign_auth_and_permission_lockdown.sql`
- **Scans / Audits Reporting:** Mantis Threat Model, Security Loop Arbiter (`docs/security/INDEPENDENT_ARBITER_REPORT.md`).
- **Fix Tried:** Replaced `CURRENT_USER = 'postgres'` checks in `reassign_booking_resource` and `reschedule_booking_slot`.
- **Why It Came Back:** `SIBLING_NOT_FIXED`. Developers patched individual RPCs as they were audited, but omitted sibling procedures (e.g. `submit_city_waitlist`, `anonymize_user_data`, `dispatch_booking_notification`), allowing unprivileged callers to execute administrative procedures without valid session bindings.
- **Citations:** `docs/security/SECURITY_LOOP_REPORT.md` Section A, commits `b962eb0`, `20261115000001`.

---

### C. REGRESSED_BY_LATER_COMMIT (Count: 2)

#### Group 5: Customer E2E Search Filter Keyword Regression
- **First Seen Commit:** PR #25 diff commit `3125173` / `6bf49a6`
- **Scans / Audits Reporting:** Playwright CI Run `44941418512` (`customer-app.spec.ts`).
- **Fix Tried:** Initial test asserted `'Orthodontist'` query matching seed clinic SVIMS Dental.
- **Why It Came Back:** `REGRESSED_BY_LATER_COMMIT` (commit `6bf49a6`). In `tests/e2e/customer-app.spec.ts:230`, a refactoring replaced query `'Orthodontist'` with generic string `'Specialty'`. Seed hospital records lacked the term 'Specialty', causing customer search assertions to fail. Reverted at root cause in commit `a7b81f3`.
- **Citations:** `tests/e2e/customer-app.spec.ts:230`, commit `a7b81f3`.

#### Group 6: Customer Reflection E2E OTP Modal Backdrop Interception
- **First Seen Commit:** `a7b81f3`
- **Scans / Audits Reporting:** Playwright CI Run `44942264935` (`customer-reflection.spec.ts`).
- **Fix Tried:** Clicked profile button after OTP verification.
- **Why It Came Back:** `REGRESSED_BY_LATER_COMMIT` (commit `a7b81f3`). When no active booking slot existed, the profile modal remained mounted on top of the navigation bar, intercepting subsequent click events. Remediated in commit `bd70603` by checking `btn-sign-out` directly and enforcing pre-test session reset.
- **Citations:** `tests/e2e/customer-reflection.spec.ts:418-428`, commit `bd70603`.

---

### D. NEW_CODE_SAME_CLASS (Count: 3)

#### Group 7: Missing `WITH CHECK` on Public PostgreSQL RLS Policies (`SEC-WIN-001`)
- **First Seen Commit:** `20261107000010_perf_consolidate_multiple_permissive_policies.sql`
- **Scans / Audits Reporting:** Supabase DB Linter, Mantis Structural Review.
- **Fix Tried:** Migration `20261120000001_harden_rls_with_check_and_grants.sql` added `WITH CHECK` clauses across existing tables.
- **Why It Came Back:** `NEW_CODE_SAME_CLASS`. Whenever new database migrations created new tables (e.g. `resource_leaves`, `merchant_vendor_splits`), authors wrote `CREATE POLICY ... FOR UPDATE USING (...)` without appending an equivalent `WITH CHECK` expression. In the absence of an automated catalog invariant test, new migrations continually reintroduced the vulnerability.
- **Citations:** `supabase/migrations/20261120000001_harden_rls_with_check_and_grants.sql:1-20`.

#### Group 8: Public EXECUTE Grants on Database Maintenance & Queue Functions (`SEC-WIN-020`)
- **First Seen Commit:** `20261001000002_reassign_auth_and_permission_lockdown.sql`
- **Scans / Audits Reporting:** Mantis Wave 1 Audit, Database Grants Allowlist Suite.
- **Fix Tried:** Migration `20261120000006_lockdown_maintenance_and_queue_rpcs.sql:1-20` revoked `EXECUTE` on 4 maintenance functions.
- **Why It Came Back:** `NEW_CODE_SAME_CLASS`. PostgreSQL defaults to `GRANT EXECUTE ON FUNCTION ... TO PUBLIC`. New functions created in forward migrations automatically inherited public execution permissions unless the author remembered to write explicit `REVOKE EXECUTE` statements.
- **Citations:** `supabase/migrations/20261120000006_lockdown_maintenance_and_queue_rpcs.sql:1-20`.

#### Group 9: State-Changing API Routes Without Shared Authentication Guards (`SEC-WIN-014`)
- **First Seen Commit:** `20261023` (Initial `apps/merchant-web/src/app/api/` route tree)
- **Scans / Audits Reporting:** Security Loop (`docs/security/SECURITY_LOOP_REPORT.md` API-01, API-04), Strix Scan.
- **Fix Tried:** Added route-specific auth calls in `/api/payments/create-order` and `/api/prescriptions/signed-url`.
- **Why It Came Back:** `NEW_CODE_SAME_CLASS`. As new endpoints were added to `apps/merchant-web/src/app/api/` (such as hospital management or refund routes), developers implemented ad-hoc parameter checks instead of binding to a uniform shared auth guard (`verifyAuthenticatedUser`, `verifyAdminRequest`, `verifyStaffManagerRequest`).
- **Citations:** `apps/merchant-web/src/app/api/payments/create-order/route.ts:30-91`.

---

### E. DISMISSED_NO_DECISION (Count: 5)

#### Group 10: Missing Origin and Sec-Fetch-Site Validation on Mutating API Routes (`MODWEB-006` / `API-05`)
- **First Seen Commit:** `20261023` (Phase 6 Hardening)
- **Scans / Audits Reporting:** Security Loop (API-05), Modern Web Guidance (MODWEB-006), Mantis Stage 1 Discovery.
- **Fix Tried:** Initially dismissed in `.gsd/DISMISSED_FINDINGS.md` as "unconfirmed secondary defense" because `Content-Type: application/json` triggers CORS preflight.
- **Why It Came Back:** `DISMISSED_NO_DECISION`. Dismissing without a test left all 33 state-changing cookie-authenticated endpoints exposed to cross-site request forgery and ambient session exploitation. Phase 2 re-opened the issue and implemented `apps/merchant-web/src/lib/csrf-guard.ts:10-40` with 100% test coverage.
- **Citations:** `.gsd/DISMISSED_FINDINGS.md:123-131`, `apps/merchant-web/src/lib/csrf-guard.ts:10-40`.

#### Group 11: Content-Security-Policy Employs 'unsafe-inline' Without Nonces (`MODWEB-004`)
- **First Seen Commit:** `20261023` (`apps/merchant-web/next.config.mjs`)
- **Scans / Audits Reporting:** Chrome Modern Web Guidance, Mantis Stage 1.
- **Fix Tried:** Dismissed in `.gsd/DISMISSED_FINDINGS.md:105-113` as "secondary containment layer with zero active XSS sinks".
- **Why It Came Back:** `DISMISSED_NO_DECISION`. Dismissal avoided addressing inline script execution risks. Phase 2 resolved this by generating per-request cryptographic nonces and deploying `Content-Security-Policy-Report-Only` in middleware.
- **Citations:** `.gsd/DISMISSED_FINDINGS.md:105-113`, `apps/merchant-web/src/middleware.ts:120-160`.

#### Group 12: Missing COOP and CORP Process Isolation Headers (`MODWEB-005`)
- **First Seen Commit:** `20261023` (`apps/merchant-web/next.config.mjs`)
- **Scans / Audits Reporting:** Chrome Modern Web Guidance, Mantis Stage 1.
- **Fix Tried:** Dismissed in `.gsd/DISMISSED_FINDINGS.md:114-122` due to fear of breaking Cashfree payment popup lifecycles.
- **Why It Came Back:** `DISMISSED_NO_DECISION`. Leaving headers unconfigured left the application exposed to cross-origin window manipulation. Phase 2 attached `Cross-Origin-Opener-Policy-Report-Only: same-origin-allow-popups` and `Cross-Origin-Resource-Policy: same-origin`.
- **Citations:** `.gsd/DISMISSED_FINDINGS.md:114-122`, `apps/merchant-web/src/middleware.ts:120-160`.

#### Group 13: Dynamic Cashfree SDK Script Loading Without Integrity or URL Verification (`MODWEB-007`)
- **First Seen Commit:** `20261114` (`apps/customer-mobile/src/screens/CheckoutModal.tsx`)
- **Scans / Audits Reporting:** Chrome Modern Web Guidance, Mantis Stage 1.
- **Fix Tried:** Dismissed in `.gsd/DISMISSED_FINDINGS.md:132-140` on grounds that pinning SRI hashes breaks when Cashfree pushes upstream CDN patches.
- **Why It Came Back:** `DISMISSED_NO_DECISION`. The dismissal left script loading completely unvalidated. Phase 2 resolved this with origin pinning to `https://sdk.cashfree.com` and URL structure validation via `isValidCashfreeScriptUrl`.
- **Citations:** `.gsd/DISMISSED_FINDINGS.md:132-140`, `apps/customer-mobile/src/screens/CheckoutModal.tsx:55-65`.

#### Group 14: Plaintext Storage of 4-Digit Check-In PIN at Rest (`SEC-WIN-018`)
- **First Seen Commit:** `20261024000003` (`public.customer_checkin_pins`)
- **Scans / Audits Reporting:** Mantis Stage 1 Discovery, Security Window Ledger.
- **Fix Tried:** Documented as ACCEPTED_RISK without persistent cryptographic vaulting, relying on compensating controls (60m pre-slot reveal, 5-failure rate limit, zero merchant SELECT grants).
- **Why It Came Back:** `DISMISSED_NO_DECISION`. Lacked a formal risk register entry and clear human governance decision. Now cataloged in `.gsd/RISK_REGISTER.md` awaiting human determination.
- **Citations:** `.gsd/SECURITY_WINDOW_LEDGER.md:32`, `docs/decisions.md:38`.

---

### F. NEEDS_HUMAN_ACTION (Count: 2)

#### Group 15: Leaked Supabase Cloud Credentials in Historical Git Commits (`SEC-DISC-002` / `SEC-WIN-024`)
- **First Seen Commit:** `9305ab5c32ecc4b00eab078583cf257ea6790d2f`
- **Scans / Audits Reporting:** Gitleaks, Mantis Stage 1 Discovery, Secret Scanning.
- **Fix Tried:** Removed secrets from active working tree files (`scripts/e2e-trinadh-hospital-test.mjs`, `tests/e2e/payment-full-flow.spec.ts`).
- **Why It Came Back:** `NEEDS_HUMAN_ACTION`. The keys remain permanently embedded in historical git commit packfiles. Agents cannot rotate production secrets on live cloud infrastructure or rewrite remote git history without human administrative authority. Escalated honestly in `.gsd/MANUAL_ACTIONS.md:1-35` and `.gsd/SECURITY_OPEN_WINDOWS.json`.
- **Citations:** `.gsd/MANUAL_ACTIONS.md:1-35`, `.gsd/SECURITY_OPEN_WINDOWS.json:95-177`.

#### Group 16: Inclusion of Demo Account Credentials in Local Dev Seed (`SEC-WIN-016`)
- **First Seen Commit:** `20260908` (`supabase/seed.sql`)
- **Scans / Audits Reporting:** Gitleaks, Mantis Wave 1 Audit.
- **Fix Tried:** Verified seed passwords (`password123`) apply solely to local Docker container resets (`supabase db reset`).
- **Why It Came Back:** `NEEDS_HUMAN_ACTION`. The repo requires mock fixtures for headless local developer tests, but scanners flag plaintext passwords. Requires explicit human acceptance in the Risk Register.
- **Citations:** `supabase/seed.sql:1-30`, `.gsd/SECURITY_CLOSURE_FINAL_REPORT.md:30`.

---

### G. SCANNER_NOISE (Count: 4)

#### Group 17: CodeQL Unused Local Variable Quality Notes (Alerts #711, #698, #697, #696, #695)
- **First Seen Commit:** `6f43e9eb1577bb44fe43207b40f7da6d98ea7aba`
- **Scans / Audits Reporting:** GitHub CodeQL (`js/unused-local-variable`).
- **Fix Tried:** None (open on `main`).
- **Why It Came Back:** `SCANNER_NOISE`. Unused variables (`isWithin60m` in `HomeScreen.tsx:154`, `saveLoading` in `schedule/page.tsx:52`, `getAdminAuthHeaders` in `admin/page.tsx:143`, `session` / `data` in `api.ts:579,1560`) are minor code quality / linting notes, not exploitable security vulnerabilities.
- **Citations:** `apps/customer-mobile/src/screens/HomeScreen.tsx:154`, `apps/merchant-web/src/app/schedule/page.tsx:52`, `apps/merchant-web/src/app/admin/page.tsx:143`.

#### Group 18: GitHub Secret Scanning Alert #1 (Synthetic Test Webhook Secret)
- **First Seen Commit:** `1f8b2f19f1d4b9193de3754a83938747381414ee`
- **Scans / Audits Reporting:** GitHub Secret Scanning (Alert #1).
- **Fix Tried:** None (open on GitHub).
- **Why It Came Back:** `SCANNER_NOISE`. Hardcoded dummy base64 string `whsec_dGVzdF9ob29rX3NlY3JldF8xMjM0NTY3ODkwMTI` ("test_hook_secret_123456789012") in test script `tests/scripts/test-whatsapp-integration.mjs:522` matched Stripe secret regex. It is a mock test token for an offline integration mock.
- **Citations:** `tests/scripts/test-whatsapp-integration.mjs:515-525`.

#### Group 19: JavaScript RegExp `.exec()` Misclassified as Python Code Injection
- **First Seen Commit:** Baseline Scan (`security_scan.py`)
- **Scans / Audits Reporting:** `security_scan.py` (`Category: Code injection risk`).
- **Fix Tried:** Dismissed in `.gsd/DISMISSED_FINDINGS.md:27-38`.
- **Why It Came Back:** `SCANNER_NOISE`. Naive substring matching for `exec(` flagged standard ECMAScript regular expression execution `actionRegex.exec(content)` in TypeScript files.
- **Citations:** `.gsd/DISMISSED_FINDINGS.md:27-38`.

#### Group 20: Dynamic Security Scanner Artifacts in Gitignored Output Folders (`SEC-WIN-010`)
- **First Seen Commit:** Baseline Scan (`security_scan.py`)
- **Scans / Audits Reporting:** `security_scan.py` flagging mock tokens in `strix_runs/`.
- **Fix Tried:** Dismissed in `.gsd/DISMISSED_FINDINGS.md:19-26`.
- **Why It Came Back:** `SCANNER_NOISE`. Historical offline scanner output dumps reside in `strix_runs/` which is fully gitignored in `.gitignore:88-90` with zero files tracked in the repository.
- **Citations:** `.gsd/DISMISSED_FINDINGS.md:19-26`, `.gitignore:88-90`.

---

## 3. Summary of Recurrence Causes

```
┌────────────────────────────────────────────────────────┐
│               RECURRENCE CAUSE TOTALS                  │
├───────────────────────────────┬────────────────────────┤
│ DISMISSED_NO_DECISION         │ 5                      │
│ SCANNER_NOISE                 │ 4                      │
│ NEW_CODE_SAME_CLASS           │ 3                      │
│ FIX_NEVER_TESTED              │ 2                      │
│ SIBLING_NOT_FIXED             │ 2                      │
│ REGRESSED_BY_LATER_COMMIT     │ 2                      │
│ NEEDS_HUMAN_ACTION            │ 2                      │
│ UNKNOWN                       │ 0                      │
├───────────────────────────────┼────────────────────────┤
│ TOTAL GROUPS ANALYZED         │ 20                     │
└───────────────────────────────┴────────────────────────┘
```
