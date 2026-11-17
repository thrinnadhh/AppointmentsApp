# Defensive Security Audit & Hardening Loop Closure Report

**Repository:** `Appointments` (`apps/merchant-web`, `apps/customer-mobile`, `packages/shared`, `supabase/`)  
**Target Architecture:** Tirupati Hyperlocal Multi-Tenant Healthcare & Booking Platform  
**Branch:** `fix/security-loop-closure` (created from `HEAD` `phase-security-hardening-bola` + Phase 12 Sentry telemetry commit `211d438`)  
**Evaluation Date:** 2026-11-18  
**Verification Framework:** Multi-Agent Swarm (Discovery Waves 1–3, Gates A, B, and C)  
**Overall Verdict:** **PASSED (100% Green, 0 Regressions, Closed Loop)**

---

## 1. Findings Ledger

The discovery wave (5 parallel audit agents across Database, API, Business Rules, Clients, and Configuration) surfaced 34 total findings. Per Safety Rule 7, only **CONFIRMED CRITICAL** and **CONFIRMED HIGH** findings were fixed automatically in Wave 2. All **MEDIUM** and **LOW** findings are documented below with suggested remediation designs.

### A. Confirmed Critical & High Findings (Remediated)

| Finding ID | Severity | Status | Surface | Vector / Vulnerability | Location | Root Cause & Remediation Summary |
|:---|:---|:---|:---|:---|:---|:---|
| **DB-01** | CRITICAL | CONFIRMED | Database | Caller Auth Bypass in `SECURITY DEFINER` RPCs | `private.reassign_booking_resource`, `private.reschedule_booking_slot`, `public.dispatch_booking_notification` | Used `CURRENT_USER = 'postgres'` which always evaluated to TRUE in `SECURITY DEFINER` procedures, allowing any authenticated caller without a sub-claim to bypass checks. Fixed by enforcing explicit `(SELECT auth.uid())` and `auth.role() = 'service_role'`. |
| **DB-02** | CRITICAL | CONFIRMED | Database | PL/pgSQL Runtime Syntax Crash | `private.create_booking_hold:43` | Evaluated non-existent column `profiles.is_admin = true` causing SQLSTATE 42703. Fixed by validating via `public.is_admin(auth.uid())` and `profiles.role = 'admin'`. |
| **DB-03** | CRITICAL | CONFIRMED | Database | Search Directory Runtime Failure | `private.search_directory`, `private.search_directory_public` | Invoked `word_similarity` without schema qualification under `SET search_path TO ''`, throwing SQLSTATE 42883. Fixed by schema-qualifying `extensions.word_similarity`. |
| **DB-04** | HIGH | CONFIRMED | Database | Dead Security Guards in Admin Functions | `public.mask_old_notification_logs`, `public.get_vault_secret_by_name`, `public.advance_test_clock`, etc. | Conditions like `current_user != 'postgres'` were dead code inside `SECURITY DEFINER`. Fixed by evaluating `auth.role() = 'service_role'` or `public.is_admin(auth.uid())`. |
| **DB-05** | HIGH | CONFIRMED | Database | Public Execute on Private Procedures | `private.submit_city_waitlist`, `private.log_client_event`, etc. | Direct `EXECUTE` granted to role `anon`. Fixed by revoking `EXECUTE` from `anon` on `private.*` and routing through rate-limited public wrappers. |
| **DB-06** | HIGH | CONFIRMED | Database | Broken Storage Policies & Public Bucket Bypass | `storage.objects` (`venue-assets`, `prescriptions`) | Evaluated `storage.foldername(p.name)` on provider table which returned NULL, blocking merchants while open uploads allowed arbitrary files in `common/*`. Fixed by evaluating `storage.foldername(objects.name)` and scoping prescriptions. |
| **DB-07** | HIGH | CONFIRMED | Database | Missing Realtime Replica Identity Full | `public.bookings`, `public.payments` | Default replica identity omitted un-updated columns in CDC WAL logs, dropping Realtime RLS updates. Fixed by setting `REPLICA IDENTITY FULL`. |
| **BIZ-01** | CRITICAL | CONFIRMED | Business / DB | Double-Booking Predicate Exclusion Gap | `public.bookings` (constraint `no_overlapping_active_bookings`) | GiST exclusion filter omitted `WAITING` and `UP_NEXT` queue states, allowing concurrent bookings for same doctor slot. Fixed by adding `WAITING` and `UP_NEXT` to exclusion predicate and hold queries. |
| **BIZ-02** | CRITICAL | CONFIRMED | Business / DB | Unprotected RPC & Auto-Refund 500 Crash | `public.reclaim_expired_hold_or_refund` | Granted to `authenticated` without role check; conflict check omitted `CHECKED_IN`, triggering unhandled 23P01 crash that aborted customer refunds. Fixed by restricting to `service_role` and catching `exclusion_violation` cleanly. |
| **BIZ-03** | HIGH | CONFIRMED | Business / DB | Premature No-Show Marking | `private.record_no_show:56` | Check `v_booking.slot_start > NOW() + 30m` allowed staff to mark patients as no-show 20m before appointment start. Fixed by requiring `NOW() >= v_booking.slot_start + INTERVAL '10 minutes'`. |
| **BIZ-04** | HIGH | CONFIRMED | Business / DB | Negative Platform Escrow Drainage | `private.record_no_show:111` | Credited ₹50 to provider when only ₹10 deposit was collected upfront, draining ₹40 platform escrow out-of-pocket. Fixed by capping credit to `LEAST(50.00, GREATEST(0.00, v_deposit))`. |
| **API-01** | CRITICAL | CONFIRMED | API | BOLA / IDOR Medical Prescription Access | `apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts` | Endpoint verified booking ownership but accepted arbitrary `storagePath` parameters, enabling patients to generate signed URLs for other patients' medical files. Fixed by enforcing path prefix match against authorized booking. |
| **API-02** / **BIZ-05** | HIGH | CONFIRMED | API | Unauthenticated PII & Check-in PIN Harvest | `apps/merchant-web/src/app/api/ticket/[id]/route.ts` | Matching 4 phone digits granted full ownership access with zero rate limits, leaking full phone, email, clinical notes, and check-in PIN. Fixed by masking PII, nullifying check-in PIN and clinical notes, and returning 403 on mismatch. |
| **API-04** | HIGH | CONFIRMED | API | Missing Admin MFA (AAL2) Enforcement | `apps/merchant-web/src/lib/auth-admin.ts` | Admin mutations only checked database role `'admin'`, never checking Authenticator Assurance Level 2 (TOTP). Fixed by requiring AAL2 on all non-GET administrative mutations. |
| **CLIENT-01** | HIGH | CONFIRMED | Client | Permissive CSP & Missing Clickjacking Guards | `apps/merchant-web/next.config.mjs` | CSP lacked `frame-ancestors 'none'`, used wildcard Supabase domains in `connect-src`, and lacked `Permissions-Policy`. Fixed by adding strict CSP directives and DENY headers. |
| **CLIENT-02** | CRITICAL | CONFIRMED | Client | SVG Injection & Mock TOTP Production Bypass | `apps/merchant-web/src/app/admin/login/page.tsx` | Admin login rendered unsanitized SVG via `dangerouslySetInnerHTML` and accepted mock factor codes in production. Fixed by sanitizing SVG tags/events and locking mock factors behind non-production flags. |
| **CLIENT-03** | HIGH | CONFIRMED | Client | Shared Test Account Takeover on Google Auth | `apps/customer-mobile/src/screens/CustomerDetailsModal.tsx` | Fallback to `signInWithGoogleDev` (+919999999991) executed in production builds on OAuth failure. Fixed by guarding with `__DEV__` and presenting user-facing error message. |
| **CLIENT-04** | HIGH | CONFIRMED | Client | Non-Cryptographic XOR Cipher in Storage | `apps/customer-mobile/src/services/secureStorage.ts` | Used `Math.random()` and static dev keys with XOR cipher. Fixed by migrating to CSPRNG (`crypto.getRandomValues`) and authenticated AES-GCM / Expo SecureStore. |
| **CLIENT-05** | HIGH | CONFIRMED | Client | Incomplete Mobile Sign-Out State Wipe | `apps/customer-mobile/App.tsx`, `AccountScreen.tsx` | Sign-out left customer bookings, passes, tokens, and push tokens cached in memory. Fixed by thoroughly clearing all customer state and unregistering push tokens on sign-out. |
| **BIZ-06** | HIGH | CONFIRMED | Business / Shared | Clinical Notes & Symptoms PII Leakage | `packages/shared/src/logger.ts` | PII denylist missed clinical complaints, medical notes, and diagnostic terms. Fixed by expanding denylist keys and adding complaint/symptom regex scrubbers. |
| **BIZ-07** | HIGH | CONFIRMED | Business / Shared | Unsanitized Exception Objects in Sentry | `packages/shared/src/logger.ts` | Sentry `beforeSend` did not recursively scrub `exception.values` or stacktrace frame local variables. Fixed by recursively sanitizing exception messages, types, and frame variables. |
| **CFG-02** | HIGH | CONFIRMED | Config / Edge | Unauthenticated WhatsApp Auth Webhook | `supabase/functions/whatsapp-auth-hook/index.ts` | Function failed open when `SEND_SMS_HOOK_SECRET` was unset, allowing external callers to trigger WhatsApp OTP sends. Fixed by failing closed with HTTP 401 when hook secret is unset or invalid. |
| **CFG-03** | HIGH | CONFIRMED | Config / Edge | Unauthenticated Crash Alert Email Spamming | `supabase/functions/crash-alert/index.ts` | Function lacked any authentication checks before updating database and calling Resend API. Fixed by requiring `CRASH_ALERT_SECRET` or `service_role` Bearer token. |
| **CFG-04** | HIGH | CONFIRMED | Config / Client | Demo Mode Role Elevation & Fixed '1234' Code | `MerchantTenantContext.tsx`, `apps/merchant-web/src/app/page.tsx` | `?demo=1` granted `isHospitalAdmin = true` and `'1234'` checked in patients without `NODE_ENV !== 'production'` checks. Fixed by locking behind non-production environment checks. |
| **CFG-05** | HIGH | CONFIRMED | Config / Client | Hardcoded Test Credentials in Mobile UI | `apps/customer-mobile/App.tsx`, `CheckoutModal.tsx` | Rendered `+919999999991` and fixed OTP `123456` in production builds. Fixed by wrapping all test credential hints in `__DEV__` conditions. |

