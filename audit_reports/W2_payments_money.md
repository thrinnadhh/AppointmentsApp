# QA Audit Report: W2 - Payments & Money Flows

- **Workstream:** W2 - Payments & Money Flows
- **Status:** COMPLETED
- **Started:** 2026-11-17T17:06:00+05:30
- **Finished:** 2026-11-17T17:15:00+05:30
- **Target Branch:** `refactor/arch-cleanup-and-security-hardening`
- **Output File:** `audit_reports/W2_payments_money.md`
- **Files & Areas Examined:**
  - `apps/customer-mobile/src/screens/CheckoutModal.tsx`
  - `apps/customer-mobile/src/screens/BookingPassModal.tsx`
  - `apps/customer-mobile/src/services/api.ts`
  - `apps/customer-mobile/package.json`
  - `apps/merchant-web/src/app/api/payments/create-order/route.ts`
  - `apps/merchant-web/src/app/api/payments/verify/route.ts`
  - `apps/merchant-web/src/app/api/webhooks/cashfree/route.ts`
  - `apps/merchant-web/src/app/api/bookings/confirm/route.ts`
  - `apps/merchant-web/src/app/api/bookings/cancel/route.ts`
  - `apps/merchant-web/src/app/api/bookings/collect-fee/route.ts`
  - `apps/merchant-web/src/app/api/doctor/emergency-cancel/route.ts`
  - `apps/merchant-web/src/app/api/ticket/[id]/route.ts`
  - `apps/merchant-web/src/app/bookings/page.tsx`
  - `apps/merchant-web/src/app/settings/page.tsx`
  - `apps/merchant-web/src/app/page.tsx`
  - `apps/merchant-web/src/lib/payment/cashfree-adapter.ts`
  - `apps/merchant-web/src/lib/payment/index.ts`
  - `apps/merchant-web/src/lib/cashfree.ts`
  - `apps/merchant-web/src/lib/supabase.ts`
  - `packages/shared/src/constants.ts`
  - `packages/shared/src/types.ts`
  - `supabase/migrations/20261026190000_split_payment_platform_fee_and_consultation_fee.sql`
  - `supabase/migrations/20261027150000_harden_collect_consultation_fee_rpc.sql`
  - `supabase/migrations/20261107000008_zero_advisor_private_schema_architecture.sql`
  - `supabase/migrations/20261114000001_production_hardening_and_cashfree.sql`
  - `supabase/migrations/20261114000002_forensic_hardening_and_cashfree_remediation.sql`
  - `supabase/migrations/20261114000003_scale_100k_rls_and_hold_batching.sql`
  - `tests/unit/cashfree-adapter.test.mjs`
  - `tests/unit/cashfree-database-schema.test.mjs`
  - `tests/unit/cashfree-payment-verification.test.mjs`
  - `tests/unit/cashfree-webhook-idempotency.test.mjs`
  - `tests/unit/hospital-split-payment.test.mjs`
  - `tests/unit/hospital-no-show-policy.test.mjs`
  - `tests/unit/production-hardening-and-cashfree.test.mjs`

---

## Executive Summary
Audited all 14 required payment, money, refund, and webhook flows end-to-end across Customer Mobile, Merchant Web, Admin APIs, Supabase Database RPCs/triggers/RLS, and Cashfree payment adapter integrations.

### Key Strengths:
1. **Cryptographic Hardening & Anti-Replay:** Cashfree adapter enforces constant-time HMAC-SHA256 signature verification (`crypto.timingSafeEqual`), strict 300-second replay window tolerance, integer-paise amount validation against tampering, and order ID binding.
2. **Production Kill-Switch:** `canMockPayments()` unconditionally disables mock payment IDs (`mock_`, `sim_`, `cf_pay_`, `cf_mock_`) in production (`VERCEL_ENV === 'production'`, `CASHFREE_ENV === 'PRODUCTION'`, or live secret key).
3. **Concurrency & Slot Protection:** Slot holds use 5-minute atomic expirations with transactional advisory locks (`hashtext('hold_limit:' || customer_id)`), max 3 active concurrent holds per customer, and PostgreSQL GiST exclusion constraints (`no_overlapping_active_bookings`).
4. **Split Payment Architecture:** Under the hospital vertical, customers pay strictly the platform fee online (₹10 default), and doctor consultation fees (e.g. ₹500) are cleanly separated, tracked, and collected offline at hospital reception via `POST /api/bookings/collect-fee`.

