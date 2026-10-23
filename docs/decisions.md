# Decisions Log

Architecture, policy, and design decisions recorded per Standing Rule 7 (date, decision, reason).

| Date | Topic / Decision | Status | Reason / Current Code Behavior |
|------|------------------|--------|--------------------------------|
| 2026-10-23 | Overlapping bookings by one customer with two doctors | OPEN | Currently allowed by database constraint `no_overlapping_active_bookings` which checks `resource_id` only. Need product decision on whether to prohibit cross-doctor concurrent bookings for the same customer. |
| 2026-10-23 | Consultant on leave with existing bookings | OPEN | Deactivating a doctor (`is_active = false`) currently leaves existing bookings in `CONFIRMED` state. Need product decision on whether to auto-reschedule, auto-refund, or preserve for front desk manual reassignment. |
| 2026-10-23 | Consultant unavailable mid-day | OPEN | Currently preserved as `CONFIRMED` for manual reassignment or bulk cancelled with 100% refund via `cancel_doctor_emergency`. Need product decision on standard automated mid-day departure flow. |
| 2026-10-23 | Check-in code after reschedule | OPEN | Rescheduling currently preserves the existing 4-digit check-in code. Need product decision on whether a new 4-digit code must be generated upon date/slot reschedule. |
| 2026-10-23 | Deposit below 60 rupees | OPEN | Currently under 3-strike policy (100% refund or 100% forfeit). Spec defines ₹50 doctor / ₹10 platform / rest refund split. Need product decision on formula when deposit is less than ₹60 (e.g. ₹0 or ₹50). |
| 2026-10-23 | Push notifications at launch | OPEN | Edge function `send-booking-notification` currently supports Expo Push when `expo_push_token` exists, with SMS fallback logs. Need product decision on whether push notifications are mandatory for Day 1 launch or SMS/WhatsApp is primary. |
| 2026-10-23 | Production domain | OPEN | Release builds require explicit HTTPS `EXPO_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_APP_URL` (no hardcoded production domain). Need final domain configuration decision for production deployment. |
