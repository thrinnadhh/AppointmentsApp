# Critic Review Report (Stage 7)

**Target Document**: `docs/designs/cashfree-payment-gateway-migration.md`  
**Reviewers**: Design Critic (`egm-design`), Structural Validator (`egm-structural`), Technical Copy Editor (`egm-style`)  
**Target Scope**: `FeatureRange` (lines 1–208)  
**Standard**: `resources/document_standards/feature-spec-standard.md`  
**Verdict**: 🔴 **REJECTED (Critical Flaws & Invariant Conflicts Identified)**

---

## 1. Executive Summary

The Critic Review phase rigorously evaluated the specification across three specialized lenses:
1. **Design Critic**: Identified critical domain mismatches between Cashfree Easy-Split and the hospital vertical's refund/strike rules, race conditions on expired slot holds, database column collisions, currency unit ambiguity (100x overcharge risk), and webhook replay vulnerabilities.
2. **Structural Validator**: Identified heading non-conformance (`## Technical Plan (Architecture)` vs canonical `## Architecture`), bullet marker syntax inconsistencies (`*` vs `-`), missing "Risks & Mitigations" section, and unlinked code references.
3. **Technical Copy Editor**: Flagged subjective praise/pejorative phrasing in alternatives ("unwarranted over-engineering", "cleanly isolates"), column name drift (`payment_provider` vs `gateway_provider`), and contradictory open questions hedging against Rule 5 invariants.

---

## 2. Consolidated Findings Matrix

| ID | Lens | Severity | Category | Summary |
|---|---|---|---|---|
| **CR-01** | Design | 🔴 **Blocker** | Domain & Financial | **Easy-Split Breaks Cancellation & 6-Strike Policies**: Locking ₹500 to a doctor vendor at order creation breaks 100% full refund requirements for >60m cancellations / Doctor Emergencies and ₹60 penalty caps on strikes 3–5. In this domain, only the platform fee is collected online. |
| **CR-02** | Design | 🔴 **Blocker** | Concurrency & Data Integrity | **Expired Hold Double-Booking & Webhook Race**: If payment succeeds after the 5-minute slot hold expires, unconditional confirmation causes illegal overlapping bookings. Missing row-level locks and late-payment auto-refund logic. |
| **CR-03** | Design | 🟡 **Major** | Currency Safety | **Currency Unit Ambiguity (100x Overcharge Risk)**: Razorpay operates strictly in integer paise (₹550 = `55000`); Cashfree `/pg/orders` expects floating-point rupees (`550.00`). Failing to standardize input units in `PaymentGatewayAdapter` risks massive overcharging. |
| **CR-04** | Design | 🟡 **Major** | Security | **Webhook Replay Attack & Encoding Ambiguity**: Missing timestamp freshness tolerance window (`Math.abs(Date.now() - timestamp) < 300000`) and unstated Base64 signature decoding. |
| **CR-05** | Design | 🟡 **Major** | Schema Collision | **Duplicate Database Columns**: `gateway_order_id` and `gateway_payment_id` already exist in `bookings`. The proposed ALTER TABLE migration and trigger on `razorpay_order_id` will fail. |
| **CR-06** | Design | 🟡 **Major** | Constraint Hazards | **Order ID Length & Phone Sanitization**: Cashfree enforces `order_id <= 45` characters (UUID prefixes exceed this) and strictly requires 10-digit numeric phone numbers (stripping `+91`). |
| **CR-07** | Design | 🟡 **Major** | Domain Invariant | **Permanent Check-in PIN Mutation**: Confirmation flow states it "sets" the PIN, but per `SPEC.md`, PIN is lifetime to the customer profile, not generated per booking. |
| **CR-08** | Design | 🟡 **Major** | Architecture | **Missing Client Verification Fallback**: Client cannot rely solely on asynchronous webhooks before requesting booking passes; requires dual active verification via `/api/payments/verify`. |
| **CR-09** | Structural | 🟡 **Major** | Standard Compliance | **Missing Required Sections**: Lacks a mandatory `## Risks & Mitigations` section and aliases `## Architecture` to `## Technical Plan (Architecture)`. |
| **CR-10** | Structural | 🟡 **Major** | Formatting | **Bullet Syntax Inconsistency**: Alternates between asterisk (`*`) and hyphen (`-`) bullets across adjacent sections. |
| **CR-11** | Style | 🟡 **Major** | Editorial & Calibration | **Contradictory Open Questions**: Posing Razorpay purging as an open question directly contradicts Standing Rule 5 and Goal 1. |
| **CR-12** | Style | 🟡 **Major** | Objectivity | **Subjective Tone in Alternatives**: Stripping conversational `"Rejected by author:"` prefixes and hyperbole ("unwarranted over-engineering", "unacceptable deployment risk"). |
| **CR-13** | Style | 🟢 **Nit** | Naming Drift | **Identifier Nomenclature**: Standardize `payment_provider` to `gateway_provider` across all sections. |

---

## 3. Remediation Directives

1. **Scrap Easy-Split; Align with Platform Fee Model**:
   - Update order creation to charge only the platform fee (₹10 or deposit) via standard `/pg/orders`.
   - Remove vendor KYC onboarding, `order_splits`, and vendor recon from the architecture.
2. **Add Strict Currency & Unit Normalization**:
   - Mandate `amountInPaise: number` in the `PaymentGatewayAdapter` interface.
   - Require `CashfreeAdapter` to divide by 100 (`amountInPaise / 100`) before calling `/pg/orders`.
3. **Harden Webhook Lifecycle**:
   - Enforce 5-minute timestamp freshness check.
   - Add explicit late-payment refund logic when slot hold has expired.
   - Decode Base64 `x-webhook-signature` using timing-safe buffer comparison.
4. **Fix Schema & Sanitization**:
   - Omit existing `gateway_order_id` / `gateway_payment_id` columns from migration.
   - Add only `gateway_provider` and `payment_session_id`.
   - Enforce `order_id` truncation/encoding (`<= 45` chars) and phone number normalization (strip `+91`).
5. **Structural & Editorial Polish**:
   - Rename `## Technical Plan (Architecture)` to `## Architecture`.
   - Add `## Risks & Mitigations` covering rate limits, gateway downtime, and credential security.
   - Standardize bullet markers to hyphens (`-`).
   - Remove `"Rejected by author:"` and resolve Open Question 1 to affirm Rule 5 compliance.