### Critical Deficiencies & Vulnerabilities Found:
1. **[BLOCKER] Broken No-Show Execution Chain (Flow 12):** There is NO `/api/bookings/no-show` backend route. The Merchant Web UI calls `recordMerchantNoShow(bookingId)` which invokes `supabase.rpc('record_no_show')` directly from the browser client with `authenticated` credentials. However, migration `20261107000008` revoked execute privileges from `authenticated` and granted it strictly to `service_role`. Clicking "No Show" in the merchant portal crashes with a `42501 Permission Denied` error.
2. **[BLOCKER] Missing Courtesy Refund Dispatch on No-Show (Flow 12):** While `record_no_show` sets `payment_status = 'REFUND_PENDING'` for strikes 1–2 courtesy refunds, there is no background queue or gateway refund dispatch worker calling Cashfree to actually refund the customer's money.
3. **[HIGH] Double-Counting Refund Amount on Merchant/Doctor Cancellation (Flow 11):** In `cancel_booking` RPC (`20261107000008:455`), merchant cancellation computes `refund_amount := deposit_amount + platform_fee`. Under split payment, `deposit_amount` is already set to `platform_fee` (₹10), so it calculates ₹20. Calling Cashfree to refund ₹20 on a ₹10 order causes Cashfree API to fail with a refund rejection.
4. **[HIGH] Lack of Native Cashfree PG SDK on Customer Mobile (Flow 1, Flow 4):** `apps/customer-mobile/package.json` contains no Cashfree native SDK. On mobile devices (`Platform.OS !== 'web'`), `CheckoutModal.tsx` attempts to synthesize a `cf_pay_...` mock ID and post it to `/api/payments/verify`, which the production backend strictly rejects as an illegal mock payment.
5. **[HIGH] Complete Absence of Merchant Earnings / Payouts / Transactions (Flow 13):** The merchant portal has no earnings dashboard, transaction ledger, or automated disbursement mechanism; only a static input for `payout_upi_id` exists in Settings.
6. **[MEDIUM] Hardcoded Platform Fees & Missing Admin Pricing Controls (Flow 14):** Platform fees (₹10 standard, ₹50 turf) are hardcoded in both TypeScript (`packages/shared/src/constants.ts`) and SQL (`create_booking_hold`). No admin table, API, or UI exists to configure dynamic platform fees or commissions.

---

## Flow-by-Flow Audit Findings

### Flow 1: Deposit-to-Confirm Booking Flow
- **Actor:** Customer (Mobile App / Web)
- **Status:** PASS (API / DB / State Machine logic verified); UNVERIFIED on physical mobile device due to missing native Cashfree SDK.
- **Severity:** N/A (Core flow operational)
- **Chain Traced:**
  - *UI Action:* Customer selects doctor and slot in `apps/customer-mobile/src/screens/CheckoutModal.tsx`.
  - *Client Validation:* Validates authentication, 7-day account block (`isBlocked`), 2-strike warning acknowledgment, and family patient inputs (name, age 0–120, note <= 200 chars).
  - *API / RPC:* Invokes `create_booking_hold` RPC (`supabase/migrations/20261114000002_forensic_hardening_and_cashfree_remediation.sql:16`).
  - *DB Security & Constraints:*
    - Caller identity check (`auth.uid() = p_customer_id` or admin/venue owner).
    - Checks `profiles.blocked_until > NOW()` -> returns 7-day block error if active.
    - Validates slot start is not in the past (`NOW() - INTERVAL '5 minutes'`) and `slot_end > slot_start`.
    - 1-hour time gap enforcement: strictly checks for overlapping bookings for the same patient within ±60 minutes (lifted for `booked_for = 'family'`).
    - Task 1 Anti-Hoarding: Acquires transactional advisory lock `hashtext('hold_limit:' || customer_id)`, counts active holds (`status = 'HELD' AND hold_expires_at > NOW()`). Rejects 4th concurrent hold with `P0001` error.
    - Concurrency row lock: `SELECT id FROM bookings WHERE ... FOR UPDATE;` and GiST exclusion constraint `no_overlapping_active_bookings`.
    - Hold duration: `NOW() + INTERVAL '5 minutes'`.
    - Amount computation: `v_platform_fee` (₹10 default, ₹50 gaming/turf), `v_deposit_amount` (₹10), `v_consultation_fee` (₹500 default from resource).
    - Status set to `status = 'HELD', payment_status = 'PENDING', platform_payment_status = 'PENDING', consultation_payment_status = 'PENDING_OFFLINE'`.