---

### B. Confirmed Medium & Low Findings (Reported with Remediation Design)

Per Safety Rule 7, these findings are documented with recommended fixes but were not applied automatically:

1. **API-03 | MEDIUM | CONFIRMED**: Check-in Consecutive Failure Lockout Missing Distributed Counter.
   - *Location*: `apps/merchant-web/src/app/api/bookings/checkin/route.ts:286-337`
   - *Symptom*: Rate limiting uses a generic window (60 req/300s), but lacks a dedicated consecutive failed PIN attempt counter. In-memory fallback map resets on serverless cold starts.
   - *Suggested Fix*: Maintain a dedicated counter in PostgreSQL `hospital_pin_lockouts` (`hospital_id`, `staff_user_id`, `failed_attempts`, `locked_until`). On 5 consecutive failed PIN submissions, lock out staff check-in attempts for 60 seconds.

2. **API-05 | MEDIUM | CONFIRMED**: Missing `Origin` and `Sec-Fetch-Site` Validation on Cookie-Authenticated Mutations.
   - *Location*: `apps/merchant-web/src/middleware.ts:114-162`
   - *Symptom*: Middleware only uses `isAllowedOrigin` to set CORS headers; it does not block state-changing requests (`POST`, `PUT`, `DELETE`) bearing session cookies when `Origin` is missing or mismatched.
   - *Suggested Fix*: In `middleware.ts`, verify that for mutation methods, `req.headers.get('origin')` matches an allowed application origin, or return HTTP 403 Forbidden.

