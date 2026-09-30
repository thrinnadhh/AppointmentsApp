# Security Remediation Plan: BOLA, Tenant Isolation & Perimeter Hardening

## Overview
This plan establishes an end-to-end remediation roadmap for 9 identified security findings across the Appointments platform, covering:
1. **Priority 1: High Severity (Financial & Access Control BOLAs)**
   - Financial Tampering & Unlinked Signature Binding in `/api/bookings/confirm` & `/api/payments/verify`
   - Spring Boot BOLA on `PUT /api/v1/slots/rules`
   - Spring Boot BOLA on `GET /api/v1/bookings/merchant/{id}`
2. **Priority 2: Medium Severity (Tenant Isolation & Perimeter Defense)**
   - Cross-Provider Hold on Behalf in `/api/bookings/hold`
   - Unauthenticated Information Scraping Oracle via Supabase RPC `search_directory`
   - Unauthenticated Backend Auth Webhook Ingress (`/api/v1/webhooks/auth/user-created`)
   - Storage Hardening in `storage.ts` (Magic bytes, path isolation, upsert disablement, bucket whitelist)
   - Runtime Environment Validation in `env.mjs` (Expanded placeholder denylist)
3. **Priority 3: Needs-Validation (Infrastructure & Operations)**
   - Docker Compose & GHCR Watchtower Hardening (Label targeting, tag pinning, network isolation)

---

## Architecture & Impact Matrix

| Domain | Files Impacted | Key Security Control |
|---|---|---|
| **Next.js Web / API** | `apps/merchant-web/src/app/api/bookings/confirm/route.ts`<br>`apps/merchant-web/src/app/api/payments/verify/route.ts`<br>`apps/merchant-web/src/app/api/bookings/hold/route.ts`<br>`apps/merchant-web/src/lib/auth-admin.ts`<br>`apps/merchant-web/src/lib/storage.ts`<br>`apps/merchant-web/src/env.mjs` | Cryptographic signature verification, order amount binding, provider ownership check, buffer magic-byte validation, strict env regexes |
| **Spring Boot Backend** | `apps/backend/src/main/kotlin/com/appointments/availability/AvailabilityController.kt`<br>`apps/backend/src/main/kotlin/com/appointments/bookings/BookingController.kt`<br>`apps/backend/src/main/kotlin/com/appointments/identity/AuthWebhookController.kt`<br>`apps/backend/src/main/kotlin/com/appointments/common/config/SecurityConfig.kt`<br>`apps/backend/src/main/kotlin/com/appointments/common/security/SecurityService.kt` | `@PreAuthorize` tenant checks, merchant staff verification, constant-time `MessageDigest.isEqual` webhook authentication |
| **Database (Supabase)** | `supabase/migrations/20261001000001_harden_search_directory_and_permissions.sql` | `REVOKE EXECUTE ... FROM anon`, sanitized `search_directory_public` RPC omitting PII |
| **Infrastructure** | `docker-compose.yml` | Image SHA pinning, Watchtower label isolation, internal network boundary |
| **Test Suites** | `test-security.mjs`<br>`test-validation.mjs` | Automated regression test cases for BOLA, tamper detection, and perimeter defense |

---

## Step-by-Step Remediation Mini-Tasks To-Do List

### Phase 1: High Severity Financial & Access Control BOLAs (P1)

- [x] **Task 1.1: Harden Payment Order Binding in `/api/bookings/confirm`**
  - [x] Assert `booking.gateway_order_id` is non-null and strictly equals incoming `razorpay_order_id`.
  - [x] Fetch gateway order via `fetchRazorpayOrder(razorpay_order_id)` and verify `razorpayOrder.amount` matches the required amount in paise (`expectedDepositPaise` / `expectedTotalPaise`).
  - [x] In the direct payment fallback branch (`fetchRazorpayPayment`), strictly reject unlinked or mismatched `order_id`.
  - [x] Target file: `apps/merchant-web/src/app/api/bookings/confirm/route.ts`

- [x] **Task 1.2: Replicate Order Binding in `/api/payments/verify`**
  - [x] Ensure `booking.gateway_order_id` strictly equals `razorpay_order_id`.
  - [x] Verify `razorpayOrder.amount` matches expected booking paise.
  - [x] Target file: `apps/merchant-web/src/app/api/payments/verify/route.ts`

- [x] **Task 1.3: Secure Spring Backend `PUT /slots/rules` against BOLA**
  - [x] Introduce or utilize a Spring security bean `SecurityService.isMerchantStaff(authentication, merchantId)`.
  - [x] Ensure that every rule in the `rules` payload matches a merchant owned/operated by the authenticated user (`AppPrincipal`).
  - [x] Apply `@PreAuthorize` or imperative ownership check, throwing 403 Forbidden for mismatched tenant IDs.
  - [x] Target file: `apps/backend/src/main/kotlin/com/appointments/availability/AvailabilityController.kt`

- [x] **Task 1.4: Eliminate BOLA Enumeration on `GET /bookings/merchant/{id}`**
  - [x] Enforce that `{merchantId}` path variable belongs to the caller's authorized merchant profile or staff records.
  - [x] Add `@PreAuthorize("hasRole('ADMIN') or @securityService.isMerchantStaff(authentication, #merchantId)")` to `merchantBookings`.
  - [x] Prevent cross-tenant revenue/booking data leaks between merchants.
  - [x] Target file: `apps/backend/src/main/kotlin/com/appointments/bookings/BookingController.kt`

