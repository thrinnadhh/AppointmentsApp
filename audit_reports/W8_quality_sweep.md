# AUDIT REPORT: W8 Quality Sweep, Timezone, Resilience & Test Suite Execution

- **Workstream:** QA Sub-Agent W8 - Quality Sweep, Timezone, Resilience & Test Suite Execution
- **Target Branch:** `refactor/arch-cleanup-and-security-hardening`
- **Time Started:** 2026-11-17 17:06:44 IST
- **Time Finished:** 2026-11-17 17:15:30 IST
- **Audit Date:** 2026-11-17
- **Files & Areas Examined:**
  - `packages/shared/src/queue-engine.ts`
  - `apps/customer-mobile/src/services/api.ts`
  - `apps/customer-mobile/src/screens/ProviderDetailScreen.tsx`
  - `apps/customer-mobile/src/screens/CheckoutModal.tsx`
  - `apps/customer-mobile/src/screens/HomeScreen.tsx`
  - `apps/customer-mobile/src/screens/MyBookingsScreen.tsx`
  - `apps/customer-mobile/src/components/ErrorBoundary.tsx`
  - `apps/customer-mobile/App.tsx`
  - `apps/merchant-web/src/lib/queue-scheduler.ts`
  - `apps/merchant-web/src/lib/supabase.ts`
  - `apps/merchant-web/src/lib/auth-admin.ts`
  - `apps/merchant-web/src/components/Navigation.tsx`
  - `apps/merchant-web/src/components/frontdesk/FastPassCheckinPanel.tsx`
  - `apps/merchant-web/src/components/frontdesk/FrontDeskQueueTabs.tsx`
  - `apps/merchant-web/src/components/frontdesk/ManualCheckinModal.tsx`
  - `apps/merchant-web/src/app/error.tsx`
  - `apps/merchant-web/src/app/page.tsx`
  - `apps/merchant-web/src/app/bookings/page.tsx`
  - `apps/merchant-web/src/app/resources/page.tsx`
  - `apps/merchant-web/src/app/admin/logs/page.tsx`
  - `apps/merchant-web/src/app/api/bookings/checkin/route.ts`
  - `apps/merchant-web/src/app/api/bookings/hold/route.ts`
  - `supabase/migrations/20261108000002_spec_arrival_window_and_trigger_privileges.sql`
  - `supabase/migrations/20261113000002_reject_premature_noshow_and_present_patient.sql`
  - `supabase/migrations/20261114000002_forensic_hardening_and_cashfree_remediation.sql`
  - `supabase/migrations/20261115000001_harden_security_definer_caller_checks.sql`

---

## 1. Timezone & Temporal Correctness (IST / Asia/Kolkata)

### Flow W8-TZ-01: Client-Side Slot Generation Timezone Anchoring
- **Actor:** Customer (Mobile App)
- **Status:** **FAIL**
- **Severity:** High
- **Chain Traced:** `ProviderDetailScreen.tsx` (Date Picker) -> `generateAvailableSlots` in `api.ts` -> `create_booking_hold` RPC -> DB `bookings`
- **Checks at each link:**
  - Client Date Generation: `apps/customer-mobile/src/screens/ProviderDetailScreen.tsx:64-68` generates 3 calendar date options using native `new Date()`, which binds to the physical device's local timezone.
  - Client Slot Step Loop: `apps/customer-mobile/src/services/api.ts:1017-1035` and `1054-1065` construct slot timestamps via `start.setHours(hour, min, 0, 0)` and `start.toISOString()`.
  - Server Booking Hold: `supabase/migrations/20261114000002_forensic_hardening_and_cashfree_remediation.sql:256` converts `p_slot_start AT TIME ZONE 'Asia/Kolkata'`.
