# Strix Security Remediation Plan: Hyperlocal Appointments Platform

> **Status:** Ready for Execution  
> **Source Run:** `strix_runs/appointments_d4d5` (Deep Scan)  
> **Target:** `Appointments` Monorepo & Merchant API  
> **Created:** 2026-10-04  
> **Mode:** Planning Only (No code modified)

---

## Executive Summary

Strix has completed deep penetration testing against the appointments monorepo and running merchant web application (`http://host.docker.internal:3000`). It evaluated 80 attack surfaces across 850 LLM reasoning turns, identifying **8 validated vulnerabilities** backed by verified Proof-of-Concept (PoC) exploits:

| Severity | Count | Primary Impact |
| :--- | :---: | :--- |
| **CRITICAL** | 1 | Full cross-tenant database compromise via exposed `service_role` key |
| **HIGH** | 2 | Unauthenticated user impersonation & unauthenticated booking creation/capture |
| **MEDIUM** | 3 | TOCTOU payment replay/double-spend, webhook settlement failure, rate limit bypass |
| **INFO** | 2 | Known CVEs in transitive build dependencies |

---

## Vulnerability Inventory & Root Cause Analysis

### 1. `vuln-0003` (CRITICAL) — Exposed Supabase `service_role` Key
- **CWE:** CWE-798 (Use of Hard-coded Credentials) | **CVSS:** 9.1
- **Root Cause:** A live, unexpiring (exp: 2036) Supabase `service_role` JWT is hardcoded in `scripts/e2e-trinadh-hospital-test.mjs` (and referenced in E2E test files). Because the GitHub repository is public, anyone can use this key to bypass Row Level Security (RLS) and query/mutate all 210 customer profiles, 50 payments, and merchant data.
- **Affected Files:**
  - `scripts/e2e-trinadh-hospital-test.mjs`
  - `tests/e2e/customer-hospital-full-lifecycle.spec.ts`

### 2. `vuln-0005` (HIGH) — User Impersonation & Admin Bypass via Headers
- **CWE:** CWE-287 (Improper Authentication) | **CVSS:** 8.2
- **Root Cause:** 
  1. `apps/merchant-web/src/lib/auth-admin.ts` trusts `x-customer-id: <any UUID>` without requiring a signature or secret when `ENABLE_E2E_BYPASS=true` and `NODE_ENV !== 'production'`.
  2. `apps/merchant-web/src/middleware.ts` allows any client request with an arbitrary dummy cookie matching `val.length > 20` to bypass the middleware route gate.
  3. `x-admin-bypass-key` grants instant platform super-admin privileges.
- **Affected Files:**
  - `apps/merchant-web/src/lib/auth-admin.ts`
  - `apps/merchant-web/src/middleware.ts`

### 3. `vuln-0007` (HIGH) — Unauthenticated Booking Hold & Confirmation
- **CWE:** CWE-862 (Missing Authorization) | **CVSS:** 8.2
- **Root Cause:** `/api/bookings/hold` and `/api/bookings/confirm` enforce customer identity and authorization checks only when `NODE_ENV === 'production'`. In non-production or development builds, an anonymous caller can hold doctor slots under any customer UUID and immediately confirm them as `CAPTURED` with zero payment.
- **Affected Files:**
  - `apps/merchant-web/src/app/api/bookings/hold/route.ts`
  - `apps/merchant-web/src/app/api/bookings/confirm/route.ts`

### 4. `vuln-0006` (MEDIUM) — Payment Anti-Replay TOCTOU Double-Spend
- **CWE:** CWE-362 (Race Condition / TOCTOU) | **CVSS:** 4.3
- **Root Cause:** `/api/bookings/confirm` checks if `gateway_payment_id` exists in `public.payments` via a non-atomic `select`, then executes the settlement write in a subsequent step. Furthermore, `public.payments (gateway_payment_id)` lacks a unique database constraint. Concurrent requests with the same payment ID both pass the check and settle two different bookings with one payment.
- **Affected Files:**
  - `apps/merchant-web/src/app/api/bookings/confirm/route.ts`
  - `supabase/migrations/` (Missing Unique Index on `payments.gateway_payment_id`)

### 5. `vuln-0008` (MEDIUM) — Razorpay Webhook Fails to Settle Payment
- **CWE:** CWE-252 (Unchecked Return Value) | **CVSS:** 6.5
- **Root Cause:**
  1. In `apps/merchant-web/src/app/api/webhooks/razorpay/route.ts`, the webhook passes `total_amount` (`deposit + fee`, e.g. 110) into `confirm_booking_payment()`, while the stored procedure expects `p_deposit_amount` matching `deposit_amount` (100).
  2. The RPC returns `{ success: false, error: "Amount mismatch with held deposit" }`, but the route ignores the failure and returns `HTTP 200 {"status":"CONFIRMED"}`.
  3. The booking stays stuck in `HELD` and expires, while the payment ledger record is never created.
- **Affected Files:**
  - `apps/merchant-web/src/app/api/webhooks/razorpay/route.ts`

### 6. `vuln-0004` (MEDIUM) — Client-Controlled Proxy Header Rate-Limit Bypass
- **CWE:** CWE-799 (Improper Control of Interaction Frequency) | **CVSS:** 5.3
- **Root Cause:** `getClientIp()` in `apps/merchant-web/src/lib/auth-admin.ts` blindly falls back to `X-Real-IP`, `CF-Connecting-IP`, or the last hop of `X-Forwarded-For`. An attacker can bypass the 5-OTP-send limit or payment throttling by cycling random header values.
- **Affected Files:**
  - `apps/merchant-web/src/lib/auth-admin.ts`

