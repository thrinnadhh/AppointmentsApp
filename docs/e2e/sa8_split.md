# Workstream SA8_SPLIT Test Report: Split-Payment Workflow Verification

**Sub-Agent Workstream:** SA8_SPLIT
**Status:** ALL PASS
**Summary:** 4/4 passed (100.0%), 0 failed, 0 blocked, 0 not run
**Execution Time:** 2026-10-27T11:26:14.529Z

## 1. Test Case Execution Results

| Case ID | Scenario | Status | Evidence |
|:---|:---|:---:|:---|
| **SP-01** | Checkout Math Validation: Online Razorpay order charges strictly platform fee (₹20, not ₹520) | ✅ PASS | Order created for 2000 paise (₹20) with platform_fee_amount=₹20 and consultation_fee_amount=₹500. Offline fee excluded from online charge. |
| **SP-02** | Database State After Online Payment: Webhook confirms slot, locks PIN, captures platform fee, and sets consultation to PENDING_OFFLINE | ✅ PASS | Booking 6f4828df-ddb4-4cfb-99b5-b155c8be500d CONFIRMED: platform_payment_status='CAPTURED', consultation_payment_status='PENDING_OFFLINE', checkin_code='4258', queue_position=1. |
| **SP-03** | Merchant Front Desk Verification & Collection: Front desk sees ₹500 balance and successfully marks it COLLECTED_AT_DESK | ✅ PASS | Front Desk d0b107bd-82cb-4197-88cf-c7989217d189 viewed ₹500 outstanding fee, collected fee, and updated consultation_payment_status to 'COLLECTED_AT_DESK' at 2026-10-27T11:26:14.456Z. |
| **SP-04** | Negative & Security Boundaries: Unauthorized collection, bad signatures, and mismatched payment amounts rejected | ✅ PASS | Customer collection rejected with 403, forged signature rejected with 400, and amount mismatch (₹520 vs ₹20) rejected with 400. |

## 2. Defects Identified

*No defects identified in this workstream. All assertions passed specification invariants.*
