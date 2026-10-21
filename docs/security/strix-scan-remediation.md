# Strix Scan Remediation Plan

## Goal
Remediate all 13 security vulnerabilities identified in the latest Strix penetration test scan (`strix_runs/appointments_b7ac`), eliminating critical authentication bypasses, API flaws, RPC escalation vectors, and dependency CVEs.

## Tasks
- [x] Task 1: Harden E2E bypass in `apps/merchant-web/src/lib/auth-admin.ts`, `apps/merchant-web/src/middleware.ts`, `apps/merchant-web/src/app/api/test/expire-hold/route.ts`, and `playwright.config.ts` by requiring an explicit non-default secret and removing unauthenticated `x-customer-id` / `x-admin-bypass-key` defaults (`vuln-0001`, `vuln-0002`) → Verify: `curl -H "x-admin-bypass-key: tirupati-superadmin-e2e-2026" http://localhost:3000/api/admin/users` returns HTTP 401.
- [x] Task 2: Fix unauthenticated booking confirmation in `apps/merchant-web/src/app/api/bookings/confirm/route.ts` by rejecting unverified placeholder signatures and enforcing gateway order & amount binding even in mock mode (`vuln-0007`) → Verify: `curl -X POST http://localhost:3000/api/bookings/confirm -d '{"booking_id":"...","gateway_payment_id":"fake","razorpay_signature":"anything"}'` returns HTTP 401/400.
- [x] Task 3: Fix loose private-IP CORS origin regex in `apps/merchant-web/src/middleware.ts` by replacing `startsWith('10.')` / `startsWith('192.168.')` with strict octet-bounded `isPrivateIpv4()` validation (`vuln-0003`) → Verify: Request with `Origin: https://10.attacker.com` is denied CORS response headers.
- [x] Task 4: Secure database RPCs via Supabase migration by revoking the unguarded 3-parameter `update_city_status` overload and binding `check_cooling_period_eligibility` strictly to `auth.uid()` (`vuln-0004`, `vuln-0005`) → Verify: Supabase migration applies cleanly; calling RPCs as an unprivileged customer returns permission denied.
- [x] Task 5: Harden client IP extraction in `apps/merchant-web/src/lib/auth-admin.ts` and routes to stop trusting raw spoofable proxy headers and prevent shared-IP OTP lockout (`vuln-0006`) → Verify: Sending varying `X-Forwarded-For` headers cannot bypass OTP rate limits or lock out legitimate clients.
- [x] Task 6: Bump and pin vulnerable dependencies in root `package.json` under `pnpm.overrides` for `shell-quote`, `compression`, `source-map-js`, `braces`, `node-forge`, and `sharp` (`vuln-0008` through `vuln-0013`) → Verify: Run `pnpm install` and check that `pnpm audit` reports 0 high/critical vulnerabilities.
- [x] Task 7: Run end-to-end regression tests and execute scoped Strix verification scan (`vuln-0001` through `vuln-0013`) → Verify: `pnpm test:security` passes with 0 failures and Strix diff scan reports all 13 issues resolved.

## Done When
- [x] All 13 vulnerabilities from scan `appointments_b7ac` are closed and verified.
- [x] No regression in admin flows, booking confirmation, or customer authentication.
- [x] `pnpm test:security` and `pnpm test:validation` pass with 100% success.

## Notes
- E2E testing in CI/local can still use bypass headers if `ALLOW_E2E_AUTH_BYPASS=true` AND `ADMIN_BYPASS_SECRET` matches an ephemeral test secret (never committed).
- Supabase migrations must be additive and idempotent without dropping existing active RPC signatures used by older mobile client versions without an overload replacement.
