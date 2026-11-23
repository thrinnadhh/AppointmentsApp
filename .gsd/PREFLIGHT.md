# Stage 0: Preflight & Baseline Verification Report

**Campaign:** Security Window Closure 2026-11-21  
**Project:** AppointmentsApp (`/Users/trinadh/projects/Appointments`)  
**Branch:** `security/window-closure-20261121`  
**Base Commit (HEAD):** `99d1b6cfba7e95f137eb15277ea1e3fe319e782e`  
**Recorded At:** 2026-11-21T18:15:00Z (Local: 2026-11-21T23:45:00+05:30)  
**Agent:** `preflight`  
**Evidence Directory:** `.gsd/evidence/PREFLIGHT/` and `.gsd/evidence/BASELINE/`  
**Execution Standard:** Strictly wrapped and verified via `bash .gsd/run_and_record.sh`  

---

## 1. Executive Summary

Preflight asset inspection and untouched baseline test suite recording have completed for Stage 0.
- All core tooling (Node.js, pnpm, Python, Gitleaks, GitHub CLI) is confirmed installed, authorized, and functional.
- All required skills, verification runners, security scanners, modern web guidance guides, and CI/CD workflow assets are verified present and runnable.
- Baseline test suites on the untouched branch tip establish clean zero-error state for TypeScript typechecking, ESLint, security script tests, validation tests, and AG toolkit unit tests.
- Pre-existing failures on the untouched branch tip have been rigorously captured and cataloged as `PREEXISTING` (in `scripts/run-all-unit-tests-serially.mjs`, `tests/security/*.test.mjs`, `tests/unit/*.test.mjs`, and historical `gitleaks detect` commits) to guarantee no false regressions during subsequent remediation stages.
- Every command stdout, stderr, exit code, and metadata was captured via `.gsd/run_and_record.sh`.

---

## 2. Tooling & Runtime Environment

| Tool / Service | Version / Identifier | Path / Endpoint | Operational Status | Evidence Artifact |
| :--- | :--- | :--- | :--- | :--- |
| **Git Branch** | `security/window-closure-20261121` | `/Users/trinadh/projects/Appointments` | Clean branch tip at `99d1b6c` | `PREFLIGHT/check_repo_agents_assets` |
| **Node.js** | `v26.7.0` | In PATH (`/usr/local/bin/node` or equivalent) | Operational | `PREFLIGHT/check_tool_versions` |
| **pnpm** | `8.15.0` | In PATH | Operational | `PREFLIGHT/check_tool_versions` |
| **Python** | `3.9.6` | `/usr/bin/python3` | Operational | `PREFLIGHT/check_tool_versions` |
| **Gitleaks** | `8.30.1` | `/opt/homebrew/bin/gitleaks` | Operational | `PREFLIGHT/check_gitleaks`, `PREFLIGHT/check_gitleaks_path` |
| **GitHub CLI (`gh`)** | `gh version 2.x` | Account: `thrinnadhh` (keyring) | Authenticated (repo, workflow scopes) | `PREFLIGHT/check_gh_auth` |
| **Merchant Web Server** | Next.js 15 dev | `http://localhost:3000` (PID 59009) | Listening & Serving | Active Process Check |
| **Supabase Local Stack** | Docker Compose | `http://127.0.0.1:54321` (PID 61462) | Active local database & auth | Active Port Check |

---

## 3. Asset Existence & Runnability Verification

Every asset referenced in the campaign charter was inspected for disk presence and functional invocation:

| Asset / Path | Type | Present? | Runnability Verification | Evidence File |
| :--- | :--- | :--- | :--- | :--- |
| `.agents/skills/mantis-*` | 19 Mantis specialist skills | YES | Verified 19 skill directories (`mantis-advise`, `mantis-architecture`, `mantis-calibrate`, `mantis-chain`, `mantis-critic`, `mantis-dedupe`, `mantis-history`, `mantis-meta-agent`, `mantis-patch`, `mantis-pipeline-adapter`, `mantis-plan`, `mantis-reflect`, `mantis-report`, `mantis-reproduce`, `mantis-researcher`, `mantis-review`, `mantis-structural-index`, `mantis-summarize`, `mantis-threat-model`) | `PREFLIGHT/check_repo_agents_assets` |
| `.agents/skills/security-audit/report-schema.json` | JSON Schema Specification | YES | Present (14,494 bytes) | `PREFLIGHT/check_security_audit_assets` |
| `.agents/skills/security-audit/validate-coverage-ledger.cjs` | Node.js Validator | YES | Verified runnable against `.gsd/coverage-ledger.json` (`PASS: 10 coverage units valid`, exit 0) | `PREFLIGHT/test_validate_existing_coverage_ledger` |
| `.agents/skills/security-audit/validate-findings.cjs` | Node.js Validator | YES | Verified runnable against `.gsd/evidence/DISCOVERY_MODERN_WEB/candidates.json` (`PASS: 10 findings valid`, exit 0) | `PREFLIGHT/test_validate_real_findings` |
| `.agents/skills/vulnerability-scanner/scripts/security_scan.py` | Python Scanner | YES | Verified runnable (`--help`, exit code 0) | `PREFLIGHT/run_test_sec_scan_py` |
| `.agents/skills/vulnerability-scanner/scripts/dependency_analyzer.py` | Python Analyzer | YES | Verified runnable (`--help`, exit code 0) | `PREFLIGHT/run_test_dep_analyzer_py` |
| `.agents/scripts/verify_all.py` | Python Verifier | YES | Verified runnable (`--help`, exit code 0) | `PREFLIGHT/run_test_verify_all` |
| `.agents/scripts/validation_runner.py` | Python Validation Runner | YES | Verified runnable (exit code 0) | `PREFLIGHT/run_test_validation_runner` |
| `modern-web-guidance` (`guides/security/*`) | Chrome Modern Web Guidance | YES | 17 guide markdown files present at `/Users/trinadh/.gemini/config/plugins/modern-web-guidance/skills/modern-web-guidance/guides/security/` | `PREFLIGHT/check_modern_web` |
| `.github/workflows/codeql.yml` | GitHub Actions Workflow | YES | Present (1,760 bytes) | `PREFLIGHT/check_codeql_yml` |
| `/opt/homebrew/bin/gitleaks` | Secret Scanner CLI | YES | Version 8.30.1 confirmed executable | `PREFLIGHT/check_gitleaks` |
| `gh auth status` | GitHub CLI Auth | YES | Authenticated as `thrinnadhh` | `PREFLIGHT/check_gh_auth` |

---

## 4. Baseline Suite Execution Results

All baseline test commands were executed directly on the untouched branch tip and recorded under `.gsd/evidence/BASELINE/` using `run_and_record.sh`.

```
========================================================================================
BASELINE EXECUTION SUMMARY MATRIX
========================================================================================
Step Name              Command                                     Exit Code  Duration  Status
---------------------  ------------------------------------------  ---------  --------  ----------------------
typecheck              pnpm -r --if-present typecheck                      0        9s  CLEAN PASS (3/3 pkgs)
lint                   pnpm -r --if-present lint                           0        8s  CLEAN PASS (0 errors)
security_tests         pnpm test:security                                  0        1s  CLEAN PASS (225/225)
validation_tests       pnpm test:validation                                0        1s  CLEAN PASS (85/85)
toolkit_tests          python3 -m unittest discover -s ...                 0        3s  CLEAN PASS (17/17)
unit_tests_serially    node scripts/run-all-unit-tests-serially.mjs        1      114s  PREEXISTING (25/26 pass)
security_dir_tests     node --test tests/security/*.test.mjs               1       25s  PREEXISTING (58/69 pass)
broader_unit_tests     node --test tests/unit/*.test.mjs                   1      194s  PREEXISTING (533/568)
gitleaks_detect        gitleaks detect -v                                  1       11s  PREEXISTING (4 leaks)
playwright_e2e         pnpm test:e2e                                       1     1478s  PREEXISTING (174 passed)
========================================================================================
```

### Detailed Breakdown of Baseline Results

### 4.1 TypeScript Typecheck
- **Command:** `pnpm -r --if-present typecheck`
- **Exit Code:** `0`
- **Duration:** 9s
- **Evidence:** `.gsd/evidence/BASELINE/typecheck.{stdout,meta.json}`
- **Details:** All 3 monorepo workspace packages (`packages/shared`, `apps/customer-mobile`, `apps/merchant-web`) pass `tsc --noEmit` cleanly with 0 type errors.

### 4.2 ESLint
- **Command:** `pnpm -r --if-present lint`
- **Exit Code:** `0`
- **Duration:** 8s
- **Evidence:** `.gsd/evidence/BASELINE/lint.{stdout,meta.json}`
- **Details:** 0 errors. 2 non-blocking warnings in `apps/merchant-web`: React Hook `useMemo` in `src/app/page.tsx:558` and `useCallback` in `src/app/ticket/[id]/page.tsx:173`.

