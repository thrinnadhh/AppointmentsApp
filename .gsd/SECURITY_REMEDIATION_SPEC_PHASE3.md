# Phase 3 Security Remediation Specification (Elephant Spec)

**Date:** 2026-11-22  
**Target Branch:** `security/window-closure-20261121` (PR #25)  
**Author:** Coordinator Mode Swarm  
**Status:** SPEC_APPROVED (Goldfish Review Passed & Verified)  

---

## 1. Executive Summary & Findings Scope

This specification addresses the confirmed security findings discovered in Wave 1 audit passes across Phase 3:
1. **Finding A (SEC-DISC-003 / High):** Customer Self-Service Account Erasure RPC Failure (`anonymize_user_data` 42501 Authorization Failure for Non-Admin Data Subjects).
2. **Finding B (SEC-DISC-004 / High):** Missing Idempotency Unique Constraint on `public.merchant_vendor_splits(booking_id)` Permitting Duplicate Split Liabilities on Concurrent Webhooks.
3. **Finding C (SEC-DISC-005 / High):** Public Account Deletion Sibling Route (`/api/account/delete-public-request`) Swallows Postgres RPC Errors, Erases `auth.users` Without Anonymizing PII in `public.profiles`, and is Erroneously Exempted from CSRF Checks.
4. **Finding D (SEC-DISC-006 / Medium):** Concurrency TOCTOU Race Condition on 1-Hour Appointment Gap Invariant in `private.create_booking_hold` Due to Late Advisory Lock Acquisition.
5. **Finding E (Task T6 / Defense-in-Depth):** Addition of Nonce-based `Content-Security-Policy-Report-Only` and `Cross-Origin-Opener-Policy-Report-Only` alongside Existing Policies.

---

## 2. Technical Remediation Design

### Component 1: Database Migration `20261122000004_fix_customer_deletion_and_vendor_split_unique.sql`

#### 1.1 `public.anonymize_user_data(p_user_id UUID)`
- **Vulnerability:** `anonymize_user_data` previously checked `IF auth.role() != 'service_role' AND v_caller_role != 'admin' THEN ...`, which failed with 42501 for customers exercising self-service DPDP erasure, and suffered from NULL evaluation bypass risks in PL/pgSQL.
- **Fix:** Update the authorization guard in `public.anonymize_user_data` with a positive, fail-closed assertion:
  ```sql
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = (SELECT auth.uid());
  IF NOT (
      auth.role() = 'service_role'
      OR COALESCE(v_caller_role, '') = 'admin'
      OR ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = p_user_id)
  ) THEN
      RAISE EXCEPTION 'Unauthorized: only service_role, admin, or the account owner can anonymize user data' USING ERRCODE = '42501';
  END IF;
  ```
  Explicit permissions lockdown:
  ```sql
  REVOKE ALL ON FUNCTION public.anonymize_user_data(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.anonymize_user_data(uuid) TO service_role;
  ```

#### 1.2 `public.merchant_vendor_splits`
- **Vulnerability:** `public.merchant_vendor_splits` lacked a UNIQUE constraint on `booking_id`, allowing concurrent webhook replays or races to insert duplicate split rows.
- **Fix:** Add a UNIQUE constraint:
  ```sql
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'uq_merchant_vendor_splits_booking'
    ) THEN
      ALTER TABLE public.merchant_vendor_splits
        ADD CONSTRAINT uq_merchant_vendor_splits_booking UNIQUE (booking_id);
    END IF;
  END $$;
  ```

#### 1.3 `private.create_booking_hold`
- **Vulnerability:** In `20261118000007_prevent_double_booking_waiting_statuses.sql`, `pg_advisory_xact_lock(hashtext('hold_limit:' || p_customer_id::text))` was acquired at line 306, AFTER the 1-hour time gap checks at lines 187-235. Concurrent hold requests for different resources bypassed the 1-hour gap check.
- **Fix:** Preserve the full hospital schema implementation from `20261118000007` verbatim (`SET search_path TO ''`, `department_id`, `platform_fee_amount`, `consultation_fee_amount`, cooling periods, and `WHEN exclusion_violation THEN`), moving `PERFORM pg_advisory_xact_lock(hashtext('hold_limit:' || p_customer_id::text));` up to function entry immediately following caller authorization checks.

---

### Component 2: Application Code Fixes

#### 2.1 `apps/merchant-web/src/app/api/account/delete-public-request/route.ts`
- **Vulnerability:** Lines 146-160 executed `delete_account_immediately` via `supabaseAdmin` in a try/catch block. In Supabase JS, RPC failures return an `{ error }` object rather than throwing, so catch blocks do not trigger. `auth.admin.deleteUser(userId)` was invoked without verifying data anonymization.
- **Fix:**
  1. Call `supabaseAdmin.rpc('anonymize_user_data', { p_user_id: userId })` directly.
  2. Check `if (anonErr) { return NextResponse.json({ error: 'Failed to erase personal data' }, { status: 500 }); }`.
  3. Only upon successful anonymization, delete the auth user record.

#### 2.2 `apps/merchant-web/src/lib/csrf-guard.ts`
- **Vulnerability:** `/api/account/delete-public-request` was exempted from CSRF checks in `WEBHOOK_OR_EXEMPT_ROUTES`.
- **Fix:** Remove `/api/account/delete-public-request` from `WEBHOOK_OR_EXEMPT_ROUTES`. State-changing mutations from browsers must satisfy `Origin` / `Sec-Fetch-Site` validation.

#### 2.3 `apps/merchant-web/src/app/api/webhooks/cashfree/route.ts`
- **Vulnerability:** Line 279 executes `insert` into `merchant_vendor_splits`. Concurrent webhooks produce duplicate inserts.
- **Fix:** Use upsert with `{ onConflict: 'booking_id', ignoreDuplicates: true }`.

---

### Component 3: Headers (Task T6)

#### 3.1 `apps/merchant-web/next.config.mjs`
- **Requirement:** Add `Content-Security-Policy-Report-Only` (nonce-based script-src alongside existing policy) and `Cross-Origin-Opener-Policy-Report-Only: same-origin-allow-popups`.
- **Implementation:** Appended both report-only headers under `headers()` in `next.config.mjs`.

---

## 3. Verification Plan & Test Matrix

1. **RED Tests (Verified Failed before fix):**
   - `tests/security/customer-self-deletion.test.mjs`: Failed with `403 Unauthorized: only service_role or admin can anonymize user data`.
   - `tests/security/vendor-split-idempotency.test.mjs`: Failed with duplicate insert succeeding (201 instead of 409 Conflict).
   - `tests/security/account-deletion-public-anonymization.test.mjs`: Failed with cross-site CSRF request allowed (`true !== false`).
2. **GREEN Verification (Verified Passed after fix):**
   - `node --test tests/security/customer-self-deletion.test.mjs` (2/2 passed).
   - `node --test tests/security/vendor-split-idempotency.test.mjs` (1/1 passed).
   - `node --test tests/security/account-deletion-public-anonymization.test.mjs` (3/3 passed).
   - `node scripts/run-all-unit-tests-serially.mjs` (26/26 suites passed).
   - Gate verification: `bash .gsd/gate.sh run`.
3. **Mutation Check:**
   - Temporarily reverting positive guard in SQL returns 403 on customer deletion.
   - Temporarily omitting `uq_merchant_vendor_splits_booking` allows duplicate split insert.
   - Restoring fixes produces 100% green suites.