- **Evidence:**
  - `apps/customer-mobile/src/screens/ProviderDetailScreen.tsx:64-68`:
    ```typescript
    const dates = [0, 1, 2].map((offset) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d;
    });
    ```
  - `apps/customer-mobile/src/services/api.ts:1019-1031`:
    ```typescript
    const start = new Date(selectedDate);
    start.setHours(hour, min, 0, 0);
    const end = new Date(start.getTime() + (slotDuration > 0 ? slotDuration : slotStep) * 60000);
    ...
    slots.push({
      resource_id: resource.id,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      ...
    });
    ```
- **Defect Reason:**
  `generateAvailableSlots` and `ProviderDetailScreen` construct Date instances using the customer device's local runtime timezone. If a customer is traveling or located outside India (e.g. UTC, US EST UTC-5, or Gulf GST UTC+4), `start.setHours(10, 0, 0, 0)` sets 10:00 AM *in their local device timezone*. Calling `.toISOString()` converts that local time to UTC, which when evaluated in India (+05:30) is shifted by the timezone offset (e.g., a 10:00 AM slot selected in US Eastern UTC-5 converts to 19:30 IST / 7:30 PM in India).
- **Likely Fix:**
  Anchor all date calculations in `apps/customer-mobile/src/services/api.ts` to `Asia/Kolkata` (+05:30) using `toClinicAnchorDate(dateStr, timeHHMM)` or `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'`, identical to the shared `queue-engine.ts` implementation.

---

### Flow W8-TZ-02: Arrival Window Evaluation (±10m around slot_start)
- **Actor:** Front Desk / Doctor / Queue Scheduler
- **Status:** **PASS**
- **Severity:** N/A
- **Chain Traced:** Check-in UI (`FastPassCheckinPanel.tsx` / `ManualCheckinModal.tsx`) -> API (`api/bookings/checkin/route.ts`) -> Database (`private.verify_checkin_code` / `private.mark_present_manually`) -> Shared Engine (`packages/shared/src/queue-engine.ts`)
- **Checks at each link:**
  - Shared Engine: `calculateArrivalTag` defines `ON_TIME_GRACE_MINUTES = 10` (`packages/shared/src/queue-engine.ts:32-33, 185-189`). Difference `diffMinutes = (arrMs - startMs) / (60 * 1000)`: `< -10m` is Early, `[-10m, +10m]` is On Time, `> +10m` is Late.
  - API Handler: `apps/merchant-web/src/app/api/bookings/checkin/route.ts:230` enforces `const isLate = now.getTime() > (new Date(booking.slot_start).getTime() + ON_TIME_GRACE_MS)`.
  - Database RPCs: `supabase/migrations/20261108000002_spec_arrival_window_and_trigger_privileges.sql:77` enforces `v_is_late := v_was_skipped OR (v_now > (v_booking.slot_start + interval '10 minutes'))`.
- **Evidence:**
  - `packages/shared/src/queue-engine.ts:187-189`:
    ```typescript
    if (diffMinutes < -ON_TIME_GRACE_MINUTES) return 'Early';
    if (diffMinutes >= -ON_TIME_GRACE_MINUTES && diffMinutes <= ON_TIME_GRACE_MINUTES) return 'On Time';
    return 'Late';
    ```
  - `supabase/migrations/20261108000002_spec_arrival_window_and_trigger_privileges.sql:77`:
    ```sql
    v_is_late := v_was_skipped OR (v_now > (v_booking.slot_start + interval '10 minutes'));
    ```
- **Conclusion:**
  Arrival window calculations are strictly aligned with SPEC.md across client, API, shared queue engine, and database functions.

---

### Flow W8-TZ-03: No-Show Determination and Premature No-Show Guard
- **Actor:** Merchant Staff / Consultant / Hospital Admin
- **Status:** **FAIL**
- **Severity:** High
- **Chain Traced:** Merchant Dashboard -> `recordMerchantNoShow` in `apps/merchant-web/src/lib/supabase.ts` -> Database `private.record_no_show` (`supabase/migrations/20261113000002_reject_premature_noshow_and_present_patient.sql`)
- **Checks at each link:**
  - SPEC.md Invariant: Line 19 specifies: *"No Show means the patient never checked in before the doctor's session ended."*
  - Implementation Check: `supabase/migrations/20261113000002_reject_premature_noshow_and_present_patient.sql:53-58` only rejects no-shows if `v_booking.slot_start > (NOW() + INTERVAL '30 minutes')`.
