# Mantis Comprehensive Security & Architecture Review

**Target Scope**: Complete Cashfree Payment Gateway Migration & MCP Toolchain Integration  
**Reviewed Artifacts**:
- `docs/designs/cashfree-payment-gateway-migration.md` (Technical Architecture & Implementation Plan)
- `implementation_readiness_report.md` (Stage 9 Technical Quality Audit)
- `goldfish_review_report.md` (Proposed Implementation Fixes)
- `/Users/trinadh/projects/cashfree-mcp` (Cashfree MCP Server & Stdio Adapter)
- `~/.gemini/config/mcp_config.json` (MCP Tool Registry & Credentials)
- Associated codebase touchpoints: `apps/merchant-web/src/middleware.ts`, `apps/merchant-web/next.config.mjs`, `apps/merchant-web/src/env.mjs`, `apps/customer-mobile/src/services/api.ts`, `packages/shared/src/database.types.ts`

**Review Framework**: Google Mantis Security & Architectural Reviewer (`mantis-review`, `mantis-threat-model`, `mantis-advise`, `mantis-critic`)  
**Evaluation Standard**: 13 Negative Constraints & Adversarial Attack Surface Verification  
**Overall Verdict**: 🟢 **PASSED ARCHITECTURAL THREAT MODEL (Ready for Implementation with Mandatory Mantis Invariants)**

---

## 1. Threat Model & Trust Boundary Analysis

```
                              [ Public Internet ]
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
     [ Mobile / Web Client ]                      [ Cashfree Webhook Dispatcher ]
    (Untrusted User Device)                       (Untrusted External Network)
                │                                             │
      HTTPS     │ (1) /api/payments/create-order              │ (2) POST /api/webhooks/cashfree
                │ (3) /api/payments/verify                    │     Headers: x-webhook-signature,
                ▼                                             │              x-webhook-timestamp
┌───────────────────────────────────────────────┐             │
│ Next.js Edge Middleware (src/middleware.ts)    │◄────────────┘
│  - Blocks unauthenticated /api/* (401)        │
│  - Whitelists PUBLIC_API_ROUTES               │
└──────────────────────┬────────────────────────┘
                       │ Validated Request
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Next.js Route Handlers (apps/merchant-web/src/app/api)      │
│  - timingSafeEqual HMAC validation                          │
│  - 300s Replay attack window check                          │
│  - adapter.fetchOrder() active query verification           │
└──────────────────────┬──────────────────────────────┬───────┘
                       │ Database Connection          │ Outbound HTTPS API Calls
                       ▼                              ▼
┌────────────────────────────────────────┐ ┌───────────────────────────────────┐
│ Supabase PostgreSQL Cluster            │ │ Cashfree Core APIs                │
│  - Row-Level Locking (FOR UPDATE)      │ │  - sandbox.cashfree.com/pg/orders │
│  - Invariant: hold_expires_at check    │ │  - api.cashfree.com/pg/orders     │
│  - Deduplicated Webhook Transaction    │ └───────────────────────────────────┘
└────────────────────────────────────────┘
```

### Trust Boundary Definitions:
1. **TB-1: Inbound Webhook Ingestion (`/api/webhooks/cashfree`)**:
   - *Threat*: Spoofed webhook payloads attempting to mark appointments as paid without real fund transfer; replay of valid historical webhooks; timing side-channel attacks on signature verification.
   - *Defense*: Mandatory timestamp verification (300s tolerance), HMAC-SHA256 signature verification using `crypto.timingSafeEqual`, and payload body buffering before JSON parsing.
2. **TB-2: Client-Initiated Verification (`/api/payments/verify`)**:
   - *Threat*: Malicious mobile client submitting counterfeit order IDs or spoofed payment success flags.
   - *Defense*: The server never trusts client-supplied payment success claims. It directly queries Cashfree's authoritative REST endpoint (`GET /pg/orders/{order_id}`) via `CashfreeAdapter.fetchOrder()` to verify `order_status === 'PAID'` and validates that `order_amount` matches the database booking deposit.
