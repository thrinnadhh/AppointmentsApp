# Implementation Readiness Review Report (Stage 9)

**Target Document**: `docs/designs/cashfree-payment-gateway-migration.md`  
**Target Scope**: Lines 222–282 (Section: Detailed Implementation Plan & File Enumeration)  
**Standard**: Implementation Readiness Standard (`implementation-readiness-standard.md`) & Codebase Invariants  
**Reviewers**: 
- `egm-implementation-readiness` (Tech Lead Validator)
- `egm-codebase-details` (Codebase Quality Auditor)
- `egm-style` (Technical Copy Editor)
**Verdict**: 🔴 **REVISION REQUIRED (Critical File Touchpoints & Execution Details Missing)**

---

## 1. Executive Summary

The Detailed Implementation Plan provides a sound high-level roadmap for introducing Cashfree alongside Razorpay via an adapter interface. However, an audit against the **Implementation Readiness Standard** and actual codebase touchpoints revealed that an implementing engineer cannot execute the plan on the first attempt without making unguided architectural choices or encountering immediate runtime and build failures.

Specifically:
1. **Critical Path Runtime Blocker**: Next.js middleware blocks all unauthenticated `/api/*` requests. Without adding `/api/webhooks/cashfree` to `PUBLIC_API_ROUTES` in `apps/merchant-web/src/middleware.ts`, every inbound Cashfree webhook will fail closed with HTTP 401.
2. **Typecheck & Build Blocker**: Modifying the database schema without synchronizing `packages/shared/src/database.types.ts` and `packages/shared/src/types.ts` will immediately break `pnpm typecheck`, violating Standing Rule 4.
3. **Mobile Client Boundary Gap**: `CheckoutModal.tsx` does not make raw HTTP calls; it delegates order creation and verification to `apps/customer-mobile/src/services/api.ts`. Omitting `api.ts` leaves the mobile checkout flow disconnected.
4. **CSP Iframe Framing Blocker**: Cashfree Drop/Web Checkout renders inside an iframe (`https://sdk.cashfree.com` and `https://sandbox.cashfree.com`). The plan omits `frame-src` from the CSP configuration in `next.config.mjs`, causing modern browsers to block the modal.
5. **Runtime Boot Crash**: `apps/merchant-web/src/env.mjs` unconditionally requires Razorpay keys in production unless updated to check the active gateway provider.

---

## 2. Consolidated Findings & Traceability Matrix

