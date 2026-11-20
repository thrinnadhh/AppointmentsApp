# Security Remediation Specification — Elephant Session (Revised Round 2)

**Date:** 2026-11-21  
**Architecture:** Google Mantis + Elephant-Goldfish Spec-Driven Workflow  
**Scope:** Appointments Monorepo (PostgreSQL Schema, Next.js 15 App Router, React Native Mobile, Tests & CI)  
**Input Catalog:** [.gsd/MANTIS_OPEN_ISSUES.json](file:///Users/trinadh/projects/Appointments/.gsd/MANTIS_OPEN_ISSUES.json)  
**Review Iteration:** Round 2 (Incorporating Goldfish Review Catches G1–G7)

---

## 1. Architectural Grouping by Root Cause & Layer

```
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 1: PostgreSQL Schema, Triggers & Function Lockdown (Wave 1)       │
│ - SEC-WIN-017: providers.city missing from guard_provider_governance   │
│ - SEC-WIN-019: cashfree_vendor_* and payout fields unblocked in trigger│
│ - SEC-WIN-020: EXECUTE grant leak on maintenance & queue procedures    │
│ - SEC-WIN-018: 4-digit check-in PIN cleartext storage [ACCEPTED_RISK]  │
│ - SEC-WIN-016: Demo seed credentials in supabase/seed.sql [ACCEPTED]   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Layer 2: Backend API & Merchant Settings Handlers (Wave 2)             │
│ - SEC-WIN-021: Missing DELETE handler on /api/hospital/members         │
│ - SEC-WIN-019 (Part 2): Strip client cashfree_* in merchant settings UI│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Layer 3: Frontend & Shared Security Boundaries (Wave 3)                │
│ - SEC-WIN-013: Segregate server secret names from client env.ts schema │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Layer 4: Tests, CI Hardening & Tooling Synchronization (Wave 4)        │
│ - SEC-WIN-022: Strip hardcoded JWT_SECRET literal in test suite        │
│ - SEC-WIN-023: Align strix-regression.test.mjs with Razorpay 410 route │
│ - SEC-WIN-025: Synchronize .agents/manifest.lock.json checksums        │
│ - SEC-WIN-024: Supabase Cloud credentials in git history [NEEDS_HUMAN] │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Detailed Technical Specifications & Invariants per Fix

### Fix Packet 1: Database Governance Trigger & Column Lockdown (`SEC-WIN-017` & `SEC-WIN-019`)
- **Target Migration File:** `supabase/migrations/20261120000004_guard_provider_payout_and_city.sql`
- **Target Test File:** `tests/security/guard-provider-payout-and-city.test.mjs`
- **Root Cause:** `public.guard_provider_governance()` triggers on `BEFORE UPDATE ON public.providers` but omitted `city` (text), `cashfree_vendor_id`, `cashfree_vendor_status`, `cashfree_app_id`, `payout_upi_id`, and masked bank/PAN credentials from the protected column comparison list.
- **Code Invariants:**
  ```sql
  CREATE OR REPLACE FUNCTION public.guard_provider_governance()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF (session_user IN ('postgres', 'supabase_admin') AND auth.jwt() IS NULL)
       OR auth.role() = 'service_role'
       OR current_setting('app.trusted_write', true) = 'true'
       OR public.is_admin(auth.uid()) THEN
      RETURN NEW;
    END IF;

    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancellation_strikes IS DISTINCT FROM OLD.cancellation_strikes
       OR NEW.strike_reset_date IS DISTINCT FROM OLD.strike_reset_date
       OR NEW.penalty_balance IS DISTINCT FROM OLD.penalty_balance
       OR NEW.is_booking_frozen IS DISTINCT FROM OLD.is_booking_frozen
       OR NEW.city_id IS DISTINCT FROM OLD.city_id
       OR NEW.city IS DISTINCT FROM OLD.city
       OR NEW.cashfree_vendor_id IS DISTINCT FROM OLD.cashfree_vendor_id
       OR NEW.cashfree_vendor_status IS DISTINCT FROM OLD.cashfree_vendor_status
       OR NEW.cashfree_app_id IS DISTINCT FROM OLD.cashfree_app_id
       OR NEW.bank_account_holder IS DISTINCT FROM OLD.bank_account_holder
       OR NEW.bank_account_last4 IS DISTINCT FROM OLD.bank_account_last4
       OR NEW.bank_ifsc IS DISTINCT FROM OLD.bank_ifsc
       OR NEW.pan_last4 IS DISTINCT FROM OLD.pan_last4
       OR NEW.payout_upi_id IS DISTINCT FROM OLD.payout_upi_id THEN
      RAISE EXCEPTION 'Unauthorized provider modification: governance, status, strikes, penalty balance, booking freeze, city, ownership, and payout credentials are protected'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END;
  $$;
  ```
- **Test Alignment (Addressing Catch G4):** Update `tests/security/guard-provider-payout-and-city.test.mjs` to remove draft-staging assertion (`!existsSync`) and verify the active migration directly against the local PostgreSQL database.
- **Regression Test:** `tests/security/guard-provider-payout-and-city.test.mjs` (Proves non-admin UPDATE fails with 42501, service role succeeds).

---

### Fix Packet 2: Operational Settings RPC Hardening (`SEC-WIN-019` Part 2 & Part 3)
- **Target Migration File:** `supabase/migrations/20261120000005_ignore_client_cashfree_settings.sql`
- **Target UI File:** `apps/merchant-web/src/app/settings/page.tsx`
- **Target Test File:** `tests/security/merchant-settings-rpc-guard.test.mjs`
- **Root Cause:** `merchant_save_operational_settings` accepted `p_cashfree_app_id` and `p_cashfree_vendor_id` and updated `public.providers`.
- **Code Invariants:** In `merchant_save_operational_settings`, client parameters `p_cashfree_app_id` and `p_cashfree_vendor_id` are completely ignored in the SQL `UPDATE` statement. In `apps/merchant-web/src/app/settings/page.tsx`, client payloads omit these keys.
- **Test Alignment (Addressing Catch G4):** Update `tests/security/merchant-settings-rpc-guard.test.mjs` to remove draft-staging assertion (`!existsSync`) and verify that calling the RPC with spoofed vendor IDs leaves stored credentials untouched on the live database.
- **Regression Test:** `tests/security/merchant-settings-rpc-guard.test.mjs`.

---

### Fix Packet 3: Maintenance & Queue RPC Execution Lockdown (`SEC-WIN-020`)
- **Target Migration File:** `supabase/migrations/20261120000006_lockdown_maintenance_and_queue_rpcs.sql`
- **Root Cause:** PostgreSQL default function execution privileges granted `EXECUTE` to `PUBLIC` and `authenticated` on newly created maintenance functions.
- **Code Invariants (Addressing Catches G1, G2, G3):**
  - **Non-Regression Invariant (G1):** `dispatch_booking_notification` is explicitly PRESERVED with `GRANT EXECUTE ... TO authenticated` because it is invoked by `apps/merchant-web/src/app/bookings/page.tsx:445` (`handleTriggerNotification`) and already enforces granular in-function authorization (`is_admin`, provider owner, consultant assignment).
  - **Accurate Function Overloads (G2 & G3):**
    ```sql
    -- 1. Purge old app logs: service_role only
    REVOKE EXECUTE ON FUNCTION public.purge_old_app_logs(integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.purge_old_app_logs(integer) TO service_role;

    -- 2. Expire stale standby queue: service_role only (exact overload: int, uuid)
    REVOKE EXECUTE ON FUNCTION public.expire_stale_standby_queue(integer, uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.expire_stale_standby_queue(integer, uuid) TO service_role;

    -- 3. Mask old notification logs: service_role only
    REVOKE EXECUTE ON FUNCTION public.mask_old_notification_logs(integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.mask_old_notification_logs(integer) TO service_role;

    -- 4. Enqueue refund request: service_role only (exact overload: uuid, uuid, text)
    REVOKE EXECUTE ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.enqueue_refund_request(uuid, uuid, text) TO service_role;
    ```
- **Regression Tests:** `tests/security/database-grants-allowlist.test.mjs` and `supabase/tests/database/05_cron_and_rate_limits.test.sql`.

---

### Fix Packet 4: Hospital Members API HTTP DELETE Implementation (`SEC-WIN-021`)
- **Target File:** `apps/merchant-web/src/app/api/hospital/members/route.ts`
- **Target Test File:** `tests/unit/hospital-admin-screens.test.mjs`
- **Standing Rule 3 Requirement (Addressing Catch G5):** Author the failing test in `tests/unit/hospital-admin-screens.test.mjs` FIRST (asserting `DELETE /api/hospital/members?id=...` returns 200 for authorized admin, removes pending invite or revokes active member, and returns 403 for non-admin). Run test to confirm pre-patch FAIL.
- **Code Invariants:**
  - Export `DELETE` handler.
  - Require authenticated hospital admin (`isHospitalAdmin(ctx)`).
  - Accept `id` query parameter (`req.nextUrl.searchParams.get('id')`) or request body `{ member_id }`.
  - If invite status is `invited`, delete row from `department_members` (cancel invite).
  - If member status is `active`, transition status to `revoked` and update `updated_at`.
  - Log audit event with `logHospitalAuditEvent` (`action: 'member.cancel_invite'` or `'member.revoke'`).
- **Regression Test:** `tests/unit/hospital-admin-screens.test.mjs`.

---

### Fix Packet 5: Client Environment Variable Schema Segregation (`SEC-WIN-013`)
- **Target File:** `apps/merchant-web/src/lib/env.ts`
- **Target Test File:** `tests/unit/build-secret-safety.test.mjs`
- **Standing Rule 3 Requirement (Addressing Catch G6):** Author the failing test in `tests/unit/build-secret-safety.test.mjs` FIRST, asserting that `SUPABASE_SERVICE_ROLE_KEY` is completely absent from the client `AuthEnv` interface and `getRawAuthEnv()`. Run test to confirm pre-patch FAIL.
- **Code Invariants:** Remove `SUPABASE_SERVICE_ROLE_KEY` from `AuthEnv` and `getRawAuthEnv()` in `env.ts`.
- **Regression Test:** `tests/unit/build-secret-safety.test.mjs`.

---

### Fix Packet 6: Test Suite & Tooling Synchronization (`SEC-WIN-022`, `SEC-WIN-023`, `SEC-WIN-025`)
- **Target Files:**
  - `tests/unit/cashfree-easysplit.test.mjs:488`
  - `tests/security/strix-regression.test.mjs:402,428,453,588`
  - `.agents/manifest.lock.json`
- **Code Invariants:**
  - In `cashfree-easysplit.test.mjs`, replace string literal with `process.env.JWT_SECRET || 'local-test-jwt-secret-placeholder-not-canonical'`.
  - In `strix-regression.test.mjs`, update Razorpay webhook assertions to expect HTTP 410 Gone (matching `tests/unit/razorpay-decommission.test.mjs`).
  - In `.agents/manifest.lock.json`, regenerate lockfile checksums to synchronize with current components.
- **Regression Tests:**
  - `node --test tests/security/strix-regression.test.mjs`
  - `python3 -m unittest discover -s .agents/scripts/tests -v`

---

## 3. Row-Level Security (RLS) Test Matrix for Touched Tables

Wave 1 touches `public.providers`. RLS permissions must be strictly verified across all roles:

| Table: `public.providers` | `anon` | `authenticated` (Owner) | `authenticated` (Other Tenant) | `service_role` |
|:---|:---:|:---:|:---:|:---:|
| **SELECT (Catalog Columns: `name`, `category_id`, `city`, `city_id`, `is_active`)** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** |
| **SELECT (Financial / Governance: `cashfree_*`, `bank_*`, `penalty_balance`)** | **DENY** | **ALLOW** | **DENY** | **ALLOW** |
| **INSERT (Direct Table Row)** | **DENY** (42501) | **DENY** (42501 - provisioned via RPC) | **DENY** (42501) | **ALLOW** |
| **UPDATE (Operational: `name`, `support_phone`, `payout_upi_id`)** | **DENY** (42501) | **ALLOW** (Own row only) | **DENY** (42501) | **ALLOW** |
| **UPDATE (Protected: `city`, `city_id`, `cashfree_vendor_*`, `strikes`)** | **DENY** (42501) | **DENY** (Blocked by Trigger 42501) | **DENY** (42501) | **ALLOW** |
| **DELETE** | **DENY** (42501) | **DENY** (42501) | **DENY** (42501) | **ALLOW** |

---

## 4. Backward Compatibility & Shipped Mobile Client Protection

- **Mobile App (`apps/customer-mobile`):**
  - Uses customer-scoped endpoints: `/api/bookings/*`, `/api/slots/availability`, `/api/payments/*`, `/api/customer/*`, `/api/ticket/*`.
  - Does NOT call `DELETE /api/hospital/members` (merchant administrative route).
  - Does NOT call maintenance RPCs (`purge_old_app_logs`, `expire_stale_standby_queue`).
  - Does NOT update `providers` directly.
  - **Verdict:** Zero breaking changes for shipped mobile app clients.
- **Web App (`apps/merchant-web`):**
  - Roster management gains `DELETE /api/hospital/members` while preserving backward compatibility with `PUT action: 'revoke'`.
  - Notification dispatch in `apps/merchant-web/src/app/bookings/page.tsx:445` remains functional (`dispatch_booking_notification` execution preserved for authenticated users with in-function auth).
  - Settings page strips read-only / server-managed Cashfree vendor input fields.

---

## 5. Non-Code & Governance Items (Documented Risk Justifications)

1. **`SEC-WIN-018` [ACCEPTED_RISK] (Cleartext 4-Digit PIN at Rest):**
   - **Compensating Controls:** PIN generation is tied to slot time; visibility is server-masked until $\le 60$ minutes pre-slot; direct SELECT is blocked for all merchant roles via RLS (`customer_id = auth.uid()`); brute-force is blocked by a 5-failure lockout in `_record_checkin_failure`. Full cryptographic hashing of a 4-digit code ($10^4$) offers negligible security gains against an attacker with full database volume dump access.
2. **`SEC-WIN-016` [ACCEPTED_RISK] (Demo Seeds in `supabase/seed.sql`):**
   - **Compensating Controls:** `seed.sql` is strictly executed by local Docker CLI (`supabase db reset`). Hosted database deployments apply migrations only, ignoring `seed.sql`.
3. **`SEC-WIN-024` [NEEDS_HUMAN] (Historical Supabase Keys in Git History):**
   - **Action Required:** Human operator must log in to the Supabase Cloud dashboard for project `ynkdnwhubfknnnzjtpeg`, regenerate the `anon` and `service_role` keys, update environment secrets, and purge git history via `git-filter-repo`.
