# Comprehension Test Report (Stage 6)

**Target Document**: `docs/designs/cashfree-payment-gateway-migration.md`  
**Reviewer**: Naive Reader (`egm-comprehension`)  
**Scope**: `FeatureRange` (lines 1..208) & `DetailedRange` (lines 209..264)  

---

### Paraphrase

**What this proposes**  
This document proposes migrating the platform's payment infrastructure from Razorpay to Cashfree Payment Gateway using an adapter pattern (`PaymentGatewayAdapter`) to support multiple gateways. It introduces an additive database migration with synchronization triggers to store generic gateway IDs while preserving legacy `razorpay_*` columns to satisfy invariant test rules. The design adopts Cashfree's native Easy-Split mechanism to automatically partition appointment fees between vendors (doctors/departments) and the platform during order creation. Furthermore, it outlines dedicated Cashfree webhook ingestion with HMAC-SHA256 verification and updates client checkout flows in both web and mobile applications.

**How the existing system works, per this document**  
Currently, appointment bookings, checkout flows, webhooks, and refunds are directly coupled to Razorpay APIs and database columns (`razorpay_order_id`, `razorpay_payment_id`) managed in `apps/merchant-web/src/lib/razorpay.ts`. Payouts between hospitals, platform fees, and cancellation penalties are calculated and distributed through custom internal database accounting rather than gateway-level vendor splits. Incoming webhooks are validated by verifying Razorpay's `X-Razorpay-Signature` against the raw payload body. Existing test suites strictly enforce these Razorpay-specific workflows, signature validations, and database fields, which cannot be modified or removed under platform test-retention rules.

---

### Audit Findings

#### 1. Undefined Vendor Mapping Mechanism for Cashfree Easy-Split
* **Severity**: 🔴 **Blocker**
* **Affected Scope**: Section "Multi-Tenant Revenue Sharing via Cashfree Easy-Split" (Lines 87–116), "Client Checkout Integration Flow" (Lines 167–170), and File Enumeration (Line 247).
* **Discrepancy Description & Rationale**:
  In Section 2, the design demonstrates that Cashfree order generation requires an `order_splits` array containing a `vendor_id` (e.g., `"hosp_tirupati_ent_dept"`). Non-Goals (Line 40) explicitly states that vendors will not be automatically provisioned via KYC APIs in Phase 1 and that "vendor IDs will be mapped via configuration or admin settings." In the checkout flow (Lines 167–170), the patient calls `POST /api/bookings/checkout (slot_id, doctor_id)`, and the backend immediately supplies `order_splits: [vendor_id]` to Cashfree.
  However, the document never defines or specifies *how* `doctor_id` resolves to `vendor_id`. The database schema migration (Section 3 and Line 247) does not add any vendor mapping table or column to doctors/departments, nor does the document specify any configuration schema or lookup mechanism. Without defining where and how vendor IDs are mapped and retrieved, an engineer cannot implement order creation or the Easy-Split integration.

---

#### 2. Open Questions Contradict Finalized Technical Plan
* **Severity**: 🟡 **Major**
* **Affected Scope**: Section "Open Questions" (Lines 45–49) vs. "Adapter Abstraction Architecture" (Lines 54–84) and "Additive Database Schema Migration" (Lines 120–135).
* **Discrepancy Description & Rationale**:
  Lines 45–48 pose two foundational open questions:
  1. *"Should we introduce a unified adapter (`PaymentGatewayAdapter`) to allow either gateway via environment variable, or completely purge Razorpay references across the repository?"*
  2. *"For existing bookings and tests asserting `razorpay_order_id`, will database views or dual-writing columns be acceptable during the transition period?"*
  Immediately following this section, Sections 1 and 3 prescribe the answers as settled architecture: creating `PaymentGatewayAdapter` with provider toggling via `PAYMENT_GATEWAY_PROVIDER`, and executing an additive database migration with a synchronization trigger. Presenting foundational decisions simultaneously as open questions and as settled implementation specifications creates confusion about whether the architectural direction is finalized or still in review.

---

