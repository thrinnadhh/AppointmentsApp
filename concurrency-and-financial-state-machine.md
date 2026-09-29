# Plan: Concurrency & Financial State Machine Hardening

## Overview
This initiative remediates 1 Critical and 3 High vulnerabilities in the appointment concurrency and financial state machine of the Hyperlocal Booking platform:

1. **Critical — Overlap Exclusion Guard**: Replace point-in-time equality checks (`slot_start = new_slot_start`) with a PostgreSQL `btree_gist` range exclusion constraint (`tstzrange(slot_start, slot_end) WITH &&`) on `public.bookings` for active bookings (`status IN ('HELD', 'CONFIRMED')`).
2. **High — Reschedule Without Capture**: Prevent unauthorized status promotion from `HELD` to `CONFIRMED` in the `reschedule_booking_slot` RPC unless a valid captured payment ID or zero-deposit exemption exists.
3. **High — Distributed Slot Lock Fail-Open**: Increase slot lock timeout to withstand slow DB transactions, ensure lock release targets only the caller's specific token (via Lua script in Redis / token comparison in memory), fail closed when Upstash Redis is unreachable in production, and eliminate `clearAllMemoryLocks()` blast-radius calls.
4. **High — Daily Limit TOCTOU & Timezone Gap**: Enforce the merchant venue's operational timezone (IST / `Asia/Kolkata`, UTC+5:30) for daily booking limit day-window calculations, and eliminate TOCTOU races by executing the quota check inside an advisory-locked atomic transaction in PostgreSQL (`pg_advisory_xact_lock`).

---

## Project Type & Agent Routing
- **Project Type**: BACKEND (PostgreSQL, Supabase RPCs, Redis distributed locking, Next.js API Routes)
- **Primary Agent**: `backend-specialist`
- **Skills**: `clean-code`, `database-design`, `api-patterns`, `lint-and-validate`

---

## Detailed Technical Specifications

### 1. Overlap Exclusion Guard (PostgreSQL & Migrations)
- **Problem**:
  - `idx_unique_active_resource_slot` on `(resource_id, slot_start)` and RPC conflict queries (`WHERE slot_start = p_slot_start`) only protected against exact start-time collisions. Overlapping bookings of differing intervals (e.g. 60m vs 30m) or staggered starts caused double-bookings.
- **Solution**:
  - Enable `btree_gist` extension: `CREATE EXTENSION IF NOT EXISTS btree_gist;`
  - Add range exclusion constraint on `public.bookings`:
    ```sql
    ALTER TABLE public.bookings
    DROP CONSTRAINT IF EXISTS no_overlapping_active_bookings;

    ALTER TABLE public.bookings 
    ADD CONSTRAINT no_overlapping_active_bookings 
    EXCLUDE USING gist (
      resource_id WITH =,
      tstzrange(slot_start, slot_end) WITH &&
    ) WHERE (status IN ('HELD', 'CONFIRMED'));
    ```
  - Update `create_booking_hold` RPC to check interval overlaps:
    `WHERE resource_id = p_resource_id AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end) AND status IN ('HELD', 'CONFIRMED')`
  - Gracefully handle `23P01` (`exclusion_violation`) exception during insert in `create_booking_hold`.
  - Maintain backward compatibility and audit trail by:
    1. Creating a new forward migration: `supabase/migrations/20260929000001_concurrency_and_financial_state_machine.sql`.
    2. Synchronizing historical migrations `20260908000001_initial_schema.sql` and `20260924000003_remediation_fixes_and_grants.sql`.

### 2. Reschedule Without Capture (State Machine Hardening)
- **Problem**:
  - `reschedule_booking_slot` previously ran `UPDATE public.bookings SET status = 'CONFIRMED' WHERE id = p_booking_id;`. An attacker holding an uncaptured/unpaid slot could invoke reschedule to immediately bypass payment and promote their booking to `CONFIRMED`.
  - The conflict check also only checked `slot_start = p_new_slot_start`.