3. **API-06 | MEDIUM | CONFIRMED**: Perimeter Route Gate Bypasses Edge Authentication for `/api/bookings/*`.
   - *Location*: `apps/merchant-web/src/middleware.ts:27, 243-250`
   - *Symptom*: `PUBLIC_API_ROUTES` contains `'/api/bookings'`, which uses `startsWith()` matching and marks `/api/bookings/cancel`, `/api/bookings/admit`, etc. as public at the perimeter (relying solely on individual route handler auth).
   - *Suggested Fix*: Change `PUBLIC_API_ROUTES` to exact path matching (`['/api/bookings/create-hold']`) rather than prefix matching.

4. **API-07 | LOW | CONFIRMED**: Legacy Razorpay Payment Verification Amount Mismatch.
   - *Location*: `apps/merchant-web/src/app/api/payments/verify/route.ts:11-14, 653-658`
   - *Symptom*: Razorpay stub orders return `amount: 0`, causing non-zero deposits to fail tampered payment checks if Razorpay is invoked.
   - *Suggested Fix*: Remove legacy Razorpay route or populate stub amount from booking deposit. (Cashfree is the sole production PG).

5. **CLIENT-06 | MEDIUM | CONFIRMED**: Mobile DPDP Data Export Link Auth Failure via `Linking.openURL`.
   - *Location*: `apps/customer-mobile/src/screens/AccountScreen.tsx:204-207`
   - *Symptom*: `AccountScreen` opens `GET /api/account/export` via external browser, which lacks the mobile app's Bearer JWT and fails with 401.
   - *Suggested Fix*: Generate a single-use time-limited signed export token (e.g. `/api/account/export?token=...`) before invoking `Linking.openURL`.