- **Evidence:** `supabase/migrations/20261114000002_forensic_hardening_and_cashfree_remediation.sql:16-405`; unit test `tests/unit/production-hardening-and-cashfree.test.mjs` (Task 1 passes).

---

### Flow 2: Hospital Option: "Pay Platform Fee Online, Consultation Fee at Hospital"
- **Actor:** Customer & Hospital Front Desk / Reception
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - *UI Action (Booking):* `CheckoutModal.tsx` shows online payable amount as platform fee (₹10) and notes consultation fee (₹500) payable at hospital.
  - *Client Validation:* Customer charged strictly ₹10.
  - *API (Order Creation):* `POST /api/payments/create-order` creates Cashfree order for ₹10 (1000 paise).
  - *DB Write (Hold & Confirmation):* `bookings.platform_fee_amount = 10.00`, `bookings.consultation_fee_amount = 500.00`, `bookings.platform_payment_status = 'CAPTURED'`, `bookings.consultation_payment_status = 'PENDING_OFFLINE'`.
  - *Customer Pass UI:* `apps/customer-mobile/src/screens/BookingPassModal.tsx:640-654` and `apps/merchant-web/src/app/api/ticket/[id]/route.ts:142-147` display "Platform Fee (Paid Online) ₹10" and "Doctor Consultation (Pay at Desk) ₹500 (Pending)" or "✓ Paid".
  - *Reception Collection UI:* `apps/merchant-web/src/components/frontdesk/FrontDeskQueueTabs.tsx:335-338` displays balance due and a "Collect Consultation Fee" action.
  - *API (Collection):* `POST /api/bookings/collect-fee` validates caller is Front Desk or Hospital Admin for this hospital (`apps/merchant-web/src/app/api/bookings/collect-fee/route.ts:42-60`).
  - *DB RPC:* Calls `public.collect_consultation_fee` (`supabase/migrations/20261027150000_harden_collect_consultation_fee_rpc.sql:7-59`), setting `consultation_payment_status = 'COLLECTED_AT_DESK'`, `consultation_collected_at = NOW()`, `consultation_collected_by = caller.id`.
  - *Non-Staff Guard:* Tested and verified: customer/unauthorized users calling `collect-fee` receive `403 Forbidden`.
- **Evidence:** `tests/unit/hospital-split-payment.test.mjs:1-170` (all 6 split payment test cases pass).

---

### Flow 3: Cashfree Order Creation
- **Actor:** Customer
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - *UI Action:* `CheckoutModal.tsx` calls `createRazorpayOrder(bookingId, customerId)`.
  - *Client Validation:* Ensures booking ID and customer ID are present.
  - *API Route:* `apps/merchant-web/src/app/api/payments/create-order/route.ts`.
  - *Rate Limiting:* 30 req/min by client IP, 10 req/min per booking ID.
  - *Authentication & Authorization:* `verifyAuthenticatedUser` + `isCallerAuthorizedForBooking` checks caller identity.
  - *State Guard:* Booking must exist, must NOT be `CONFIRMED` or `COMPLETED`, and hold must NOT be expired (`hold_expires_at < Date.now()` returns 410).
  - *Amount Calculation:* Extracts `platform_fee_amount` (₹10), converts to integer paise (1000 paise). Writes `expected_payment_amount_paise = 1000` to `bookings` table.
  - *Adapter:* `CashfreeAdapter.createOrder` (`apps/merchant-web/src/lib/payment/cashfree-adapter.ts:35-79`).
  - *Formatting:* Formats order ID to `cf_${cleanId}` (<= 45 chars). Normalizes phone number to 10 digits (`normalizePhoneNumber`).
  - *Cashfree Expiry Boundary:* Safely omits `order_expiry_time` when < 15 minutes to satisfy Cashfree API validation while allowing application-level 5-minute hold.
  - *DB Write:* Updates `bookings.gateway_order_id`, `gateway_provider = 'cashfree'`, and `payment_session_id`.
  - *Response:* Returns `{ success: true, order_id, payment_session_id, gateway_provider: 'cashfree', amount: 1000 }`.