- **Evidence:**
  - `supabase/migrations/20261113000002_reject_premature_noshow_and_present_patient.sql:53-58`:
    ```sql
    -- Reject premature no-show for future appointments (> 30 min away)
    IF v_booking.slot_start > (NOW() + INTERVAL '30 minutes') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Premature no-show: Appointment slot is in the future. Cannot report no-show for an upcoming appointment.'
        );
    END IF;
    ```
- **Defect Reason:**
  The check `v_booking.slot_start > (NOW() + INTERVAL '30 minutes')` only blocks no-show reporting when the appointment is more than 30 minutes in the *future*. If an appointment slot starts in 15 minutes (or 5 minutes, or within the arrival window before session end), `v_booking.slot_start > (NOW() + 30m)` is FALSE. This permits a merchant to trigger `record_no_show` *before the appointment has even started*, prematurely penalizing an on-time or approaching patient and forfeiting their deposit or applying a strike penalty.
- **Likely Fix:**
  Change the premature no-show guard in `private.record_no_show` to ensure that no-show can only be reported after the appointment arrival window has elapsed and the doctor's session has ended (or at minimum `NOW() >= v_booking.slot_end + INTERVAL '10 minutes'`).

---

### Flow W8-TZ-04: Midnight Boundary Crossing & Daily Limit Sargability
- **Actor:** Customer & System Scheduler
- **Status:** **PASS** (with Medium Observation)
- **Severity:** Medium
- **Chain Traced:** `create_booking_hold` RPC -> `pg_advisory_xact_lock` -> `slot_start` range check
- **Checks at each link:**
  - In `supabase/migrations/20261114000002_forensic_hardening_and_cashfree_remediation.sql:256-267`:
    ```sql
    v_slot_date_ist := (p_slot_start AT TIME ZONE 'Asia/Kolkata')::date;
    v_day_start := (v_slot_date_ist::timestamp AT TIME ZONE 'Asia/Kolkata');
    v_day_end := v_day_start + INTERVAL '1 day';

    PERFORM pg_advisory_xact_lock(hashtext('daily_limit:' || v_provider_id::text || ':' || v_slot_date_ist::text));

    SELECT COUNT(*) INTO v_daily_count
    FROM public.bookings
    WHERE provider_id = v_provider_id
      AND slot_start >= v_day_start
      AND slot_start < v_day_end
    ```
- **Evidence:**
  - `(v_slot_date_ist::timestamp AT TIME ZONE 'Asia/Kolkata')` converts the IST calendar date cleanly into a `timestamptz` representing midnight IST.
  - The interval `slot_start >= v_day_start AND slot_start < v_day_end` is fully sargable and avoids any timezone drift.
- **Observation / Edge Case:**
  In `apps/merchant-web/src/app/page.tsx:1496`:
  `const isToday = Boolean(b.slot_start && new Date(b.slot_start).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today);`
  For appointments spanning across midnight (e.g. 23:50 to 00:30 in turf/gaming), the booking is bound to yesterday's date in `slot_start`, so after midnight it disappears from the current day's active live list even if consultation/play is in progress.

---

### Flow W8-TZ-05: Device Clock Desynchronization Resilience
- **Actor:** Customer Mobile Client vs Database Engine
- **Status:** **FAIL**
- **Severity:** Medium
- **Chain Traced:** Client UI (`api.ts:generateAvailableSlots`) -> RPC (`create_booking_hold`)
- **Checks at each link:**
  - Client Hardware Clock Check: In `apps/customer-mobile/src/services/api.ts:1023`:
    `const isPast = isSelectedDateToday && start.getTime() <= (now.getTime() + 5 * 60 * 1000);`
    `now` is evaluated from device hardware time.
  - Server Clock Defense: In `supabase/migrations/20261114000002_forensic_hardening_and_cashfree_remediation.sql:163`:
    `IF p_slot_start < (NOW() - INTERVAL '5 minutes') THEN RETURN jsonb_build_object('success', false, 'error', 'Invalid slot: cannot book slots in the past'); END IF;`