6. **CLIENT-07 | MEDIUM | CONFIRMED**: Telemetry Initialized Prior to DPDP Consent Selection.
   - *Location*: `apps/customer-mobile/App.tsx:30-46`, `instrumentation-client.ts:11-30`
   - *Symptom*: Sentry initializes at top-level module evaluation before `ConsentScreen` is confirmed.
   - *Suggested Fix*: Defer `Sentry.init()` until `consentStorage.get('analytics_consent') === true`.

7. **CLIENT-08 | MEDIUM | CONFIRMED**: Client Directly Queries Permanent Check-in PIN from `profiles`.
   - *Location*: `apps/customer-mobile/src/services/api.ts:1662-1688`
   - *Symptom*: Mobile app fetches PIN via direct PostgREST SELECT on `profiles`.
   - *Suggested Fix*: Route check-in PIN retrieval through an RPC that verifies the 60-minute window before returning the PIN.

8. **CFG-01 | CRITICAL (HOSTED CONFIG) / MEDIUM (LOCAL)**: Fixed Test OTPs in `supabase/config.toml`.
   - *Location*: `supabase/config.toml:282-297`
   - *Symptom*: Maps 14 phone numbers to fixed OTP `"123456"`. This is intentional for local Docker automated tests, but must be completely absent in hosted Mumbai Supabase project `jldvjdwzhkyypkdroswu`.
   - *Remediation*: Verified local Docker only. Added to Production Cutover Checklist.

9. **CFG-06 | HIGH (EDGE CORS) / MEDIUM (OVERALL)**: Permissive Vercel Subdomain Matching in Edge Functions.
   - *Location*: `supabase/functions/*/index.ts`
   - *Symptom*: Edge functions check `host.startsWith('appointments-merchant-') && host.endsWith('.vercel.app')`.
   - *Suggested Fix*: Adopt strict origin regex matching `VERCEL_TEAM_SLUG` as implemented in `middleware.ts`.

10. **CFG-07 | MEDIUM | CONFIRMED**: Open Signup & High OTP Frequency in `config.toml`.
    - *Location*: `supabase/config.toml:240-279`
    - *Symptom*: Rate limit `max_frequency = "1s"` and disabled CAPTCHA could allow SMS pumping on public auth endpoints.
    - *Suggested Fix*: Increase `max_frequency = "60s"` and enable Turnstile/hCaptcha in hosted production dashboard.

11. **CFG-08 | MEDIUM | CONFIRMED**: Non-Constant-Time Secret Comparison in `whatsapp-sender`.
    - *Location*: `supabase/functions/whatsapp-sender/index.ts:77-80`
    - *Symptom*: Uses `===` instead of `crypto.timingSafeEqual` for CRON_SECRET.
    - *Suggested Fix*: Adopt `timingSafeCompare` from `process-refund-queue`.

12. **CFG-09 | MEDIUM | CONFIRMED**: Edge Functions Drift in `config.toml`.
    - *Location*: `supabase/config.toml:450-474`
    - *Symptom*: 4 edge functions (`crash-alert`, `generate-invoice`, `process-cancellation`, `send-booking-notification`) are omitted from `config.toml`.
    - *Suggested Fix*: Declare all 9 functions in `supabase/config.toml` with explicit `verify_jwt` settings.

13. **CFG-10 | MEDIUM | CONFIRMED**: Supply Chain Vulnerabilities in `undici` and `zod`.
    - *Location*: `package.json`, `pnpm-lock.yaml`
    - *Symptom*: `pnpm audit --prod` reports 17 vulnerabilities (undici < 7.30.1, zod < 4.6.6).
    - *Suggested Fix*: Run `pnpm update undici` and bump zod in next scheduled dependency update wave.

