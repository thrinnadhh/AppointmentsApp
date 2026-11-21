# Goldfish Spec Review Log

**Project:** Appointments Monorepo  
**Workflow:** Google Mantis + Elephant-Goldfish Spec-Driven Workflow  
**Spec Document:** [.gsd/SECURITY_REMEDIATION_SPEC.md](file:///Users/trinadh/projects/Appointments/.gsd/SECURITY_REMEDIATION_SPEC.md)  
**Task Graph:** [.gsd/SECURITY_TASKS.json](file:///Users/trinadh/projects/Appointments/.gsd/SECURITY_TASKS.json)  
**Catalog:** [.gsd/MANTIS_OPEN_ISSUES.json](file:///Users/trinadh/projects/Appointments/.gsd/MANTIS_OPEN_ISSUES.json)  

---

## Round 1 Review (2026-11-20 19:35 UTC / 2026-11-21 01:05 IST)
**Reviewer:** Zero-Context Goldfish Spec Reviewer (`7eae1582-cb5d-45aa-90f9-0b9f0a248883` - `mantis-critic` + `plan-checker`)  
**Verdict:** `GAPS_DETECTED`  

### Catches Identified & Elephant Remediations:

1. **Gap G1 (Merchant UI Regression Risk):**
   - *Catch:* The proposed migration in Fix Packet 3 initially contemplated revoking execute grants on notification RPCs, but `dispatch_booking_notification` is directly called from `apps/merchant-web/src/app/bookings/page.tsx:445` by `authenticated` users (`handleTriggerNotification`). Revoking `EXECUTE` from `authenticated` would cause an immediate regression and crash the merchant bookings triage screen.
   - *Remediation:* Explicitly preserved `GRANT EXECUTE ON FUNCTION public.dispatch_booking_notification TO authenticated, service_role`. Documented that `dispatch_booking_notification` already enforces internal authorization checks (caller must be an active admin, owner of the provider, or assigned consultant). Added as an explicit non-regression invariant in both the spec and `TASK-W1-03`.

2. **Gap G2 (PostgreSQL Signature Mismatch on Standby Queue):**
   - *Catch:* Fix Packet 3 listed `REVOKE EXECUTE ON FUNCTION public.expire_stale_standby_queue()` with 0 arguments. In PostgreSQL schema (`20261114000004_fix_human_journey_rpc_grants_and_triggers.sql`), the function is overloaded with parameters `(p_threshold_minutes integer DEFAULT 120, p_provider_id uuid DEFAULT NULL)`. Running zero-arg REVOKE would fail with `function public.expire_stale_standby_queue() does not exist`.
   - *Remediation:* Updated exact signature to `public.expire_stale_standby_queue(integer, uuid)` in spec and `TASK-W1-03`.

3. **Gap G3 (PostgreSQL Signature Mismatch on Refund Queue):**
   - *Catch:* Fix Packet 3 listed `REVOKE EXECUTE ON FUNCTION public.enqueue_refund_request(uuid, numeric, text, text)`. In the database schema, `enqueue_refund_request` accepts 3 parameters: `(p_booking_id uuid, p_actor_id uuid, p_reason text)`. The 4-arg REVOKE would fail with `function public.enqueue_refund_request(...) does not exist`.
   - *Remediation:* Updated exact signature to `public.enqueue_refund_request(uuid, uuid, text)` in spec and `TASK-W1-03`.

4. **Gap G4 (Test Invalidation via Staging Check):**
   - *Catch:* Existing draft tests `tests/security/guard-provider-payout-and-city.test.mjs` and `tests/security/merchant-settings-rpc-guard.test.mjs` contained draft-staging assertions (`assert.ok(!existsSync(migrationPath))`). When the migrations are created in `supabase/migrations/`, these tests would immediately fail on the staging check.
   - *Remediation:* Added explicit requirement in `TASK-W1-01` and `TASK-W1-02` to update the test files in the same atomic commit, removing the draft-staging assertion and asserting live database behavior directly against the active migration.

5. **Gap G5 (Standing Rule 3 Compliance for Hospital Members DELETE):**
   - *Catch:* `tests/unit/hospital-admin-screens.test.mjs` currently passes all 6 tests and has no test case asserting `DELETE /api/hospital/members`. Implementing the route without an initial failing test would violate Standing Rule 3 ("Every bug fix starts with a failing test").
   - *Remediation:* Added explicit requirement to author the failing test in `tests/unit/hospital-admin-screens.test.mjs` FIRST (asserting 200 for authorized admin, cancellation of pending invite, revocation of active member, and 403 for unauthorized caller), verifying pre-patch FAIL before implementing the route handler in `apps/merchant-web/src/app/api/hospital/members/route.ts`. Included test file in `target_files` of `TASK-W2-01`.

6. **Gap G6 (Standing Rule 3 Compliance for Client Secret Segregation):**
   - *Catch:* `tests/unit/build-secret-safety.test.mjs` tests cashfree import evaluations but lacks an assertion that `SUPABASE_SERVICE_ROLE_KEY` is absent from the client `AuthEnv` interface in `env.ts`.
   - *Remediation:* Added explicit requirement to author the failing test in `tests/unit/build-secret-safety.test.mjs` FIRST, asserting that `SUPABASE_SERVICE_ROLE_KEY` is not present in the client auth schema, verifying pre-patch FAIL before editing `apps/merchant-web/src/lib/env.ts`. Included test file in `target_files` of `TASK-W3-01`.

7. **Gap G7 (Task Test Target Realignment):**
   - *Catch:* `TASK-W2-02` listed `tests/unit/hospital-server-api-matrix.test.mjs` as its regression test, but that suite tests hospital backend routes and does not cover settings page frontend forms.
   - *Remediation:* Realigned `TASK-W2-02` regression test to `tests/scripts/test-state-machine-remediation.mjs` and verification command to `node tests/scripts/test-state-machine-remediation.mjs && pnpm --filter @appointments/merchant-web typecheck`.

---

## Round 2 Review (2026-11-20 19:39 UTC / 2026-11-21 01:09 IST)
**Reviewer:** Zero-Context Goldfish Spec Reviewer (`7eae1582-cb5d-45aa-90f9-0b9f0a248883` - `mantis-critic` + `plan-checker`)  
**Input:** Revised `.gsd/SECURITY_REMEDIATION_SPEC.md` (Round 2) and `.gsd/SECURITY_TASKS.json` (v1.1.0)  
**Status:** Completed  
**Verdict:** `SPEC_APPROVED`  

### Reviewer Verdict & Verification Summary:
- **Catches G1–G7 Verification:** All 7 catches verified as completely and cleanly resolved.
- **Completeness:** 11 / 11 issues accounted for (8 mapped to code tasks across 4 waves, 2 accepted risks with documented compensating controls, 1 needs-human credential rotation).
- **Sibling Entry Points:** Fully covered across database triggers, operational RPCs, settings UI, and service-role API endpoints.
- **Compatibility & Non-Regression:** Zero breaking changes for customer mobile app, webhooks, or merchant bookings triage.
- **File Disjointness:** Zero file overlap across all concurrent tasks within each wave and across waves.
- **Standing Rule 3:** Explicit RED-GREEN test ordering mandated for all behavioral and bug fix tasks.

---

## Round 1 Review — Campaign `security/window-closure-20261121` (2026-11-21 18:50 UTC / 2026-11-22 00:20 IST)
**Reviewer:** Zero-Context Goldfish Spec Reviewer (`goldfish` - `mantis-critic` + `plan-checker`)  
**Input:** `.gsd/SECURITY_OPEN_WINDOWS.json`, `.gsd/SECURITY_WAVE_PLAN.json`, `.gsd/SECURITY_REMEDIATION_SPEC.md`, `.gsd/SECURITY_TASKS.json`, `.gsd/COVERAGE_LEDGER.json`, `.gsd/MANUAL_ACTIONS.md`  
**Verdict:** `SPEC_APPROVED`

### Systematic Verification Against 5 Mandatory Criteria:

1. **Criterion 1: Mapping & Non-Overlap (Confirmed Windows ↔ Wave Plan Tasks)**
   - *Result:* **PASS** (Exit code 0, evidence in `.gsd/evidence/STAGE3_GOLDFISH/criterion1_mapping_and_overlap.*`).
   - Confirmed WINDOW_IDs: `SEC-DISC-001` (CWE-285, High), `SEC-DISC-002` (CWE-798, High).
   - `SEC-DISC-001` maps 1-to-1 to `TASK-W2-01` in Wave 2.
   - `SEC-DISC-002` maps 1-to-1 to `TASK-W4-01` in Wave 4 (`NEEDS_HUMAN` governance item per Global Rule R5).
   - Zero orphans, zero unmapped confirmed windows, zero redundant task mappings.
   - Zero file overlap between tasks: `TASK-W2-01` exclusively touches `apps/merchant-web/src/app/api/account/delete/route.ts` and `tests/security/account-deletion-auth.test.mjs`; `TASK-W4-01` exclusively touches `.gsd/MANUAL_ACTIONS.md`.

2. **Criterion 2: Sibling Entry Points Coverage**
   - *Result:* **PASS** (Exit code 0, evidence in `.gsd/evidence/STAGE3_GOLDFISH/criterion2_sibling_entrypoints.*` and `criterion2_check_all_deletion_routes.*`).
   - Server Actions: Verified 0 `'use server'` directives exist in `apps/merchant-web`.
   - API Routes: Audited all account deletion routes:
     - `DELETE /api/account/delete`: Patched by `TASK-W2-01` to invoke `delete_account_immediately` with the authenticated user-scoped client `supabase.rpc`, fixing the `auth.uid() IS NULL` exception.
     - `POST /api/account/delete-public-request`: Verified proof-of-ownership flow with fallback to `service_role` RPC `public.anonymize_user_data(userId)` and zero grace period.
     - `GET /api/account/delete`: Verified read-only inspection of deletion status.
   - Database RPCs:
     - `public.delete_account_immediately(p_reason)`: Verified `(SELECT auth.uid())` requirement, granted to `authenticated` and `service_role`.
     - `public.request_account_deletion(p_reason)`: Delegates to `delete_account_immediately(p_reason)`.
     - `public.anonymize_user_data(p_user_id)`: Granted exclusively to `service_role`.
   - Client Bridges & Mobile App:
     - `apps/customer-mobile/src/screens/AccountScreen.tsx`: Calls `supabase.rpc('request_account_deletion')` directly, with fallback to `fetch('/api/account/delete', { method: 'DELETE' })`. The `TASK-W2-01` fix ensures both direct RPC and API route invocations succeed under the caller's JWT context.

3. **Criterion 3: Browser Policies & Client Compatibility**
   - *Result:* **PASS** (Exit code 0, evidence in `.gsd/evidence/STAGE3_GOLDFISH/criterion3_browser_policies.*`).
   - Wave 3 is marked `CLEAN` with 0 tasks; all 10 modern web candidates (`MODWEB-001` through `MODWEB-010`) were verified safe / defense-in-depth hygiene.
   - Zero breaking header modifications: no restrictive CSP changes that would break Cashfree checkout SDK (`https://sdk.cashfree.com`), UPI deep-linking schemes (`upi://`), or `CashfreeCheckoutWebView` origin whitelisting (`CASHFREE_ALLOWED_ORIGINS`).
   - Mobile WebView postMessage bridge retains strict fail-closed origin validation without regressions.

4. **Criterion 4: File and Line Range Citation Verification**
   - *Result:* **PASS** (Exit code 0, evidence in `.gsd/evidence/STAGE3_GOLDFISH/criterion4_spotcheck_citations.*` and `criterion4_comprehensive_spotcheck.*`).
   - 100% of CRITICAL and HIGH citations verified:
     - `SEC-DISC-001`: `apps/merchant-web/src/app/api/account/delete/route.ts:44-70` and `supabase/migrations/20261121000002_immediate_account_deletion_and_single_admin.sql:51` verified exist and contain claimed code.
     - `SEC-DISC-002`: Leaked Supabase Cloud credentials verified in git commit history objects for commits `9305ab5c`, `34b7d2c7`, and `5e515195`.
     - `MODWEB-003`: `apps/merchant-web/src/lib/supabase.ts:58` verified.
     - `MODWEB-004`: `apps/merchant-web/src/middleware.ts` headers verified.
   - REST citations spot-checked (>30% sample): `SEC-DISC-003`, `MODWEB-006`, `MODWEB-010` verified.
   - All 100 coverage units in `.gsd/COVERAGE_LEDGER.json` verified against repository paths.

5. **Criterion 5: Wave Dependency Ordering**
   - *Result:* **PASS** (Exit code 0, evidence in `.gsd/evidence/STAGE3_GOLDFISH/criterion5_wave_dependencies.*`).
   - Wave 1 (Database): 0 tasks (clean).
   - Wave 2 (API Routes): `TASK-W2-01` depends only on existing database stored procedures in migration `20261121000002_immediate_account_deletion_and_single_admin.sql`.
   - Wave 3 (Frontend): 0 tasks (clean).
   - Wave 4 (DevOps & Governance): `TASK-W4-01` targets `.gsd/MANUAL_ACTIONS.md` for human governance.
   - Strict topological forward independence: No task depends on an artifact or migration introduced in a later wave.

### Conclusion & Approval:
The remediation specification and wave plan meet all quality and safety criteria. Round 1 review passes with zero defects.
Verdict: **SPEC_APPROVED**

