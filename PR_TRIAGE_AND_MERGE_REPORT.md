# PR Triage & Resolution Report: Elephant-Goldfish Merge Train

**Repository:** `thrinnadhh/AppointmentsApp`  
**Execution Date:** 2026-11-20  
**Orchestration Mode:** `coordinator-mode` + Elephant-Goldfish Orchestration  
**Final Status:** All 10 open Pull Requests triaged, security-audited, tested, and resolved (**0 open PRs remaining**).

---

## 1. Executive Summary

A comprehensive multi-phase triage was executed across all 10 open Pull Requests on `thrinnadhh/AppointmentsApp`. Using parallel bounded-context Goldfish auditors (`pr-security-auditor`) and an Elephant state dependency matrix (`.gsd/PR_TRIAGE_MATRIX.json`), all PRs were reviewed for zero security regressions, secret leaks, breaking dependency changes, and database migration ordering.

- **7 PRs Merged Cleanly**: PR #17, #18, #19, #20, #22, #23 (GitHub Actions security upgrades) and PR #13 (Security Window Closure campaign hardening, Cashfree origin guards, and RPC protections).
- **3 PRs Closed with Rationale**: PR #15 & #21 (rejected due to CodeQL `init`/`analyze` action version splitting, consolidated together in PR #13) and PR #16 (rejected due to `pnpm/action-setup@v6` standalone runtime incompatibility with pnpm 8.15.0).
- **Toolchain Hardening**: Updated `.github/dependabot.yml` with `groups: github-actions` and ignored `pnpm/action-setup` major semver updates to prevent fragmented PR spam in the future.
- **Final `main` Verification**: All checks on `origin/main` are running with green CI (CodeQL passed, Security audit passed, Lint/Typecheck passed, Build passed, offline unit tests 31/31 passed).

---

## 2. Complete PR Triage Matrix & Actions

| PR # | Title | Bucket | CI Status (Before) | Security Risk & Audit Finding | Action Taken | Final Status |
|:---:|:---|:---|:---:|:---|:---|:---:|
| **#13** | `fix(security): Security Window Closure campaign hardening` | `DATABASE_MIGRATIONS` | `NO_CHECKS` (Conflicting) | **CONDITIONAL_APPROVE**: High-value security hardening across RLS, API auth, and Cashfree WebView origin guards. 16 commits were already merged via PR #14; required rebase onto `origin/main` to drop duplicates. | Rebased onto `origin/main` dropping commits `b962eb0`..`9d2c333`, consolidated CodeQL v4 paired bump, tested, and merged. | **MERGED** (`899edc9`) |
| **#15** | `ci(deps): bump github/codeql-action/analyze from 3.39.3 to 4.39.3` | `SECURITY_AND_DEPS` | `FAILURE` (4 failing checks) | **REJECT**: Splitting `analyze` from `init` violates CodeQL action version locking and halts the analysis step. | Closed with comment directing consolidation with PR #21. | **CLOSED** |
| **#16** | `ci(deps): bump pnpm/action-setup from 3.0.0 to 6.1.1` | `SECURITY_AND_DEPS` | `FAILURE` (2 failing checks) | **REJECT**: Standalone native bootstrapper in v6 causes Node environment isolation failures with Expo/Metro bundler, failing Customer E2E tests and breaking the CI gate. | Closed with comment retaining pinned v3.0.0. Added dependabot ignore rule. | **CLOSED** |
| **#17** | `ci(deps): bump actions/checkout from 4.2.2 to 7.0.1` | `SECURITY_AND_DEPS` | `SUCCESS` (13 passed) | **APPROVED**: Valid 40-char commit SHA (`3d3c42e5...`), Node 24 Actions runner compatible, 0 security regressions. | Approved and squashed into `main`. | **MERGED** (`a1b35ad`) |
| **#18** | `ci(deps): bump actions/upload-artifact from 4.4.3 to 7.0.2` | `SECURITY_AND_DEPS` | `SUCCESS` (13 passed) | **APPROVED**: Valid 40-char commit SHA (`cf430e03...`), preserves artifact contracts and conditionals. | Approved and squashed into `main`. | **MERGED** (`1b4e4a7`) |
| **#19** | `ci(deps): bump gitleaks/gitleaks-action from 2.3.9 to 3.0.0` | `SECURITY_AND_DEPS` | `SUCCESS` (13 passed) | **APPROVED**: Valid 40-char commit SHA (`e0c47f4f...`), runtime migrated to Node 24, preserves `--log-opts="--all"`. | Approved and squashed into `main`. | **MERGED** (`c0532e4`) |
| **#20** | `ci(deps): bump actions/cache from 4.3.0 to 6.1.0` | `SECURITY_AND_DEPS` | `SUCCESS` (13 passed) | **APPROVED**: Valid 40-char commit SHA (`55cc8345...`), Node 24 runner compatible, cache keys preserved. | Approved and squashed into `main`. | **MERGED** (`10da955`) |
| **#21** | `ci(deps): bump github/codeql-action/init from 3.39.3 to 4.39.3` | `SECURITY_AND_DEPS` | `FAILURE` (2 failing checks) | **REJECT**: Splitting `init` from `analyze` violates CodeQL action version locking and halts the analysis step. | Closed with comment directing consolidation with PR #15. | **CLOSED** |
| **#22** | `ci(deps): bump trufflesecurity/trufflehog from 3.88.1 to 3.99.9` | `SECURITY_AND_DEPS` | `SUCCESS` (13 passed) | **APPROVED**: Valid 40-char commit SHA (`3bd2b588...`), preserves `--only-verified` secret scanning. | Approved and squashed into `main`. | **MERGED** (`6c86050`) |
| **#23** | `ci(deps): bump actions/setup-node from 4.4.0 to 7.1.0` | `SECURITY_AND_DEPS` | `SUCCESS` (13 passed) | **APPROVED**: Valid 40-char commit SHA (`949feb24...`), provisions Node 22 with pnpm caching across all jobs. | Approved and squashed into `main`. | **MERGED** (`d4db9c9`) |

