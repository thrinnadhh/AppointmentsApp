# Campaign Decision Log: Security Window Closure 2026-11-21

**Project:** AppointmentsApp (`/Users/trinadh/projects/Appointments`)  
**Branch:** `security/window-closure-20261121`  
**Governing Standard:** Autonomous, unattended execution governed by GLOBAL RULES R1 through R6.  
**Principle:** "The user is asleep. Do NOT stop to ask for approval at any stage. When a decision is ambiguous, choose the most conservative option, log it in `.gsd/DECISIONS.md`, and continue."

---

## DEC-001: Strict Wrapper Execution via `.gsd/run_and_record.sh`
- **Date / Stage:** 2026-11-21 / Stage 0 (Preflight & Baseline)
- **Context:** Global Rule R1 mandates zero fabrication: every file path, line range, command, exit code, and test result stated must come from actual tool calls executed during this campaign.
- **Ambiguity / Dilemma:** Commands can be run directly in subshells or wrapped with metadata capture. Direct commands don't automatically produce structured metadata artifacts.
- **Conservative Decision:** All verification, discovery, test suites, and scanner commands across all agents and stages MUST be executed via `bash .gsd/run_and_record.sh <STAGE> <STEP> <COMMAND...>`.
- **Impact:** Captures stdout, stderr, exit code, execution timestamp, and `git rev-parse HEAD` in `.gsd/evidence/<STAGE>/<STEP>.meta.json`.

---

## DEC-002: Cataloging and Isolation of Pre-existing Failures
- **Date / Stage:** 2026-11-21 / Stage 0 (Preflight & Baseline)
- **Context:** Several baseline test suites on the untouched branch tip return non-zero exit codes:
  - `node scripts/run-all-unit-tests-serially.mjs`: 1 failing suite (`hospital-hardened-rpcs.test.mjs`, 2 failed tests)
  - `node --test tests/security/*.test.mjs`: 11 failing tests across pgTAP and strix regression allowlist
  - `node --test tests/unit/*.test.mjs`: 35 failing tests in adversarial cross-tenant matrix tests
  - `gitleaks detect -v`: 4 historical commits with mock Supabase tokens
- **Ambiguity / Dilemma:** Should these failures be masked, silently skipped, or resolved before preflight completes?
- **Conservative Decision:** Do NOT touch or modify any test code, loosen assertions, or hide these failures (Global Rule R4). Formally catalog every one of these as `PREEXISTING` in `.gsd/PREFLIGHT.md`.
- **Impact:** Prevents any misattribution of pre-existing failures to subsequent security remediations while maintaining full transparency.

---

## DEC-003: Gitleaks Historic Leaks Non-Mutation Policy
- **Date / Stage:** 2026-11-21 / Stage 0 (Preflight & Baseline)
- **Context:** Gitleaks identified 4 historical commit hashes containing Supabase JWT tokens (`9305ab5c32ecc4b00eab078583cf257ea6790d2f`, `34b7d2c76c3f4008f2d56b9f3c75937ba9583b75`, `5e51519501ec2fbdab1291da76d27e2adba7ae51`).
- **Ambiguity / Dilemma:** Should git history be rewritten (e.g. `git filter-repo`, `git rebase`, or force push) to purge secrets from past commits?
- **Conservative Decision:** Strictly adhere to Global Rule R5: "No force-push, no pushes to main/default, no merging. Never print, commit, or log secrets. For any secret found in history, record it in the report as 'ROTATION REQUIRED (human action)'. Do not attempt rotation."
- **Impact:** Preserves immutable git history, keeps safe blast radius, and flags the credentials for human key rotation in the final closure report.

---

## DEC-004: Validator CLI Invocation Standard (`validate-coverage-ledger.cjs` & `validate-findings.cjs`)
- **Date / Stage:** 2026-11-21 / Stage 0 (Preflight & Baseline)
- **Context:** Neither validator implements a CLI `--help` flag; invoking them without an explicit existing JSON file path results in an unhandled exception and exit code 1.
- **Ambiguity / Dilemma:** Is the asset considered broken / `BLOCKED_TOOL` under Rule R6?
- **Conservative Decision:** Test both scripts against real, concrete candidate JSON inputs (`.gsd/coverage-ledger.json` and `.gsd/evidence/DISCOVERY_MODERN_WEB/candidates.json`). Both scripts returned exit code 0 (`PASS: 10 coverage units valid`, `PASS: 10 findings valid`). The tools are confirmed functional and operational.
- **Impact:** Confirms validator runnability without altering validator code or falsely classifying working tools as broken.

---