14. **CFG-11 | LOW | CONFIRMED**: Inactive Test Credentials in Git History.
    - *Location*: Commits `bff50315`, `2ff78d7a`, `c8b89864`
    - *Symptom*: Historical commits contain mock strings with live prefixes (`rzp_live_realauthkey123`).
    - *Remediation*: Documented in `docs/backlog.md` (DEF-RC-06). Keys are simulated; no active credentials exposed.

15. **DB-08 | LOW | CONFIRMED (AUDIT OF KNOWN LEAD)**: Verification of Check-in PIN Privilege on `profiles`.
    - *Location*: `public.profiles.permanent_checkin_pin`
    - *Finding*: Migration `20261024000003:73` granted SELECT to `anon`, but subsequent migration `20261104000002:7` explicitly revoked all permissions on `profiles` from `anon`. Live catalog confirms `anon` has 0 column permissions, and authenticated users can only query their own row via RLS `users_read_own_profile`.

16. **DB-09 | LOW | CONFIRMED**: Doctor Leave Reason Exposed via `USING (true)`.
    - *Location*: `public.resource_leaves` (`resource_leaves_select_policy`)
    - *Symptom*: Allows anyone to view doctor leave reasons.
    - *Suggested Fix*: Restrict select policy to leave dates/times only, and mask `reason` to non-staff users.

---

## 2. Proof Matrix per Fixed Finding

Every resolved finding was verified across all three independent verification gates:

| Finding ID | Severity | Gate A: Code Receipt (`file:line`) | Gate B: Runtime Test Name | Gate B Status Code | Gate B Matching ALLOW Test | Gate C: Catalog Diff Result |
|:---|:---|:---|:---|:---|:---|:---|
| **DB-01** | CRITICAL | `20261118000001_*.sql:46-58, 203-215, 335-345` | `Fix 1 (DB-01): DENY unauthenticated caller` | `42501` / Exception | `Fix 1 (DB-01): ALLOW authorized provider doctor` (PASS) | Function definitions updated; `CURRENT_USER` check removed |
| **DB-02** | CRITICAL | `20261118000002_*.sql:47-50` | `Fix 2 (DB-02): DENY non-existent column syntax` | `42703` prevented | `Fix 2 (DB-02): ALLOW admin creates hold` (PASS) | `npx supabase db lint` error 42703 on `create_booking_hold` resolved |
| **DB-03** | CRITICAL | `20261118000003_*.sql:95-110, 243-258` | `Fix 3 (DB-03): DENY unqualified function call` | `42883` prevented | `Fix 3 (DB-03): ALLOW search_directory_public` (PASS) | `extensions.word_similarity` schema-qualified; 0 lint errors |
| **DB-04** | HIGH | `20261118000001_*.sql:567-573, 608-616, 646-654` | `Fix 1 (DB-04): DENY non-admin caller` | `42501` Unauthorized | `Fix 1 (DB-04): ALLOW service_role / admin` (PASS) | Dead security guards replaced with active role/uid checks |
| **DB-05** | HIGH | `20261118000004_*.sql:9-16` | `Fix 4 (DB-05): DENY direct anon execute` | `42501` Permission Denied | `Fix 4 (DB-05): ALLOW public rate-limited wrapper` (PASS) | `information_schema.routine_privileges` shows `anon` revoked |
| **DB-06** | HIGH | `20261118000005_*.sql:19-27, 39-47, 59-67` | `Fix 5 (DB-06): DENY unauthenticated venue upload` | `42501` RLS Violation | `Fix 5 (DB-06): ALLOW provider doctor upload` (PASS) | Storage policies use `storage.foldername(objects.name)` |
| **DB-07** | HIGH | `20261118000006_*.sql:9-10` | `Fix 6 (DB-07): Verify publication identity` | `relreplident = 'f'` | `Fix 6 (DB-07): ALLOW CDC full row decode` (PASS) | `pg_class.relreplident` = `'f'` (FULL) on `bookings`, `payments` |
| **BIZ-01** | CRITICAL | `20261118000007_*.sql:11-17, 96-102` | `Fix 7 (BIZ-01): DENY concurrent hold on WAITING` | `23P01` Exclusion Violation | `Fix 7 (BIZ-01): ALLOW hold on free slot` (PASS) | `pg_constraint` includes `'WAITING'`, `'UP_NEXT'` in predicate |
| **BIZ-02** | CRITICAL | `20261118000008_*.sql:28-33, 60-70, 115-135` | `Fix 8 (BIZ-02): DENY authenticated customer call` | `42501` Permission Denied | `Fix 8 (BIZ-02): ALLOW service_role auto-refund` (PASS) | `reclaim_expired_hold_or_refund` granted strictly to `service_role` |
| **BIZ-03** | HIGH | `20261118000009_*.sql:56-62` | `Fix 9 (BIZ-03): DENY premature no-show marking` | Exception: Slot not started | `Fix 9 (BIZ-03): ALLOW no-show after grace period` (PASS) | Stored procedure rejects no-shows prior to `slot_start + 10m` |
| **BIZ-04** | HIGH | `20261118000009_*.sql:111, 144` | `Fix 9 (BIZ-04): DENY negative platform escrow` | Provider credit capped | `Fix 9 (BIZ-04): ALLOW full deposit allocation` (PASS) | Provider credit capped to `v_booking.deposit_amount` (₹10) |
| **API-01** | CRITICAL | `route.ts:98-114, 121-131` | `Fix 1 (API-01): DENY arbitrary storagePath IDOR` | **403 Forbidden** | `Fix 1 (API-01): ALLOW booking owner prescription` (PASS) | Verified storage path matches authorized booking ID prefix |
| **API-02** / **BIZ-05** | HIGH | `route.ts:38-65, 125-138, 140-168` | `Fix 2 (API-02): DENY invalid phone last 4 digits` | **403 Forbidden** | `Fix 2 (API-02): ALLOW ticket view with masked PII` (PASS) | Full PII, clinical notes, and PIN suppressed unauthenticated |
| **API-04** | HIGH | `auth-admin.ts:145-197, 590-600, 630-640` | `Fix 3 (API-04): DENY admin mutation with AAL1` | **403 Forbidden (MFA_REQ)** | `Fix 3 (API-04): ALLOW admin mutation with AAL2` (PASS) | AAL2 requirement enforced on all admin mutations |
| **CLIENT-01** | HIGH | `next.config.mjs:32, 35-37, 48-55` | `Fix 4 (CLIENT-01): DENY framing & permissions` | Headers Evaluated | `Fix 4 (CLIENT-01): ALLOW self-origin scripts` (PASS) | CSP `frame-ancestors 'none'`, Permissions-Policy added |
| **CLIENT-02** | CRITICAL | `page.tsx:45-76, 217-220, 295-298` | `Fix 1 (CLIENT-02): DENY mock TOTP in production` | Authority Error (Rejected) | `Fix 1 (CLIENT-02): ALLOW valid TOTP enrollment` (PASS) | SVG tags/scripts sanitized; mock TOTP production-locked |
| **CLIENT-03** | HIGH | `CustomerDetailsModal.tsx:70-94` | `Fix 5 (CLIENT-03): DENY Google dev login in prod` | Friendly Error (Blocked) | `Fix 5 (CLIENT-03): ALLOW Google dev login in dev` (PASS) | Fallback to `+919999999991` locked strictly to `__DEV__` |
| **CLIENT-04** | HIGH | `secureStorage.ts:16-30, 73-95, 110-155` | `Fix 6 (CLIENT-04): DENY insecure Math.random RNG` | CSPRNG Enforced | `Fix 6 (CLIENT-04): ALLOW authenticated AES-GCM` (PASS) | CSPRNG and authenticated encryption / SecureStore active |
| **CLIENT-05** | HIGH | `App.tsx:82, 195-205`, `AccountScreen.tsx:31` | `Fix 7 (CLIENT-05): DENY lingering booking state` | State Wiped | `Fix 7 (CLIENT-05): ALLOW clean customer sign-in` (PASS) | Bookings, passes, and push tokens cleared on sign-out |
| **BIZ-06** | HIGH | `logger.ts:44, 244-256, 304-307` | `Fix 8 (BIZ-06): DENY clinical notes in telemetry` | `[REDACTED_MEDICAL]` | `Fix 8 (BIZ-06): ALLOW safe diagnostic UUIDs` (PASS) | Clinical symptoms, notes, and complaints regex scrubbed |
| **BIZ-07** | HIGH | `logger.ts:522-543` | `Fix 8 (BIZ-07): DENY unhandled PII exceptions` | Recursive Scrubbing | `Fix 8 (BIZ-07): ALLOW error tags & breadcrumbs` (PASS) | Sentry exception values, types, and frame variables scrubbed |
| **CFG-02** | HIGH | `whatsapp-auth-hook/index.ts:140-155` | `Fix 9 (CFG-02): DENY trigger when secret unset` | **401 Unauthorized** | `Fix 9 (CFG-02): ALLOW valid HMAC signature` (PASS) | Fails closed with 401 when hook secret is unset |
| **CFG-03** | HIGH | `crash-alert/index.ts:69-87` | `Fix 9 (CFG-03): DENY unauthenticated crash trigger`| **401 Unauthorized** | `Fix 9 (CFG-03): ALLOW Bearer service_role call` (PASS) | Enforces Bearer token or `CRASH_ALERT_SECRET` |
| **CFG-04** | HIGH | `MerchantTenantContext.tsx:59-62`, `page.tsx:57` | `Fix 2 (CFG-04): DENY ?demo=1 elevation in prod` | `isHospitalAdmin = false` | `Fix 2 (CFG-04): ALLOW authenticated admin` (PASS) | `?demo=1` role elevation and code `'1234'` locked to dev |
| **CFG-05** | HIGH | `App.tsx:37-41`, `CheckoutModal.tsx:1083` | `Fix 3 (CFG-05): DENY test credentials in prod` | Elements Unmounted | `Fix 3 (CFG-05): ALLOW test credentials in __DEV__` (PASS)| Hardcoded credentials omitted from production mobile builds |

