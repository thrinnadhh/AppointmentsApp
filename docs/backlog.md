# Backlog

Cross-layer findings and deferred issues recorded per Standing Rule 6.

| Layer | Symptom | How to Reproduce | Notes |
|-------|---------|------------------|-------|
| Database | `record_no_show` RPC implements 3-strike penalty model rather than ₹50 doctor / ₹10 platform / deposit-60 refund split specified in SPEC line 13. | Call `public.record_no_show(booking_id)` and inspect deposit deduction and profile flags. | Deferred to next database layer task. |
| UI (Customer) | [RESOLVED 2026-10-23 in Phase 5d] Check-in 4-digit code 60-minute pre-slot visibility gate. | Verified in `apps/customer-mobile/src/screens/BookingPassModal.tsx`, implemented in `apps/merchant-web/src/app/api/ticket/[id]/route.ts` and `apps/merchant-web/src/app/ticket/[id]/page.tsx`. Verified in `tests/unit/hospital-customer-screens.test.mjs`. | RESOLVED |