## DEC-005: Playwright E2E Test Suite Execution Strategy & Baseline Integration
- **Date / Stage:** 2026-11-21 / Stage 0 (Preflight & Baseline)
- **Context:** `pnpm test:e2e` contains 275 tests configured to run serially with 1 worker (`workers: 1`, `fullyParallel: false`) against local Next.js (port 3000) and Supabase (port 54321), taking ~24.6 minutes to complete. Coordinator requested completion of Preflight and publication of Stage 0 baseline so downstream stages could begin.
- **Ambiguity / Dilemma:** Should the entire swarm stall waiting for Playwright E2E to finish, or should preflight finalize the unit, security, validation, and static baselines while Playwright records in the background?
- **Conservative Decision:** Per coordinator directive #6, finalized and published `.gsd/PREFLIGHT.md` and `.gsd/DECISIONS.md` immediately, while leaving `playwright_e2e` actively logging to `.gsd/evidence/BASELINE/playwright_e2e.stdout`. Upon completion of task-116 at T+1478s (exit code 1, 174 passed, 27 failed, 74 not run), the finalized test outcomes were merged into `.gsd/PREFLIGHT.md` and marked as `PREEXISTING`.
- **Impact:** Prevented pipeline deadlock, unblocked downstream discovery analysis (Stage 1), and fully integrated comprehensive E2E baseline execution metrics without data loss.

---

## DEC-006: Restoration of Consultant Notification Authorization and Hospital Admin Standby Queue Permissions
- **Date / Stage:** 2026-11-22 / Stage 4 (Verification & Gate Hardening)
- **Context:** Notification dispatch trigger in `complete_booking` previously threw 42501 for consultants because migration `20261121000001` omitted `is_caller_authorized_for_resource`. Additionally, `expire_stale_standby_queue(integer, uuid)` had its `EXECUTE` grant revoked from `authenticated` in migration `20261120000006`, blocking hospital admins from clearing their late queues.
- **Ambiguity / Dilemma:** Should `dispatch_booking_notification` check resource assignment or only provider-level ownership? Should `expire_stale_standby_queue` be executable by authenticated callers or only service_role?
- **Conservative Decision:** Created forward migration `20261122000002_restore_consultant_notification_authorization.sql`. In `dispatch_booking_notification`, restored `is_caller_authorized_for_resource(v_booking.provider_id, v_booking.resource_id, v_caller_id)` to preserve the principle of least privilege while permitting consultants to complete consultations. In `expire_stale_standby_queue`, restored `GRANT EXECUTE TO authenticated` because the function itself enforces strict in-body tenant isolation (`IF auth.role() = 'authenticated' ...`).
- **Impact:** Fixed doctor appointment completion and hospital admin standby queue sweep without weakening cross-tenant boundaries. Fully verified in `tests/unit/hospital-hardened-rpcs.test.mjs` (7/7 pass) and `tests/unit/phase1-security-blockers.test.mjs` (24/24 pass).

---

## DEC-007: Harmonization of Notification Template Parameters and Dispatch Queue Contracts
- **Date / Stage:** 2026-11-22 / Stage 4 (Verification & Gate Hardening)
- **Context:** Test suites `test-real-notification-queue.mjs` and `test-whatsapp-integration.mjs` failed in CI due to: (1) Date-time format mismatch in `build_template_params` (`Mon DD, YYYY at HH12:MI AM` instead of canonical `DD Mon YYYY, FMHH12:MI AM`); (2) Signature changes in `reminder_1h` (4 params instead of 3: provider, time, ref) and `booking_cancelled` (customer instead of provider); (3) Fallback name defaulting to `'Patient'` instead of canonical `'there'`; (4) Missing `status`, `channel`, and `whatsapp_log_id` in `dispatch_booking_notification` return payload and missing `last_error` on SKIPPED logs.
- **Ambiguity / Dilemma:** Should test assertions be updated to match the widened return, or should the database function be harmonized to honor all existing contracts?
- **Conservative Decision:** Created forward migration `20261122000003_harmonize_notification_contracts.sql`. Under Standing Rule 5 ("Never weaken or delete a test"), harmonized `build_template_params` and `dispatch_booking_notification` in PostgreSQL to fulfill both the multi-channel notification requirements and the strict contractual signatures expected by existing queue and integration test suites.
- **Impact:** All 11 tests pass in `test-whatsapp-integration.mjs` and all tests pass in `test-real-notification-queue.mjs` with 0 failures and 0 skipped tests.

---

## DEC-008: Disabling Local SMTP (Inbucket) on Port 54324
- **Date / Stage:** 2026-11-22 / Stage 4 (Verification & Gate Hardening)
- **Context:** GitHub Actions runner intermittently failed during `Start local Supabase and apply migrations` with `failed to start docker container "supabase_inbucket_Appointments": failed to bind host port 0.0.0.0:54324/tcp: address already in use` due to Docker networking recycling delays across container restart boundaries.
- **Ambiguity / Dilemma:** Keep `local_smtp` enabled and rely on shell retry loops, or disable the container in `supabase/config.toml`?
- **Conservative Decision:** In `supabase/config.toml`, set `[local_smtp] enabled = false`. Zero production, unit, or E2E tests depend on the inbucket SMTP web interface on port 54324 (all notification tests inspect database rows directly or mock delivery providers).
- **Impact:** Eliminates port 54324 binding contention, speeds up Supabase local startup, and stabilizes CI runner execution without impacting application functionality.