#### 3. Ambiguous Mobile Client SDK Integration ("Cashfree Drop SDK" on Mobile)
* **Severity**: 🟡 **Major**
* **Affected Scope**: Section "Client Checkout Integration Flow" (Line 173), "Detailed Implementation Plan - Phase 4" (Line 233), and File Enumeration (Lines 256–257).
* **Discrepancy Description & Rationale**:
  Line 173 in the sequence diagram specifies: `Patient (Mobile App) -> CF: Launch Cashfree Drop SDK (payment_session_id)`. Line 257 states that `apps/customer-mobile/src/screens/CheckoutScreen.tsx` updates payment invocation to pass `payment_session_id` to "Cashfree SDK / Drop component."
  In Cashfree's ecosystem, the "Drop SDK" is a web JavaScript library (`@cashfreepayments/cashfree-js`). Mobile applications (e.g., React Native) typically require Cashfree's native React Native PG SDK bridge or an embedded WebView. The document is vague about the integration model for `customer-mobile`, and neither Phase 4 nor the file table lists updating mobile package dependencies (`package.json`) to install a Cashfree SDK, while simultaneously updating CSP in `apps/merchant-web/next.config.mjs` (Line 232). A developer cannot tell whether the mobile app embeds a web checkout view or requires a native package installation.

---

#### 4. Unspecified CI Environment Configuration for Legacy Test Isolation
* **Severity**: 🟡 **Major**
* **Affected Scope**: Section "Adapter Abstraction Architecture - Provider Resolution" (Lines 82–84) vs. "The Problem" (Line 20) and "Goals" (Line 33).
* **Discrepancy Description & Rationale**:
  Line 83 specifies that provider resolution defaults to `cashfree` and falls back to `razorpay` if unconfigured. If the default runtime provider is `cashfree`, running existing unmodified test suites in CI without explicit environment flags will trigger the Cashfree flow, immediately causing tests asserting Razorpay HMAC signatures, headers, and endpoints to fail. The document does not describe how the test environment or test setups isolate legacy suites from this `cashfree` default to guarantee the stated goal of "Zero Test Regressions."

---

#### 5. Undefined Project-Specific Domain Terms
* **Severity**: 🟡 **Major**
* **Affected Scope**: Section "Webhook Ingestion & Idempotency Lifecycle" (Line 152) and "Client Checkout Integration Flow" (Line 177).
* **Discrepancy Description & Rationale**:
  The document introduces domain-specific rules and processes without defining them or linking to their source specifications:
  - *"Updates refund ledger in `audit_logs` matching existing Doctor Emergency / 6-Strike refund requirements."* (Line 152)
  - *"Confirm Booking & Set Permanent Check-in PIN"* (Line 177)
  A new team member has no context for what the "Doctor Emergency / 6-Strike refund" business rules entail, nor how a "Permanent Check-in PIN" is generated, formatted, or assigned. These concepts should either be defined inline or linked to the canonical specification (e.g., `docs/hospital/SPEC.md`).

---

#### 6. Vague Vendor Reconciliation Execution Lifecycle
* **Severity**: 🟢 **Nit**
* **Affected Scope**: Section "Multi-Tenant Revenue Sharing via Cashfree Easy-Split" (Lines 115–116).
* **Discrepancy Description & Rationale**:
  Line 116 states: *"Reconciliation: Settled splits are verified via Cashfree's `POST /split/order/vendor/recon` endpoint without custom payout triggers."*
  The document does not specify who, when, or what process executes this reconciliation endpoint (e.g., an automated reconciliation cron, an admin-facing route, or manual verification). While Alternative B explicitly rejects background cron jobs, no file in the file enumeration table (Lines 245–263) handles settlement reconciliation.

---

#### 7. Unlinked Standing Rules
* **Severity**: 🟢 **Nit**
* **Affected Scope**: Lines 20, 21, 121, 211, and 248.
* **Discrepancy Description & Rationale**:
  The document repeatedly references "Standing Rule 2", "Standing Rule 5", and "Standing Rule 7" as governing constraints for architectural choices. For a fresh reader, these rules are neither defined nor linked to their defining repository documentation (e.g., `AGENTS.md` or `GEMINI.md`). Providing links or citations ensures clear traceability for project-specific constraints.

