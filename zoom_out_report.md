# Initial Zoom Out Review Report (Stage 5)

**Target Document**: `docs/designs/cashfree-payment-gateway-migration.md`  
**Reviewers**: Skeptical Architect (`egm-zoom-out`) & Inventive Catalyst (`egm-inventive-catalyst`)  
**Verdict**: 🔴 **REJECTED (Requires Major Architectural Revision)**

---

## 1. Executive Summary

The Initial Zoom Out review audited `docs/designs/cashfree-payment-gateway-migration.md` against the actual codebase (`apps/merchant-web`, `apps/customer-mobile`, `packages/shared`, `supabase/migrations`) and domain invariants (`docs/hospital/SPEC.md`). 

The audit reveals that while introducing Cashfree as an alternative gateway is feasible, the design document as drafted is predicated on domain misunderstandings, non-existent database constraints, and severe YAGNI violations.

---

## 2. Critical Findings Matrix

| ID | Priority | Category | Finding Summary |
|---|---|---|---|
| **ZO-01** | 🔴 **Blocker** | YAGNI / Domain Mismatch | **Cashfree Easy-Split is unneeded**: Per `docs/hospital/SPEC.md`, patients only pay a ₹10 platform fee online; doctor consultation fees are collected offline at the clinic desk. Partitioning ₹500/₹50 online is a phantom requirement. |
| **ZO-02** | 🔴 **Blocker** | Codebase Conflict | **Database schema is already generic**: `bookings` and `payments` already use `gateway_order_id` and `gateway_payment_id`. Proposing a trigger on non-existent `razorpay_order_id` will break database migrations. |
| **ZO-03** | 🔴 **Blocker** | Rule 5 Invariant | **Test Suite Regression**: Existing security and regression test suites assert Razorpay webhook paths, SRI script hashes, and CSP whitelist entries. Purging them violates Standing Rule 5. |
| **ZO-04** | 🟡 **Major** | File Path Accuracy | **Incorrect File Paths**: The design hallucinates paths (`api/bookings/checkout`, `CheckoutScreen.tsx`, `admin/bookings/refund`). Actual paths are `api/payments/create-order`, `api/payments/verify`, `CheckoutModal.tsx`, and `api/admin/refunds`. |
| **ZO-05** | 🟡 **Major** | Race Conditions | **Slot Lock Expiration vs Order TTL**: The 5-minute database hold can lapse while the Cashfree checkout order remains open, allowing payment on expired slots. Cashfree `order_expiry_time` must be capped at 5 minutes. |
| **ZO-06** | 🟡 **Major** | Webhook Dependency | **Passive Webhook Failure Mode**: The client requests tickets immediately after SDK completion. Webhook jitter causes 404/unconfirmed errors unless active pull-through verification (`fetchOrder`) is supported on the read path. |
| **ZO-07** | 🟢 **Nit** | Simplicity | **Over-engineered OOP Adapter Hierarchy**: A clean, functional `apps/merchant-web/src/lib/cashfree.ts` module mirroring `razorpay.ts` is more cohesive than abstract class hierarchies. |

---

## 3. Reviewer Reports

### A. Skeptical Architect Review (`egm-zoom-out`)

1. **Domain Invariant Conflict (Easy-Split)**:
   - In `docs/hospital/SPEC.md` and migration `20261026190000_split_payment_platform_fee_and_consultation_fee.sql`, the online payment is strictly the platform fee (₹10). The doctor's ₹500 consultation fee is collected in person at the hospital desk (`consultation_payment_status = 'COLLECTED_AT_DESK'`).
   - Consequently, building vendor KYC onboarding, automated vendor provisioning, reconciliation endpoints (`POST /split/order/vendor/recon`), and dynamic split payloads is massive, unnecessary complexity.
2. **Schema Reality Check**:
   - `packages/shared/src/database.types.ts` confirms that `bookings` and `payments` already use `gateway_order_id` and `gateway_payment_id`. There is no `razorpay_order_id` column on `bookings`. Proposing a migration with a trigger copying `razorpay_order_id` would throw PostgreSQL syntax/relation errors.
3. **Repository Path Realignment**:
   - Order creation: `apps/merchant-web/src/app/api/payments/create-order/route.ts`
   - Payment verification: `apps/merchant-web/src/app/api/payments/verify/route.ts`
   - Refunds: `apps/merchant-web/src/app/api/admin/refunds/route.ts`, `api/bookings/cancel/route.ts`, `api/doctor/emergency-cancel/route.ts`, `api/bookings/no-show/route.ts`
   - Mobile checkout: `apps/customer-mobile/src/screens/CheckoutModal.tsx`

---

### B. Inventive Catalyst Review (`egm-inventive-catalyst`)

1. **Synchronized Gateway Order TTL (Pattern 3: Preliminary Action)**:
   - Compute Cashfree's `order_expiry_time` dynamically to match the 5-minute database reservation hold (`now() + 5 minutes`). This prevents late payments on expired slots.
2. **Read-Path Active Pull-Through Reconciliation (Pattern 5: Inversion)**:
   - If the client requests the booking pass while status is still `PENDING_PAYMENT`, query Cashfree's `fetchOrder(gateway_order_id)` inline rather than failing or waiting indefinitely for webhook delivery.
3. **Additive Column Management**:
   - Keep migrations strictly additive. If needed, only add `payment_session_id TEXT` and `gateway_provider VARCHAR(32) DEFAULT 'razorpay'`. Do not create procedural database triggers.

---

## 4. Required Action Items Before Advancing

1. **Scrap Easy-Split from Scope**: Align order creation to charge only the platform fee (₹10) via standard `/pg/orders`. Remove vendor onboarding and split reconciliation.
2. **Correct Database Schema Migration**: Drop the proposed trigger on non-existent `razorpay_order_id`. Only add `payment_session_id` and `gateway_provider` if needed.
3. **Update Repository File References**: Fix all route and component paths to point to actual existing files in `Appointments`.
4. **Add Order TTL Synchronization**: Set `order_expiry_time` in Cashfree to 5 minutes to prevent race condition slot collisions.
5. **Preserve Razorpay Handlers**: Keep Razorpay handlers and CSP rules intact to satisfy existing security tests per Standing Rule 5.

