# Technical Decisions, Architecture & Domain Invariants

## Multi-App Monorepo Stack
- **Customer Mobile (`apps/customer-mobile`)**: React Native (Expo) for iOS/Android. Phone OTP auth, hyperlocal Tirupati discovery (Hospitals, Restaurants, Salons, Gaming/Turf, Pet Care), 5-minute atomic booking holds, Razorpay deposit checkout, booking pass with lifetime 4-digit check-in PIN.
- **Merchant Web (`apps/merchant-web`)**: Next.js 15 App Router (port 3000). Hospital Admin, Front Desk queue desk, and Consultant screens.
- **Shared Core (`packages/shared`)**: Queue math engine (`evaluateConsultantQueue`, `buildRollingTenSlotQueue`) and shared constants.
- **Database (`supabase/`)**: PostgreSQL with strict RLS, `SECURITY DEFINER` RPCs, and `pg_cron`.
- **Payments & Distributed State**: Razorpay (Orders API, HMAC-SHA256 webhooks, Refunds with `X-Refund-Idempotency` header) + Upstash Redis (fail-closed distributed locks and rate limiters).

## Reconciled Core Stored Procedures (11 Canonical RPCs)
1. `cancel_booking`: DPDP audit logs, 60-minute cooling-off fee calculation, emergency cancellation.
2. `complete_booking`: Role guard (`is_admin OR auth.uid() IN (doctor_user_id, front_desk_assigned)`).
3. `reschedule_booking_slot`: Enforces 1-hour minimum patient gap check.
4. `record_no_show`: Enforces tiered no-show policy; restricted strictly to `service_role`.
5. `mark_present_manually`: `FOR UPDATE` row lock, late grace window, `customer_arrived_at` tracking.
6. `verify_checkin_code`: Daily PIN lookup, permanent lifetime PIN fallback, 5-attempt / 60s lockout rate limit.
7. `expire_stale_standby_queue`: Auto-expires overdue standby candidates while protecting delayed on-time patients.
8. `override_hospital_queue_position`: Restricted to hospital admins and assigned front desk staff.
9. `collect_consultation_fee`: Split payment support (platform fee online, consultation fee at desk).
10. `create_booking_hold`: GiST range exclusion overlap check + daily quota tracking in `Asia/Kolkata`.
11. `cancel_doctor_emergency`: Mass-reschedule, 100% refund trigger, 0 merchant strikes.

## Database & Security Hard Locks
- **No Overlapping Active Bookings**: `no_overlapping_active_bookings` (`EXCLUDE USING gist (resource_id WITH =, tstzrange(slot_start, slot_end) WITH &&) WHERE status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION')`).
- **Single Active Consultation**: `idx_single_in_consultation_per_doctor` (`CREATE UNIQUE INDEX ON public.bookings (resource_id) WHERE status = 'IN_CONSULTATION'`).
- **Profile Column Lockdown**: `role`, `is_superadmin`, `permanent_checkin_pin`, and `blocked_until` are revoked from `anon` and `authenticated` update privileges.
- **Production Environment Guards (`apps/merchant-web/src/env.mjs`)**: Strictly fails build/startup if `ALLOW_MOCK_PAYMENTS=true` or demo mode is enabled when `NODE_ENV === 'production'`. Razorpay secret validation must be evaluated lazily at runtime rather than breaking Next.js build-time module imports (`DEF-RC-01`).
