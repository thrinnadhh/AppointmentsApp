# QA Audit Report: W5 - Admin Portal & Multi-City Governance

- **Workstream:** W5 - Admin Portal & Multi-City Governance
- **Status:** COMPLETED
- **Started:** 2026-11-17T17:06:00+05:30
- **Finished:** 2026-11-17T17:15:00+05:30
- **Target Branch:** `refactor/arch-cleanup-and-security-hardening`
- **Output File:** `audit_reports/W5_admin.md`
- **Files & Areas Examined:**
  - `apps/merchant-web/src/app/admin/login/page.tsx` (Admin multi-stage authentication & TOTP MFA)
  - `apps/merchant-web/src/app/admin/page.tsx` (Multi-city expansion matrix, merchant triage, velocity KPIs)
  - `apps/merchant-web/src/app/admin/logs/page.tsx` (Dedicated observability, crash alert console, diagnostic drawer)
  - `apps/merchant-web/src/middleware.ts` (Edge route guards, public whitelist, admin redirect gate)
  - `apps/merchant-web/src/lib/auth-admin.ts` (`verifyAdminRequest`, `verifyStaffManagerRequest`, role check)
  - `apps/merchant-web/src/lib/supabase.ts` (Admin PostgREST calls & RPC helpers)
  - `apps/merchant-web/src/app/api/admin/doctor-assignments/route.ts` (Doctor-front desk staff assignment API)
  - `apps/merchant-web/src/app/api/admin/refunds/route.ts` (Admin manual refund queue reconciliation)
  - `apps/merchant-web/src/app/api/cities/waitlist/route.ts` (Public city waitlist registration API)
  - `apps/customer-mobile/src/services/api.ts` (Mobile city selector & waitlist integration)
  - `apps/customer-mobile/src/screens/HomeScreen.tsx` (Territory selection modal)
  - `packages/shared/src/logger.ts` (Sanitization, PII redaction, structured logging)
  - `supabase/migrations/` (Cities, admin audit logs, app logs, RPC functions, RLS policies)
  - `tests/unit/admin-city-matrix-transition.test.mjs`
  - `tests/scripts/test-admin-logs.mjs`
  - `tests/scripts/test-routes.mjs`
  - `tests/e2e/admin-auth-guard.spec.ts`
  - `tests/e2e/admin-city-control.spec.ts`
  - `tests/e2e/admin-merchant-integration.spec.ts`
  - `tests/e2e/admin-security-phases.spec.ts`
  - `tests/e2e/edge-admin.spec.ts`

---

## Executive Summary