- **Defect Reason:**
  If a customer's phone clock is set fast by 15 minutes, valid upcoming slots are incorrectly marked as `isPast = true` and rendered disabled/hidden on the mobile client. Conversely, if the client clock is slow by 15 minutes, expired slots appear selectable until the user reaches the checkout submission step and receives a backend error. The client does not synchronize its clock against a server timestamp header (e.g. HTTP `Date` response header).
- **Likely Fix:**
  Compute a clock offset on mobile startup by comparing client `Date.now()` with the HTTP `Date` header from Supabase or the Next.js API, and adjust client-side `now` calculations by this delta.

---

## 2. Client & Server Resilience and Error Handling

### Flow W8-RES-01: Top-Level React Error Boundaries
- **Actor:** Customer & Merchant / Admin Users
- **Status:** **PASS**
- **Severity:** N/A
- **Evidence:**
  - Customer Mobile: `apps/customer-mobile/src/components/ErrorBoundary.tsx` wraps root screen in `App.tsx:6-8, 10-12`. Implements `componentDidCatch` with diagnostic logging via `mobileLogger.forComponent('MobileErrorBoundary', 'UI_CRASH').critical()`. Renders safe recovery fallback UI with "Restart Screen" action without crashing the app.
  - Merchant / Admin Web: `apps/merchant-web/src/app/error.tsx` implements Next.js App Router root error boundary. Logs unhandled React errors with `webLogger.forComponent('AppErrorBoundary').error()`, displays error digest, and provides "Try Again" (`reset()`) and "Back to Overview" navigation buttons.
- **Conclusion:**
  Both mobile and web applications implement comprehensive error boundary protection preventing white screens or native app termination.

---

### Flow W8-RES-02: Action Button Double-Tap & Submission Defense
- **Actor:** Customer / Merchant Front Desk / Consultant
- **Status:** **PASS**
- **Severity:** N/A
- **Chain Traced:** UI Action -> Component State Guard -> API Endpoint -> DB Concurrency Lock
- **Checks at each link:**
  - Mobile Slot Booking & Checkout:
    `apps/customer-mobile/src/screens/CheckoutModal.tsx:1096`:
    `disabled={isProcessing || secondsLeft === 0 || isBlocked}`.
    `isProcessing` is set to `true` synchronously at the start of `handlePayOrHold` and reset only on error.
  - Merchant Fast-Pass Check-In:
    `apps/merchant-web/src/components/frontdesk/FastPassCheckinPanel.tsx:205`:
    `disabled={isLockedOut || isVerifying || !codeInput.trim()}`.
  - Front Desk Queue Actions (Admit, Start, End, Complete, Override):
    `apps/merchant-web/src/components/frontdesk/FrontDeskQueueTabs.tsx:229, 356, 486, 730`:
    `disabled={isProcessingAction}` prevents rapid consecutive taps across all queue actions.
  - Front Desk Manual Check-In:
    `apps/merchant-web/src/components/frontdesk/ManualCheckinModal.tsx:288, 295`:
    `disabled={isSubmitting}`.
  - Database Layer Concurrency Locks:
    `create_booking_hold` uses GiST exclusion constraint `no_overlapping_active_bookings` and `pg_advisory_xact_lock`.
    `private.mark_present_manually` and `private.verify_checkin_code` execute `SELECT ... FOR UPDATE` with `status = 'CONFIRMED' AND is_present = FALSE` atomic updates.
- **Conclusion:**
  State-level disabled flags and database row/exclusion locks provide double-tap and race-condition immunity.

---

