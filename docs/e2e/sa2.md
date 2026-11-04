# Workstream SA2 Test Report: Booking & Payments

**Sub-Agent Workstream:** SA2
**Status:** ALL PASS
**Summary:** 10/10 passed (100.0%), 0 failed, 0 blocked, 0 not run
**Execution Time:** 2026-10-23T07:52:45.245Z

## 1. Test Case Execution Results

| Case ID | Scenario | Status | Evidence |
|:---|:---|:---:|:---|
| **B1** | 7-minute hold countdown & expiry with virtual test clock | ✅ PASS | Slot 396d99c4-3f81-40d7-9ee7-926ddd534efa released after 8-min clock advance; re-held as cadd1653-71b9-463f-acf4-45e96e40eaaa |
| **B2** | Payment initiation extends hold duration | ✅ PASS | Hold extended from 2026-10-20T03:45:00.000Z to 2026-10-20T03:50:00.000Z |
| **B3** | Double-booking exclusion constraint across 50 runs with 3 concurrent customers | ✅ PASS | 50/50 runs passed. Exactly 1 winner and 2 exclusion conflicts per iteration. |
| **B4** | Payment capture transitions HELD to CONFIRMED | ✅ PASS | Booking 6ce8d423-fc35-4904-a46b-9ae560e60bec transitioned to CONFIRMED with CAPTURED status. |
| **B5** | Customer cancellation refund cutoff policy (>=60m vs <=59:59) | ✅ PASS | >=60m cutoff refunded ₹100; 59:59 cutoff refunded ₹0; 20m refunded ₹0 |
| **B6** | Merchant cancellation gives 100% refund and increments provider strike | ✅ PASS | Refund: ₹110 (100% of ₹110); provider strikes increased from 0 to 2. |
| **B7** | The same customer books overlapping slots: report the current behavior. | ✅ PASS | Same doctor: rejected by exclusion constraint (code 23P01); different doctors: allowed by current schema (both confirmed). |
| **B8** | The last slot of a session, and bookings near midnight IST, behave correctly. | ✅ PASS | Last session slot (b0676011-7ea5-4886-97d5-640ce56f6d51) confirmed; midnight IST slot (05f1047d-766d-49d1-94bb-5638f6ca6708) confirmed with strictly positive 15m duration. |
| **B9** | A customer sees only their own bookings and their own code. | ✅ PASS | Customer 1 retrieved own booking (51dc6882-4725-4b35-9884-d747336804c4) and code; Customer 2 booking (c1048df9-f49d-454e-b93c-0a6c25c19b38) strictly filtered by RLS. |
| **G1** | Hospital Admin cross-department visibility | ✅ PASS | Admin retrieved all 64 bookings across all hospital departments. |

## 2. Defects Identified

*No defects identified in this workstream. All assertions passed specification invariants.*