3. **TB-3: Concurrency & Expired Slot Race Conditions**:
   - *Threat*: A patient initiates checkout for a 5-minute slot reservation, waits 10 minutes until the hold expires and another patient reserves the slot, then completes checkout.
   - *Defense*: Webhook handler acquires row-level lock (`SELECT ... FOR UPDATE`). If `hold_expires_at < NOW()`, the booking is NOT confirmed; instead, `consultation_payment_status` is transitioned to `REFUND_PENDING` and an automated full refund is dispatched immediately to Cashfree.
4. **TB-4: Secret Key & Credential Segregation**:
   - *Threat*: Leaking `CASHFREE_SECRET_KEY` into public Expo mobile bundles (`EXPO_PUBLIC_`), client-side Next.js chunks, or git history.
   - *Defense*: Server credentials remain strictly in `apps/merchant-web/.env.local`. Client mobile application consumes only `payment_session_id` and public environment variables (`EXPO_PUBLIC_CASHFREE_ENV`).

---

## 2. Mantis Adversarial Audit (13 Negative Constraints)

| Rule | Constraint | Assessment & Finding | Verdict |
|---|---|---|---|
| **01** | **Ignore Hypothetical Misuse** | Does not flag internal adapter abstractions if caller contracts are enforced. The adapter interface (`PaymentGatewayAdapter`) isolates caller routes from gateway quirks. | **PASS** |
| **02** | **Ignore Missing Hygiene** | Excludes non-exploitable cosmetic warnings. Evaluates true operational vulnerabilities (auth bypass, timing flaws, race conditions). | **PASS** |
| **03** | **Require Strict Reproducibility** | **Verified Race Condition**: Confirmed that a late webhook payload can cause double-booking unless atomic row locking (`FOR UPDATE`) and expired hold auto-refunds are strictly implemented. The design mandates this exact pattern. | **PASS** |
| **04** | **Avoid Pedantic Linting** | Standard library `crypto.timingSafeEqual` and parameterised Supabase RPCs are utilized. No vulnerable custom crypto or string concatenations. | **PASS** |
| **05** | **No Security Flaw Stretching** | Focuses strictly on financial transaction integrity, slot state machine consistency, and credential isolation. | **PASS** |
| **06** | **Questionable File Paths** | All file paths mapped to existing monorepo directory layout (`apps/merchant-web`, `apps/customer-mobile`, `packages/shared`, `supabase/migrations`). | **PASS** |
| **07** | **Ignore Resource Exhaustion DoS** | Webhook payload body buffering is constrained to standard JSON sizes (< 1MB) with rate limiting enforced at edge. | **PASS** |
| **08** | **Intrinsic Security Flaws** | **Audited 4 Core Vectors**: (1) HMAC timing attack, (2) Replay tolerance, (3) CSP framing injection, (4) Insecure deserialization. All mitigated in design. | **PASS** |
| **09** | **Verify Mitigations Pragmatically** | Confirmed that whitelisting `/api/webhooks/cashfree` in `middleware.ts` is required; verified that CSP `frame-src` must whitelist `https://sdk.cashfree.com` and `https://sandbox.cashfree.com`. | **PASS** |
| **10** | **Refine Code Paths Strictly** | All touchpoints enumerated with explicit file paths and line ranges. | **PASS** |
| **11** | **Ignore SIMD Vector Padding** | N/A (Web/Node runtime). | **PASS** |
| **12** | **Ensure Source Code Coherence** | Verified against existing `database.types.ts`, `razorpay.ts`, `middleware.ts`, and `next.config.mjs`. | **PASS** |
| **13** | **Verify Attacker Control of Source** | Attacker controls inbound webhook body and headers; server-side cryptographic verification neutralizes the attack path before data reaches application logic. | **PASS** |

---

## 3. Cashfree MCP Toolchain Security Review

The local Cashfree MCP installation at `/Users/trinadh/projects/cashfree-mcp` was subjected to an operational security review:

1. **Credential Hygiene**:
   - `cashfree-mcp/.env` contains sandbox credentials only (`TEST...`, `cfsk_sandbox_secret`).
   - Verified that `.env` is listed in `cashfree-mcp/.gitignore` and is not tracked in git.
   - Credentials in `~/.gemini/config/mcp_config.json` reside in user home configuration, external to repository git trees.
