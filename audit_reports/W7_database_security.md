# QA Sub-Agent W7 — Database Integrity & System Security Audit

- **Workstream:** Database Integrity & System Security Audit (W7)
- **Files & Areas Examined:**
  - `supabase/migrations/` (All 171 SQL migration files)
  - Live PostgreSQL database catalog: `information_schema.tables`, `pg_class`, `pg_proc`, `pg_constraint`, `pg_indexes`, `pg_policies`, `information_schema.triggers`
  - `apps/merchant-web/src/app/api/` (All 38 server API routes & endpoint security guards)
  - `apps/merchant-web/src/lib/` (`auth-admin.ts`, `hospital-access.ts`, `supabase.ts`, `redis.ts`, `storage.ts`)
  - `apps/merchant-web/src/env.mjs` & environment configurations (`.env.example`, `apps/merchant-web/.env.example`)
  - Security & unit test suites in `tests/unit/` and `tests/security/`
- **Time Started:** 2026-11-17 17:08:00 UTC
- **Time Finished:** 2026-11-17 17:17:30 UTC
- **Overall Status:** FAIL (3 Defects Found: 2 Broken Database Functions in migrations, 1 Ambiguous Function Overload set; RLS and Server-Side API BOLA guards PASSED)

---

## Executive Summary
This audit conducted an end-to-end static and empirical verification of database migrations, schema constraints, index coverage on critical paths, triggers, Row Level Security (RLS) enforcement, server-side role enforcement (BOLA/BFLA defense), and credential/secrets safety across the Appointments platform.

### Key Audit Findings:
1. **Migration & Schema Integrity (FAIL - High Severity):**
   - **`private.create_booking_hold`**: Migration `20261114000002_forensic_hardening_and_cashfree_remediation.sql` line 68 attempts to query `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)`. However, `public.profiles` has no column named `is_admin` (it uses `role = 'admin'`). Invoking this path triggers PostgreSQL error `42703: column "is_admin" does not exist`.
   - **`public.merchant_move_booking_to_standby`**: Migration `20261115000003_resolve_overloads_and_standby_linter.sql` lines 388-392 executes `UPDATE public.bookings SET queue_status = 'STANDBY' ...`. However, `public.bookings` has never had a `queue_status` column. Calling this RPC immediately crashes with `42703: column "queue_status" of relation "bookings" does not exist`.
   - **Ambiguous Function Overloads**: Migration `20261115000001_harden_security_definer_caller_checks.sql` created conflicting signatures for `merchant_add_resource_leave` and `merchant_register_shop_for_user` without dropping legacy versions. This triggers PostgREST error `PGRST202` (duplicate RPC) and breaks automated schema assertions.
2. **Database Invariants & Constraints (PASS):**
   - GiST exclusion constraint `no_overlapping_active_bookings` on `public.bookings` (`resource_id` + `tstzrange(slot_start, slot_end)`) successfully prevents double-booking across active statuses (`HELD`, `PENDING_PAYMENT`, `CONFIRMED`, `CHECKED_IN`, `IN_CONSULTATION`).
   - Unique partial index `idx_single_in_consultation_per_doctor` strictly enforces the hospital invariant: at most one active consultation per consultant doctor at any time.
   - Foreign key rules enforce financial auditability: `bookings.customer_id` and `payments.booking_id` are `ON DELETE RESTRICT`.
3. **Database Indexes on Hot Query Paths (PASS):**
   - Full compound index coverage exists for bookings (`idx_bookings_customer`, `idx_bookings_provider`, `idx_bookings_resource_slot_status`, `idx_bookings_hold_expiry`, `idx_bookings_gateway_lookup`).
   - Front Desk assignments and Department Members have comprehensive composite and unique indexes.
4. **Triggers & PostgreSQL Functions (FAIL - due to buggy functions):**
   - Database triggers (`validate_booking_update`, `protect_booking_payment_fields`, `guard_profile_governance`, `guard_provider_governance`) provide robust defense-in-depth, blocking REST tampering with financial columns, booking statuses, user roles, check-in PINs, and penalty counters.
   - All 127 `SECURITY DEFINER` functions have explicit `search_path` set (`search_path = public, pg_temp` or `search_path = ''`).
   - Execution on all sensitive RPCs is revoked from `anon` and `PUBLIC`.
