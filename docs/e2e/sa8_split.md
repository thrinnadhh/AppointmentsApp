# Workstream SA8_SPLIT Test Report: Split-Payment Workflow Verification

**Sub-Agent Workstream:** SA8_SPLIT
**Status:** ALL PASS
**Summary:** 4/4 passed (100.0%), 0 failed, 0 blocked, 0 not run
**Execution Time:** 2026-10-26T13:43:24.563Z

## 1. Test Case Execution Results

| Case ID | Scenario | Status | Evidence |
|:---|:---|:---:|:---|
| **SP-01** | Checkout Math Validation: Online Razorpay order charges strictly platform fee (₹20, not ₹520) | ✅ PASS | Order created for 2000 paise (₹20) with platform_fee_amount=₹20 and consultation_fee_amount=₹500. Offline fee excluded from online charge. |
| **SP-02** | Database State After Online Payment: Webhook confirms slot, locks PIN, captures platform fee, and sets consultation to PENDING_OFFLINE | ✅ PASS | Booking 7ad07027-2bd4-4f6b-85b2-271e95949e6b CONFIRMED: platform_payment_status='CAPTURED', consultation_payment_status='PENDING_OFFLINE', checkin_code='4453', queue_position=1. |
| **SP-03** | Merchant Front Desk Verification & Collection: Front desk sees ₹500 balance and successfully marks it COLLECTED_AT_DESK | ✅ PASS | Front Desk 36341b61-af1a-471d-b342-fc3ab9c3fa4d viewed ₹500 outstanding fee, collected fee, and updated consultation_payment_status to 'COLLECTED_AT_DESK' at 2026-10-26T13:43:24.491Z. |
| **SP-04** | Negative & Security Boundaries: Unauthorized collection, bad signatures, and mismatched payment amounts rejected | ✅ PASS | Customer collection rejected with 403, forged signature rejected with 400, and amount mismatch (₹520 vs ₹20) rejected with 400. |

## 2. Defects Identified

*No defects identified in this workstream. All assertions passed specification invariants.*
