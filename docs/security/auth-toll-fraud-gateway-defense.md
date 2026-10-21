# Remediation: Authentication, Toll-Fraud & Gateway Defense (3 High, 3 Med)

## Status: Completed & Verified ✅

### Summary of Completed Remediations

1. **High — OTP E.164 Normalization & XFF Bypass**:
   - Installed `libphonenumber-js` in `@appointments/merchant-web`.
   - Updated [route.ts](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/app/api/auth/otp/send/route.ts) and [route.ts](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/app/api/auth/otp/verify/route.ts) to parse phone numbers strictly using `parsePhoneNumber(phone.trim(), 'IN')`, validate via `.isValid()`, and format as canonical `.format('E.164')` strings (e.g. `+919848012345`). Invalid or non-viable numbers are rejected upfront with 400.
   - Bound rate limits to trusted proxy headers or raw socket IPs via `getClientIp`, preventing spoofing via client-crafted `X-Forwarded-For` headers.

2. **High — Razorpay SRI & CSP Hardening**:
   - Updated [CheckoutModal.tsx](file:///Users/trinadh/projects/Appointments/apps/customer-mobile/src/screens/CheckoutModal.tsx) script injection to include `script.integrity = 'sha384-NGmSb1KehQLbxaQireyZsxqw5m8oN1qSYAOEkPd7JW3f2liirqbwcgV1ANfaqxpe'` and `script.crossOrigin = 'anonymous'`.
   - Tightened [next.config.mjs](file:///Users/trinadh/projects/Appointments/apps/merchant-web/next.config.mjs) CSP: removed wildcard `http:` and `https:` from `script-src` and `frame-src`, and explicitly allowlisted `https://checkout.razorpay.com` and `https://api.razorpay.com`.
   - Scrubbed placeholder keys from [page.tsx](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/app/settings/page.tsx) and `.github/workflows/ci.yml`.

3. **High — GitHub Actions CI Hardening**:
   - Pinned all third-party actions in [.github/workflows/ci.yml](file:///Users/trinadh/projects/Appointments/.github/workflows/ci.yml) across all 8 jobs to immutable 40-character commit SHAs (`actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, `actions/upload-artifact`, `trufflesecurity/trufflehog`).
   - Enforced non-ignorable, blocking security scan steps (`continue-on-error: false` for `pnpm audit` and `trufflehog`).
   - Added `security-audit` gate verification to `all-checks-pass`.

4. **Medium — create-order Caller Verification**:
   - Updated [route.ts](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/app/api/payments/create-order/route.ts): enforced `const caller = await verifyAuthenticatedUser(req); if (!caller) return 401;`. Anonymous callers can no longer create payment orders for bookings.
   - Added unit test in `test-routes.mjs` verifying anonymous requests receive 401.

5. **Medium — Non-Prod E2E Customer Header Leak**:
   - Updated [middleware.ts](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/middleware.ts): disabled `x-customer-id` header evaluation when `process.env.NODE_ENV === 'production'`, and restricted `Access-Control-Allow-Headers` in production to prevent exposure of bypass headers.
   - Updated [auth-admin.ts](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/lib/auth-admin.ts): strictly gated `x-customer-id` / `x-test-customer-id` header override logic behind `process.env.NODE_ENV !== 'production'`.

6. **Medium — Hold Endpoint Rate Limiter Spoofing**:
   - Updated [route.ts](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/app/api/bookings/hold/route.ts) and shared helper [auth-admin.ts](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/lib/auth-admin.ts): replaced vulnerable leftmost `split(',')[0]` extraction with `(req as any).ip` -> `x-real-ip` -> `cf-connecting-ip` -> rightmost trusted proxy hop in `x-forwarded-for`.

---

### Verification Summary

- **Unit & Security Suites**:
  - `node test-concurrency.mjs`: 16/16 passed
  - `node test-routes.mjs`: 68/68 passed
  - `node test-security.mjs`: 31/31 passed
  - `node test-validation.mjs`: 31/31 passed
  - **Total**: 146 tests passed (0 failures)
- **Typecheck**: `pnpm --filter @appointments/merchant-web typecheck` (passed with 0 errors)
- **Linter**: `pnpm --filter @appointments/merchant-web lint` (passed with 0 errors)
