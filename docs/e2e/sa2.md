# Workstream SA2 Test Report: Booking & Payments

**Sub-Agent Workstream:** SA2
**Status:** ALL PASS
**Summary:** 10/10 passed (100.0%), 0 failed, 0 blocked
**Execution Time:** 2026-10-21T07:23:00.466Z

## 1. Test Case Execution Results

| Case ID | Scenario | Status | Evidence |
|:---|:---|:---:|:---|
| **B1** | 7-minute hold countdown & expiry with virtual test clock | ✅ PASS | Slot cabddc17-bb50-469c-9cc5-5d113bcd7f0e released after 8-min clock advance; re-held as a8b442b9-d480-4a30-80c4-c4cf8ec81e5f |
| **B2** | Payment initiation extends hold duration | ✅ PASS | Hold extended from 2026-10-20T03:45:00.000Z to 2026-10-20T03:50:00.000Z |
| **B3** | Double-booking exclusion constraint across 50 runs with 3 concurrent customers | ✅ PASS | 50/50 runs passed. Exactly 1 winner and 2 exclusion conflicts per iteration. |
| **B4** | Payment capture transitions HELD to CONFIRMED | ✅ PASS | Booking 59490fe1-ad63-428d-804b-76e501851563 transitioned to CONFIRMED with CAPTURED status. |
| **B5** | Customer cancellation refund cutoff policy (>30m vs <=30m) | ✅ PASS | >30m cutoff refunded ₹100; <=30m cutoff refunded ₹0 |
| **B6** | Merchant cancellation gives 100% refund and increments provider strike | ✅ PASS | Refund: ₹110 (100% of ₹110); provider strikes increased from 0 to 2. |
| **B7** | The same customer books overlapping slots: report the current behavior. | ✅ PASS | Same doctor: rejected by exclusion constraint (code 23P01); different doctors: allowed by current schema (both confirmed). |
| **B8** | The last slot of a session, and bookings near midnight IST, behave correctly. | ✅ PASS | Last session slot (28ab1df7-b18b-4e10-8536-06a560b9db69) confirmed; midnight IST slot (3bbefa96-1eb9-469e-a133-f4b1bea5d5a7) confirmed with strictly positive 15m duration. |
| **B9** | A customer sees only their own bookings and their own code. | ✅ PASS | Customer 1 retrieved own booking (8f7318e1-e76e-4326-af60-39774d42cca6) and code; Customer 2 booking (a5d26e71-d615-448a-8be7-d365a7102742) strictly filtered by RLS. |
| **G1** | Hospital Admin cross-department visibility | ✅ PASS | Admin retrieved all 63 bookings across all hospital departments. |

## 2. Defects Identified

*No defects identified in this workstream. All assertions passed specification invariants.*