### Flow W8-RES-03: Empty States & Loading Skeletons
- **Actor:** Customer & Merchant Staff
- **Status:** **PASS**
- **Severity:** N/A
- **Evidence:**
  - `apps/customer-mobile/src/screens/HomeScreen.tsx:793-798`:
    Renders styled `emptyResults` with icon 🔎, title *"No venues found in {currentVertical}"*, and category reset action.
  - `apps/customer-mobile/src/screens/MyBookingsScreen.tsx:238-245`:
    Renders styled `emptyState` with 📅 / 📂 icons and descriptive copy for both upcoming and past booking lists.
  - `apps/customer-mobile/src/screens/ProviderDetailScreen.tsx:232, 416`:
    Renders `ActivityIndicator` loading indicators while provider data and slot schedules are fetched.
  - `apps/merchant-web/src/components/frontdesk/FrontDeskQueueTabs.tsx:208, 385, 508, 629`:
    Renders specialized empty queue cards for "Waiting Queue (0)", "Standby Queue (0)", and "Completed Consultations (0)".
- **Conclusion:**
  All key views provide clear loading feedback and empty states.

---

### Flow W8-RES-04: Back-Navigation Resilience Mid-Booking
- **Actor:** Customer (Mobile App)
- **Status:** **PASS**
- **Severity:** N/A
- **Chain Traced:** `ProviderDetailScreen.tsx` -> `CustomerDetailsModal.tsx` -> `CheckoutModal.tsx` -> Cancel Action
- **Checks at each link:**
  - In `apps/customer-mobile/App.tsx:565-585`, selecting a slot and tapping "Book" opens `CustomerDetailsModal` in memory without creating a database row.
  - Tapping "Cancel" (`onClose`) on `CustomerDetailsModal` dismisses the modal cleanly with zero server writes.
  - In `apps/customer-mobile/src/screens/CheckoutModal.tsx:320`, database hold `createHoldOnSupabase` is invoked when the user confirms checkout.
  - If the user cancels (`✕ Cancel` in `CheckoutModal.tsx:523`), `onClose()` dismisses the view.
  - If a hold was placed and the user abandons payment, the 5-minute hold expires automatically and is reclaimed by `pg_cron` / edge function `release-expired-holds`.
- **Conclusion:**
  Back navigation is resilient and cannot corrupt state or leak unreleased holds.

---

### Flow W8-RES-05: Network Failure & Offline State Handling
- **Actor:** Customer Mobile App & Merchant Web
- **Status:** **UNVERIFIED** (Requires physical device network disconnection)
- **Evidence:**
  - `apps/customer-mobile/src/services/api.ts:250, 310, 480` wraps network calls in try/catch and logs errors.
  - `apps/customer-mobile/src/screens/BookingPassModal.tsx:75` contains fallback logic to retain current booking ticket data when offline.
  - No global offline banner or `@react-native-community/netinfo` listener is mounted in `App.tsx`.
- **Manual Verification Needed:**
  Test on a physical Android/iOS device by initiating checkout, toggling Airplane Mode on/off, and verifying retry prompts and ticket display integrity.

---

## 3. Dead UI Sweep (Customer, Merchant, and Admin Apps)

### Flow W8-DUI-01: Missing onPress / onClick Handlers
- **Actor:** Customer, Merchant, Admin Users
- **Status:** **PASS**
- **Severity:** N/A
- **Checks:**
  - Automated AST scan across all `.tsx` files in `apps/customer-mobile/` and `apps/merchant-web/src/`.
  - Analyzed flagged buttons:
    1. `apps/merchant-web/src/app/admin/logs/page.tsx:672`: Expand chevron button inside table row. The parent `<tr>` implements `onClick={() => setExpandedLogId(isExpanded ? null : rowId)}` (`L599`), so row clicks cleanly toggle the diagnostic drawer.
    2. `apps/merchant-web/src/app/resources/page.tsx:540`: "Add Doctor" button rendered for non-Hospital Admins. The element has `disabled` attribute and a hover tooltip *"Restricted: Only Hospital Administrator can add doctors"* per SPEC.md role governance.
  - Verified all TouchableOpacity, Pressable, and button components in `customer-mobile` have active `onPress` callbacks.