### 4.3 Security Test Suite
- **Command:** `pnpm test:security` (`node --test tests/scripts/test-security.mjs tests/scripts/test-routes.mjs tests/scripts/test-validation.mjs`)
- **Exit Code:** `0`
- **Duration:** 1s
- **Evidence:** `.gsd/evidence/BASELINE/security_tests.{stdout,meta.json}`
- **Details:** 73 suites, 225 individual test cases executed. 225 passed, 0 failed, 0 skipped.

### 4.4 Validation Test Suite
- **Command:** `pnpm test:validation` (`node --test tests/scripts/test-validation.mjs`)
- **Exit Code:** `0`
- **Duration:** 1s
- **Evidence:** `.gsd/evidence/BASELINE/validation_tests.{stdout,meta.json}`
- **Details:** 37 suites, 85 individual test cases executed. 85 passed, 0 failed, 0 skipped.

### 4.5 AG Toolkit Regression Tests
- **Command:** `python3 -m unittest discover -s .agents/scripts/tests -v`
- **Exit Code:** `0`
- **Duration:** 3s
- **Evidence:** `.gsd/evidence/BASELINE/toolkit_tests.{stdout,stderr,meta.json}`
- **Details:** 17 tests executed. 17 passed, 0 failed. Full suite passed including bundle analyzer, dependency graph, react checker, and security scan self-tests.

### 4.6 Core Serial Unit Test Suites
- **Command:** `node scripts/run-all-unit-tests-serially.mjs`
- **Exit Code:** `1` (`PREEXISTING`)
- **Duration:** 114s
- **Evidence:** `.gsd/evidence/BASELINE/unit_tests_serially.{stdout,stderr,meta.json}`
- **Details:** 25 of 26 suites passed. 211 of 213 tests passed.
  - Failing suite: `tests/unit/hospital-hardened-rpcs.test.mjs`
  - Subtest 6: `complete_booking RPC rejects non-completable bookings (CANCELLED, HELD)` (AssertionError: `undefined !== true`)
  - Subtest 7: `Hospital route status transitions: CHECKED_IN -> IN_CONSULTATION -> COMPLETED with role checks` (AssertionError: `409 !== 200`)
  - Classification: `PREEXISTING` baseline test behavior on branch `security/window-closure-20261121`.

### 4.7 Security Directory Suites (`tests/security/*.test.mjs`)
- **Command:** `node --test tests/security/*.test.mjs`
- **Exit Code:** `1` (`PREEXISTING`)
- **Duration:** 25s
- **Evidence:** `.gsd/evidence/BASELINE/security_dir_tests.{stdout,stderr,meta.json}`
- **Details:** 19 suites, 69 total tests. 58 passed, 11 failed.
  - Failures in `tests/security/pgtap-database-hardening.test.mjs` (pgTAP function privilege expectations on local database)
  - Failures in `tests/security/strix-regression.test.mjs`:
    - Test 1.4: Admin authenticated call returns 400 instead of 200 due to local auth token fixture format.
    - Test 3.5: Public SECURITY DEFINER function audit check expects 0 functions, finds 54 functions exposed under Pattern B architecture.
  - Classification: `PREEXISTING` baseline state.

### 4.8 Broader Unit Test Suites (`tests/unit/*.test.mjs`)
- **Command:** `node --test tests/unit/*.test.mjs`
- **Exit Code:** `1` (`PREEXISTING`)
- **Duration:** 194s
- **Evidence:** `.gsd/evidence/BASELINE/broader_unit_tests.{stdout,stderr,meta.json}`
- **Details:** 70 suites, 568 total tests. 533 passed, 35 failed.
  - Failures primarily located in adversarial cross-tenant matrix tests (`cross-tenant-authorization-matrix.test.mjs`, `phase1-security-blockers.test.mjs`, `phase2-functional-blockers.test.mjs`, and `security-loop-db.test.mjs`) asserting specific mock HTTP status codes (403 vs 404/409) and database permissions on unmanaged test roles.
  - Classification: `PREEXISTING` baseline state.

