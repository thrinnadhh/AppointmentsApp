# Workstream SA2 Test Report: Booking & Payments

**Sub-Agent Workstream:** SA2
**Status:** ALL PASS
**Summary:** 10/10 passed (100.0%), 0 failed, 0 blocked, 0 not run
**Execution Time:** 2026-10-22T17:23:29.893Z

## 1. Test Case Execution Results

| Case ID | Scenario | Status | Evidence |
|:---|:---|:---:|:---|
| **B1** | 7-minute hold countdown & expiry with virtual test clock | ✅ PASS | Slot 1912a843-7d3f-4641-96e3-74eb1081bd05 released after 8-min clock advance; re-held as 85b688cf-2180-4e52-aa93-2196e9fad2fe |
| **B2** | Payment initiation extends hold duration | ✅ PASS | Hold extended from 2026-10-20T03:45:00.000Z to 2026-10-20T03:50:00.000Z |
| **B3** | Double-booking exclusion constraint across 50 runs with 3 concurrent customers | ✅ PASS | 50/50 runs passed. Exactly 1 winner and 2 exclusion conflicts per iteration. |
| **B4** | Payment capture transitions HELD to CONFIRMED | ✅ PASS | Booking f6b31440-edce-48e6-955e-8ca0bb296bcc transitioned to CONFIRMED with CAPTURED status. |
| **B5** | Customer cancellation refund cutoff policy (>=60m vs <=59:59) | ✅ PASS | >=60m cutoff refunded ₹100; 59:59 cutoff refunded ₹0; 20m refunded ₹0 |
| **B6** | Merchant cancellation gives 100% refund and increments provider strike | ✅ PASS | Refund: ₹110 (100% of ₹110); provider strikes increased from 0 to 2. |
| **B7** | The same customer books overlapping slots: report the current behavior. | ✅ PASS | Same doctor: rejected by exclusion constraint (code 23P01); different doctors: allowed by current schema (both confirmed). |
| **B8** | The last slot of a session, and bookings near midnight IST, behave correctly. | ✅ PASS | Last session slot (2c16a1e1-282e-4e17-8396-6033213b6887) confirmed; midnight IST slot (ef3d8217-02a7-4e4d-b730-48bf402ba8e2) confirmed with strictly positive 15m duration. |
| **B9** | A customer sees only their own bookings and their own code. | ✅ PASS | Customer 1 retrieved own booking (63cf0a15-b1ec-4095-841c-b13b77606680) and code; Customer 2 booking (d868b3bf-e9f3-4335-9766-ac040ed79ce1) strictly filtered by RLS. |
| **G1** | Hospital Admin cross-department visibility | ✅ PASS | Admin retrieved all 64 bookings across all hospital departments. |

## 2. Defects Identified

*No defects identified in this workstream. All assertions passed specification invariants.*