- **Conclusion:**
  Zero dead buttons or unhandled click/press components found.

---

### Flow W8-DUI-02: Broken Navigation Paths & Dead Links
- **Actor:** All Users
- **Status:** **PASS**
- **Severity:** N/A
- **Checks:**
  - Traced all Next.js App Router paths:
    - `/` -> `apps/merchant-web/src/app/page.tsx`
    - `/admin` -> `apps/merchant-web/src/app/admin/page.tsx`
    - `/admin/logs` -> `apps/merchant-web/src/app/admin/logs/page.tsx`
    - `/admin/login` -> `apps/merchant-web/src/app/admin/login/page.tsx`
    - `/login` & `/register` -> `apps/merchant-web/src/app/login/page.tsx`, `register/page.tsx`
    - `/venues`, `/resources`, `/schedule`, `/bookings`, `/departments`, `/team`, `/audit-logs`, `/settings` -> all present in `apps/merchant-web/src/app/`
    - `/privacy`, `/terms`, `/refund-policy` -> all present in `apps/merchant-web/src/app/`
    - `/queue` -> `apps/merchant-web/src/app/queue/page.tsx` (clean redirect to `/bookings`)
    - `/customer/dashboard` -> `apps/merchant-web/src/app/customer/dashboard/page.tsx`
  - Traced external links:
    - `https://appointments4u.in/privacy`, `/terms`, `/refund-policy` match production domain routes.
    - `mailto:support@appointments4u.in` and `mailto:grievance@appointments4u.in` are correctly formatted.
- **Conclusion:**
  Zero broken routes or dead links detected.

---

### Flow W8-DUI-03: Orphaned Screens Sweep
- **Actor:** Mobile & Web Developers
- **Status:** **PASS**
- **Severity:** N/A
- **Checks:**
  - Mobile Screens in `apps/customer-mobile/src/screens/`:
    `HomeScreen`, `ProviderDetailScreen`, `CustomerDetailsModal`, `CheckoutModal`, `BookingPassModal`, `MyBookingsScreen`, `AccountScreen`, `ConsentScreen`.
    All 8 screens are imported in `apps/customer-mobile/App.tsx:24-31` and rendered conditionally.
  - Web Pages in `apps/merchant-web/src/app/`:
    Every page is accessible via role-based navigation in `apps/merchant-web/src/components/Navigation.tsx:138-201` or via in-app action buttons.
- **Conclusion:**
  Zero orphaned screens in the repository.

---

## 4. Test Suite Execution Summary

Executed the full unit test suite:
```bash
node --test tests/unit/*.test.mjs
```

### Overall Test Suite Receipts
- **Total Tests Run:** 435
- **Suites Executed:** 124
- **Passed:** 391
- **Failed:** 33
- **Cancelled:** 11 (cancelled due to suite hook failure in `security-human-journey-bola.test.mjs`)
- **Skipped / Todo:** 0

---

### Detailed Test Failure Log & Root Cause Analysis

