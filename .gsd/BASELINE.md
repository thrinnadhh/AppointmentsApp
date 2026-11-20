# Preflight & Baseline State

**Recorded At:** 2026-11-20T23:42:00+05:30  
**Branch:** `security/window-closure-2026-11-20`  
**Base Commit (HEAD):** `6f43e9eb1577bb44fe43207b40f7da6d98ea7aba`  

---

## 1. Tooling & Scanner Availability

| Tool | Status | Version / Path | Notes |
|------|--------|----------------|-------|
| **Git Working Tree** | Clean | `security/window-closure-2026-11-20` | Branched from `main` |
| **Gitleaks** | INSTALLED | 8.30.1 (`/opt/homebrew/bin/gitleaks`) | Active |
| **Supabase CLI** | INSTALLED | 2.109.1 (`/opt/homebrew/bin/supabase`) | Local daemon active (:54321, :54322) |
| **Semgrep** | NOT_RUN | Missing from PATH | `semgrep not found` — recorded as `NOT_RUN` per Global Rules |
| **CodeQL Config** | PRESENT | `.github/codeql/codeql-config.yml` | Present |
| **Node.js** | INSTALLED | v22.12.0 | Monorepo engine `>=22.0.0` |
| **pnpm** | INSTALLED | 10.4.1 | Monorepo workspace manager |
| **Python** | INSTALLED | 3.12.3 | Used for AG kit scanners & verifiers |

---

## 2. Referenced Files, Skills & Agents Verification

| Component Path | Exists? | Details |
|----------------|---------|---------|
| `.agents/skills/mantis-*` | YES | 19 Mantis skills present |
| `.agents/skills/security-audit/` | YES | Directory present |
| `.agents/skills/security-audit/report-schema.json` | YES | Present |
| `.agents/skills/security-audit/validate-coverage-ledger.cjs` | YES | Present & executable |
| `.agents/skills/security-audit/validate-findings.cjs` | YES | Present & executable |
| `.agents/skills/vulnerability-scanner/scripts/` | YES | `security_scan.py`, `dependency_analyzer.py` present |
| `.agents/scripts/verify_all.py` | YES | Present |
| `.agents/scripts/validation_runner.py` | YES | Present |
| `.agents/agent/*` | YES | 19 specialist agent definitions present |
| `2026-11-08_DRIFT_REPORT.md` | YES | Present (372 lines, full architectural drift analysis) |
| `.github/` configs | PARTIAL | CodeQL configs present (`.github/codeql/codeql-config.yml`, `.github/workflows/codeql.yml`); Semgrep rules not present in `.github/` |

---

## 3. Baseline Suite Execution Results

### 3.1 TypeScript Typecheck
- **Command:** `pnpm -r --if-present typecheck`
- **Exit Code:** `0`
- **Result:** PASSED across all 3 workspace packages:
  - `packages/shared`: PASSED (0 errors)
  - `apps/customer-mobile`: PASSED (0 errors)
  - `apps/merchant-web`: PASSED (0 errors)

### 3.2 ESLint
- **Command:** `pnpm -r --if-present lint`
- **Exit Code:** `0`
- **Result:** PASSED (0 errors, 2 warnings in `merchant-web`: React Hook `useMemo` in `page.tsx` and `useCallback` in `ticket/[id]/page.tsx`)

### 3.3 Core Serial Unit Test Suites
- **Command:** `node scripts/run-all-unit-tests-serially.mjs`
- **Exit Code:** `0`
- **Suites:** 26 / 26 passed
- **Tests:** 210 / 210 passed (0 failed, 0 cancelled)
- **Duration:** 35.59s

### 3.4 Security Script Test Suites
- **Command:** `pnpm test:security` (`node --test tests/scripts/test-security.mjs tests/scripts/test-routes.mjs tests/scripts/test-validation.mjs`)
- **Exit Code:** `0`
- **Suites:** 73 / 73 passed
- **Tests:** 225 / 225 passed (0 failed)

### 3.5 Validation Test Suites
- **Command:** `pnpm test:validation` (`node --test tests/scripts/test-validation.mjs`)
- **Exit Code:** `0`
- **Suites:** 37 / 37 passed
- **Tests:** 85 / 85 passed (0 failed)

### 3.6 Broader Unit Test Suites (`tests/unit/*.test.mjs`)
- **Command:** `node --test tests/unit/*.test.mjs`
- **Exit Code:** `1` (Pre-existing baseline failures)
- **Suites:** 167 suites
- **Total Tests:** 568
- **Passed:** 533
- **Failed:** 35 (Recorded as pre-existing failures; mainly adversarial cross-tenant matrix tests in `cross-tenant-authorization-matrix.test.mjs`, `phase1-security-blockers.test.mjs`, and `security-loop-api.test.mjs` expecting specific 403 vs 404/409 codes)

### 3.7 Security Directory Suites (`tests/security/*.test.mjs`)
- **Command:** `node --test tests/security/*.test.mjs`
- **Exit Code:** `1` (Pre-existing baseline failures)
- **Suites:** 19 suites
- **Total Tests:** 69
- **Passed:** 58
- **Failed:** 11 (Recorded as pre-existing failures; e.g. `strix-regression.test.mjs` webhook tests expecting 400 vs 410, pgTAP allowlist checks)

### 3.8 AG Toolkit Internal Regression Tests
- **Command:** `python3 -m unittest discover -s .agents/scripts/tests -v`
- **Exit Code:** `1` (Pre-existing baseline failures)
- **Ran:** 17 tests
- **Passed:** 15
- **Failed:** 2 (`test_component_registry_and_lock_are_synchronized` and `test_toolkit_self_validation_passes` due to stale `manifest.lock.json` in toolkit)

### 3.9 Gitleaks Secret Scan
- **Command:** `gitleaks detect -v`
- **Exit Code:** `1`
- **Leaks Found:** 4 historical leaks in git commits (Supabase JWTs for `ynkdnwhubfknnnzjtpeg` in `scripts/e2e-trinadh-hospital-test.mjs`, `tests/e2e/payment-full-flow.spec.ts`, `tests/e2e/compliance-pages.spec.ts`)