- **Evidence:** `apps/merchant-web/src/app/api/payments/create-order/route.ts:1-286`; `tests/unit/cashfree-adapter.test.mjs`.

---

### Flow 4: Cashfree Payment Success & Verification
- **Actor:** Customer / Cashfree SDK Client
- **Status:** PASS (API / RPC verification logic); UNVERIFIED (native mobile payment flow; mobile uses webview on web or mock in dev).
- **Severity:** N/A
- **Chain Traced:**
  - *UI Action:* Cashfree Drop SDK triggers `onSuccess` callback -> calls `verifyRazorpayPayment(...)` (`CheckoutModal.tsx:394`).
  - *API Route:* `apps/merchant-web/src/app/api/payments/verify/route.ts`.
  - *Rate Limiting:* 30 req/min IP, 15 req/min user account.
  - *Authorization Guard:* Caller must be authenticated and must match `booking.customer_id` (`caller.id !== booking.customer_id` returns 403).
  - *Mock Payment Kill-Switch:* Checks `canMockPayments()`. Rejects synthetic payment IDs (`cf_pay_`, `mock_`, etc.) with 400 when in production.
  - *Order Binding Assertion:* Asserts `booking.gateway_order_id === incomingOrderId` (returns 400 if mismatched).
  - *Gateway Polling:* `cfAdapter.fetchOrder(orderId)` retrieves live order status from Cashfree API. Enforces `status === 'PAID'`.
  - *Tamper Protection:* Compares `orderDetails.amountInPaise` strictly to `expectedAmountPaise`. Returns 400 "Tampered payment amount" if mismatched.
  - *Anti-Replay Guard:* Checks `payments` table for existing `effectivePaymentId`. Returns 409 if used for a different booking.
  - *Expired Hold Auto-Refund:* If hold expired before payment verification, records payment, sets booking `CANCELLED` and `REFUND_PENDING`, triggers `cfAdapter.refundOrder(...)`, and returns 410 with auto-refund notice.
  - *DB RPC:* Calls `confirm_booking_payment` service-role RPC (`supabase/migrations/20261026190000_split_payment_platform_fee_and_consultation_fee.sql:344`). Sets `status = 'CONFIRMED', payment_status = 'CAPTURED', platform_payment_status = 'CAPTURED'`. Inserts into `payments` table. Releases Redis slot lock.
- **Evidence:** `apps/merchant-web/src/app/api/payments/verify/route.ts:148-434`; `tests/unit/cashfree-payment-verification.test.mjs` (all 6 verification security tests pass).

---

### Flow 5: Cashfree Payment Failure & Abandoned Payment Handling
- **Actor:** Customer / System Background Worker
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - *Background Cron Job:* `public.release_expired_holds()` scheduled via `pg_cron` every 1 minute (`supabase/migrations/20261114000003_scale_100k_rls_and_hold_batching.sql:157`).
  - *DB Execution:* Bounded batching with `LIMIT 1000 FOR UPDATE SKIP LOCKED` finds holds where `status = 'HELD' AND hold_expires_at <= NOW()`. Atomically sets `status = 'CANCELLED', payment_status = 'FORFEITED'`.
  - *Inline Sweep:* `create_booking_hold` automatically sweeps and cancels expired holds on the requested resource & slot synchronously before checking availability.
  - *Webhook Failure Events:* `apps/merchant-web/src/app/api/webhooks/cashfree/route.ts:250-280` handles `PAYMENT_FAILED_WEBHOOK` and `PAYMENT_USER_DROPPED_WEBHOOK`, cancels the hold, and releases the Redis slot lock.
  - *Late Payment Race Resolution:* If a payment arrives after the hold expired, `reclaim_expired_hold_or_refund` RPC (`20261114000002:462`) takes an advisory transaction lock on the slot:
    - *Case A (Slot is Free):* Atomically reclaims the slot and promotes booking to `CONFIRMED` / `CAPTURED`.
    - *Case B (Slot is Occupied by Competitor):* Atomically marks booking `CANCELLED` / `REFUND_PENDING`, inserts a CRITICAL audit log `LATE_PAYMENT_REFUND_SLOT_COLLISION`, and executes automated Cashfree refund via `cfAdapter.refundOrder`.