#### 1. Cross-Tenant Authorization Matrix (`tests/unit/cross-tenant-authorization-matrix.test.mjs`)
- **Failing Tests:**
  - `11. Booking Flow: Check-in, Admit, Start, End, Complete role and cross-hospital isolation` (L1125): `AssertionError: Front Desk B must receive 403 on Hospital A booking check-in (404 !== 403)`
  - `13. POST /api/bookings/override & /api/bookings/reorder: Assigned Staff vs Cross-Hospital` (L1278): `AssertionError: Desk B must receive 403 on Hospital A queue override (404 !== 403)`
  - `15. Customer Arrival Signal & Cancellation: Customer A vs Customer B isolation` (L1337): `AssertionError: Customer B cannot cancel Customer A booking (404 !== 403)`
  - `17. GET /api/ticket/[id]: Full ticket for owner vs Data Masking` (L1397): `AssertionError: Expected 200, got 404`
  - `20. POST /api/payments/create-order: Customer A vs Customer B cross-tenant payment order` (L1449): `AssertionError: Customer B must receive 403 creating order on Customer A booking (404 !== 403)`
  - `24. POST /api/bookings/confirm: Customer A vs Customer B confirmation authorization` (L1542): `AssertionError: Customer B must receive 403 confirming Customer A booking (404 !== 403)`
  - `29. POST /api/payments/verify: Customer A vs Customer B valid HMAC payment verification` (L1650): `AssertionError: Customer B must receive 403 on Customer A booking (404 !== 403)`
  - `39. Supabase Power Features: pgmq lockdown, push token isolation, edge secrets, idempotency, and DLQ` (L2054): `error: function private.mark_present_manually(uuid) is not unique`
  - `Group 8 Suite Level`: `AssertionError: All 38 routes on disk must be covered in matrixLedger`
- **Root Cause:**
  - The API endpoints filter by tenant/caller ownership directly in the database query (`.eq('provider_id', ...)` or `.eq('customer_id', ...)`). When a cross-tenant caller queries another tenant's record, the query returns no row, resulting in `404 Not Found` instead of `403 Forbidden`.
  - Migration function overload collision: multiple migrations created `private.mark_present_manually` with conflicting signatures or overloads.

#### 2. Database Grants & Stored Procedure Overloads (`tests/unit/security-audit-database-grants.test.mjs`)
- **Failing Test:**
  - `3. zero ambiguous custom function overloads exist in public schema (including hospital_role & hospital_accessible_resource_ids)` (L49)
- **Failure Message:**
  `AssertionError: Must have zero ambiguous overloaded functions. Found: [{"count":2,"proname":"merchant_add_resource_leave"},{"count":2,"proname":"merchant_register_shop_for_user"}]`
- **Root Cause:**
  Duplicate functions with different parameter types exist in the `public` schema for `merchant_add_resource_leave` and `merchant_register_shop_for_user`.

#### 3. Database Advisor Schema Lint (`tests/unit/database-advisor-fixes.test.mjs`)
- **Failing Test:**
  - `5. supabase db lint must report zero errors in the public schema` (L98)
- **Failure Message:**
  `AssertionError: Found public schema lint errors: [{"function":"public.merchant_move_booking_to_standby","issues":[{"level":"error","message":"..."}]}]`
- **Root Cause:**
  `public.merchant_move_booking_to_standby` has an unresolved linter violation in the database schema.

#### 4. Family & Minor Booking Invariants (`tests/unit/family-booking-qa-lead.test.mjs`)
- **Failing Tests:**
  - `F-02: Book for family adult (age 35, relationship 'spouse') - row saved, token issued` (L279): `AssertionError: Expected 200, got 404`
  - `F-05: Age invalid - -1, 121, 1.5, "abc" rejected; null/empty allowed when optional` (L429): `AssertionError: null age must be accepted when optional (400 !== 201)`
  - `F-11: Multiple family bookings - back-to-back allowed for different patients; 1-hour gap enforced for same patient` (L689): `AssertionError: Same patient must adhere to 1-hour gap (201 !== 400)`
- **Root Cause:**
  Validation logic in API hold route rejects null age when optional, and 1-hour gap enforcement fails to flag duplicate patient booking under family flow.

#### 5. Hospital Concurrency Safety & Races (`tests/unit/hospital-concurrency-safety.test.mjs`)
- **Failing Tests:**
  - `Race 1: Double check-in - exactly 1 caller succeeds, zero double-processing (50/50 runs)` (L109): `AssertionError: Run 8: Expected exactly 1 winner, got 0`
  - `Race 2: Consultant cannot have two In Consultation bookings concurrently (50/50 runs)` (L161)
- **Root Cause:**
  Under high parallel concurrency (50 parallel runs), transient race conditions occur where both callers receive conflict or error states, yielding 0 winners instead of 1.

