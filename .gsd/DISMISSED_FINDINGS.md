# Dismissed Findings & False Positives Catalog

**Date:** 2026-11-20  
**Audit Pipeline:** Google Mantis (`.agents/skills/mantis-dedupe`, `.agents/skills/mantis-critic`)  
**Scope:** Appointments Monorepo

The following items were identified during static scanning, pattern analysis, or baseline triage and were systematically analyzed and dismissed with verifiable justifications:

---

## 1. Monorepo Sub-Package Lockfiles (`SEC-WIN-009`)
- **Flagged Location:** `packages/shared/package.json`, `apps/merchant-web/package.json`, `apps/customer-mobile/package.json`
- **Flagged By:** `dependency_analyzer.py` ("Missing JavaScript lock file")
- **Dismissal Reason (False Positive):** The repository is an integrated pnpm workspace governed canonically by the single root lockfile `pnpm-lock.yaml`. Per-package lockfiles are neither standard nor supported in pnpm workspaces. CI workflows strictly enforce `pnpm install --frozen-lockfile`.
- **Verdict:** `FALSE_POSITIVE` (Architectural Intent).

---

## 2. Dynamic Security Scanner Output Artifacts (`SEC-WIN-010`)
- **Flagged Location:** `strix_runs/appointments_6ae9/vulnerabilities.json`
- **Flagged By:** `security_scan.py` (Flagged mock Bearer tokens and JWT strings)
- **Dismissal Reason (False Positive):** The `strix_runs/` directory contains transient output reports from past automated dynamic scanner runs. The entire directory is excluded from version control in `.gitignore` (lines 88–90). Zero files are tracked in git (`git ls-files strix_runs/` returns 0 rows).
- **Verdict:** `FALSE_POSITIVE` (Gitignored Test Artifact).

---

## 3. JavaScript RegExp `.exec()` Flagged as Python Code Injection
- **Flagged Location:**
  - `tests/security/github-actions-hardening.test.mjs:20` (`actionRegex.exec(content)`)
  - `tests/scripts/test-security.mjs:33` (`/^\d{1,3}.../.exec(host)`)
  - `apps/merchant-web/src/middleware.ts:37` (`/^\d{1,3}.../.exec(host)`)
  - `scripts/e2e-status.mjs:86,92`
  - `scripts/scan-untracked-allowlist-paths.mjs:69`
  - `scripts/audit-tracked-jwt.mjs:40`
- **Flagged By:** `security_scan.py` (`exec() usage`, Category: `Code injection risk`)
- **Dismissal Reason (False Positive):** `security_scan.py` uses naive substring matching for `exec(` which is dangerous in Python (`eval`/`exec`), but in JavaScript and TypeScript, `.exec()` is the standard, safe built-in method on `RegExp` objects for regular expression pattern matching.
- **Verdict:** `FALSE_POSITIVE` (Static Scanner Rule Misclassification).

---

## 4. Subprocess Shell Execution in Local Evidence Generator
- **Flagged Location:** `.gsd/generate_red_evidence.py:9` (`subprocess.run(cmd, shell=True)`)
- **Flagged By:** `security_scan.py` (`Command injection risk`)
- **Dismissal Reason (False Positive):** This is an offline local test harness utility in the `.gsd` internal audit folder executed only by human developers during audit verification. It is not part of any production server, API, client bundle, or CI workflow.
- **Verdict:** `FALSE_POSITIVE` (Non-Production Local Script).

---

## 5. Previously Remediated Findings (Historical Verification Confirmed)
The following findings were confirmed fully closed and verified by automated regression test suites:
- `SEC-WIN-001` (CWE-284): `resource_availability` RLS `WITH CHECK` — Verified closed by `tests/security/database-grants-allowlist.test.mjs` (5/5 PASS).
- `SEC-WIN-002` & `SEC-WIN-003` (CWE-749/346): `CashfreeCheckoutWebView` origin whitelist & message validation — Verified closed by `tests/unit/cashfree-webview-origin-guard.test.mjs` (6/6 PASS).
- `SEC-WIN-004` (CWE-285): Prescription signed URL E2E bypass — Verified closed by `tests/unit/prescriptions-signed-url-bypass.test.mjs` (4/4 PASS).
- `SEC-WIN-005` (CWE-294): Razorpay webhook replay — Verified closed via complete route decommission (returns HTTP 410) by `tests/unit/razorpay-decommission.test.mjs` (4/4 PASS).
- `SEC-WIN-006` (CWE-426): `SECURITY DEFINER` search_path isolation — Verified closed by `tests/security/security-definer-schema-guard.test.mjs` (3/3 PASS).
- `SEC-WIN-008` (CWE-200): Check-in PIN vs OTP terminology — Verified closed by `tests/unit/checkin-pin-terminology.test.mjs` (3/3 PASS).
- `SEC-WIN-011` (CWE-829): GitHub Actions commit SHA pinning — Verified closed by `tests/security/github-actions-hardening.test.mjs` (4/4 PASS).
- `SEC-WIN-012` (CWE-799): Client event log flooding — Verified closed by `tests/security/anon-log-throttle.test.mjs` (2/2 PASS).
- `SEC-WIN-014` (CWE-306): Order creation auth ordering — Verified closed by `tests/unit/create-order-auth-ordering.test.mjs` (3/3 PASS).
- `SEC-WIN-015` (CWE-200): Resource leaves RLS leakage — Verified closed by `tests/security/resource-leaves-rls-hardening.test.mjs` (3/3 PASS).