- **Evidence:** `supabase/migrations/20261114000003_scale_100k_rls_and_hold_batching.sql:157-190`; `tests/unit/production-hardening-and-cashfree.test.mjs` (Task 4 passes).

---

### Flow 6: Webhook Handling
- **Actor:** Cashfree Payment Gateway Engine
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - *HTTP Route:* `POST /api/webhooks/cashfree` (`apps/merchant-web/src/app/api/webhooks/cashfree/route.ts`).
  - *Public Bypass:* Whitelisted in `PUBLIC_API_ROUTES` in `middleware.ts`.
  - *Header Validation:* Validates presence of `x-webhook-signature` and `x-webhook-timestamp` (returns 400 if missing).
  - *Cryptographic Signature Check:* `CashfreeAdapter.verifyWebhook` calculates HMAC-SHA256 of `${timestamp}${rawBody}` using `CASHFREE_SECRET_KEY` and compares in constant time using `crypto.timingSafeEqual` (`apps/merchant-web/src/lib/cashfree.ts:233-275`).
  - *Replay Protection:* Rejects any payload where `Math.abs(nowMs - timestampMs) > 300,000` (5-minute tolerance window).
  - *Payload Safety:* Uses `assertSafePayloadStructure` to reject malicious deep object graphs or prototype poisoning.
  - *Payload Parsing:* Extracts `eventType`, `order_id`, `cf_payment_id`, `payment_amount`, `payment_currency`.
  - *Amount Verification:* Verifies integer paise (`Math.round(amount * 100) === expected_payment_amount_paise`). Rejects tampered amounts with 400.
  - *Currency Verification:* Enforces `payment_currency === 'INR'`.
  - *Settlement Dispatch:* Calls `confirm_booking_payment` service-role RPC.
- **Evidence:** `apps/merchant-web/src/app/api/webhooks/cashfree/route.ts:1-289`; `tests/unit/cashfree-webhook-idempotency.test.mjs` (all tests pass).

---

### Flow 7: Duplicate-Webhook Idempotency
- **Actor:** Cashfree Webhook Dispatcher
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - *Ledger Check Link:* `webhooks/cashfree/route.ts:63-75` queries `public.payments` by `gateway_payment_id`. If `status === 'CAPTURED'`, returns immediate `200 OK` with `{ status: 'OK', idempotent: true }`.
  - *Booking Status Check Link:* `webhooks/cashfree/route.ts:113-118` checks `booking.status === 'CONFIRMED' || booking.payment_status === 'CAPTURED'`. Returns immediate `200 OK` with `{ status: 'OK', idempotent: true }`.
  - *Database RPC Idempotency Link:* `public.confirm_booking_payment` (`20261026190000:391-402`) locks booking row with `FOR UPDATE`. If `status = 'CONFIRMED' AND gateway_payment_id = p_gateway_payment_id`, returns `{ success: true, idempotent: true }`.
  - *Unique Constraint Link:* `payments.gateway_payment_id` has a unique constraint. Duplicate concurrent inserts catch `unique_violation` and return clean success.
- **Evidence:** `apps/merchant-web/src/app/api/webhooks/cashfree/route.ts:61-75`; `tests/unit/cashfree-webhook-idempotency.test.mjs`.

---

### Flow 8: Payment Split Between Merchant and Platform
- **Actor:** System / Accounting Ledger
- **Status:** PASS (Split fee tracking); FAIL (No merchant payout or disbursement engine)
- **Severity:** Medium
- **Chain Traced:**
  - *Booking Data Model:* `platform_fee_amount` (₹10, platform revenue captured online via Cashfree) and `consultation_fee_amount` (₹500, merchant revenue collected offline at reception desk).
  - *Payment Status Model:* `platform_payment_status` ('PENDING' -> 'CAPTURED') and `consultation_payment_status` ('PENDING_OFFLINE' -> 'COLLECTED_AT_DESK').
  - *Payments Table:* Records only the online platform fee transaction (`amount = 10.00, currency = 'INR', status = 'CAPTURED'`).
  - *Gaps / Defect:* No accounting ledger table exists (`merchant_balances`, `platform_ledger`, or automated payout transfers via Cashfree Easy Split vendor API). The platform retains 100% of the online payment (₹10), and the merchant collects 100% of their consultation fee offline at desk. There is no automated revenue-sharing or commission disbursement mechanism.
