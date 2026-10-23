# Backlog

Cross-layer findings and deferred issues recorded per Standing Rule 6.

| Layer | Symptom | How to Reproduce | Notes |
|-------|---------|------------------|-------|
| Database | `record_no_show` RPC implements 3-strike penalty model rather than ₹50 doctor / ₹10 platform / deposit-60 refund split specified in SPEC line 13. | Call `public.record_no_show(booking_id)` and inspect deposit deduction and profile flags. | Deferred to next database layer task. |
| UI (Mobile) | Check-in 4-digit code is visible on the mobile booking pass immediately upon booking confirmation, rather than gated to 60 minutes before slot start per SPEC line 16. | Book any slot > 60 minutes in future and open BookingPassModal; code is visible immediately. | Deferred to mobile UI task. |
