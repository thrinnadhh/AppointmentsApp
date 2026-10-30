# API Security & Corruption Remediation Plan

## Goal
Resolve all void security boundaries (unauthenticated PII / check-in code leakage / broadcast spoofing) and corrupted route handlers (missing database RPCs, authentication context loss, spoofable IP headers, unbounded queries) across the Next.js API surface.

## Tasks

- [x] Task 1: Create Database Migration for `cancel_doctor_emergency`
  - **Files**: `supabase/migrations/20261030000001_cancel_doctor_emergency_rpc.sql`
  - **Action**: Implement `public.cancel_doctor_emergency(p_doctor_resource_id, p_effective_from, p_reason)` with 100% refunds and 0 merchant strikes, matching the contract expected by `/api/doctor/emergency-cancel`. Apply to local PostgreSQL.
  - **Verify**: `node tests/scripts/test-policies-standby-and-doctor-emergency.mjs` runs and succeeds.

- [x] Task 2: Fix Authenticated Session Context in `/api/account/delete`
  - **File**: `apps/merchant-web/src/app/api/account/delete/route.ts`
  - **Action**: Call `supabase.rpc('request_account_deletion')` on the authenticated cookie client rather than `supabaseAdmin`, ensuring `auth.uid()` is passed into Postgres.
  - **Verify**: `request_account_deletion` executes without "Not authenticated" 500 error.

- [x] Task 3: Secure `/api/ticket/[id]` Against PII Scraping and Check-in Code Theft
  - **File**: `apps/merchant-web/src/app/api/ticket/[id]/route.ts`
  - **Action**: Validate UUID format. Check caller identity: only expose the secret `checkin_code` and unmasked PII to the authenticated customer or authorized provider staff. Redact `checkin_code` and mask phone/email for unauthenticated link-only viewers.
  - **Verify**: `node --test tests/scripts/test-ticket-freshness.mjs` passes and unauthorized calls do not leak check-in codes.

- [x] Task 4: Secure `/api/customer/queue-and-history` Against Unauthenticated PII Scraping
  - **File**: `apps/merchant-web/src/app/api/customer/queue-and-history/route.ts`
  - **Action**: Disallow querying arbitrary `customer_id` or `phone` without active authenticated session matching caller. Validate `booking_id` UUID when used for link-only queue viewing.
  - **Verify**: Unauthenticated requests with `?phone=...` or `?customer_id=...` return 401/403.

- [x] Task 5: Authenticate & Authorize `/api/queue/broadcast`
  - **File**: `apps/merchant-web/src/app/api/queue/broadcast/route.ts`
  - **Action**: Add `verifyAuthenticatedUser(req)` and check that caller is authorized staff/merchant for the target doctor/provider.
  - **Verify**: Unauthenticated POST requests are rejected with 401.

- [x] Task 6: Harden `/api/logs/ingest` Against IP Spoofing
  - **File**: `apps/merchant-web/src/app/api/logs/ingest/route.ts`
  - **Action**: Replace raw `x-forwarded-for` with platform-verified `getClientIp(request)` from `@/lib/auth-admin`.
  - **Verify**: Rate limit derives from trusted edge headers.

- [x] Task 7: Clamp Query Limits in `/api/admin/bookings` and `/api/bookings`
  - **Files**: `apps/merchant-web/src/app/api/admin/bookings/route.ts` & `apps/merchant-web/src/app/api/bookings/route.ts`
  - **Action**: Enforce `Math.min(Math.max(1, limit), 100)` to prevent memory exhaustion / DoS.
  - **Verify**: Large limit parameters are capped at 100.

- [x] Task 8: Resilient Error Handling in `/api/admin/app-logs/test-alert`
  - **File**: `apps/merchant-web/src/app/api/admin/app-logs/test-alert/route.ts`
  - **Action**: Handle edge function dispatch failure gracefully without crashing the admin route when `crash-alert` is not deployed.
  - **Verify**: POST returns 200 with test log inserted and edge status noted.

## Done When
- [x] `pnpm typecheck` passes with 0 errors.
- [x] All security and route test suites (`test-security.mjs`, `test-routes.mjs`, `test-validation.mjs`, `test-policies-standby-and-doctor-emergency.mjs`) pass with 0 errors.
- [x] No unauthenticated endpoint leaks secret check-in codes or dumps customer PII.