---

## 3. Final Test Counts vs. Baseline

Every suite was executed serially and compared against the Phase 0 baseline:

| Test Suite / Gate | Baseline (Phase 0) | Post-Remediation (Phase 3) | New Tests Added | Regressions | Status |
|:---|:---|:---|:---|:---|:---|
| **TypeScript Typecheck (`pnpm -r typecheck`)** | 0 errors | 0 errors | 0 | 0 | **PASS** |
| **Security Suite (`pnpm test:security`)** | 225 passed | 225 passed | 0 | 0 | **PASS** |
| **Validation Suite (`pnpm test:validation`)** | 85 passed | 85 passed | 0 | 0 | **PASS** |
| **Telemetry & Privacy (`test-telemetry-privacy.mjs`)**| 27 passed | 27 passed | 0 | 0 | **PASS** |
| **Database Security Unit Tests (`security-loop-db`)**| N/A | 22 passed | +22 tests (10 suites) | 0 | **PASS** |
| **API Authorization Unit Tests (`security-loop-api`)**| N/A | 6 passed | +6 tests (4 suites) | 0 | **PASS** |
| **Client / Config Unit Tests (`security-loop-client`)**| N/A | 22 passed | +22 tests (9 suites) | 0 | **PASS** |
| **Production Build (`pnpm build`)** | Passed | Passed (100% clean) | 0 | 0 | **PASS** |
| **TOTAL AUTOMATED VERIFICATION TESTS** | **337 Passed** | **387 Passed** | **+50 Tests** | **0 Failures** | **100% GREEN** |

---

## 4. Decisions Needed (Spec Conflicts & Architectural Alignment)

During the audit, two structural conflicts between implementation and specification were identified. Per safety rules, these have NOT been modified and are submitted for human decision:

### 1. Check-in PIN Customer Visibility Window
- **Current Code Behavior**:
  - In `apps/customer-mobile/src/screens/HomeScreen.tsx:236-248` and `MyBookingsScreen.tsx:197-233`, the customer mobile app calls `fetchCustomerLifetimePin()` and displays the customer's permanent 4-digit check-in PIN unconditionally at all times (24 hours a day, 365 days a year), even weeks before any appointment.
  - In `apps/merchant-web/src/components/BookingPassModal.tsx` and `apps/merchant-web/src/app/api/ticket/[id]/route.ts`, the web app enforces a strict 60-minute window: the check-in PIN is concealed until 60 minutes before the scheduled appointment slot.
- **Specification Source of Truth (`docs/hospital/SPEC.md` line 28)**:
  - *"PIN is shown to the customer on their ticket/booking pass from 60 minutes before the slot until check-in."*
- **Question for Decision**:
  - Should the customer mobile app be updated to hide the lifetime check-in PIN on `HomeScreen` and `MyBookingsScreen` until 60 minutes before the patient's slot (aligning with `SPEC.md` line 28 and `BookingPassModal.tsx`), OR should `docs/hospital/SPEC.md` be updated to officially allow customers to view their lifetime permanent check-in PIN at all times in the mobile app?