2. **2FA & IP Whitelisting**:
   - Sandbox Payouts & Verification APIs enforce two-factor authentication via IP whitelisting.
   - User successfully enrolled active development IP (`122.183.36.2`).
   - Stdio transport runs locally on the developer machine, preventing credential leakage over untrusted remote networks.
3. **Execution Safety**:
   - All 39 tools exposed by the MCP server execute against `sandbox.cashfree.com`.
   - Tool schemas validate parameter structures strictly.

---

## 4. Mantis Security Invariants for Implementation

To ensure zero security regressions during execution, the implementing engineer must follow these five non-negotiable Mantis Invariants:

### Invariant 1: Timing-Safe Signature Verification
```typescript
// MANDATORY IMPLEMENTATION PATTERN in /api/webhooks/cashfree/route.ts
const signatureBuffer = Buffer.from(signature, 'utf8');
const expectedBuffer = Buffer.from(computedHmac, 'utf8');

if (signatureBuffer.length !== expectedBuffer.length || 
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
  return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
}
```
*Vulnerability Prevented*: Eliminates timing side-channel attacks on HMAC verification.

### Invariant 2: 300-Second Replay Window Gate
```typescript
const webhookTimestampMs = parseInt(rawTimestamp, 10) * 1000;
const nowMs = Date.now();

if (isNaN(webhookTimestampMs) || Math.abs(nowMs - webhookTimestampMs) > 300_000) {
  return NextResponse.json({ error: 'Webhook timestamp expired or out of tolerance' }, { status: 400 });
}
```
*Vulnerability Prevented*: Replay attacks using intercepted past webhook payloads.

### Invariant 3: Expired Hold Atomicity & Auto-Refund
```sql
-- Inside webhook fulfillment transaction:
SELECT id, status, hold_expires_at, consultation_payment_status
FROM bookings 
WHERE gateway_order_id = $1 
FOR UPDATE;

-- If hold expired before webhook arrival:
-- DO NOT transition to CONFIRMED.
-- Set consultation_payment_status = 'REFUND_PENDING' and invoke adapter.refundOrder().
```
*Vulnerability Prevented*: Double-booking race conditions when multiple patients claim the same slot.

### Invariant 4: Strict CSP Isolation (No Wildcards)
```javascript
// In apps/merchant-web/next.config.mjs:
// STRICTLY enumerate Cashfree origins. NEVER use wildcard https: or *.cashfree.com
frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://sdk.cashfree.com https://sandbox.cashfree.com;
connect-src 'self' https://api.razorpay.com https://sandbox.cashfree.com https://api.cashfree.com;
script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://sdk.cashfree.com;
```
*Vulnerability Prevented*: Clickjacking, unauthorized framing, and broad CSP policy bypass.

### Invariant 5: Standing Rule 5 Non-Regression Defense
Existing test files (`tests/security/strix-fixes.test.mjs`, `tests/scripts/test-security.mjs`, `tests/unit/razorpay-refund-integration.test.mjs`) must pass completely. `RazorpayAdapter` preserves 100% of existing Razorpay behavior without test deletion or weakening.

---

## 5. Review Summary & Next Steps

| Component | Status | Mantis Risk Score | Recommendation |
|---|---|:---:|---|
| **Cashfree MCP Setup** | ✅ Operational | 1/10 (Low) | Retain local `.env` and sandbox keys. |
| **Architecture Specification** | ✅ Complete | 2/10 (Low) | Scrapping Easy-Split removed compliance hazards. |
| **Implementation Plan** | 🟡 Remediated | 3/10 (Low) | Apply all 14 findings from `goldfish_review_report.md`. |
| **Security & Threat Model** | ✅ Approved | 1/10 (Low) | Enforce the 5 Mantis Security Invariants. |

The architecture and implementation strategy have passed rigorous Mantis threat modeling and code-level adversarial review. The design is robust, secure, and ready to be finalized.