### 7. `vuln-0001` & `vuln-0002` (INFO) — Transitive Dependency CVEs
- **CWE:** CWE-400 / CWE-347
- **Root Cause:** Transitive build dependencies (`braces < 3.0.3` for stack overflow, `node-forge < 1.4.0` for RSA PKCS#1 v1.5 signature forgery) pulled via legacy tooling.
- **Affected Files:**
  - `package.json` (`pnpm.overrides`)

---

## Phased Remediation Plan

### Phase 1: Secrets & Key Sanitation (P0 — Immediate)
- [ ] **Task 1.1**: Remove all hardcoded `service_role` JWT literals from:
  - `scripts/e2e-trinadh-hospital-test.mjs`
  - `tests/e2e/customer-hospital-full-lifecycle.spec.ts`
  - Replace with `process.env.SUPABASE_SERVICE_ROLE_KEY`. Fail fast with a clear error if the environment variable is unset.
- [ ] **Task 1.2**: Add `scripts/e2e-trinadh-hospital-test.mjs` and all local test scratch files containing real credentials to `.gitignore`.
- [ ] **Task 1.3**: Provide user with key rotation steps on Supabase Dashboard (`Settings -> API -> Reset Secret Key`) to invalidate the exposed token.

### Phase 2: Authorization & Middleware Hardening (P1 — Critical)
- [ ] **Task 2.1**: Remove unauthenticated `x-customer-id` header impersonation from `apps/merchant-web/src/lib/auth-admin.ts`.
  - Customer identity must be established exclusively via verified Supabase JWT Bearer token or SSR session cookies.
- [ ] **Task 2.2**: Fix fake cookie bypass in `apps/merchant-web/src/middleware.ts`.
  - Remove the superficial `val.length > 20` heuristic.
  - Require real cookie session validation or eliminate the public route gate loophole for protected APIs.
- [ ] **Task 2.3**: Eliminate `NODE_ENV !== 'production'` bypass in:
  - `apps/merchant-web/src/app/api/bookings/hold/route.ts`
  - `apps/merchant-web/src/app/api/bookings/confirm/route.ts`
  - Authenticate the calling user in all environments; ensure `customer_id` matches the authenticated caller's UUID unless the caller is an authorized merchant/admin.

### Phase 3: Financial Integrity & Database Atomicity (P1 — Critical)
- [ ] **Task 3.1**: Create a Supabase migration to add a unique index on payments:
  ```sql
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_gateway_payment_id_unique 
  ON public.payments (gateway_payment_id) 
  WHERE gateway_payment_id IS NOT NULL;
  ```
- [ ] **Task 3.2**: Refactor `apps/merchant-web/src/app/api/bookings/confirm/route.ts` to handle double-spend attempts atomically. Catch database uniqueness violations (`23505`) and return HTTP 409 Conflict.
- [ ] **Task 3.3**: Fix Razorpay webhook in `apps/merchant-web/src/app/api/webhooks/razorpay/route.ts`:
  - Pass the exact amount expected by the database settlement RPC (`deposit_amount` vs `total_amount`).
  - Check the RPC return value: if `!rpcResult?.success`, log error, fail the request with HTTP 500/400 (allowing gateway retry), and do NOT report `status: "CONFIRMED"`.
  - Ensure payment ledger record is written atomically inside the settlement transaction.

### Phase 4: Rate Limiting & Network Resolver Hardening (P2 — Medium)
- [ ] **Task 4.1**: Refactor `getClientIp()` in `apps/merchant-web/src/lib/auth-admin.ts`:
  - Do not trust arbitrary client-supplied headers without verifying reverse-proxy IP.
  - Prioritize connection socket IP (`req.ip`) or strictly extract from trusted Cloudflare / Vercel proxy headers only when deployed on their edge.

### Phase 5: Dependency & Build Sanitization (P3 — Low)
- [ ] **Task 5.1**: Update `pnpm.overrides` in root `package.json` to enforce secure versions:
  - `"braces": ">=3.0.3"`
  - `"node-forge": ">=1.4.0"`
- [ ] **Task 5.2**: Run `pnpm install` and verify `pnpm audit` reports 0 high/critical CVEs.

---

## Verification & Proof Checklist

| Vulnerability | Verification Method | Expected Result |
| :--- | :--- | :--- |
| `vuln-0003` | `git grep -i "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS"` | 0 hardcoded occurrences in tracked repo files |
| `vuln-0005` | Send unauthenticated request with `x-customer-id: <victim_uuid>` to `/api/bookings` | Returns `HTTP 401 Unauthorized` |
| `vuln-0007` | Send unauthenticated `POST /api/bookings/hold` without session | Returns `HTTP 401 Unauthorized` |
| `vuln-0006` | Run concurrent confirmation exploit script with shared `gateway_payment_id` | Exactly 1 booking confirms (HTTP 200), remaining 7 fail (HTTP 409) |
| `vuln-0008` | Send signed Razorpay webhook payload for `payment.captured` | Persists `payments` row, marks booking `CONFIRMED`, returns valid state |
| `vuln-0004` | Send 10 consecutive OTP requests cycling `X-Forwarded-For` from same IP | Blocked at 6th request with `HTTP 429 Too Many Requests` |
| Full Suite | `pnpm test:validation && pnpm test:security && pnpm test:e2e` | 100% green pass with 0 regressions |
