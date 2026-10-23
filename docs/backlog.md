# Backlog

Cross-layer findings and deferred issues recorded per Standing Rule 6.

| Layer | Symptom | How to Reproduce | Notes |
|-------|---------|------------------|-------|
| Database | [RESOLVED 2026-10-23 in Phase 7a] No-Show Tiered Policy & 7-Day Account Block. | Implemented in migration `20261024000001_no_show_tiered_policy_and_account_block.sql` with ₹50 doctor / ₹10 platform / remainder split and 7-day block at > 5 strikes. Verified in `tests/unit/hospital-no-show-policy.test.mjs`. | RESOLVED |
| UI (Customer) | [RESOLVED 2026-10-23 in Phase 5d] Check-in 4-digit code 60-minute pre-slot visibility gate. | Verified in `apps/customer-mobile/src/screens/BookingPassModal.tsx`, implemented in `apps/merchant-web/src/app/api/ticket/[id]/route.ts` and `apps/merchant-web/src/app/ticket/[id]/page.tsx`. Verified in `tests/unit/hospital-customer-screens.test.mjs`. | RESOLVED |
| UI (Customer) | Display warning pop-up note during booking when customer has 2 no-shows (warning of ₹60 deduction on 3rd no-show), and display 'Your account is blocked for 7 days' when `blocked_until > NOW()`. | Attempt booking with customer profile having `no_show_count >= 2` or `blocked_until > NOW()`. | Planned for Phase 7b UI Layer. |

