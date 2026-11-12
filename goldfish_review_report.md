# Goldfish Annotated Review Report

**Status**: Resolved  
**Target:** `docs/designs/cashfree-payment-gateway-migration.md` (`222-295`)  
**Stage:** Stage 9 (Implementation Readiness Test Remediation)

## Prioritized Findings & AI Suggestions

### [IR-01] [`egm-codebase-details` / `egm-implementation-readiness`] - Severity: Blocker
* **Affected Scope:** Phase 3 (line 240) & File Table; `apps/merchant-web/src/middleware.ts`
* **Discrepancy Description:** `apps/merchant-web/src/middleware.ts` intercepts all `/api/*` requests and returns `401 Unauthorized` unless explicitly whitelisted in `PUBLIC_API_ROUTES`. Only `/api/webhooks/razorpay` is currently whitelisted. Inbound Cashfree webhooks will fail closed with HTTP 401.
* **Rationale:** Omission of `middleware.ts` prevents any Cashfree webhook from reaching its route handler.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Essential runtime touchpoint. `middleware.ts` must be included in Phase 3 and the File Enumeration table.
* ***Proposed Edit:***
  * Location: Phase 3 (line 240) & File Enumeration Table
  * Change: Add `apps/merchant-web/src/middleware.ts` as an UPDATE item: "Adds `'/api/webhooks/cashfree'` to `PUBLIC_API_ROUTES` to bypass authentication for server-to-server webhook ingestion."

### [IR-02] [`egm-implementation-readiness` / `egm-codebase-details`] - Severity: Blocker
* **Affected Scope:** Phase 1 (line 228) & File Table; `packages/shared/src/database.types.ts` & `packages/shared/src/types.ts`
* **Discrepancy Description:** Phase 1 applies migration adding `gateway_provider` and `payment_session_id` to `bookings`. In this monorepo, database types are centrally defined in `packages/shared/src/database.types.ts` and `types.ts`.
* **Rationale:** Omitting these type files will cause `pnpm typecheck` to fail in Phase 3 and Phase 5, violating Standing Rule 4.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Type synchronization is required for monorepo compilation.
* ***Proposed Edit:***
  * Location: Phase 1 & File Enumeration Table
  * Change: Add `packages/shared/src/database.types.ts` and `packages/shared/src/types.ts` as UPDATE items: "Updates `bookings` Row, Insert, and Update types with `gateway_provider: string` and `payment_session_id: string | null`, and adds `payment_session_id?: string` to `CreateRazorpayOrderResponse`."

### [IR-03] [`egm-codebase-details` / `egm-implementation-readiness`] - Severity: Blocker
* **Affected Scope:** Phase 4 (line 247) & File Table; `apps/customer-mobile/src/services/api.ts`
* **Discrepancy Description:** `CheckoutModal.tsx` does not make direct HTTP fetch calls; it delegates order creation and verification to `createRazorpayOrder` and `verifyRazorpayPayment` in `apps/customer-mobile/src/services/api.ts`. `createRazorpayOrder` drops unmapped fields and does not return `payment_session_id`.
* **Rationale:** Without updating `api.ts`, `CheckoutModal.tsx` cannot receive `payment_session_id` or trigger Cashfree checkout.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Core client service abstraction must be updated alongside UI.
* ***Proposed Edit:</a>
  * Location: Phase 4 & File Enumeration Table
  * Change: Add `apps/customer-mobile/src/services/api.ts` as an UPDATE item: "Updates order creation and verification service functions to return `payment_session_id` and handle Cashfree verification while preserving backward compatibility."

### [IR-04] [`egm-codebase-details` / `egm-implementation-readiness`] - Severity: Major
* **Affected Scope:** Phase 4 (line 246) & File Table (line 275); `apps/merchant-web/next.config.mjs`
* **Discrepancy Description:** Cashfree Drop renders checkout inside an iframe. CSP in `next.config.mjs` currently limits `frame-src` to `api.razorpay.com` and `checkout.razorpay.com`. Line 275 mentions only `script-src` and `connect-src`.
* **Rationale:** Browsers will block the Cashfree Drop iframe if `frame-src` does not whitelist Cashfree domains.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Mandatory browser security configuration.
* ***Proposed Edit:***
  * Location: Phase 4 & File Enumeration Table
  * Change: Explicitly include `frame-src` in `next.config.mjs` updates to authorize `https://sdk.cashfree.com` and `https://sandbox.cashfree.com`.