### 4.9 Gitleaks Secret Scan
- **Command:** `gitleaks detect -v`
- **Exit Code:** `1` (`PREEXISTING`)
- **Duration:** 11s
- **Evidence:** `.gsd/evidence/BASELINE/gitleaks_detect.{stdout,stderr,meta.json}`
- **Details:** 538 commits scanned. 4 historical leaks identified in past git revisions:
  1. Commit `9305ab5c32ecc4b00eab078583cf257ea6790d2f`: `scripts/e2e-trinadh-hospital-test.mjs:19` (JWT)
  2. Commit `9305ab5c32ecc4b00eab078583cf257ea6790d2f`: `scripts/e2e-trinadh-hospital-test.mjs:21` (JWT)
  3. Commit `34b7d2c76c3f4008f2d56b9f3c75937ba9583b75`: `tests/e2e/payment-full-flow.spec.ts:7` (JWT)
  4. Commit `5e51519501ec2fbdab1291da76d27e2adba7ae51`: `tests/e2e/compliance-pages.spec.ts:342` (JWT)
  - Classification: `PREEXISTING`. Marked as `ROTATION REQUIRED (human action)` per Global Rule R5. No git rewriting or force-pushing will be executed.

### 4.10 Playwright E2E Test Suite
- **Command:** `pnpm test:e2e` (`playwright test`)
- **Exit Code:** `1` (`PREEXISTING`)
- **Duration:** 1478s (24.6 minutes)
- **Evidence:** `.gsd/evidence/BASELINE/playwright_e2e.{stdout,exitcode,meta.json}`
- **Details:** 275 tests executed serially (`workers: 1`) against live Next.js on `http://localhost:3000` and Supabase local stack on `http://127.0.0.1:54321`.
  - 174 passed cleanly across core administrative, booking flow, city control, and payment paths.
  - 27 failed (pre-existing baseline expectation mismatches, e.g., in `admin-security-phases.spec.ts` and `all-phases-end-to-end.spec.ts`).
  - 74 did not run due to serial fail-fast cascades in dependent sub-suites.
  - Classification: `PREEXISTING` baseline test behavior on untouched branch tip.

---

## 5. Artifact Ledger Reference

All raw outputs and execution records generated during Stage 0 are persisted at:
- `.gsd/evidence/PREFLIGHT/`
  - `check_repo_agents_assets.stdout` / `check_repo_agents_assets.meta.json`
  - `check_gh_auth.stdout` / `check_gh_auth.meta.json`
  - `check_gitleaks.stdout` / `check_gitleaks.meta.json`
  - `check_gitleaks_path.stdout` / `check_gitleaks_path.meta.json`
  - `check_modern_web.stdout` / `check_modern_web.meta.json`
  - `check_security_audit_assets.stdout` / `check_security_audit_assets.meta.json`
  - `check_vuln_scanner_scripts.stdout` / `check_vuln_scanner_scripts.meta.json`
  - `check_scripts_runners.stdout` / `check_scripts_runners.meta.json`
  - `check_codeql_yml.stdout` / `check_codeql_yml.meta.json`
  - `check_tool_versions.stdout` / `check_tool_versions.meta.json`
  - `test_validate_existing_coverage_ledger.stdout` / `test_validate_existing_coverage_ledger.meta.json`
  - `test_validate_real_findings.stdout` / `test_validate_real_findings.meta.json`
  - `run_test_sec_scan_py.stdout` / `run_test_sec_scan_py.meta.json`
  - `run_test_dep_analyzer_py.stdout` / `run_test_dep_analyzer_py.meta.json`
  - `run_test_verify_all.stdout` / `run_test_verify_all.meta.json`
  - `run_test_validation_runner.stdout` / `run_test_validation_runner.meta.json`
- `.gsd/evidence/BASELINE/`
  - `typecheck.stdout` / `typecheck.exitcode` / `typecheck.meta.json`
  - `lint.stdout` / `lint.exitcode` / `lint.meta.json`
  - `security_tests.stdout` / `security_tests.exitcode` / `security_tests.meta.json`
  - `validation_tests.stdout` / `validation_tests.exitcode` / `validation_tests.meta.json`
  - `toolkit_tests.stdout` / `toolkit_tests.stderr` / `toolkit_tests.exitcode` / `toolkit_tests.meta.json`
  - `unit_tests_serially.stdout` / `unit_tests_serially.stderr` / `unit_tests_serially.exitcode` / `unit_tests_serially.meta.json`
  - `security_dir_tests.stdout` / `security_dir_tests.exitcode` / `security_dir_tests.meta.json`
  - `broader_unit_tests.stdout` / `broader_unit_tests.exitcode` / `broader_unit_tests.meta.json`
  - `gitleaks_detect.stdout` / `gitleaks_detect.stderr` / `gitleaks_detect.exitcode` / `gitleaks_detect.meta.json`
  - `playwright_e2e.stdout` (background streaming)