5. **Row Level Security (RLS) Coverage Matrix (PASS):**
   - **100% of public tables (30/30)** have RLS ENABLED (`relrowsecurity = true`).
   - Zero sensitive tables have overly permissive `USING (true)` policies for authenticated users.
   - Table `payments` has zero direct client write policies (read-only for clients, writes strictly reserved to `service_role` and verified RPCs).
6. **Server-Side Role Enforcement (BOLA / BFLA Defense) (PASS):**
   - All 38 Next.js API routes enforce server-side authentication (`verifyAuthenticatedUser`, `verifyAdminRequest`, `verifyStaffManagerRequest`, or `getAccessContext`).
   - Zero reliance on client-side role claims.
   - Every booking mutation route verifies object-level authorization via `isCallerAuthorizedForBooking`.
   - The public ticket endpoint (`/api/ticket/[id]`) redacts all customer PII, provider phone, and permanent PINs unless the caller is authenticated as the booking owner or staff.
7. **Hardcoded Secrets & Deployment Readiness (FAIL - Low Severity config drift):**
   - Zero live credentials found across git repository (Gitleaks passed: 28.09 MB scanned, 0 leaks).
   - Fail-fast production boot validation in `apps/merchant-web/src/env.mjs` prevents boot with placeholder secrets or `ALLOW_MOCK_PAYMENTS=true`.
   - Root `.env.example` has not been updated with Cashfree environment variables (`CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `PAYMENT_GATEWAY_PROVIDER`), though `apps/merchant-web/.env.example` is complete.

---

## Detailed Audit by Flow

### FLOW 1: Migration Integrity (Static Review)
- **ID:** FLOW-SEC-01
- **Name:** Migration Continuity, Dependency Ordering & Syntax Review
- **Actor:** System / Database Engine
- **Status:** FAIL
- **Severity:** High
- **Chain Traced:**
  - `supabase/migrations/` (171 SQL files) -> `npx supabase db lint` -> PostgreSQL Catalog (`pg_proc`, `pg_class`, `pg_attribute`)
- **Checks at each link:**
  1. *File Naming & Chronological Order:* All 171 migration filenames strictly adhere to `YYYYMMDDHHMMSS_<description>.sql`. Timestamps range from `20260908000001` to `20261115000003`. All timestamps are strictly unique and sequentially ordered.
  2. *Destructive Operations:* Scanned all 171 files for `DROP TABLE` or `ALTER TABLE ... DROP COLUMN`. Zero tables dropped, zero columns dropped. All schema changes follow an additive/evolutionary pattern.
  3. *Syntax & Runtime Compatibility:* Executed `npx supabase db lint` against local Supabase. Linter detected two fatal runtime SQL reference errors in latest migrations:
     - `private.create_booking_hold`: references non-existent column `is_admin` in `public.profiles`.
     - `public.merchant_move_booking_to_standby`: references non-existent column `queue_status` in `public.bookings`.
- **Evidence:**
  - `supabase/migrations/20261114000002_forensic_hardening_and_cashfree_remediation.sql:68`:
    `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)`
  - `supabase/migrations/20261115000003_resolve_overloads_and_standby_linter.sql:388`:
    `UPDATE public.bookings SET queue_status = 'STANDBY', is_present = true ...`
  - Output of `npx supabase db lint`:
    `{"function":"private.create_booking_hold","issues":[{"level":"error","message":"column \"is_admin\" does not exist"}]}`
    `{"function":"public.merchant_move_booking_to_standby","issues":[{"level":"error","message":"column \"queue_status\" of relation \"bookings\" does not exist"}]}`
- **Reason for FAIL:**
  - Two recent migrations introduced SQL statements that query non-existent columns.
- **Likely Fix:**
  - In `private.create_booking_hold`: change `is_admin = true` to `role = 'admin'` (or `public.is_admin(auth.uid())`).
  - In `public.merchant_move_booking_to_standby`: remove `queue_status = 'STANDBY'` from the UPDATE statement (standby status is dynamically evaluated or tracked via `skipped_at`).

---

### FLOW 2: Database Constraints & Invariants
- **ID:** FLOW-SEC-02
- **Name:** Double-Booking Defense, Single-Consultation Invariant, FK & Check Constraints
- **Actor:** Customer, Consultant, Merchant, Database Engine
- **Status:** PASS
- **Severity:** N/A (Verified)
- **Chain Traced:**
  - Booking Hold / Confirm -> PostgreSQL GiST Exclusion Index -> Status Update to IN_CONSULTATION -> Unique Partial B-Tree Index -> Table Constraints
- **Checks at each link:**
  1. *Double-Booking Defense (GiST Exclusion Constraint):*
     - Verified constraint `no_overlapping_active_bookings` on `public.bookings`:
       ```sql
       EXCLUDE USING gist (
         resource_id WITH =,
         tstzrange(slot_start, slot_end) WITH &&
       ) WHERE (status = ANY (ARRAY['HELD'::booking_status, 'PENDING_PAYMENT'::booking_status, 'CONFIRMED'::booking_status, 'CHECKED_IN'::booking_status, 'IN_CONSULTATION'::booking_status]))
       ```
     - Any concurrent attempt to insert or hold overlapping time ranges for the same `resource_id` is atomically blocked by PostgreSQL kernel with error `23P01 (exclusion_violation)`.
  2. *Doctor Single-Consultation Constraint:*
     - Verified unique partial index `idx_single_in_consultation_per_doctor` on `public.bookings`:
       ```sql
       CREATE UNIQUE INDEX idx_single_in_consultation_per_doctor ON public.bookings USING btree (resource_id) WHERE (status = 'IN_CONSULTATION'::booking_status);
       ```
     - Verified API handler integration in `apps/merchant-web/src/app/api/bookings/start/route.ts` line 90-100: catches error code `23505` and returns HTTP 409 `"Doctor already has an active consultation in progress"`.
  3. *Foreign Key Invariants & Cascades:*
     - Total 49 foreign keys audited.
     - `bookings.customer_id -> profiles.id`: `ON DELETE RESTRICT` (protects customer profile from deletion if active/past bookings exist).
     - `payments.booking_id -> bookings.id`: `ON DELETE RESTRICT` (protects financial payment records from deletion).
     - `account_deletion_requests.user_id -> auth.users.id`: `ON DELETE CASCADE`.
  4. *Check Constraints:*
     - `slot_start < slot_end` enforced on `bookings` (`check_booking_times`) and `resource_availability` (`check_avail_times`).
     - `patient_age` constrained to `0 <= patient_age <= 120`.
     - `booked_for` constrained to `'self'` or `'family'`.
     - `payment_status` constrained to allowed enum states.
- **Evidence:**
  - Query of `pg_constraint` on `public.bookings` (conname: `no_overlapping_active_bookings`, `check_booking_times`, `check_bookings_patient_age`, `bookings_customer_id_fkey`).
  - Unit tests: `tests/unit/hospital-concurrency-safety.test.mjs` PASSED.

---

### FLOW 3: Database Indexes on Hot Query Paths
- **ID:** FLOW-SEC-03
- **Name:** Index Coverage on High-Frequency Query Paths
- **Actor:** Customer, Front Desk, Consultant, Admin API
- **Status:** PASS
- **Severity:** N/A (Verified)
- **Chain Traced:**
  - REST / RPC Query -> PostgreSQL Query Planner -> Index Scan
- **Checks at each link:**
  1. *Bookings Hot Paths:*
     - Customer bookings lookup: `idx_bookings_customer` `(customer_id, status)` and `idx_bookings_customer_slot` `(customer_id, slot_start DESC)`.
     - Merchant calendar & live queue: `idx_bookings_provider` `(provider_id, slot_start)` and `idx_bookings_resource_slot_status` `(resource_id, slot_start, status)`.
     - Stale checkout hold release worker: `idx_bookings_hold_expiry` `(hold_expires_at) WHERE status = 'HELD'`.
     - Payment gateway reconciliation: `idx_bookings_gateway_lookup` `(gateway_provider, gateway_order_id)`.
     - Cooling period checks: `idx_bookings_cooling_lookup` `(customer_id, provider_id, status, slot_start DESC)`.
     - Hospital department queue: `idx_bookings_department_id` `(department_id)`.
  2. *Front Desk & Staff Scoping:*
     - `doctor_front_desk_assignments`: `idx_dfda_doctor_id` `(doctor_id)`, `idx_dfda_user_id` `(user_id)`, `idx_dfda_provider_id` `(provider_id)`, and unique composite `(doctor_id, user_id)`.
     - `department_members`: `idx_dept_members_user_id`, `idx_dept_members_merchant_id`, `idx_dept_members_department_id`, and `idx_dept_members_role` `(department_id, role)`.
  3. *Payments:*
     - `payments`: `idx_payments_booking_id` `(booking_id)` and unique `payments_gateway_payment_id_key` `(gateway_payment_id)`.
  4. *Directory Search & Geolocation:*
     - Trigram GIN indexes on `providers.name`, `providers.description`, and `resources.name`.
     - Spatial GiST index on `providers` coordinates: `idx_providers_geo` `USING gist (st_makepoint(longitude, latitude)::geography)`.
- **Evidence:**
  - Query of `pg_indexes` across `bookings`, `doctor_front_desk_assignments`, `department_members`, `payments`, `providers`, `resources`.

---

### FLOW 4: Triggers & PostgreSQL Functions
- **ID:** FLOW-SEC-04
- **Name:** Trigger Governance, SECURITY DEFINER search_path & Caller Authorization
- **Actor:** Database Engine, PostgreSQL RPCs
- **Status:** FAIL
- **Severity:** Medium
- **Chain Traced:**
  - Table UPDATE/INSERT -> Trigger Execution -> Trigger Function (`SECURITY DEFINER`) -> search_path isolation -> Internal Governance Checks
- **Checks at each link:**
  1. *Database Triggers Governance:*
     - `validate_booking_update` (on `bookings`): strictly prevents direct modification of financial columns (`platform_fee`, `deposit_amount`, `total_amount`, `invoice_number`, `gateway_payment_id`) and status transitions via REST. Enforces that status changes must go through authorized RPCs.
     - `protect_booking_payment_fields` (on `bookings`): prevents tampering with payment identifiers and enforces the 60-minute refund window on cancellations.
     - `guard_profile_governance` (on `profiles`): strictly aborts client modifications to `role`, `assigned_city_id`, `no_show_count`, `is_flagged`, `blocked_until`, and `permanent_checkin_pin`.
     - `guard_provider_governance` (on `providers`): protects `owner_id`, `status`, `cancellation_strikes`, `strike_reset_date`, `penalty_balance`, `is_booking_frozen`, and `city_id`.
     - `check_department_member_limit` (on `department_members`): enforces the maximum 3 staff members per department invariant.
  2. *SECURITY DEFINER Functions `search_path` Isolation:*
     - Audited all 127 `SECURITY DEFINER` functions in `public` and `private` schemas.
     - **100% (127/127)** have explicit `search_path` configured (`search_path = public, pg_temp` or `search_path = ''`). Zero unconfigured search_path functions, eliminating search_path hijacking risks.
  3. *Caller Execution Grants Snapshot:*
     - Default privileges in `public` schema revoke `EXECUTE` from `anon` and `PUBLIC`.
     - Sensitive RPCs (`create_booking_hold`, `confirm_booking_payment`, `verify_checkin_pin`, `process_hospital_no_show`) are restricted to `authenticated` and `service_role`.
     - Only 5 safe read-only/telemetry functions permit `anon` execution: `get_active_cities`, `get_nearby_providers`, `search_directory_public`, `submit_city_waitlist`, and `log_client_event`.
  4. *Function Overload Ambiguity Defect:*
     - `tests/unit/security-audit-database-grants.test.mjs` test #3 failed:
       Found duplicate overloaded functions in `public` schema:
       - `merchant_add_resource_leave` (2 overloads: one with `p_doctor_id uuid`, one with `p_resource_id text`).
       - `merchant_register_shop_for_user` (2 overloads: differing parameter counts and types).
- **Evidence:**
  - `tests/unit/security-audit-database-grants.test.mjs:57`:
    `AssertionError: Must have zero ambiguous overloaded functions. Found: [{"count":2,"proname":"merchant_add_resource_leave"},{"count":2,"proname":"merchant_register_shop_for_user"}]`
  - `tests/unit/security-definer-grants-snapshot.test.mjs` tests 1 & 2 PASSED.
- **Reason for FAIL:**
  - Unresolved function overloads cause PostgREST ambiguity (`PGRST202`) when invoked from client SDKs.
- **Likely Fix:**
  - Add a migration that explicitly drops the obsolete function signatures (`DROP FUNCTION public.merchant_add_resource_leave(uuid, text, text, date, text);` and legacy `merchant_register_shop_for_user`) before defining the unified version.

---

### FLOW 5: Row Level Security (RLS) Coverage Matrix
- **ID:** FLOW-SEC-05
- **Name:** Row Level Security (RLS) Matrix & Multi-Tenant Separation
- **Actor:** Customer, Merchant, Front Desk, Consultant, Admin, Anonymous
- **Status:** PASS
- **Severity:** N/A (Verified)
- **Chain Traced:**
  - Client REST Request -> Supabase PostgREST -> PostgreSQL RLS Engine -> Role Policy Evaluation -> Data Filtered / Rejected
- **Checks at each link:**
  1. *RLS Enabled Check:* All 30 public tables have `relrowsecurity = true`. Zero tables have RLS disabled.
  2. *Overly Permissive Policies Check:* Scanned all 76 policies for `USING (true)`. Only 9 policies use `true`, and all 9 are restricted to `service_role` (for internal logging) or public read-only directory data (`categories`, `cities`, `sub_categories`, `resource_availability`, `resource_leaves`).
  3. *Payments Table Lockdown:* `payments` has only 1 policy: `SELECT` for authenticated users matching `booking.customer_id`, `provider.owner_id`, or platform admin. Direct client `INSERT`, `UPDATE`, and `DELETE` are completely absent, making `payments` immutable from the client REST API.
  4. *Hospital Staff Isolation:* `bookings` SELECT and UPDATE policies enforce that Front Desk staff can only access bookings for their assigned doctors (via `hospital_accessible_resource_ids_for_user(auth.uid())`) and Consultant doctors can only access their own appointments.
  5. *Test Suites:* `tests/unit/hospital-bookings-rls.test.mjs` (5/5 tests passed: Hospital Admin full access, Front Desk assigned doctor isolation, Consultant personal isolation, Customer cross-tenant block, Salon merchant isolation).
- **Evidence:**
  - Query of `pg_class` and `pg_policies` across all 30 public tables.
  - Test output from `tests/unit/hospital-bookings-rls.test.mjs`:
    ```
    ✔ 1. Hospital Admin can read and update all bookings in the hospital
    ✔ 2. Front Desk can read and update ONLY assigned doctor bookings
    ✔ 3. Consultant can read and update ONLY their own appointments
    ✔ 4. Customer can read their own bookings and cannot read others
    ✔ 5. Salon merchant can read and update salon bookings normally
    ```

---

### FLOW 6: Server-Side Role Enforcement (BOLA / BFLA Defense)
- **ID:** FLOW-SEC-06
- **Name:** API Authorization Guards, Role Separation & BOLA Defense
- **Actor:** Client HTTP Caller -> Next.js 15 App Router API
- **Status:** PASS
- **Severity:** N/A (Verified)
- **Chain Traced:**
  - HTTP Request -> `NextRequest` -> `verifyAuthenticatedUser` / `getAccessContext` -> Server-side Role & Tenant Validation -> Database Query / RPC
- **Checks at each link:**
  1. *Authentication Guards:* Audited all 38 route handlers under `apps/merchant-web/src/app/api/`. Every non-public route performs server-side JWT verification using `verifyAuthenticatedUser`, `verifyAdminRequest`, `verifyStaffManagerRequest`, or `getAccessContext`.
  2. *Zero Client-Side Trust:* No route trusts client-supplied headers or body claims for roles. Roles are fetched directly from `public.profiles` using the verified `auth.uid()`.
  3. *BOLA (Broken Object Level Authorization) Defense:*
     - Every booking action (`api/bookings/start`, `admit`, `end`, `cancel`, `checkin`, `collect-fee`, `emergency-choice`, `reorder`, `override`) calls `isCallerAuthorizedForBooking(caller.id, booking, allowCustomer)`.
     - Consultant consultation actions strictly set `allowCustomer = false`, returning HTTP 403 if a customer attempts to start or complete an appointment.
     - Cross-hospital modifications are blocked in `api/hospital/departments` (`requestedMerchantId !== ctx.merchantId` -> HTTP 403).
  4. *Sensitive Data Exposure (Ticket Endpoint):*
     - `apps/merchant-web/src/app/api/ticket/[id]/route.ts`: if the caller is not the booking owner or authorized staff, all patient PII (`name`, `phone`, `email`), hospital address, check-in PIN, and reference code are redacted to `null`.
     - Permanent check-in PIN is only revealed to the authenticated customer within 60 minutes of the slot start (`isWindowOpen`).
  5. *Webhook Cryptographic Verification:*
     - `api/webhooks/cashfree/route.ts` and `api/webhooks/razorpay/route.ts` verify HMAC-SHA256 signatures before processing order events, preventing forged payment confirmations.
- **Evidence:**
  - `apps/merchant-web/src/app/api/bookings/start/route.ts:43`:
    `const isAuthorized = await isCallerAuthorizedForBooking(caller.id, booking, false);`
  - `apps/merchant-web/src/app/api/ticket/[id]/route.ts:58-89`: Redacts all customer and provider PII when caller is unauthenticated or unauthorized.
  - `apps/merchant-web/src/app/api/hospital/departments/route.ts:65-71`: Cross-tenant hospital guard.

---

### FLOW 7: Hardcoded Secrets, Keys & Deployment Readiness
- **ID:** FLOW-SEC-07
- **Name:** Secret Scanning, Git Hygiene, and Production Boot Configuration
- **Actor:** CI/CD Runner / Production Server
- **Status:** FAIL
- **Severity:** Low
- **Chain Traced:**
  - Repository Files -> Gitleaks Scanner -> `apps/merchant-web/src/env.mjs` -> Server Boot
- **Checks at each link:**
  1. *Secret Leak Scan:*
     - Ran Gitleaks scanner across the repository: 28.09 MB scanned, 0 secrets leaked.
     - Audited `git ls-files`: only `.env.example` files are tracked; zero live `.env`, `.env.local`, or private credential files exist in git tracking.
  2. *Fail-Fast Production Boot Guard (`apps/merchant-web/src/env.mjs`):*
     - Rejects any environment variable containing placeholder patterns (`placeholder`, `CHANGE_ME`, `your-*-key`, `replace-me`, etc.).
     - Requires essential variables in production: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `ADMIN_SECRET`, `CRON_SECRET`, `DELETION_TOKEN_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
     - Strictly throws an error if `ALLOW_MOCK_PAYMENTS === 'true'` in production.
     - Rejects insecure `http://` URLs for Supabase or the public app URL.
     - Production bundle build verified: `npx next build` in `apps/merchant-web` compiled successfully across all 44 routes.
  3. *Configuration Drift Defect:*
     - The root `.env.example` file lacks definitions for Cashfree payment credentials (`PAYMENT_GATEWAY_PROVIDER`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV`). While `apps/merchant-web/.env.example` has them, a first-time developer or DevOps engineer setting up from the root `.env.example` would encounter missing variable errors in production.
- **Evidence:**
  - `tests/unit/git-secrets-and-ci-hygiene.test.mjs` PASSED (Gitleaks verified 0 leaks).
  - `tests/unit/security-audit-production-env.test.mjs` PASSED (6/6 assertions passed).
  - Comparison of `.env.example` (root) vs `apps/merchant-web/.env.example`.
- **Reason for FAIL:**
  - Root `.env.example` does not document Cashfree environment variables, causing deployment drift.
- **Likely Fix:**
  - Copy Cashfree variables from `apps/merchant-web/.env.example` into root `.env.example`.

---

## RLS TABLE AUDIT MATRIX

| Table Name | RLS Enabled? | Roles Covered | Policies Defined | Vulnerabilities Found | Status |
|---|---|---|---|---|---|
| `account_deletion_requests` | YES | `public` (authenticated) | Users see own deletion request (SELECT) | None (User scoped via `auth.uid() = user_id`) | PASS |
| `admin_audit_logs` | YES | `service_role`, `public` | Service role full access (ALL); Admins view logs (SELECT) | None (Admin scoped via `is_admin(auth.uid())`) | PASS |
| `app_logs` | YES | `service_role`, `authenticated` | Service role full access (ALL); Admins view logs (SELECT) | None (Admin scoped via `is_admin(auth.uid())`) | PASS |
| `appointment_checkin_codes` | YES | `authenticated` | customers_read_own_checkin_codes (SELECT) | None (Scoped to `customer_id = auth.uid()`) | PASS |
| `audit_logs` | YES | `authenticated`, `service_role` | insert_audit_logs (INSERT); owner_read_audit_logs (SELECT) | None (Merchant owner, hospital admin, or platform admin) | PASS |
| `bookings` | YES | `public`, `authenticated` | Customers create bookings (INSERT); bookings_select_policy (SELECT); bookings_update_policy (UPDATE) | None (Strict scoping: customer, provider owner, hospital admin, front desk assigned doctors; DB triggers block direct REST status/fee edits) | PASS |
| `categories` | YES | `public` | Categories readable by everyone (SELECT) | None (Public reference catalog data) | PASS |
| `cities` | YES | `anon`, `authenticated` | cities_select_anon (SELECT); cities_select_authenticated (SELECT); admin insert/update/delete | None (Public reference catalog data; mutations admin-only) | PASS |
| `city_settlements` | YES | `authenticated` | admin delete, insert, select, update | None (Admin only via `is_admin(auth.uid())`) | PASS |
| `city_waitlist` | YES | `anon`, `authenticated` | insert policy (anon/auth); select/update/delete (admin only) | None (Public waitlist submission; management admin-only) | PASS |
| `contact_reveal_audit` | YES | `authenticated` | contact_reveal_audit_select_policy (SELECT) | None (Admin or provider owner only) | PASS |
| `crash_alert_dedup` | YES | `service_role`, `authenticated` | Service role full access (ALL); Admin select | None (System telemetry dedup) | PASS |
| `department_members` | YES | `authenticated` | select, insert, update, delete | None (Scoped to hospital admin or self profile) | PASS |
| `departments` | YES | `authenticated` | select, insert, update, delete | None (Scoped to hospital admin or assigned department members) | PASS |
| `doctor_front_desk_assignments` | YES | `authenticated` | select, insert, update, delete | None (Scoped to hospital admin) | PASS |
| `merchant_memberships` | YES | `authenticated` | select, insert, update, delete | None (Scoped to provider owner, admin, or member self) | PASS |
| `notification_logs` | YES | `authenticated` | select, insert, update, delete | None (Scoped to recipient user or provider owner) | PASS |
| `payments` | YES | `public` (authenticated) | Users can read own payments (SELECT) | None (Read-only for users matching `booking.customer_id` or provider owner; direct REST writes completely disabled) | PASS |
| `platform_config` | YES | `public` | Read config (SELECT) | None (Public platform configuration; mutations blocked) | PASS |
| `profiles` | YES | `public`, `authenticated` | Users insert own profile (INSERT); users_read_own_profile (SELECT); users_update_own_profile (UPDATE) | None (Direct updates governed by `guard_profile_governance` trigger blocking role/pin/blocked escalations) | PASS |
| `providers` | YES | `anon`, `authenticated` | Anon select active providers; Auth select; Merchant update own provider | None (Direct updates governed by `guard_provider_governance` trigger blocking status/strikes/owner edits) | PASS |
| `push_tokens` | YES | `authenticated` | select, insert, update, delete | None (Strictly scoped to `user_id = auth.uid()`) | PASS |
| `resource_availability` | YES | `public` | Read availability (SELECT); Merchant insert/update/delete | None (Public slot reading; modifications scoped to resource owner) | PASS |
| `resource_leaves` | YES | `anon`, `authenticated` | Public read leaves (SELECT); Staff manage leaves (ALL) | None (Public read for slot calendars; edits scoped to doctor/merchant) | PASS |
| `resources` | YES | `anon`, `authenticated` | Anon read active resources; Auth read; Merchant/Admin insert/update/delete | None (Scoped to provider owner, hospital admin, or platform admin) | PASS |
| `staff_checkin_rate_limits` | YES | `anon`, `authenticated` | deny_all (ALL) | None (Explicit deny-all policy; accessible solely via `service_role`) | PASS |
| `sub_categories` | YES | `public` | Read subcategories (SELECT) | None (Public reference catalog data) | PASS |
| `test_provider_clock_links` | YES | `anon`, `authenticated` | deny_all (ALL) | None (Explicit deny-all policy; accessible solely via `service_role`) | PASS |
| `test_tenant_clocks` | YES | `anon`, `authenticated` | deny_all (ALL) | None (Explicit deny-all policy; accessible solely via `service_role`) | PASS |
| `user_consents` | YES | `public` (authenticated) | Users manage own consents (ALL) | None (Strictly scoped to `auth.uid() = user_id`) | PASS |

---

## Defects Summary

| Defect ID | Severity | File & Location | Description | Recommended Fix |
|---|---|---|---|---|
| DEF-W7-01 | **HIGH** | `supabase/migrations/20261114000002_forensic_hardening_and_cashfree_remediation.sql:68` | In `private.create_booking_hold`, the caller authorization guard executes: `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)`. `public.profiles` does not have an `is_admin` column; it has `role` (enum). Any hold created by a platform admin or authorized manager for a patient crashes with Postgres error `42703 (undefined_column)`. | Replace `is_admin = true` with `public.is_admin(auth.uid())` or `role = 'admin'`. |
| DEF-W7-02 | **HIGH** | `supabase/migrations/20261115000003_resolve_overloads_and_standby_linter.sql:388` | In `public.merchant_move_booking_to_standby`, the function executes: `UPDATE public.bookings SET queue_status = 'STANDBY' ...`. `public.bookings` relation has no column named `queue_status`. Invoking this RPC immediately crashes with Postgres error `42703`. | Remove `queue_status = 'STANDBY'` from the UPDATE query in `merchant_move_booking_to_standby`. |
| DEF-W7-03 | **MEDIUM** | `supabase/migrations/20261115000001_harden_security_definer_caller_checks.sql` | Migration created overloaded signatures for `merchant_add_resource_leave` and `merchant_register_shop_for_user` without dropping existing function signatures. Causes PostgREST ambiguity (`PGRST202`) and breaks `tests/unit/security-audit-database-grants.test.mjs`. | Add a migration to explicitly DROP the legacy function signatures before recreating the unified functions. |
| DEF-W7-04 | **LOW** | `.env.example` (root) | Root `.env.example` lacks Cashfree payment configuration variables (`PAYMENT_GATEWAY_PROVIDER`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV`), causing documentation and onboarding drift compared to `apps/merchant-web/.env.example`. | Sync Cashfree environment variables from `apps/merchant-web/.env.example` into root `.env.example`. |

---

## HANDOFF
- **W2 (Payments & Money Flows):** Verify that Cashfree webhook signature verification rejects replay attacks with identical timestamps and handles edge cases where order amounts contain paise decimals.
- **W3 (Hospital Operations & Queues):** Verify that frontend UI does not invoke `merchant_move_booking_to_standby` until DEF-W7-02 is patched in migrations.
- **W8 (Verification & Test Suite Lead):** Test `tests/unit/security-human-journey-bola.test.mjs` setup hook fails because it inserts into `resources` without an existing `provider` row; the test fixture needs a provider fixture before inserting resources.