- **Solution**:
  - Replace equality check with range overlap:
    `WHERE resource_id = v_booking.resource_id AND tstzrange(slot_start, slot_end) && tstzrange(p_new_slot_start, p_new_slot_end) AND status IN ('HELD', 'CONFIRMED') AND id != p_booking_id`
  - Enforce financial state machine:
    - If `v_booking.status = 'HELD'`:
      - If `COALESCE(v_booking.deposit_amount, 0) > 0` AND (`v_booking.payment_status != 'PAID'` OR `v_booking.gateway_payment_id IS NULL`), keep `status = 'HELD'`.
      - If zero deposit or already paid, allow transition to `CONFIRMED`.
    - If `v_booking.status = 'CONFIRMED'`: preserve `CONFIRMED`.
    - Reject any rescheduling on `CANCELLED` or `COMPLETED`.
  - Update both `20260928000002_lockdown_anonymous_rpcs_and_onboarding_ato.sql` and `20260929000001_concurrency_and_financial_state_machine.sql`.

### 3. Distributed Slot Lock Fail-Open (Redis & API Routes)
- **Problem**:
  - Static lock value `'locked'` allowed any process to delete another caller's lock via `releaseSlotLock(slotKey)`.
  - Unhandled Upstash failures fell through to `memoryStore` on serverless, causing a silent fail-open.
  - TTL in `hold/route.ts` was 10s, which could expire prematurely during slow DB connections.
  - `apps/merchant-web/src/app/api/admin/merchants/route.ts:81` cleared all locks platform-wide whenever an admin activated any single merchant.
- **Solution**:
  - In `apps/merchant-web/src/lib/redis.ts`:
    - Generate unique UUID lock token per acquisition.
    - Default TTL 30s.
    - Return `{ acquired: boolean, token: string }`.
    - If `isUpstashConfigured`: fail-closed if Upstash is unreachable or errors.
    - `releaseSlotLock(slotKey, token?)`: evaluate Lua script on Redis (`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`) or match token in memory store.
  - In `apps/merchant-web/src/app/api/bookings/hold/route.ts`:
    - Use 30s lock acquisition.
    - Pass caller's `lockToken` to `releaseSlotLock(slotKey, lockToken)`.
  - In `apps/merchant-web/src/app/api/admin/merchants/route.ts`:
    - Remove `clearAllMemoryLocks()` call and import.

### 4. Daily Limit TOCTOU & Timezone Gap
- **Problem**:
  - `apps/merchant-web/src/app/api/bookings/hold/route.ts` used local server `setHours(0,0,0,0)` (UTC in production), skewing the operational day by 5.5 hours relative to IST (`Asia/Kolkata`).
  - Checking `count` via Supabase client before RPC insertion had a TOCTOU race window under concurrent requests.
- **Solution**:
  - Enforce daily limit check directly inside `create_booking_hold` RPC:
    - Acquire transaction-scoped advisory lock: `PERFORM pg_advisory_xact_lock(hashtext('daily_limit:' || v_provider_id::text || ':' || v_slot_date_ist::text));`
    - Compute date in IST: `v_slot_date_ist := (p_slot_start AT TIME ZONE 'Asia/Kolkata')::date;`
    - Count existing bookings for that provider on that IST calendar date with status `IN ('HELD', 'CONFIRMED', 'COMPLETED')`.
    - If count >= limit, reject with clear error message.
  - In `apps/merchant-web/src/app/api/bookings/hold/route.ts`:
    - Calculate IST calendar day window correctly using `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'`.
    - Rely on atomic DB advisory lock for concurrency protection.

---

## Verification Plan
1. Run existing test suites: `node test-routes.mjs`, `node test-security.mjs`, `node test-validation.mjs`.
2. Add comprehensive automated tests in a new test suite (`test-concurrency.mjs`):
   - Overlap Exclusion: verify exclusion constraint and RPC range checks reject overlapping slots with different intervals.
   - Reschedule State Machine: verify unpaid HELD bookings stay HELD, zero-deposit or paid bookings stay/become CONFIRMED.
   - Distributed Lock: test token-specific release, TTL, and fail-closed behavior when Upstash is configured.
   - Daily Limit: test IST boundary calculation across 00:00-05:30 IST and advisory lock atomicity.
3. Run linting and TypeScript checks: `npm run lint` and `npx tsc --noEmit`.
