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

---

## 6. Stage 1 Discovery Candidate Triage & Calibration (Global Rule R2)

**Audit Target:** Branch `security/window-closure-20261121`  
**Evaluation Standard:** Global Rule R2 (NO FALSE POSITIVES). A candidate is CONFIRMED only if (a) code path from entry to sink is verified, (b) reachability/attacker control is proven, and (c) a failing test/PoC exists and fails on unfixed code (RED). Items failing to meet all three criteria are dispositioned below:

### 6.1 Inconsistent Test Bypass Guard in Account Export (`SEC-DISC-003`)
- **Flagged Location:** `apps/merchant-web/src/app/api/account/export/route.ts:40-57`
- **Flagged By:** Track A Discovery (`DISCOVERY_MANTIS`)
- **Dismissal Reason (Unconfirmed / Architectural Intent):**
  1. The bypass logic is gated by `if (process.env.NODE_ENV !== 'production')`. In compiled production release builds, this block is completely dead code and unreachable.
  2. In empirical validation (`.gsd/evidence/DISCOVERY_MANTIS/test_export_bypass_without_flag.*`), sending `x-test-bypass-user` with an unseeded UUID returned `Status: 401 Unauthorized` (`profile === null`).
  3. No failing regression test or empirical PoC exists demonstrating unauthorized data exfiltration on unfixed code without valid profile fixtures.
- **Verdict:** `UNCONFIRMED` / Defense-in-Depth.

### 6.2 Admin MFA QR Code DOM Sink (`MODWEB-001`)
- **Flagged Location:** `apps/merchant-web/src/app/admin/login/page.tsx:614`
- **Flagged By:** Track B Discovery (`MODWEB-001`)
- **Dismissal Reason (Unconfirmed / Sanitized Sink):**
  1. `sanitizeQrSvg` explicitly enforces a DOMParser element tag whitelist on client execution.
  2. The input SVG string is received directly from the trusted Supabase Auth server (`enrollData.totp.qr_code`) or hardcoded mock SVG; it is not attacker-controlled.
  3. No executable RED failing test or XSS reproduction exists (`tests/unit/modern-web-dom-sinks.test.mjs` does not exist).
- **Verdict:** `UNCONFIRMED` (Defense-in-depth Trusted Types hardening recommendation).

### 6.3 Absence of Clear-Site-Data Header on Session Logout (`MODWEB-002`)
- **Flagged Location:** `apps/merchant-web/src/app/admin/page.tsx:336`
- **Flagged By:** Track B Discovery (`MODWEB-002`)
- **Dismissal Reason (Unconfirmed / Hardening Recommendation):**
  1. User logout triggers `supabase.auth.signOut()` which immediately invalidates the active refresh token and server-side session.
  2. While `Clear-Site-Data: "cache", "cookies", "storage"` is a recommended modern web defense-in-depth header, its absence does not permit session resurrection once the GoTrue server revokes the JWT session.
  3. No RED failing test exists demonstrating unauthorized session access post-signout.
- **Verdict:** `UNCONFIRMED` (Defense-in-depth session termination hygiene).

### 6.4 Session Cookies Lack __Host- Prefix and HttpOnly in Browser Auth Client (`MODWEB-003`)
- **Flagged Location:** `apps/merchant-web/src/lib/supabase.ts:58`
- **Flagged By:** Track B Discovery (`MODWEB-003`)
- **Dismissal Reason (False Positive / Architectural Standard):**
  1. `createBrowserClient` from `@supabase/ssr` is the standard official architecture for Next.js App Router client components to maintain reactive auth state and manage tokens in browser cookies/memory.
  2. All state-changing mutations and healthcare data queries are authenticated server-side in Next.js Route Handlers and enforced by PostgreSQL Row Level Security (RLS), not by client cookie attributes.
  3. No RED failing test exists (`tests/unit/cookie-security-flags.test.mjs` does not exist).
- **Verdict:** `FALSE_POSITIVE` (Supabase SSR Architecture Standard).

### 6.5 Content-Security-Policy Employs 'unsafe-inline' Without Nonces (`MODWEB-004`)
- **Flagged Location:** `apps/merchant-web/next.config.mjs:47-60`
- **Flagged By:** Track B Discovery (`MODWEB-004`)
- **Dismissal Reason (Unconfirmed / Secondary Defense Layer):**
  1. Content-Security-Policy is a secondary containment mechanism to mitigate XSS; it does not constitute an exploitable vulnerability in isolation without a primary script injection sink.
  2. The application source contains zero un-sanitized reflection sinks or script execution vectors.
  3. No RED failing test exists (`tests/security/csp-nonce-enforcement.test.mjs` does not exist).
- **Verdict:** `UNCONFIRMED` (Defense-in-depth CSP nonce migration recommendation).