The Admin Portal and Multi-City Governance subsystem provides platform oversight, territory gating, merchant pipeline triage, and real-time observability telemetry. Following the architectural cleanup in commit `f48a1fcc3827a40ad963aee0143a17d973d28a51` (PR #8), administrative operations are primarily mediated via direct Supabase PostgREST clients and hardened PostgreSQL `SECURITY DEFINER` functions with strict `public.is_admin(auth.uid())` authorization, eliminating legacy intermediate Next.js proxy endpoints (`/api/admin/analytics`, `/api/admin/cities`, `/api/admin/merchants`, `/api/admin/waitlist`, `/api/admin/app-logs`). The only server-side Next.js `/api/admin/*` routes retained are `/api/admin/doctor-assignments` and `/api/admin/refunds`.

### High-Level Verdicts:
1. **Admin Authentication & Authorization (Flow 1): PASS.** Robust multi-stage authentication (email/password -> GoTrue TOTP MFA -> AAL2 elevation), open-redirect defense, zero-trust edge route gating, and fail-closed RBAC rejecting non-admin roles (customers, merchants, consultants, anonymous) across web and API.
2. **City Expansion & Management (Flow 2): PARTIAL FAIL (High Severity on City Creation).** Territory launch status toggling (`ACTIVE` <-> `PAUSED`, `PLANNED` -> `EXPANDING` -> `ACTIVE`), status regression prevention, and waitlist deduplication pass end-to-end. However, direct city insertion via `handleCreateCity` in the Admin UI fails with `42501 permission denied` because SQL table-level `INSERT` privilege on `public.cities` was revoked from role `authenticated` in migration `20261107000005`. Furthermore, mobile customer reflection has up to a 30-minute latency due to an aggressive in-memory cache TTL in `apps/customer-mobile/src/services/api.ts`.
3. **Merchant Management (Flow 3): PARTIAL FAIL (Medium Severity on Rejection & Discovery Boost).** Merchant review, approval (`ACTIVE`), and suspension (`SUSPENDED`) update the database atomically and synchronize immediately to block merchant login/dashboard access and hide the provider from mobile discovery while preserving existing confirmed bookings. However, there is no "Reject" action in the Admin UI, and merchant shop placement controls / priority boosting in discovery are completely unimplemented.
4. **Per-City Analytics & Dashboard (Flow 4): PARTIAL FAIL (Medium Severity on Category Breakdown).** Real-time KPI aggregation (completed appointments, completion velocity, gross deposit volume, total bookings) operates cleanly per territory and dynamic time horizon (Today, 3D, 7D, 30D, All). However, per-city breakdown by vertical/category (Hospitals, Salons, Vets, Turfs, Restaurants) is not aggregated by the analytics RPC or displayed in the matrix.
5. **Issue / Problem Logs (Flow 5): PARTIAL FAIL (Low Severity on Resolution Workflow).** Automated client/server crash ingestion, PII sanitization, auto-elevation to `CRITICAL` severity, deduplication via fingerprint hashing, alert rate limiting, and 30-day sliding retention pruning work effectively. However, `app_logs` lacks an issue resolution workflow (no `status` or `is_resolved` column, no UI controls to acknowledge or resolve issues).
6. **Reports & Data Exports (Flow 6): FAIL (Medium Severity).** Generation and bulk downloading of CSV or JSON reports for transactions, appointments, or administrative audit logs are not implemented anywhere in the Admin Portal.

---

## Detailed Flow Audits

### Flow 1: Admin Authentication & Authorization
- **ID:** `FLOW-W5-01`
- **Name:** Super Admin Authentication, TOTP MFA, Edge RBAC, and Zero-Trust Protection
- **Actors:** Super Admin, Malicious Actor / Non-Admin (Customer, Merchant, Consultant, Anonymous)
- **Status:** **PASS**
- **Severity:** N/A (Verified Clean)

#### End-to-End Trace Chain:
1. **UI Action (`apps/merchant-web/src/app/admin/login/page.tsx:86-224`):**
   - User inputs email and master password at `/admin/login`.
   - Client checks input presence and validates `redirect` parameter against Open Redirect regex `SAFE_REDIRECT_REGEX = /^\/(?!\/)[a-zA-Z0-9\-_./?=&%]*$/` (`page.tsx:29-38`), rejecting absolute external domains or protocol-relative targets.
2. **Client Authentication (`apps/merchant-web/src/app/admin/login/page.tsx:99-157`):**
   - Invokes `supabase.auth.signInWithPassword({ email, password })`.
   - On successful credentials check, queries `/api/auth/me` with Bearer token (up to 3 retries) to fetch the user's profile from `public.profiles`.
   - Evaluates `profile.role === 'admin'`. If role is not `admin`, session is terminated immediately via `supabase.auth.signOut()` and throws `Access Denied: This account lacks Super Administrator privileges.`.
3. **MFA Stage 2 Evaluation (`apps/merchant-web/src/app/admin/login/page.tsx:160-248`):**
   - Calls `supabase.auth.mfa.listFactors()`.
   - If verified TOTP factor exists: calls `supabase.auth.mfa.challenge({ factorId })` and transitions state machine to `MFA_CHALLENGE`. Form prompts for 6-digit TOTP code.
   - If unverified / first-time: unenrolls stale factors and calls `supabase.auth.mfa.enroll({ factorType: 'totp' })`. Form transitions to `MFA_ENROLL`, displaying SVG QR code and secret key.
   - User submits 6-digit TOTP code -> calls `supabase.auth.mfa.verify()` or `challengeAndVerify()`. Session is elevated to Authenticator Assurance Level 2 (AAL2).
   - Router redirects to safe URL (`/admin`).
4. **Server-Side Route Gates (`apps/merchant-web/src/middleware.ts:271-277`):**
   - Edge Middleware checks `isAdminRoute = pathname.startsWith('/admin') && pathname !== '/admin/login'`.
   - If visitor lacks valid session cookies, Bearer token, or valid non-production E2E bypass, middleware redirects immediately to `/admin/login?redirect=${pathname}`.
   - Verified in test: `tests/e2e/admin-auth-guard.spec.ts:10-21` (TC-ADMIN-AUTH-01).
5. **In-Page Component Guard (`apps/merchant-web/src/app/admin/page.tsx:187-266` & `logs/page.tsx:66-127`):**
   - On mount, fetches caller profile via `admin_get_caller_profile` RPC or `/api/auth/me`.
   - If profile role is not `admin`, halts data retrieval and renders a hard `403 Access Denied` UI barrier prohibiting dashboard viewing.
   - Verified in test: `tests/e2e/admin-auth-guard.spec.ts:23-42` (TC-ADMIN-AUTH-02).
6. **API Route Protection (`apps/merchant-web/src/lib/auth-admin.ts:482-576`):**
   - `verifyAdminRequest(request)` extracts JWT from Bearer header or SSR cookies.
   - Verifies user in `profiles` table: if `profile.role !== 'admin'`, returns `{ error: 'Forbidden: Super Administrator authority required. Access denied.', status: 403 }`.
   - Explicitly rejects test customer headers (`isTestCustomer === true`) with 403.
   - Non-production E2E bypass requires `ENABLE_E2E_BYPASS=true` and a strong >=24 character non-committed secret (`isE2EBypassEnabled()`).
   - Verified in tests:
     - `tests/scripts/test-routes.mjs:650-674` (Tests 6.1-6.4: Unauthenticated 401, Customer 403, Merchant 403, Super Admin 200).
     - `tests/unit/cross-tenant-authorization-matrix.test.mjs:1810-1845` (Test 37: `/api/admin/doctor-assignments` & `/api/admin/refunds` reject Customer with 403, wrong-role with 403, allow Superadmin with 200).
7. **Database Authorization (RLS & RPC Grants):**
   - Direct database RPCs (`get_admin_city_stats`, `get_admin_velocity_analytics`, `update_city_status`, `admin_fetch_merchants`, `admin_update_merchant_status`, `get_admin_audit_logs`, `purge_old_app_logs`) declare `SECURITY DEFINER` and execute:
     ```sql
     IF auth.role() != 'service_role' AND NOT public.is_admin(auth.uid()) THEN
         RAISE EXCEPTION 'Access Denied: Administrator authority required' USING ERRCODE = '42501';
     END IF;
     ```
   - RLS on `admin_audit_logs` and `app_logs` restricts `SELECT` strictly to `public.is_admin(auth.uid())`.

#### Evidence:
- `apps/merchant-web/src/app/admin/login/page.tsx:26-38, 99-157, 160-248`
- `apps/merchant-web/src/middleware.ts:245-250, 271-277`
- `apps/merchant-web/src/app/admin/page.tsx:187-266, 617-646`
- `apps/merchant-web/src/lib/auth-admin.ts:482-576`
- `tests/e2e/admin-auth-guard.spec.ts:10-82, 154-250`
- `tests/scripts/test-routes.mjs:650-674` (4/4 tests pass)
- `tests/unit/cross-tenant-authorization-matrix.test.mjs:1810-1845` (Test 37 passes)

---

### Flow 2: City Expansion & Management
- **ID:** `FLOW-W5-02`
- **Name:** Territory Launch Matrix, Activation Toggles, Mobile Reflection, and Waitlist
- **Actors:** Super Admin, Customer Mobile App
- **Status:** **PARTIAL FAIL**
- **Severity:** **High** (City Creation Fails due to Missing SQL Privilege; Medium Latency on Customer Reflection)

#### End-to-End Trace Chain:
1. **Adding a New City (Admin UI Modal -> DB Insert):**
   - Admin clicks "Expand New City" at `apps/merchant-web/src/app/admin/page.tsx:774-780`.
   - Modal renders (`page.tsx:1788-1910`): inputs city slug, name, coordinates (lat/lng), radius (km), merchant target quota, and initial status (`EXPANDING` | `PLANNED` | `ACTIVE`).
   - `handleCreateCity` (`page.tsx:420-454`) calls `supabase.from('cities').insert(...)` using the browser Supabase client.
   - **DEFECT (High Severity):** While RLS policy `cities_admin_insert` (`supabase/migrations/20261108000001_perf_consolidate_cities_and_profiles.sql:64`) checks `(SELECT is_admin())`, the Postgres table-level `INSERT` privilege on `public.cities` was revoked from `authenticated` in migration `20260924000003:1127` (`REVOKE INSERT, UPDATE, DELETE ON public.cities FROM authenticated;`), and subsequent grant migration `20261107000005:138` granted only `SELECT` (`GRANT SELECT ON TABLE public.cities TO anon, authenticated, service_role;`). The legacy route `/api/admin/cities` was purged in PR #8. Consequently, direct client insertions by an authenticated admin fail with PostgreSQL error:
     `42501 permission denied for table cities`.
   - **Likely Fix:** Create a `SECURITY DEFINER` function `public.admin_create_city(...)` that validates `is_admin(auth.uid())` and inserts into `public.cities` with immutable `search_path`, or execute `GRANT INSERT ON TABLE public.cities TO authenticated;` with RLS `WITH CHECK (is_admin())`.
2. **City Launch Status Toggle (`apps/merchant-web/src/app/admin/page.tsx:367-393`):**
   - Admin clicks `Launch Active`, `Start Expansion`, `Pause`, or `Resume` in the Territory Control Matrix (`page.tsx:1079-1123`).
   - `handleUpdateCityStatus` optimistically updates local UI state.
   - Calls `updateAdminCityStatus(cityId, newStatus)` in `apps/merchant-web/src/lib/supabase.ts:1034-1056`.
   - Invokes `update_city_status` RPC (`supabase/migrations/20260913000001:160-220` & `20261027180000:99`).
   - RPC validates `public.is_admin()`, updates `public.cities.status = p_status`, and appends an immutable audit entry to `admin_audit_logs` via `public.log_admin_action('UPDATE_CITY_STATUS', 'city', p_city_id, ...)`.
   - Anti-regression: Illegal status regressions (e.g. regressing `ACTIVE` back to `PLANNED`) are rejected by database RPC `update_city_expansion_status` (`tests/e2e/edge-admin.spec.ts:32-50`, EC-ADMIN-01).
   - Verified in test: `tests/unit/admin-city-matrix-transition.test.mjs:6-34` (optimistic update & array guard pass).
3. **Customer App Reflection (`apps/customer-mobile/src/services/api.ts:1490-1541`):**
   - Customer mobile app loads territories via `fetchActiveCities(includeExpanding)`.
   - Queries `supabase.rpc('get_active_cities', { p_include_expanding: true })` (`supabase/migrations/20261107000008:68-71`).
   - **DEFECT / Latency Hazard (Medium Severity):** `fetchActiveCities` implements an in-memory cache:
     ```ts
     const CITIES_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes (api.ts:95)
     if (activeCitiesCache && Date.now() - activeCitiesCache.timestamp < CITIES_CACHE_TTL_MS && activeCitiesCache.data.length > 0) {
       return activeCitiesCache.data;
     }
     ```
     Because there is no Supabase Realtime subscription on `public.cities` and no pull-to-refresh cache purge in `HomeScreen.tsx`, a newly launched city does **not** appear immediately for customers with an active running app session; it only updates after 30 minutes or upon killing and restarting the app.
   - **Likely Fix:** Lower `CITIES_CACHE_TTL_MS` to 60 seconds (or invalidate cache whenever the user pulls to refresh or opens the territory selector modal).
4. **City Waitlist Handling (`apps/merchant-web/src/app/api/cities/waitlist/route.ts:1-132`):**
   - Inbound waitlist registration via `POST /api/cities/waitlist`.
   - Rate limiting: Max 10 requests/hr per IP (`checkRateLimit`), max 3 registrations/24h per phone.
   - Strict phone parsing & E.164 normalization via `libphonenumber-js`.
   - Invokes `submit_city_waitlist` RPC: checks if the phone is already registered for that city; if duplicate, returns HTTP 200 with `{ duplicate: true, already_registered: true }` without inserting redundant rows (`tests/e2e/edge-admin.spec.ts:232-254`, EC-ADMIN-08).
   - Admin UI (`apps/merchant-web/src/app/admin/page.tsx:1335-1447`) fetches waitlist leads via `fetchAdminCityWaitlist()` -> `admin_fetch_city_waitlist` RPC, showing demand pills ("Nellore: 12") and role filters (`all`, `customer`, `merchant`).
   - Verified in test: `tests/e2e/admin-city-control.spec.ts:121-170` (Features 4 & 5).

#### Evidence:
- `apps/merchant-web/src/app/admin/page.tsx:367-393, 420-454, 1079-1123, 1788-1910`
- `apps/merchant-web/src/app/api/cities/waitlist/route.ts:1-132`
- `apps/customer-mobile/src/services/api.ts:95, 1490-1541`
- `supabase/migrations/20261108000001_perf_consolidate_cities_and_profiles.sql:48-83`
- `supabase/migrations/20261107000005_supabase_security_advisor_remediation.sql:138`
- `tests/unit/admin-city-matrix-transition.test.mjs:1-34`
- `tests/e2e/admin-city-control.spec.ts:67-96`
- `tests/e2e/edge-admin.spec.ts:32-50, 232-254`

---

### Flow 3: Merchant Management
- **ID:** `FLOW-W5-03`
- **Name:** Merchant Onboarding Triage, Status Gating, and Discovery Placement
- **Actors:** Super Admin, Merchant, Customer
- **Status:** **PARTIAL FAIL**
- **Severity:** **Medium** (Missing Rejection action; Missing Placement & Priority Boosting controls)

#### End-to-End Trace Chain:
1. **Review Pending Registrations (`apps/merchant-web/src/app/admin/page.tsx:1132-1333`):**
   - Admin navigates to Section 2: "Merchant Onboarding Pipeline & Business Governance".
   - Status sub-tabs filter by `all`, `active` (`ACTIVE`), `pending` (`PENDING_APPROVAL`), and `suspended` (`SUSPENDED`).
   - Filter controls: real-time search (matches business name, owner phone, email, category), vertical category dropdown (`admin-merchant-type-filter`), and city dropdown (`admin-merchant-city-filter`).
   - Table columns display business name, contact info, vertical badge, city territory, bookable resources count, and status badge.
2. **Approval & Suspension Actions (`apps/merchant-web/src/app/admin/page.tsx:1296-1326`):**
   - Pending merchants (`PENDING_APPROVAL`): Displays `Approve & Launch` button -> calls `handleUpdateMerchantStatus(merchant.id, 'ACTIVE')`.
   - Active merchants (`ACTIVE`): Displays `Block Merchant` button -> calls `handleUpdateMerchantStatus(merchant.id, 'SUSPENDED')`.
   - Suspended merchants (`SUSPENDED`): Displays `Unblock Merchant` button -> calls `handleUpdateMerchantStatus(merchant.id, 'ACTIVE')`.
   - Mutation helper `updateAdminMerchantStatus(providerId, newStatus)` (`apps/merchant-web/src/lib/supabase.ts:1097-1145`):
     - Calls `admin_update_merchant_status` RPC or updates `providers.status = newStatus, updated_at = now()`.
     - Automatically logs an immutable audit trail entry via `public.log_admin_action('UPDATE_MERCHANT_STATUS', 'provider', providerId, ...)`.
   - **DEFECT (Medium Severity - Missing Rejection Action):** While `provider_status` enum supports `'REJECTED'`, the Admin UI does not provide a "Reject" button or rejection reason workflow; admins can only leave merchants in `PENDING_APPROVAL` or set them to `SUSPENDED`.
3. **Immediate Access Gating Verification:**
   - **Merchant Web Impact:** When a merchant is set to `SUSPENDED`, accessing the Merchant Web app displays the full-width alert:
     `Account Suspended & Blocked by Platform Administration. Bookings Paused.` (`SuspendedBanner.tsx`).
     Verified in Playwright test `tests/e2e/admin-merchant-integration.spec.ts:76-128` (TC-ADMIN-MERCHANT-02).
   - **Customer Discovery Impact:** In `apps/customer-mobile/src/services/api.ts`, provider queries filter on `status = 'ACTIVE'` and `is_active = true`. Suspended shops are immediately purged from customer browse and category search.
     Verified in Playwright test `tests/e2e/admin-merchant-integration.spec.ts:130-174` (TC-ADMIN-MERCHANT-03).
   - **Booking Lock Impact:** Inside `private.create_booking_hold` (`supabase/migrations/20261113000001`), database constraints check `providers.is_active` and `providers.status = 'ACTIVE'`, blocking any new booking holds.
   - **Existing Bookings Preservation:** In `tests/e2e/edge-admin.spec.ts:53-122` (EC-ADMIN-02), existing `CONFIRMED` appointments for a suspended merchant remain valid and are not automatically cancelled.
4. **Merchant Shop Placement Controls & Priority Boosting:**
   - **DEFECT (Medium Severity - Not Implemented):** Mentioned in PRD and REPO_MAP (`REPO_MAP.md:79, 112`), but there are no placement score controls, priority boosting toggles, or featured ranking options in `apps/merchant-web/src/app/admin/page.tsx`. The database table `public.providers` contains no `placement_score`, `priority_boost`, or `featured_rank` columns.
   - **Likely Fix:** Add an integer column `placement_score INT DEFAULT 0` to `public.providers` with an index, and add an admin score input in the merchant table row.

#### Evidence:
- `apps/merchant-web/src/app/admin/page.tsx:395-417, 1132-1333`
- `apps/merchant-web/src/lib/supabase.ts:1061-1145`
- `supabase/migrations/20260924000003_remediation_fixes_and_grants.sql:933-979, 1027-1050`
- `tests/e2e/admin-merchant-integration.spec.ts:29-174` (TC-ADMIN-MERCHANT-01, 02, 03 pass)
- `tests/e2e/edge-admin.spec.ts:53-122, 203-212` (EC-ADMIN-02, EC-ADMIN-06 pass)

---

### Flow 4: Per-City Analytics & Dashboard
- **ID:** `FLOW-W5-04`
- **Name:** Multi-City Territory Performance, Velocity Horizon Switching, and Revenue Metrics
- **Actors:** Super Admin
- **Status:** **PARTIAL FAIL**
- **Severity:** **Medium** (Per-City Category Breakdown Missing)

#### End-to-End Trace Chain:
1. **Analytics Data Ingestion & Parallel Fetch (`apps/merchant-web/src/app/admin/page.tsx:156-184`):**
   - Admin selects time horizon (`today`, `3days`, `7days`, `30days`, `all`) and territory scope (`all` or specific `city_id`).
   - `loadDashboardData` executes parallel queries:
     - `fetchAdminCityStats()` -> `get_admin_city_stats` RPC (`supabase/migrations/20260924000003:791-843`).
     - `fetchAdminVelocity(selectedWindow, cityId)` -> `get_admin_velocity_analytics` RPC (`20260924000003:848-925`).
   - Note: The legacy proxy endpoint `/api/admin/analytics` was purged in PR #8; queries execute directly against Postgres via PostgREST.
2. **KPI Calculations (`apps/merchant-web/src/app/admin/page.tsx:649-664, 850-973`):**
   - **Card 1 (Completed Bookings & Completion Velocity):**
     `completedBookingsAll` = `velocity?.completed_bookings ?? cities.reduce((acc, c) => acc + (c.completed_bookings || 0), 0)`.
     `totalBookingsAll` = `velocity?.total_bookings ?? cities.reduce((acc, c) => acc + (c.total_bookings || 0), 0)`.
     `completionPercentage` = `Math.round((completedBookingsAll / totalBookingsAll) * 100)`.
   - **Card 2 (Merchant Pipeline Funnel):**
     `activeMerchantsCount` = count where `status === 'ACTIVE'`.
     `pendingMerchantsCount` = count where `status === 'PENDING_APPROVAL'`.
   - **Card 3 (Rollout Coverage):**
     `activeCitiesCount`, `expandingCitiesCount`, `plannedCitiesCount`.
   - **Card 4 (Gross Deposit Volume):**
     `totalDepositAmount` = `velocity?.gross_deposit_amount ?? cities.reduce((acc, c) => acc + (c.deposit_volume || 0), 0)`.
     Formatted via `₹{Number(totalDepositAmount || 0).toLocaleString('en-IN')}`.
     In database RPC `get_admin_city_stats`, deposit volume is strictly computed from captured or forfeited funds:
     `COALESCE(SUM(b.deposit_amount) FILTER (WHERE b.payment_status IN ('CAPTURED', 'FORFEITED')), 0)::NUMERIC`.
   - **Card 5 (Expansion Waitlist Signals):**
     `waitlist.length` inbound expressions of demand.
3. **Shop Count Breakdown by Vertical/Category (Hospitals, Salons, Vets, Turfs, Restaurants):**
   - **DEFECT (Medium Severity - Partial Implementation):**
     - The database function `get_admin_city_stats()` aggregates:
       `onboarded_merchants`, `in_progress_merchants`, `suspended_merchants`, `total_resources`, `total_bookings`, `completed_bookings`, `deposit_volume`, `waitlist_count`.
     - It does **not** group by vertical category.
     - The Territory Control Matrix displays only overall active merchants vs `merchant_target` quota.
     - While the merchant list in Section 2 allows filtering by vertical category dropdown (`admin-merchant-type-filter`), an aggregated matrix or chart displaying shop counts per vertical per city (e.g. Tirupati: 10 Hospitals, 4 Salons, 2 Vets; Nellore: 5 Hospitals, 3 Salons) is not implemented in the analytics backend or UI.
   - **Likely Fix:** Update `get_admin_city_stats` or `get_admin_velocity_analytics` to return a `category_breakdown` JSON object (`{ "Hospitals": 10, "Salons": 4, ... }`) by joining `public.categories`.

#### Evidence:
- `apps/merchant-web/src/app/admin/page.tsx:79-85, 156-184, 649-664, 848-973, 1001-1130`
- `apps/merchant-web/src/lib/supabase.ts:980-1029`
- `supabase/migrations/20260924000003_remediation_fixes_and_grants.sql:791-925`
- `tests/e2e/admin-city-control.spec.ts:28-65` (Feature 1 passes)

---

### Flow 5: Issue / Problem Logs
- **ID:** `FLOW-W5-05`
- **Name:** Application Observability, Crash Telemetry, Deduplication, and Alerting Console
- **Actors:** Super Admin, Mobile & Web Clients, System Background Workers
- **Status:** **PARTIAL FAIL**
- **Severity:** **Low** (Issue Resolution Workflow Missing on Logs Table)

#### End-to-End Trace Chain:
1. **Issue Log Ingestion & PII Sanitization (`packages/shared/src/logger.ts` & `supabase/migrations/`):**
   - Errors captured across Mobile (`ErrorBoundary.tsx`, `services/logger.ts`) and Web (`apps/merchant-web/src/lib/logger.ts`).
   - `sanitizeLogData()` redacts passwords, Bearer/JWT tokens, API keys, and masks Indian mobile phone numbers (`+91 94401 *****`).
   - Flushed to PostgreSQL via SECURITY DEFINER RPC `log_client_event` (`supabase/migrations/20261021000001:95-274`).
   - Automatically parses severity (`DEBUG`, `INFO`, `WARN`, `ERROR`, `CRITICAL`), category (`AUTH`, `BOOKING`, `PAYMENT`, `HOSPITAL_QUEUE`, `NOTIFICATION`, `DATABASE`, `NETWORK`, `UI_CRASH`, `SECURITY`, `OTHER`), and source (`customer-mobile`, `merchant-web`, `admin-web`, `edge-function`, `database`).
   - Auto-elevation: messages containing crash keywords (`CRASH`, `FATAL`, `PAYMENT_FAILURE`, `SECURITY_BREACH`, etc.) are automatically elevated to `CRITICAL`.
   - Deduplication: updates `public.crash_alert_dedup` table, tracking `occurrence_count` and throttling alert notifications (minimum 15-minute quiet window per fingerprint).
   - Critical Alert Dispatch: edge function `supabase/functions/crash-alert` dispatches alert notification for `CRITICAL` events.
   - Verified in test: `tests/scripts/test-admin-logs.mjs:1-110` (Tests 1-5 pass 100%).
2. **Observability UI & Diagnostic Console:**
   - **Embedded Dashboard Snippet (`apps/merchant-web/src/app/admin/page.tsx:1590-1785`):** Displays health status badge, total records, platform breakdown (Mobile, Web, API), and latest 3 events with deep-links.
   - **Dedicated Observability Console (`apps/merchant-web/src/app/admin/logs/page.tsx:1-795`):**
     - Full filter bar: Severity, Category, Source, Date Range (`today`, `24h`, `7d`, `30d`, `all`), and keyword search.
     - Live Auto-Sync: toggles 8-second polling interval.
     - Expandable diagnostic drawer displaying Stack Trace, Business Context (role, city, vertical, appointment_id), Environment & Build, Session & Identity, and Sanitized Metadata with "Copy JSON".
     - Action buttons: "Test CRITICAL Alert" (dispatches manual test event via `log_client_event`), "Refresh", and "Prune Expired" (invokes `purge_old_app_logs` RPC).
     - Verified in test: `tests/scripts/test-admin-logs.mjs:103-107` (asserts purged proxy route in favor of direct Supabase RPC).
3. **Resolution Workflow & User Problem Reports:**
   - **DEFECT (Low Severity - Missing Resolution State):**
     - The `public.app_logs` table schema contains no resolution tracking columns (no `is_resolved`, `resolved_by`, `resolution_notes`, or `resolved_at`).
     - In `apps/merchant-web/src/app/admin/logs/page.tsx`, there are no controls to mark an issue as "Acknowledged", "Assigned", or "Resolved".
     - The only available state management is bulk purging (`purge_old_app_logs`), which permanently deletes logs older than the retention period.
     - There is no user-facing ticketing or problem report submission feature in `customer-mobile`.
   - **Likely Fix:** Add `is_resolved BOOLEAN DEFAULT FALSE` and `resolved_at TIMESTAMPTZ` to `public.app_logs`, and add a "Resolve" CTA in the diagnostic inspection drawer.

#### Evidence:
- `apps/merchant-web/src/app/admin/logs/page.tsx:1-795`
- `apps/merchant-web/src/app/admin/page.tsx:1590-1785`
- `packages/shared/src/logger.ts:1-150`
- `supabase/migrations/20261009000001_create_app_logs_and_admin_security.sql:1-165`
- `supabase/migrations/20261021000001_classify_app_logs_and_alerts.sql:1-302`
- `tests/scripts/test-admin-logs.mjs:1-110` (All 5 test suites pass)

---

### Flow 6: Reports & Data Exports
- **ID:** `FLOW-W5-06`
- **Name:** Administrative Bulk Reports & CSV/JSON Data Exports
- **Actors:** Super Admin
- **Status:** **FAIL**
- **Severity:** **Medium** (Missing Administrative Feature)

#### End-to-End Trace Chain:
1. **Audit Scope:**
   - Generation and download of CSV/JSON reports for transactions, appointments, merchants, and audit trails.
2. **Current Codebase Inspection:**
   - `apps/merchant-web/src/app/admin/page.tsx`:
     - Contains NO export buttons or report download controls for territory statistics, merchant funnels, waitlists, or transaction volume.
   - `apps/merchant-web/src/app/admin/logs/page.tsx`:
     - Contains only an inline "Copy JSON" button inside the diagnostic drawer for a single log entry (`copyToClipboard(JSON.stringify(log, null, 2))`).
     - Contains NO bulk export or CSV download feature for crash logs or telemetry metrics.
   - `apps/merchant-web/src/app/api/account/export/route.ts`:
     - Only implements individual customer DPDP Act data subject access requests for single authenticated users (`data-principal-archive-{id}.json`). It does not support administrative platform-wide exports.
   - Backend APIs:
     - No `/api/admin/reports/*` or `/api/admin/export/*` endpoints exist.
     - No database RPC exists to format and stream CSV/JSON reports for platform appointments, transactions, or audit logs.
3. **Verdict:**
   - **FAIL ("Not Implemented").** The platform lacks administrative CSV/JSON report generation and data download capabilities.
4. **Likely Fix:**
   - In `apps/merchant-web/src/app/admin/page.tsx`, add an "Export Report" dropdown offering CSV/JSON downloads for (1) City Expansion Summary, (2) Merchant Directory & Status, and (3) Audit Trail Ledger. Implement client-side CSV serialization (`new Blob([csvContent], { type: 'text/csv' })`) or create a protected endpoint `/api/admin/reports/export`.

#### Evidence:
- `apps/merchant-web/src/app/admin/page.tsx` (absence of export triggers)
- `apps/merchant-web/src/app/admin/logs/page.tsx:700-722` (single copy button only)
- `apps/merchant-web/src/app/api/account/export/route.ts:62-112` (customer-only scope)

---

## Scope Handoffs

During the W5 workstream audit, the following findings outside the Admin scope were identified:
- **HANDOFF [W1 - Customer Booking & Discovery]:** `fetchActiveCities` in `apps/customer-mobile/src/services/api.ts:95, 1491` enforces a 30-minute in-memory cache TTL (`CITIES_CACHE_TTL_MS = 30 * 60 * 1000`) without pull-to-refresh cache invalidation, preventing newly activated cities from appearing immediately in active customer mobile sessions.
- **HANDOFF [W7 - Database & Security Architecture]:** Migration `20261108000001_perf_consolidate_cities_and_profiles.sql:64` added RLS policy `cities_admin_insert` on `public.cities` for role `authenticated`, but migration `20261107000005:138` granted only `SELECT` to `authenticated`, causing direct client `supabase.from('cities').insert(...)` to fail with `42501 permission denied`.
- **HANDOFF [W3 - Merchant Setup & Team Access]:** Merchant Web `apps/merchant-web/src/app/team/page.tsx` relies on `/api/admin/doctor-assignments` for Front Desk to Doctor mappings; however, non-admin hospital administrators access this route via `verifyStaffManagerRequest`, which is correctly scoped but titled under `/api/admin/`.