| ID | Priority | Category | Affected Scope | Discrepancy & Required Remediation |
|---|---|---|---|---|
| **IR-01** | 🔴 **Blocker** | Codebase Touchpoint | Phase 3, Table; `apps/merchant-web/src/middleware.ts` | **Next.js Middleware Webhook Whitelist**: In `middleware.ts`, unauthenticated API requests are blocked with HTTP 401 unless listed in `PUBLIC_API_ROUTES`. Add `apps/merchant-web/src/middleware.ts` to Phase 3 and the File Table, prescribing adding `'/api/webhooks/cashfree'` to `PUBLIC_API_ROUTES`. |
| **IR-02** | 🔴 **Blocker** | Codebase Touchpoint | Phase 1, Table; `packages/shared/src/database.types.ts` & `types.ts` | **TypeScript Database & API Types Sync**: All Supabase queries use `@appointments/shared`. Phase 1 introduces `gateway_provider` and `payment_session_id` to `bookings`. Add `database.types.ts` and `types.ts` to Phase 1 and the File Table to prevent `pnpm typecheck` failures. |
| **IR-03** | 🔴 **Blocker** | Codebase Touchpoint | Phase 4, Table; `apps/customer-mobile/src/services/api.ts` | **Mobile API Client Service Layer**: `CheckoutModal.tsx` delegates payment order creation and verification to `apps/customer-mobile/src/services/api.ts`. Add `api.ts` to Phase 4 and the File Table, updating service functions to expose `payment_session_id`. |
| **IR-04** | 🟡 **Major** | Security / Browser | Phase 4, Table; `apps/merchant-web/next.config.mjs` | **CSP `frame-src` Directive**: Cashfree Drop renders checkout UI in an iframe. In `next.config.mjs`, `frame-src` must be explicitly extended to authorize `https://sdk.cashfree.com` and `https://sandbox.cashfree.com` alongside `script-src` and `connect-src`. |
| **IR-05** | 🟡 **Major** | Environment & SRE | Phase 4, Table; `apps/merchant-web/src/env.mjs` | **Server Boot Environment Validation**: `apps/merchant-web/src/env.mjs` enforces `REQUIRED_PRODUCTION_VARS` (`RAZORPAY_KEY_ID`, etc.) and `APP_KEY_PREFIXES`. Update `env.mjs` to conditionally validate keys based on `PAYMENT_GATEWAY_PROVIDER` and register the `CASHFREE_` prefix. |
| **IR-06** | 🟡 **Major** | Zero-Decision Rule | Phase 3, Table; `/api/payments/verify` & `/api/payments/create-order` | **Verification & Order Creation Data Contracts**: Cashfree Drop does not return an HMAC signature from the client. Specify that `/api/payments/verify` invokes `adapter.fetchOrder(orderId)` to confirm `order_status === 'PAID'`. Explicitly define the JSON response schema for `/api/payments/create-order` when Cashfree is active. |
| **IR-07** | 🟡 **Major** | Zero-Decision Rule | Phase 4, Table; `.env.example` files | **Canonical Environment Variable Naming**: Replace ambiguous `ENV` and `PAYMENTS_APP_ID` with canonical names: `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV` (`SANDBOX` \| `PRODUCTION`), and Expo mobile variable `EXPO_PUBLIC_CASHFREE_ENV`. |
| **IR-08** | 🟡 **Major** | Asynchronous SRE | Phase 3, Table; Async Refund Workers | **Background Worker & Cron Recovery Alignment**: In `apps/merchant-web/src/lib/razorpay.ts`, `recoverStuckRefunds()` runs cron checks on stuck refunds, and admin refunds enqueue into `refunds` pgmq worker (Decision 57). Detail how the worker resolves `PaymentGatewayAdapter` dynamically using the booking record's `gateway_provider`. |
| **IR-09** | 🟡 **Major** | Zero-Decision Rule | Phase 5, Table; Test Plan Specifications | **Concrete Test Plan & Assertion Criteria**: Enumerate explicit test scenarios in Phase 5: paise-to-rupee integer math, order ID length formula `cf_${booking_id.replace(/-/g, '').slice(0, 32)}`, 300s replay attack window rejection, expired hold race condition auto-refund, and webhook idempotency. |
| **IR-10** | 🟡 **Major** | Technical Style | Lines 280–281 | **Path vs. Taxonomy Contradiction**: The plan describes `cashfree-webhook-idempotency.test.mjs` and `cashfree-refund-integration.test.mjs` as integration test suites, but places them in `tests/unit/`. Clarify that these are isolated unit/mock suites using mocked database/API clients, or place under proper directory taxonomy. |
| **IR-11** | 🟢 **Nit** | Technical Style | Lines 234, 236, 263, 265, 271 | **Eliminate Buzzwords & Jargon**: Replace "functional client" with "Cashfree REST API client", "polymorphic gateway refund execution" with "adapter `refundOrder()` calls", and simplify stacked adjectives ("unified", "standardized", "canonical"). |
| **IR-12** | 🟢 **Nit** | Technical Style | Lines 261, 264, 275, 282 | **Drop Defensive Invariant Caveats**: Remove repetitive defensive disclaimers ("without weakening Razorpay tests", "past migrations untouched") from the file table rationale. |
| **IR-13** | 🟢 **Nit** | Zero-Decision Rule | Line 266 | **Order ID Truncation Expression**: Document the exact canonical expression `cf_${booking_id.replace(/-/g, '').slice(0, 32)}` directly in the table rationale for `cashfree-adapter.ts`. |
| **IR-14** | 🟢 **Nit** | Codebase Invariant | Line 276 | **Razorpay SRI Integrity Invariant in `CheckoutModal.tsx`**: Note that when integrating Cashfree Drop into `CheckoutModal.tsx`, the existing `loadRazorpayScript()` SHA-384 integrity and `crossOrigin` attributes must be preserved to prevent regressing `tests/scripts/test-security.mjs`. |

---

## 3. Required File Enumeration Additions

The File Enumeration table in Section 2 must be augmented with the following missing touchpoints:

| Action | File Path | Rationale |
|---|---|---|
| **UPDATE** | `apps/merchant-web/src/middleware.ts` | Adds `'/api/webhooks/cashfree'` to `PUBLIC_API_ROUTES` to bypass authentication checks for server-to-server webhook ingestion. |
| **UPDATE** | `packages/shared/src/database.types.ts` | Updates TypeScript database definition for `bookings` table to add `gateway_provider: string` and `payment_session_id: string \| null`. |
| **UPDATE** | `packages/shared/src/types.ts` | Adds `payment_session_id?: string` to `CreateRazorpayOrderResponse` and shared payment types. |
| **UPDATE** | `apps/customer-mobile/src/services/api.ts` | Updates mobile client service functions (`createRazorpayOrder` / `createPaymentOrder`, `verifyPayment`) to return and consume `payment_session_id`. |
| **UPDATE** | `apps/merchant-web/src/env.mjs` | Conditionally enforces production credentials based on `PAYMENT_GATEWAY_PROVIDER` and registers `CASHFREE_` prefix in `APP_KEY_PREFIXES`. |
| **UPDATE** | `apps/merchant-web/next.config.mjs` | Extends CSP `frame-src` directive to include `https://sdk.cashfree.com` and `https://sandbox.cashfree.com` alongside `script-src` and `connect-src`. |