- **Evidence:** `supabase/migrations/20261026190000_split_payment_platform_fee_and_consultation_fee.sql:8-33`; `tests/unit/hospital-split-payment.test.mjs`.

---

### Flow 9: Booking Confirmation State Machine
- **Actor:** Customer / Payment Gateway
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - *State Invariant:* Booking MUST remain in `HELD` state until payment succeeds.
  - *Client Creation:* `create_booking_hold` creates booking in `HELD` with `hold_expires_at = NOW() + 5m`.
  - *Order Creation:* `create-order` creates gateway order without changing booking status.
  - *RPC Permission Lockdown:* `confirm_booking_payment` is revoked from `PUBLIC, anon, authenticated` (`20261026190000:452`). PostgREST clients cannot call this RPC directly.
  - *Gateway Verification Barrier:* Gateway confirmation occurs ONLY after `/api/payments/verify` or `/api/webhooks/cashfree` verifies that Cashfree order status is `PAID` and amount matches expected paise.
  - *Atomic State Transition:* `confirm_booking_payment` executes under a row-level lock (`FOR UPDATE`), transitions `status` from `HELD` to `CONFIRMED`, and records the payment in `payments` table atomically.
  - *Exclusion Guard:* `no_overlapping_active_bookings` GiST constraint on `(resource_id WITH =, tstzrange(slot_start, slot_end) WITH &&)` guarantees that no two bookings can be confirmed for the same slot.
- **Evidence:** `supabase/migrations/20261026190000_split_payment_platform_fee_and_consultation_fee.sql:344-454`; `tests/unit/cashfree-payment-verification.test.mjs`.

---

### Flow 10: Customer Cancel/Reschedule Refund Math
- **Actor:** Customer
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - *UI Action:* Customer initiates cancellation or reschedule in `MyBookingsScreen.tsx`.
  - *API Route:* `POST /api/bookings/cancel` (`apps/merchant-web/src/app/api/bookings/cancel/route.ts`).
  - *Authorization & Role Guard:* Caller must be authenticated; `effectiveInitiatedBy` strictly enforced based on caller identity (vuln-0009 remediation).
  - *DB RPC:* `cancel_booking` (`supabase/migrations/20261107000008_zero_advisor_private_schema_architecture.sql:370-585`).
  - *60-Minute Cutoff Policy:* Calculates `v_minutes_to_slot := EXTRACT(EPOCH FROM (slot_start - now)) / 60`.
    - *>= 60 minutes:* `v_eligible := true`, `payment_status = 'REFUND_PENDING'`, `refund_amount = deposit_amount` (₹10).
    - *< 60 minutes:* `v_eligible := false`, `payment_status = 'FORFEITED'`, `refund_amount = 0.00`.
  - *Gateway Refund Dispatch:* If `result.refund_eligible && refund_amount > 0`:
    - Atomically updates `payments` table `status = 'REFUND_PENDING'` where `status = 'CAPTURED'` (single-winner atomic claim to eliminate TOCTOU duplicate refunds).
    - Calls `cfAdapter.refundOrder(...)`. Promotes booking and payment to `REFUNDED` on success; marks `REFUND_FAILED` + logs critical alert + inserts into `admin_audit_logs` and `notification_logs` on failure.
  - *Customer Reschedule:* `reschedule_booking_slot` RPC (`20261107000008:2385`) rejects customer reschedules within 60 minutes (`slot_start < now + 60m`). Beyond 60 minutes, shifts slot time; preserves existing `CONFIRMED` status, payment records, and 4-digit check-in PIN without charging a new fee.
- **Evidence:** `apps/merchant-web/src/app/api/bookings/cancel/route.ts:121-264`; `tests/e2e/workstreams/sa3-cancellations-money.test.mjs:C1` (60m boundary verified).

---