---

## 3. Security & Quality Audit Findings (Goldfish Deep-Dives)

### A. Database Migrations & Governance (PR #13)
1. **RLS & Trigger Protection**:
   - `guard_provider_governance()` restricts non-admin mutation of `city`, `cashfree_vendor_*`, `bank_*`, and `payout_upi_id` with SQLSTATE `42501`.
   - `merchant_save_operational_settings(...)` enforces caller authorization against provider ownership, memberships, and department access with strict `search_path = public, private, pg_temp`.
2. **Draft Migrations**:
   - Forward migrations `20261120000004` and `20261120000005` were placed in `supabase/migrations_draft/` with rollback counterparts in `supabase/migrations_rollback/`. Timestamp ordering is sequential with zero schema collisions.
3. **Mobile Checkout Defenses**:
   - `CashfreeCheckoutWebView.tsx` strictly validates `nativeEvent.url` against `isAllowedCashfreeUrl(currentUrl)`, blocks unauthorized domains, wraps `JSON.parse` in try/catch, and triggers server-authoritative fallback verification if the URL is missing.
   - `CheckoutModal.tsx` implements fail-closed polling on modal close, exponential backoff on HTTP 429 rate limiting, and server-authoritative payment verification.

### B. CI Dependency & Workflow Security (PRs #15–#23)
1. **Commit SHA Pinning (`SEC-WIN-011`)**:
   - Every single updated GitHub Action maintains full 40-character hexadecimal SHA pinning with version annotation comments. Verified by [tests/security/github-actions-hardening.test.mjs](file:///Users/trinadh/projects/Appointments/tests/security/github-actions-hardening.test.mjs) (4/4 PASS).
2. **CodeQL Action Version Parity**:
   - `github/codeql-action/init` and `github/codeql-action/analyze` were consolidated and simultaneously bumped to SHA `33d7b85da1a04171e211befe2c739303b9a4c066` (`# v4.39.3`) in [.github/workflows/codeql.yml](file:///Users/trinadh/projects/Appointments/.github/workflows/codeql.yml), resolving the runner mismatch.
3. **Dependabot Configuration**:
   - Configured [.github/dependabot.yml](file:///Users/trinadh/projects/Appointments/.github/dependabot.yml) with:
     ```yaml
     groups:
       github-actions:
         patterns:
           - "*"
     ignore:
       - dependency-name: "pnpm/action-setup"
         update-types: ["version-update:semver-major"]
     ```

---

## 4. Verification Receipts on `origin/main`

- **GitHub PR Status:**
  ```bash
  $ gh pr list --state open
  no open pull requests in thrinnadhh/AppointmentsApp
  ```
- **Local Unit & Security Suites:**
  - `tests/unit/checkout-modal-verify-on-close.test.mjs`: 7/7 PASS
  - `tests/unit/cashfree-webview-origin-guard.test.mjs`: 6/6 PASS
  - `tests/security/github-actions-hardening.test.mjs`: 4/4 PASS
  - `tests/unit/checkin-pin-terminology.test.mjs`: 3/3 PASS
  - `tests/unit/create-order-auth-ordering.test.mjs`: 3/3 PASS
  - `tests/unit/prescriptions-signed-url-bypass.test.mjs`: 4/4 PASS
  - `tests/unit/razorpay-decommission.test.mjs`: 4/4 PASS
  - **Total Passing Tests:** 31 passed, 0 failed, 0 skipped.
- **Typecheck:**
  - `@appointments/merchant-web`: Clean (0 errors)
  - `@appointments/customer-mobile`: Clean (0 errors)
- **GitHub Actions on `main`:**
  - `CodeQL Advanced Security Audit` (`44786756980`): **SUCCESS**
  - `Dependabot Updates` (`44786764003`): **SUCCESS**
  - `CI — Tirupati Appointments Platform` (`44786757100`): **SUCCESS** (Audit, Lint/Typecheck, Build passed).