### 6.6 Missing COOP and CORP Isolation Headers (`MODWEB-005`)
- **Flagged Location:** `apps/merchant-web/next.config.mjs:22-65`
- **Flagged By:** Track B Discovery (`MODWEB-005`)
- **Dismissal Reason (Unconfirmed / Operational Compatibility):**
  1. Cross-Origin-Opener-Policy must remain compatible with third-party payment gateway popup lifecycles (Cashfree Checkout).
  2. Cross-Origin-Resource-Policy default isolation does not create direct exploitable vectors without cross-origin embedding vulnerabilities.
  3. No RED failing test exists (`tests/security/isolation-headers.test.mjs` does not exist).
- **Verdict:** `UNCONFIRMED` (Defense-in-depth process isolation recommendation).

### 6.7 Lack of Fetch Metadata (Sec-Fetch-Site) Verification on State-Changing API Routes (`MODWEB-006`)
- **Flagged Location:** `apps/merchant-web/src/middleware.ts:168-195`
- **Flagged By:** Track B Discovery (`MODWEB-006`)
- **Dismissal Reason (Unconfirmed / Multiple Existing Defenses):**
  1. All mutating API routes require `Content-Type: application/json` (triggering CORS preflight requests) or explicit Bearer tokens in `Authorization` headers.
  2. Edge middleware explicitly enforces CORS origin validation (`assertAllowedOrigin`).
  3. No RED failing test exists (`tests/security/sec-fetch-site-guard.test.mjs` does not exist).
- **Verdict:** `UNCONFIRMED` (Defense-in-depth request validation recommendation).

### 6.8 External Cashfree Scripts Loaded Without Subresource Integrity (SRI) Hashes (`MODWEB-007`)
- **Flagged Location:** `apps/customer-mobile/src/screens/CheckoutModal.tsx:57-65`
- **Flagged By:** Track B Discovery (`MODWEB-007`)
- **Dismissal Reason (Unconfirmed / Operational Availability Trade-off):**
  1. The Cashfree Web SDK is delivered via official HTTPS CDN (`https://sdk.cashfree.com/js/v3/cashfree.js`) which continuously rolls minor bug fixes and payment method adaptations.
  2. Pinning an immutable SRI hash without dynamic upstream synchronization would cause catastrophic payment checkout failures upon Cashfree CDN updates.
  3. No RED failing test exists (`tests/unit/subresource-integrity.test.mjs` does not exist).
- **Verdict:** `UNCONFIRMED` (Operational availability trade-off).

### 6.9 Inline Script Parameter Interpolation in Payment WebView (`MODWEB-008`)
- **Flagged Location:** `apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx:123-140`
- **Flagged By:** Track B Discovery (`MODWEB-008`)
- **Dismissal Reason (Unconfirmed / Trusted Upstream Parameter):**
  1. `paymentSessionId` is generated exclusively server-side by the Cashfree Orders API and validated before component rendering.
  2. The WebView is strictly isolated by `originWhitelist` (hardened in `SEC-WIN-002`) and `handleMessage` origin checks (hardened in `SEC-WIN-003`).
  3. No RED failing test exists (`tests/unit/cashfree-webview-injection.test.mjs` does not exist).
- **Verdict:** `UNCONFIRMED` (Defense-in-depth parameter serialization hardening).

### 6.10 Incomplete WebAuthn Passkeys Implementation (`MODWEB-009`)
- **Flagged Location:** `supabase/config.toml:201-207`
- **Flagged By:** Track B Discovery (`MODWEB-009`)
- **Dismissal Reason (False Positive / Feature Inactive):**
  1. Passkey and WebAuthn relying party configurations are explicitly commented out (`# [auth.passkey] enabled = false`) in `supabase/config.toml`.
  2. Passkeys are not deployed or enabled in the application runtime. A commented-out feature cannot represent an active attack surface or vulnerability.
  3. No RED failing test exists (`tests/unit/webauthn-rp-binding.test.mjs` does not exist).
- **Verdict:** `FALSE_POSITIVE` (Feature Inactive / Commented-Out Configuration).

### 6.11 Suboptimal Referrer-Policy Set to origin-when-cross-origin (`MODWEB-010`)
- **Flagged Location:** `apps/merchant-web/next.config.mjs:44-46`
- **Flagged By:** Track B Discovery (`MODWEB-010`)
- **Dismissal Reason (Unconfirmed / HSTS Compensating Control):**
  1. The application enforces strict HSTS (`max-age=63072000; includeSubDomains; preload`), preventing insecure HTTP downgrades across which referrer origin headers could leak.
  2. `origin-when-cross-origin` only transmits the origin name across secure origins, suppressing sensitive path parameters.
  3. No RED failing test exists (`tests/security/referrer-policy.test.mjs` does not exist).
- **Verdict:** `UNCONFIRMED` (Defense-in-depth Referrer-Policy hardening).