### Flow 11: Merchant-Side Cancel & Doctor Emergency Cancellation Refund Math
- **Actor:** Merchant Admin / Hospital Admin / Consultant
- **Status:** FAIL
- **Severity:** High
- **Chain Traced:**
  - *Merchant Cancel UI & API:* `POST /api/bookings/cancel` with `p_initiated_by: 'MERCHANT'`.
  - *Doctor Emergency Cancel UI & API:* `POST /api/doctor/emergency-cancel` with `doctor_resource_id`. Authorizes caller as Hospital Admin or target Consultant.
  - *DB RPCs:* `cancel_booking` (`20261107000008:452`) and `cancel_doctor_emergency` (`20261107000008:609`).
  - *Defect 1 (Over-calculation of Refund Amount):*
    In both RPCs:
    ```sql
    v_refund_amount := COALESCE(v_booking.deposit_amount, 0.00) +
                       COALESCE(v_booking.platform_fee, 0.00) +
                       COALESCE(v_booking.platform_fee_gst, 0.00);
    ```
    In the split-payment hospital vertical, `deposit_amount` is ₹10 (the platform fee paid online) AND `platform_fee` is ₹10.
    The RPC calculates `v_refund_amount = 20.00`.
    When `/api/bookings/cancel` or `/api/doctor/emergency-cancel` calls Cashfree (`cfAdapter.refundOrder`) with 2000 paise (₹20) on a ₹10 order, Cashfree rejects the refund because the requested refund amount exceeds the captured transaction amount.
  - *Defect 2 (Missing DB Column Assignment in `cancel_doctor_emergency`):*
    `cancel_doctor_emergency` updates `status = 'CANCELLED', payment_status = 'REFUND_PENDING'` but DOES NOT update `refund_amount = v_refund_amt` on `bookings`.
    `/api/doctor/emergency-cancel/route.ts:109` falls back to `b.refund_amount ?? b.deposit_amount` (₹10), which refunds ₹10 on Cashfree, but the customer SMS notification states: *"Your appointment has been cancelled and a 100% full refund of ₹20 (including deposit and platform fee) has been initiated"*, causing audit discrepancy and customer confusion.
  - *Likely Fix:* In `cancel_booking` and `cancel_doctor_emergency`, calculate `v_refund_amount := LEAST(COALESCE(v_booking.deposit_amount, 0.00), COALESCE(v_booking.total_amount, 0.00))` (or use the captured payment amount from `payments` table). Set `bookings.refund_amount = v_refund_amount`.
- **Evidence:** `supabase/migrations/20261107000008_zero_advisor_private_schema_architecture.sql:455-462, 687-735`; `apps/merchant-web/src/app/api/doctor/emergency-cancel/route.ts:100-135`.

---

### Flow 12: No-Show Money Split (₹50 Doctor/Hospital, ₹10 Platform, Remainder Refunded)
- **Actor:** Hospital Front Desk / Consultant
- **Status:** FAIL
- **Severity:** Blocker
- **Chain Traced:**
  - *UI Action:* Front Desk clicks "No Show" in `apps/merchant-web/src/app/bookings/page.tsx:989` or `apps/merchant-web/src/app/page.tsx:2935`.
  - *Client Function:* Calls `recordMerchantNoShow(bookingId)` from `apps/merchant-web/src/lib/supabase.ts:533`.
  - *Defect 1 (Broken Link & Missing API Route):*
    There is NO `/api/bookings/no-show` API endpoint. `recordMerchantNoShow` executes:
    `supabase.rpc('record_no_show', { p_booking_id: bookingId })` using the browser client (`authenticated` role).
    However, migration `20261107000008:3822`:
    `REVOKE ALL ON FUNCTION public.record_no_show FROM PUBLIC, anon, authenticated;`
    `GRANT EXECUTE ON FUNCTION public.record_no_show TO service_role;`
    Executing this from the browser fails immediately with a `42501 Permission Denied` error. Front desk staff cannot record no-shows.
  - *Defect 2 (No Gateway Refund Dispatch):*
    For strikes 1–2 (courtesy 100% refund), `record_no_show` sets `payment_status = 'REFUND_PENDING'` and `refund_amount = deposit_amount`. However, no gateway refund API call (`cfAdapter.refundOrder`) is ever dispatched. The booking remains in `REFUND_PENDING` indefinitely.
  - *Split Math:*
    - Strikes 1–2: 100% courtesy refund, no monetary penalty.
    - Strikes 3–5: ₹50 credited to `providers.penalty_balance` (merchant credit), ₹10 platform fee. Under split payment where deposit = ₹10 (<= 60), full deposit is forfeited (`payment_status = 'FORFEITED'`, ₹0 refunded). However, `providers.penalty_balance` is credited ₹50 even though platform only collected ₹10 online.
    - Strike 6+: Account blocked for 7 days (`profiles.blocked_until = NOW() + 7 days`), strike counter reset to 0.
  - *Likely Fix:* Create a server API route `POST /api/bookings/no-show`, verify front desk / hospital admin authorization, invoke `record_no_show` via `getSupabaseAdmin()`, and trigger `cfAdapter.refundOrder` if `refund_amount > 0`.