### [IR-05] [`egm-codebase-details`] - Severity: Major
* **Affected Scope:** Phase 4 & File Table; `apps/merchant-web/src/env.mjs`
* **Discrepancy Description:** `apps/merchant-web/src/env.mjs` enforces `REQUIRED_PRODUCTION_VARS` (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`). If `PAYMENT_GATEWAY_PROVIDER=cashfree` is deployed in production without Razorpay keys, server boot fails. Also `APP_KEY_PREFIXES` lacks `CASHFREE_`.
* **Rationale:** Server will crash on boot if environment validation is not aware of the active gateway provider.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Required for production deployment stability.
* ***Proposed Edit:***
  * Location: Phase 4 & File Enumeration Table
  * Change: Add `apps/merchant-web/src/env.mjs` as an UPDATE item: "Conditionally enforces production credentials based on `PAYMENT_GATEWAY_PROVIDER` and registers `CASHFREE_` prefix in `APP_KEY_PREFIXES`."

### [IR-06] [`egm-implementation-readiness`] - Severity: Major
* **Affected Scope:** Phase 3 (lines 241-242) & File Table (lines 268-270)
* **Discrepancy Description:** Cashfree Drop checkout does not return a client HMAC signature. Synchronous verification requires calling `adapter.fetchOrder(orderId)` to verify `order_status === 'PAID'`. The plan does not specify the request/response contracts for `/api/payments/verify`, `/api/payments/create-order`, or webhook acknowledgment status codes.
* **Rationale:** Leaves critical API contract design decisions to the implementer (Zero-Decision Rule violation).
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Document precise request/response schemas and status codes.
* ***Proposed Edit:***
  * Location: Phase 3 & File Enumeration Table
  * Change: Specify that `/api/payments/verify` branches by `gateway_provider`, calling `adapter.fetchOrder(orderId)` to verify `order_status === 'PAID'` for Cashfree. Document `create-order` JSON response schema (`{ order_id, cf_order_id, payment_session_id, gateway_provider }`) and webhook response codes (HTTP 200 on success/duplicate, HTTP 400 on invalid HMAC/replay).

### [IR-07] [`egm-implementation-readiness` / `egm-codebase-details`] - Severity: Major
* **Affected Scope:** Phase 4 (line 248) & File Table (lines 277-278)
* **Discrepancy Description:** Environment variables are ambiguously named (`ENV`, `PAYMENTS_APP_ID`, and unnamed mobile flags).
* **Rationale:** `ENV` collides with OS shell defaults; Expo mobile variables require `EXPO_PUBLIC_` prefix.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Pre-determines exact environment variable names per Zero-Decision Rule.
* ***Proposed Edit:***
  * Location: Phase 4 & File Enumeration Table
  * Change: Standardize names: `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV` (`SANDBOX` | `PRODUCTION`), and Expo mobile variable `EXPO_PUBLIC_CASHFREE_ENV`.

### [IR-08] [`egm-codebase-details`] - Severity: Major
* **Affected Scope:** Phase 3 (line 243) & File Table (lines 271-274)
* **Discrepancy Description:** In `apps/merchant-web/src/lib/razorpay.ts`, `recoverStuckRefunds()` runs cron checks on stuck refunds, and admin refunds enqueue into `refunds` pgmq worker (Decision 57). The plan does not state how async workers resolve the active adapter.
* **Rationale:** Background refund worker will fail or misroute if it hardcodes Razorpay.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Prescribes dynamic gateway resolution based on the booking's `gateway_provider` column.
* ***Proposed Edit:***
  * Location: Phase 3 & File Enumeration Table
  * Change: Detail that the background pgmq refund worker and `recoverStuckRefunds()` resolve `PaymentGatewayAdapter` dynamically using the booking record's `gateway_provider` column.

### [IR-09] [`egm-implementation-readiness`] - Severity: Major
* **Affected Scope:** Phase 5 (lines 250-254) & File Table (lines 279-282)
* **Discrepancy Description:** Test plan is described in broad strokes without explicit test assertions and edge cases.
* **Rationale:** Implementation readiness standard requires concrete test assertions to verify on the first attempt.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Detail specific happy path and failure edge case assertions.
* ***Proposed Edit:***
  * Location: Phase 5 & File Enumeration Table
  * Change: Enumerate explicit test scenarios: paise-to-rupee integer math, order ID truncation length formula `cf_${booking_id.replace(/-/g, '').slice(0, 32)}`, 300s replay attack window rejection, expired hold race condition auto-refund, and webhook idempotency.

### [IR-10] [`egm-style`] - Severity: Major
* **Affected Scope:** Lines 280-281
* **Discrepancy Description:** Test files located under `tests/unit/` are described as "Integration test suite...".
* **Rationale:** Calling an integration test exercising database row locks or external sandbox endpoints a "unit" test in its path is technically uncalibrated.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Calibrate descriptions to specify isolated unit/mock test suites.
* ***Proposed Edit:</a>
  * Location: Lines 280-281
  * Change: Update descriptions to: "Unit test suite verifying webhook replay handling, timing-safe signature comparison, and expired hold transitions using mock database client" and "Unit test suite verifying Cashfree refund payload formatting and status mapping."

### [IR-11] [`egm-style`] - Severity: Nit
* **Affected Scope:** Lines 226, 234, 236, 263, 265, 271
* **Discrepancy Description:** Uses buzzwords and academic jargon ("functional client", "polymorphic gateway refund execution", "unified", "canonical").
* **Rationale:** Degrades technical directness and clarity.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Replace with dry, concrete engineering terminology.
* ***Proposed Edit:***
  * Location: Section 1 & Section 2
  * Change: Replace "functional Cashfree client service" with "Cashfree REST API client", "polymorphic gateway refund execution" with "adapter `refundOrder()` calls", and "Unified Implementation List" with "Phased Implementation Steps".

### [IR-12] [`egm-style`] - Severity: Nit
* **Affected Scope:** Lines 261, 264, 275, 282
* **Discrepancy Description:** Repeatedly appends defensive disclaimers echoing Standing Rule 5 ("without weakening Razorpay tests", "past migrations untouched").
* **Rationale:** Defensive hedging that adds no operational guidance.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Drop redundant clauses.
* ***Proposed Edit:***
  * Location: File Enumeration Table
  * Change: Delete trailing defensive disclaimers.

### [IR-13] [`egm-implementation-readiness` / `egm-zoom-out`] - Severity: Nit
* **Affected Scope:** Line 266
* **Discrepancy Description:** Cites "order ID truncation" without specifying the exact formula.
* **Rationale:** Developer must know the exact expression to implement.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Embed canonical expression.
* ***Proposed Edit:***
  * Location: Line 266
  * Change: State formula `cf_${booking_id.replace(/-/g, '').slice(0, 32)}` directly in table entry.

### [IR-14] [`egm-codebase-details`] - Severity: Nit
* **Affected Scope:** Line 276 (`CheckoutModal.tsx`)
* **Discrepancy Description:** `tests/scripts/test-security.mjs` asserts that `CheckoutModal.tsx` contains `script.integrity = 'sha384-NGmSb1KehQLbxaQireyZsxqw5m8oN1qSYAOEkPd7JW3f2liirqbwcgV1ANfaqxpe'`.
* **Rationale:** Modifying `CheckoutModal.tsx` carelessly could remove the Razorpay SRI check and fail security tests.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Explicitly note that `loadRazorpayScript()` SRI integrity must remain intact.
* ***Proposed Edit:***
  * Location: Line 276
  * Change: Add note: "Preserves existing `loadRazorpayScript()` SHA-384 integrity and `crossOrigin` attributes."
