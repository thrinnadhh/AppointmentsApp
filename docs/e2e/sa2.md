# Workstream SA2 Test Report: Booking & Payments

**Sub-Agent Workstream:** SA2
**Status:** ALL PASS
**Summary:** 10/10 passed (100.0%), 0 failed, 0 blocked
**Execution Time:** 2026-10-21T07:56:37.879Z

## 1. Test Case Execution Results

| Case ID | Scenario | Status | Evidence |
|:---|:---|:---:|:---|
| **B1** | 7-minute hold countdown & expiry with virtual test clock | ✅ PASS | Slot 56c0f5b9-eb71-4119-98f4-8b76bec1dd3b released after 8-min clock advance; re-held as f4c0b14b-e561-4e33-a69e-fa74d5ffdad3 |
| **B2** | Payment initiation extends hold duration | ✅ PASS | Hold extended from 2026-10-20T03:45:00.000Z to 2026-10-20T03:50:00.000Z |
| **B3** | Double-booking exclusion constraint across 50 runs with 3 concurrent customers | ✅ PASS | 50/50 runs passed. Exactly 1 winner and 2 exclusion conflicts per iteration. |
| **B4** | Payment capture transitions HELD to CONFIRMED | ✅ PASS | Booking a9fc3620-e7f8-495d-9ced-b3c905186883 transitioned to CONFIRMED with CAPTURED status. |
| **B5** | Customer cancellation refund cutoff policy (>30m vs <=30m) | ✅ PASS | >30m cutoff refunded ₹100; <=30m cutoff refunded ₹0 |
| **B6** | Merchant cancellation gives 100% refund and increments provider strike | ✅ PASS | Refund: ₹110 (100% of ₹110); provider strikes increased from 0 to 2. |
| **B7** | The same customer books overlapping slots: report the current behavior. | ✅ PASS | Same doctor: rejected by exclusion constraint (code 23P01); different doctors: allowed by current schema (both confirmed). |
| **B8** | The last slot of a session, and bookings near midnight IST, behave correctly. | ✅ PASS | Last session slot (30802542-61eb-4496-bbd9-b3ec37a3b379) confirmed; midnight IST slot (6bc32b17-9224-402d-93f8-13947bf17ae5) confirmed with strictly positive 15m duration. |
| **B9** | A customer sees only their own bookings and their own code. | ✅ PASS | Customer 1 retrieved own booking (9c45196a-f304-4efb-815c-68d263059e4f) and code; Customer 2 booking (47ff8033-b312-487e-b1bc-a3028ae813fa) strictly filtered by RLS. |
| **G1** | Hospital Admin cross-department visibility | ✅ PASS | Admin retrieved all 63 bookings across all hospital departments. |

## 2. Defects Identified

*No defects identified in this workstream. All assertions passed specification invariants.*
