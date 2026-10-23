# Backlog

Cross-layer findings and deferred issues recorded per Standing Rule 6.

| Layer | Symptom | How to Reproduce | Notes |
|-------|---------|------------------|-------|
| UI (Customer) | [RESOLVED 2026-10-23 in Phase 5d] Check-in 4-digit code 60-minute pre-slot visibility gate. | Verified in `apps/customer-mobile/src/screens/BookingPassModal.tsx`, implemented in `apps/merchant-web/src/app/api/ticket/[id]/route.ts` and `apps/merchant-web/src/app/ticket/[id]/page.tsx`. Verified in `tests/unit/hospital-customer-screens.test.mjs`. | RESOLVED |
| UI (Customer) | [RESOLVED 2026-10-23 in Phase 7b] Display warning pop-up note during booking when customer has 2 no-shows (warning of ₹60 deduction on 3rd no-show), and display 'Your account is blocked for 7 days' when `blocked_until > NOW()`. | Implemented in `apps/customer-mobile/src/screens/CheckoutModal.tsx` and `AccountScreen.tsx`. Granted SELECT via migration `20261024000002_grant_customer_profile_no_show_count.sql`. Verified in customer mobile app. | RESOLVED |