- **Evidence:** `apps/merchant-web/src/app/bookings/page.tsx:295`; `apps/merchant-web/src/lib/supabase.ts:464, 534`; `supabase/migrations/20261107000008_zero_advisor_private_schema_architecture.sql:3654-3823`; `tests/unit/hospital-no-show-policy.test.mjs`.

---

### Flow 13: Merchant Earnings / Payouts / Transaction List in Merchant Portal
- **Actor:** Merchant / Hospital Owner
- **Status:** FAIL (Not implemented)
- **Severity:** High
- **Chain Traced:**
  - *UI Action:* Merchant seeks earnings report or payout history.
  - *Codebase Search:* Searching `apps/merchant-web/src/app/` for "earnings", "payouts", or "transactions" yields zero pages, components, or API endpoints.
  - *Current State:* The only payout element in the entire merchant web app is a single text input in `apps/merchant-web/src/app/settings/page.tsx:430` that stores `payout_upi_id` to `providers.payout_upi_id`.
  - *Missing Capabilities:*
    - No earnings summary dashboard (total consultation fees collected offline vs penalties vs platform fees).
    - No transaction ledger or payout history table.
    - No Cashfree vendor split or automated payout disbursement mechanism.
  - *Likely Fix:* Build a dedicated merchant earnings/payouts page in `apps/merchant-web/src/app/earnings/page.tsx` with API route `/api/merchant/payouts` querying completed bookings and penalty adjustments.
- **Evidence:** `apps/merchant-web/src/app/settings/page.tsx:430-440`; `apps/merchant-web/src/lib/supabase.ts:214`.

---

### Flow 14: Admin Pricing Controls (Platform Fee Adjustments, Commission Rates)
- **Actor:** Platform Super Admin
- **Status:** FAIL (Not implemented)
- **Severity:** Medium
- **Chain Traced:**
  - *Admin UI & API:* Searching `apps/merchant-web/src/app/admin/` and `apps/merchant-web/src/app/api/admin/` confirms no pricing or platform fee endpoints exist (only `doctor-assignments` and `refunds` exist).
  - *Hardcoded Architecture:* Platform fees are hardcoded in two separate code locations:
    1. TypeScript: `packages/shared/src/constants.ts:112` (`PLATFORM_FEES = { clinics: 10, salons: 10, pets: 10, restaurants: 10, gaming: 50, default: 10 }`).
    2. SQL Database: `supabase/migrations/20261114000002_forensic_hardening_and_cashfree_remediation.sql:305` (`v_platform_fee := CASE WHEN v_category_id IN ('gaming', 'turf') THEN 50.00 ELSE 10.00 END;`).
  - *Missing Capabilities:* No database configuration table (`platform_pricing_rules`), no admin API route (`/api/admin/pricing`), and no admin UI exists to adjust platform fees, surge pricing, or commission rates.
  - *Likely Fix:* Create a `platform_settings` table in Supabase, replace hardcoded fee values in `create_booking_hold` with a dynamic query from `platform_settings`, and add a pricing management interface in `apps/merchant-web/src/app/admin/`.
- **Evidence:** `packages/shared/src/constants.ts:106-128`; `supabase/migrations/20261114000002_forensic_hardening_and_cashfree_remediation.sql:305`.

---

## HANDOFF
- **HANDOFF to W1 (Mobile App):** `apps/customer-mobile/package.json` contains no Cashfree native SDK or WebView checkout; on native Android/iOS, checkout fabricates `cf_pay_` mock payment IDs, causing payment failures in production.
- **HANDOFF to W4 (Hospital Operations / Front Desk):** `apps/merchant-web/src/app/bookings/page.tsx` and `apps/merchant-web/src/app/page.tsx` invoke `record_no_show` directly via the browser client without an API route, resulting in `42501 Permission Denied` when marking no-shows.
- **HANDOFF to W7 (Admin Portal):** `apps/merchant-web/src/app/admin/` contains no UI or API routes for platform fee configuration, commission rates, or financial reconciliation.