#### 6. Functional Blockers & Payment Configuration (`tests/unit/phase2-functional-blockers.test.mjs`)
- **Failing Tests:**
  - `2a. Build environment files and CI top-level env do not set ALLOW_MOCK_PAYMENTS=true` (L333): `AssertionError: apps/merchant-web/.env.local must not set ALLOW_MOCK_PAYMENTS=true`
  - `4b. Atomic DB claim before gateway call prevents concurrent duplicate refunds` (L718)
  - `4c. Failed refund inserts into public.admin_audit_logs using admin_id` (L813)
  - `4d (Mocked Unit): Hard-fails if CASHFREE_SECRET_KEY starts with cfsk_ma_prod_ in tests` (L889)
- **Root Cause:**
  `apps/merchant-web/.env.local` has `ALLOW_MOCK_PAYMENTS=true` active in development, violating the production safety guard test.

#### 7. BOLA & Authorization Definer Suite Setup (`tests/unit/security-human-journey-bola.test.mjs`)
- **Failing Suite Hook:**
  - `Security: BOLA & Authorization Definer Hardening` (L13):
    `error: insert or update on table "resources" violates foreign key constraint "resources_provider_id_fkey"`
    `Key (provider_id)=(2ffa2a93-7b8d-4d84-b907-eb936969779a) is not present in table "providers".`
- **Impact:**
  Caused 11 subsequent subtests in this suite to cancel.

---

## 5. Lint & Type-Check Summary

### Lint Verification
- **Command:** `pnpm lint` (`pnpm -r --if-present lint`)
- **Result:** **PASSED** (0 errors, 2 warnings)
- **Breakdown:**
  - `packages/shared`: 0 errors, 0 warnings (`tsc --noEmit` clean).
  - `apps/customer-mobile`: 0 errors, 0 warnings (`tsc --noEmit` clean).
  - `apps/merchant-web`: 0 errors, 2 warnings (`next lint`):
    1. `apps/merchant-web/src/app/page.tsx:555:6`: `Warning: React Hook useMemo has a missing dependency: 'isDemo'. Either include it or remove the dependency array. react-hooks/exhaustive-deps`
    2. `apps/merchant-web/src/app/ticket/[id]/page.tsx:173:6`: `Warning: React Hook useCallback has a missing dependency: 'fetchQueueAndHistory'. Either include it or remove the dependency array. react-hooks/exhaustive-deps`

### Type-Check Verification
- **Command:** `pnpm typecheck` (`pnpm -r --if-present typecheck`)
- **Result:** **PASSED** (0 errors)
- **Breakdown:**
  - `packages/shared`: `tsc --noEmit` passed with 0 errors.
  - `apps/customer-mobile`: `tsc --noEmit` passed with 0 errors.
  - `apps/merchant-web`: `tsc --noEmit` passed with 0 errors.

---

## 6. HANDOFF (Issues Outside Scope)

- **HANDOFF to W2 (Payments):** `apps/merchant-web/.env.local` has `ALLOW_MOCK_PAYMENTS=true` which causes `phase2-functional-blockers.test.mjs` test 2a to fail.
- **HANDOFF to W6 (Database/Security):** Duplicate function overloads exist in the `public` schema for `merchant_add_resource_leave` and `merchant_register_shop_for_user`, and `private.mark_present_manually(uuid)` is ambiguous.
- **HANDOFF to W6 (Database/Security):** `tests/unit/security-human-journey-bola.test.mjs` setup hook fails on foreign key `resources_provider_id_fkey` due to missing provider row in seed/test setup.
- **HANDOFF to W7 (Hospital Queue/RBAC):** API endpoints return 404 instead of 403 on cross-tenant requests because database queries scope by tenant ID before validating existence.
- **HANDOFF to W1 (Customer Booking):** Family booking validation fails on optional null age in `family-booking-qa-lead.test.mjs` test F-05.