---

### Phase 2: Tenant Isolation & Perimeter Defense (P2)

- [x] **Task 2.1: Enforce Provider Ownership on Hold-On-Behalf (`/api/bookings/hold`)**
  - [x] In `apps/merchant-web/src/lib/auth-admin.ts`, implement `isCallerAuthorizedForProvider(callerId: string, providerId: string): Promise<boolean>`.
  - [x] In `apps/merchant-web/src/app/api/bookings/hold/route.ts`, when `caller && caller.id !== customer_id`:
    - Fetch the resource's parent `provider_id`.
    - Verify `await isCallerAuthorizedForProvider(caller.id, resData.provider_id)`.
    - Reject external merchants with `403 Forbidden`.
  - [x] Target files: `apps/merchant-web/src/app/api/bookings/hold/route.ts`, `apps/merchant-web/src/lib/auth-admin.ts`

- [x] **Task 2.2: Mitigate Supabase Anon Oracle for `search_directory`**
  - [x] Create migration `supabase/migrations/20261001000001_harden_search_directory_and_permissions.sql`.
  - [x] Execute `REVOKE EXECUTE ON FUNCTION public.search_directory(text) FROM anon;`.
  - [x] Define `public.search_directory_public(p_query text DEFAULT '')` returning sanitized fields (omitting phone, email, tax/bank data).
  - [x] Grant execute on `search_directory_public` to `anon`, `authenticated`, `service_role`.
  - [x] Target file: `supabase/migrations/20261001000001_harden_search_directory_and_permissions.sql`

- [x] **Task 2.3: Secure Backend Auth Webhook Ingress**
  - [x] Read `AUTH_WEBHOOK_SECRET` in Spring backend (`application.yml` / `@Value`).
  - [x] In `AuthWebhookController.kt`, inspect incoming `X-Webhook-Secret` header.
  - [x] Perform constant-time verification using `MessageDigest.isEqual(...)`.
  - [x] Return 401 Unauthorized if secret is missing or mismatched.
  - [x] Target files: `apps/backend/src/main/kotlin/com/appointments/identity/AuthWebhookController.kt`, `apps/backend/src/main/resources/application.yml`

- [x] **Task 2.4: Storage Adapter Hardening in `storage.ts`**
  - [x] Implement buffer magic-byte inspection (PNG, JPEG, WebP, PDF) to validate real file types instead of trusting client MIME headers.
  - [x] Enforce folder isolation structure: `<provider_id>/<user_id>/<uuid>.<ext>`.
  - [x] Change `upsert: true` to `upsert: false` in `uploadMediaAsset` and `uploadPrivateDocument` to disallow file overwrites.
  - [x] Whitelist target buckets strictly to `venue-assets` and `prescriptions-and-records`.
  - [x] Target file: `apps/merchant-web/src/lib/storage.ts`

- [x] **Task 2.5: Expand Environment Variable Denylist in `env.mjs`**
  - [x] Update `PLACEHOLDER_PATTERNS` with comprehensive regex:
    `/^(xxx+|change[_-]?me|your[_-].*|placeholder.*|dummy.*|test[_-]secret|rzp[_-]test[_-]placeholder)$/i`.
  - [x] Expand forbidden substrings to include hyphenated and underscored placeholder variations.
  - [x] Target file: `apps/merchant-web/src/env.mjs`

---

### Phase 3: Infrastructure Hardening (P3)

- [x] **Task 3.1: Harden Watchtower Configuration in `docker-compose.yml`**
  - [x] Pin `api` service image to specific release tag or commit SHA.
  - [x] Add `com.centurylinklabs.watchtower.enable: "true"` label to `api` container.
  - [x] Configure Watchtower with `--cleanup` (`WATCHTOWER_CLEANUP: "true"`), `--include-stopped` (`WATCHTOWER_INCLUDE_STOPPED: "true"`), and `WATCHTOWER_LABEL_ENABLE: "true"`.
  - [x] Isolate `/var/run/docker.sock` from internet-exposed reverse proxy networks.
  - [x] Target file: `docker-compose.yml`

---

### Phase 4: Verification & Automated Regression Testing

- [x] **Task 4.1: Add Node.js Security Test Assertions**
  - [x] Test confirm route rejecting mismatched or unlinked `razorpay_order_id`.
  - [x] Test confirm route rejecting tampered deposit amounts.
  - [x] Test hold route blocking cross-provider holds on behalf.
  - [x] Test storage adapter magic byte checks, non-upsert behavior, and path isolation.
  - [x] Test env placeholder regex against various dummy keys.
  - [x] Target file: `test-security.mjs` / `test-validation.mjs`

- [x] **Task 4.2: Execute Verification Suite**
  - [x] Run `node --test test-security.mjs`.
  - [x] Run `node --test test-validation.mjs`.
  - [x] Run backend Gradle check/build (`./gradlew test` in `apps/backend`).
  - [x] Run Next.js lint & typecheck (`pnpm --filter @appointments/merchant-web build` / `typecheck`).
  - [x] Run Playwright E2E suites (`tests/e2e/phase1-bola-defense.spec.ts`, `tests/e2e/phase2-tenant-isolation.spec.ts`).
