# Intermediate Zoom Out Review Report (Stage 8)

**Target Document**: `docs/designs/cashfree-payment-gateway-migration.md`  
**Reviewer**: Skeptical Architect (`egm-zoom-out`)  
**Standard**: Zoom-Out Architectural Standard & Codebase Invariants  
**Verdict**: 🟢 **APPROVED (Architecture Converged; Ready for Implementation Readiness Test)**

---

## 1. Summary of Evaluation

The revised technical design document has successfully converged to a clean, minimal, and non-destructive transition plan:

1. **Clean Elimination of Prior Blockers**:
   - **Easy-Split Domain Mismatch**: Completely eliminated. Order creation now targets standard `/pg/orders` for the ₹10 online platform fee / deposit only.
   - **Database Schema Collision & Trigger**: Completely eliminated. Additive migration strictly adds `gateway_provider` and `payment_session_id`, leaving existing generic columns and legacy data intact.
   - **Standing Rule 5 Test Regressions**: Completely eliminated. Razorpay functionality is preserved via `RazorpayAdapter` wrapping `apps/merchant-web/src/lib/razorpay.ts`. Existing test suites remain 100% intact, and parallel Cashfree suites are established.

2. **Domain Invariants Alignment**:
   - The platform fee and deposit model strictly adheres to `docs/hospital/SPEC.md` lines 10–24.
   - Slot reservation hold window (5 minutes) is synchronized with Cashfree's `order_expiry_time` (`now() + 5 minutes`).
   - Webhook fulfillment incorporates defense against late payments on expired slot holds, preventing double-booking by immediately initiating an automated refund.

---

## 2. Implementation Touchpoint Findings

| ID | Priority | Scope | Description & Remediation |
|---|---|---|---|
| **ZO-08** | 🟡 **Major** | Detailed Plan / File Table | **Next.js Middleware Whitelist**: `apps/merchant-web/src/middleware.ts` intercepts `/api/*` and blocks unauthenticated calls. Add `/api/webhooks/cashfree` to `PUBLIC_API_ROUTES`. |
| **ZO-09** | 🟡 **Major** | Detailed Plan / File Table | **CSP `frame-src` Directive**: Cashfree Drop/Web Checkout renders inside an iframe. Extend CSP `frame-src` with `https://sdk.cashfree.com` and `https://sandbox.cashfree.com` in `next.config.mjs`. |
| **ZO-10** | 🟡 **Major** | Detailed Plan / File Table | **Client API Service Layer**: `apps/customer-mobile/src/services/api.ts` must be updated to return `payment_session_id` to `CheckoutModal.tsx`. |
| **ZO-11** | 🟢 **Nit** | Architecture / Section 5 | **Synchronous Verification Flow**: Clarify that `/api/payments/verify` calls `adapter.fetchOrder(orderId)` to verify `PAID` status on the active read path. |
| **ZO-12** | 🟢 **Nit** | Architecture / Section 2 | **Order ID Example Consistency**: Align sample payload with specified format `cf_${booking_id.replace(/-/g, '').slice(0, 32)}`. |

---

## 3. Next Steps
Advance to **Stage 9 (Implementation Readiness Test)** to verify that all implementation instructions, file touches, and execution steps are unambiguous and ready for developer handover.