### 2. No-Show Policy: Strikes & 7-Day Account Block vs. Financial Deduction Only
- **Current Code Behavior**:
  - Stored procedure `private.record_no_show` tracks `profiles.no_show_count`. Strikes 1–2 receive courtesy 100% refunds; Strikes 3–5 deduct ₹60 (₹50 to hospital, ₹10 to platform) and refund remainder. On Strike 6 (exceeding 5 strikes), it sets `profiles.blocked_until = NOW() + INTERVAL '7 days'` and resets `no_show_count = 0`.
  - Procedure `private.create_booking_hold` checks `blocked_until > NOW()` and rejects new booking holds with *"Your account is blocked for 7 days due to excessive no-shows"*.
  - `CheckoutModal.tsx` and `AccountScreen.tsx` in `apps/customer-mobile` display account blocked banners.
- **Specification & Prompt Guidance**:
  - `docs/hospital/SPEC.md` line 23 currently specifies the 7-day account block rule (*"Exceeding 5 strikes (6th no-show): account is blocked for 7 days"*).
  - However, user guidelines state: *"hospital policy in docs/hospital/SPEC.md is deduction only, no account blocking"*.
- **Question for Decision**:
  - Should hospital vertical no-shows be updated to "financial deduction only" (eliminating strike counters and removing the 7-day account block from `record_no_show`, `create_booking_hold`, and the mobile UI), OR should the current 6-strike 7-day account blocking policy be retained as the defense against persistent booking abuse?

---

## 5. Production Checklist for Hosted Mumbai Project (`jldvjdwzhkyypkdroswu`)

The following security configurations cannot be proven by local Docker execution and must be explicitly verified or set in the live hosted Supabase project `jldvjdwzhkyypkdroswu` (AWS `ap-south-1` Mumbai):

1. **Vault Secrets (`vault.decrypted_secrets`)**:
   - In local Docker, all 5 vault secrets (`razorpay_key_secret`, `razorpay_webhook_secret`, `internal_webhook_secret`, `expo_push_access_token`, `edge_functions_base_url`) contain placeholder `'REPLACE_ME'`.
   - In hosted production, set genuine secrets:
     - `cashfree_secret_key` and `cashfree_app_id` (Cashfree PG API credentials).
     - `internal_webhook_secret` (shared secret for database trigger -> edge function authorization header).
     - `expo_push_access_token` (Expo Push notification token).
     - `edge_functions_base_url` (`https://jldvjdwzhkyypkdroswu.supabase.co/functions/v1`).
     - `crash_alert_secret` and `resend_api_key` for `crash-alert`.

2. **Supabase Auth Test Numbers (SMS Pumping & Bypass Removal)**:
   - Verify in the hosted Supabase Dashboard under **Authentication > Providers > Phone** that **all 14 test phone numbers** (e.g., `919999900001`, `919999999991`, `919848011101..106`) and fixed OTP `"123456"` are completely removed from production GoTrue configuration.

3. **Supabase Auth Production Hardening**:
   - Set **SMS OTP Rate Limit**: Increase minimum interval between SMS dispatches from 1s to 60s per phone number.
   - Set **Email Confirmations**: Set `enable_confirmations = true` for new merchant/admin user registrations.
   - Enable **CAPTCHA Protection**: Turn on Cloudflare Turnstile or hCaptcha in Supabase Auth to prevent automated SMS pumping.

4. **Edge Function Environment Secrets**:
   - Ensure the following environment variables are provisioned via `npx supabase secrets set`:
     - `CRASH_ALERT_SECRET`
     - `SEND_SMS_HOOK_SECRET`
     - `CRON_SECRET`
     - `RESEND_API_KEY`
     - `CASHFREE_APP_ID`
     - `CASHFREE_SECRET_KEY`
     - `CASHFREE_WEBHOOK_SECRET`
     - `SENTRY_DSN`
     - `SENTRY_AUTH_TOKEN`

5. **India Data Residency & Sentry PII Guardrails**:
   - Verify hosted Supabase project remains pinned to `ap-south-1` (Mumbai).
   - Verify Vercel production deployment remains pinned to `bom1` (Mumbai).
   - In Sentry (`matrisoftwaresolutions`), confirm `sendDefaultPii: false` and Session Replay sample rates remain `0` across production merchant and customer projects.
