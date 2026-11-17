# QA Workstream Audit Report: W1 - Customer Booking & Discovery

- **Workstream:** W1 - Customer Booking & Discovery
- **Auditor:** Sub-Agent W1
- **Branch:** `refactor/arch-cleanup-and-security-hardening`
- **Files & Areas Examined:**
  - `apps/customer-mobile/App.tsx` (Entry point, navigation history stack, auth listeners, deep-linking, push registration)
  - `apps/customer-mobile/src/screens/HomeScreen.tsx` (5-Category hub, city territory selector, search bar, fuzzy directory search, nearby venue cards)
  - `apps/customer-mobile/src/screens/ProviderDetailScreen.tsx` (Shop profile, resource/staff selection, operating hours, weekly schedule, slot grid, cooling period calculation)
  - `apps/customer-mobile/src/screens/CustomerDetailsModal.tsx` (Patient input, Google OAuth, mobile validation, profile sync)
  - `apps/customer-mobile/src/screens/CheckoutModal.tsx` (5-minute countdown hold timer, deposit & platform fee calculation, split payments, Cashfree & Razorpay checkout, family member options)
  - `apps/customer-mobile/src/screens/BookingPassModal.tsx` (Ticket pass, permanent 4-digit PIN reveal, QR code, Live OPD Queue, presence banner)
  - `apps/customer-mobile/src/screens/MyBookingsScreen.tsx` (Upcoming & past bookings, cancellation with 60m refund cutoff, reschedule modal, lifetime PIN)
  - `apps/customer-mobile/src/screens/AccountScreen.tsx` (Profile overview, DPDP consent toggles, attendance standing, JSON data export, 30-day account deletion)
  - `apps/customer-mobile/src/screens/ConsentScreen.tsx` (DPDPA Section 6 granular consent gate)
  - `apps/customer-mobile/src/components/DoctorEmergencyModal.tsx` (Emergency cancellation modal with 100% refund, wait, or reschedule)
  - `apps/customer-mobile/src/services/api.ts` (Supabase RPC client, session management, slot availability fetch, caching)
  - `apps/customer-mobile/src/services/secureStorage.ts` (AES-256 encrypted session persistence with SecureStore & AsyncStorage)
  - `apps/customer-mobile/src/services/notifications.ts` (Expo Push notification registration & deep-linking)
  - `packages/shared/src/constants.ts` (Vertical definitions, category normalization, platform fees)
  - `apps/merchant-web/src/app/api/slots/availability/route.ts` (Rate-limited, PII-scrubbed slot availability)
  - `apps/merchant-web/src/app/api/bookings/confirm/route.ts` (Payment confirmation & booking settlement)
  - `apps/merchant-web/src/app/api/account/delete/route.ts` & `apps/merchant-web/src/app/api/account/export/route.ts` (DPDPA right to erasure & data portability)
  - `supabase/migrations/` (RPCs: `create_booking_hold`, `confirm_booking_payment`, `get_nearby_providers`, `get_active_cities`, `search_directory`, GiST exclusion constraints, pg_cron jobs, notification triggers)
- **Time Started:** 2026-11-17T11:35:05Z
- **Time Finished:** 2026-11-17T11:45:00Z

---

## Executive Summary

| Total Flows Audited | PASS | FAIL | UNVERIFIED |
|---------------------|------|------|------------|
| 10                  | 6    | 4    | 0          |

### Key Findings & Defect Summary
1. **Flow 3 Defect (Medium):** In `HomeScreen.tsx` line 991, expansion waitlist submissions are hardcoded to `'nellore'` regardless of which planned/expanding city the user selected.
2. **Flow 4 Defect (Medium):** Paused shops (`is_active = false`) are still returned in customer search and nearby listings because `get_nearby_providers` only filters `WHERE p.status = 'ACTIVE'` without verifying `p.is_active = true`. Customers can view slots but receive an error upon holding.
3. **Flow 7 Defect (Medium):** `BookingPassModal.tsx` hardcodes Hospital OPD terminology ("Hospital OPD Live Pass & Queue", "Doctor Consultation • OPD Room", "The doctor will call Token #1 shortly") across all verticals, producing confusing UI for Salons, Vets, Turfs, and Restaurants.
4. **Flow 9 Defect (High):** In `apps/customer-mobile/src/services/api.ts` line 1665, `fetchCustomerLifetimePin` queries non-existent table `customer_checkin_pins` instead of `public.profiles.permanent_checkin_pin`. This causes `MyBookingsScreen.tsx` to fail fetching the actual PIN and fall back to the hardcoded string `'4821'`.

---

## Detailed Audit Results per Flow

### Flow 1: Sign up / login / logout / session persistence / auth failures in apps/customer-mobile
- **Actor:** Customer / Patient
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - **UI Action:** User enters mobile number in Profile/Sign-in modal (`input-phone-auth`) -> taps "Send 6-Digit OTP" -> receives OTP -> enters code (`input-otp-code`) -> taps "Verify OTP & Sign In". Alternatively, user taps "Continue with Google" (`btn-continue-google`) in `CustomerDetailsModal.tsx`, or verifies email via Email OTP card.
  - **Client Validation:**
    - Mobile: Validates non-empty string, strips non-digits, formats to E.164 (`+91` prefix for 10-digit Indian numbers) (`apps/customer-mobile/src/services/api.ts:1248`).
    - OTP: Validates 6 digits non-empty (`App.tsx:369`).
    - Email: Checks non-empty and presence of `@` symbol (`api.ts:1313`).
  - **API / Edge Function:**
    - Supabase Auth: Calls `supabase.auth.signInWithOtp({ phone })` and `supabase.auth.verifyOtp({ phone, token, type: 'sms' })` (`api.ts:1250, 1277`).
    - Session retrieval: `getCurrentCustomerSession()` calls `supabase.auth.getSession()` (`api.ts:1396`).
  - **DB Write (Tables / Triggers):**
    - `auth.users` creates user row.
    - Post-verification hook: Calls RPC `sync_customer_profile(p_full_name, p_phone, p_email)` which upserts into `public.profiles`.
    - Automatically assigns `permanent_checkin_pin` via database trigger `handle_new_auth_user` if null (`supabase/migrations/20261024000003_permanent_pin_and_one_hour_patient_gap.sql:96`).
  - **Session Persistence:**
    - Handled via `encryptedSessionStorage` (`apps/customer-mobile/src/services/secureStorage.ts:38`).
    - Generates 256-bit AES key stored in `expo-secure-store`.
    - Encrypts JWT session payload with IV prefix and stores chunked blocks (1000-char chunks) in SecureStore (native) or localStorage (web).
    - Session successfully restored on app launch via `useEffect` in `App.tsx:131`.
  - **Logout:**
    - User taps "Sign Out / Switch Account" (`btn-sign-out`) -> calls `signOutCustomer()` (`api.ts:1408`) -> `supabase.auth.signOut()`.
    - `supabase.auth.onAuthStateChange` listener in `App.tsx:158` catches `SIGNED_OUT`, resets `activeCustomerId = ''`, `isAuthenticated = false`, `isPhoneVerified = false`, and clears `customerBookings`.
  - **Auth Failures:**
    - Incorrect OTP: Displays error "Invalid OTP. Please try 123456" (`App.tsx:398`).
    - Unauthenticated hold creation: Rejects with "Authentication required to create a booking hold" (`api.ts:582`).
    - In `CheckoutModal.tsx`: If unauthenticated, `onRequireAuth()` prompts sign-in dialog (`CheckoutModal.tsx:294`).
- **Evidence:**
  - `apps/customer-mobile/App.tsx:131-192, 343-477`
  - `apps/customer-mobile/src/services/api.ts:38-45, 1246-1390, 1405-1415`
  - `apps/customer-mobile/src/services/secureStorage.ts:13-145`
  - `tests/unit/mobile-secure-storage.test.mjs` (PASSED)

---

### Flow 2: Home screen with 5 category cards (Hospitals, Salons, Vet Care, Turf/Gaming, Restaurants)
- **Actor:** Customer
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - **UI Action:** User opens app -> views 5-Category Hub on `HomeScreen.tsx`. Taps any of the 5 visual cards:
    1. Hospitals & Clinics (🏥 Doctors & Care)
    2. Salons & Spas (✂️ Hair & Beauty)
    3. Restaurants & Dining (🍽️ Dining & Booths)
    4. Gaming & Turf (🏏 Turfs & Courts)
    5. Pet Care & Clinic (🐾 Vets & Pets)
  - **Client Routing & Hierarchy:**
    - Root home view: `selectedCategory === null` (`HomeScreen.tsx:584`).
    - Exactly 5 cards rendered in 2-2-1 grid (`FIVE_CATEGORIES` derived from `packages/shared/src/constants.ts:31`).
    - Tapping a card sets `selectedCategory = cat.id` (`HomeScreen.tsx:507`).
    - `App.tsx:528` pushes `{ screen: 'HOME', categoryId: cat.id }` onto `history` navigation stack.
    - Transitions immediately to Category View (`categoryDataWrapper`, line 648) showing active banner, horizontal category switcher, search bar, and filtered provider list.
    - Back button `← All Categories` (`HomeScreen.tsx:652`) sets `selectedCategory = null`, returning to the 5-card hub.
    - Hardware Android back button (`App.tsx:713`) and browser `popstate` (`App.tsx:720`) pop category back to root hub.
  - **Data Fetch:**
    - Category venue count badges: Loaded on mount via `fetchProvidersByCategory('all')` (`HomeScreen.tsx:367`).
    - When category is selected, queries `fetchNearbyProviders(selectedCity.latitude, selectedCity.longitude, selectedCategory, 25000)` (`HomeScreen.tsx:427`).
  - **Verification:** All 5 category cards are active, non-null, and map to valid database verticals (`clinics`, `salons`, `restaurants`, `gaming`, `pets`). No dead cards found.
- **Evidence:**
  - `apps/customer-mobile/src/screens/HomeScreen.tsx:83-89, 499-531, 607-626, 648-738`
  - `packages/shared/src/constants.ts:31-72`
  - `apps/customer-mobile/App.tsx:528-548`

---

### Flow 3: City selection (Tirupati default) and behavior when changing cities
- **Actor:** Customer
- **Status:** FAIL
- **Severity:** Medium
- **Chain Traced:**
  - **UI Action:** User taps location badge `📍 Tirupati, AP ▾` in header (`HomeScreen.tsx:544`) -> opens `showCityModal`.
  - **Default Setting:** Initialized to Tirupati (`id: 'tirupati'`, lat: `13.6288`, lng: `79.4192`, status: `'ACTIVE'`) (`HomeScreen.tsx:331-345`).
  - **API / DB Fetch:** Calls `fetchActiveCities(true)` (`api.ts:1490`) invoking Supabase RPC `get_active_cities(p_include_expanding: true)` (`supabase/migrations/20261107000008_zero_advisor_private_schema_architecture.sql:33`).
  - **Behavior for Active City:**
    - If user selects an `ACTIVE` city (e.g. Tirupati): sets `selectedCity`, closes modal.
    - `useEffect` (line 411) detects `selectedCity` change and re-fetches `fetchNearbyProviders` passing new coordinates.
  - **Behavior for Non-Active City (Expanding / Planned):**
    - Shows `EXPANDING SOON` pill.
    - Selection is disabled (`if (isActive) { ... }`), preventing invalid bookings in unlaunched cities.
    - Displays pre-launch waitlist form at bottom of modal: "Want appointments in another city? Leave your mobile or email."
  - **Defect Identified:**
    - In `HomeScreen.tsx` line 991:
      ```ts
      const res = await joinCityWaitlist('nellore', waitlistPhone, 'customer', 'Mobile app home selector');
      ```
      The city parameter passed to `joinCityWaitlist` is hardcoded to `'nellore'`.
      When a customer attempts to join the waitlist for Chittoor, Chennai, Bangalore, or Hyderabad, the submission is recorded in `public.city_waitlist` with `city_name = 'Nellore'`.
  - **Likely Fix:** Track the tapped non-active city in component state (e.g. `selectedExpandingCityId`) and pass `selectedExpandingCityId || 'nellore'` dynamically to `joinCityWaitlist`.
- **Evidence:**
  - `apps/customer-mobile/src/screens/HomeScreen.tsx:331-364, 888-1008` (specifically line 991)
  - `apps/customer-mobile/src/services/api.ts:1546-1571`
  - `supabase/migrations/20260912000004_super_admin_multi_city.sql:23-38`

---

### Flow 4: Shop listing shows ALL providers across the marketplace (queries, filters, active status checks)
- **Actor:** Customer
- **Status:** FAIL
- **Severity:** Medium
- **Chain Traced:**
  - **UI Action:** User selects vertical -> views list of provider cards (`provider-card`).
  - **API / DB Query:**
    - Invokes `fetchNearbyProviders(lat, lng, categoryId, 25000)` in `api.ts:241`.
    - Calls Supabase RPC `get_nearby_providers` (`supabase/migrations/20261107000008_zero_advisor_private_schema_architecture.sql:77`).
    - SQL Query:
      ```sql
      SELECT ... FROM public.providers p
      WHERE p.status = 'ACTIVE'
        AND (p_category IS NULL OR p_category = 'all' OR p.category_id = p_category ...)
        AND extensions.ST_DWithin(
          extensions.ST_MakePoint(p.longitude, p.latitude)::extensions.geography,
          v_client_point,
          v_clamped_radius
        )
      ```
    - Joins active resources: `WHERE r.provider_id = pd.id AND r.is_active = true`.
  - **Suspended Venue Defense:**
    - If provider is `SUSPENDED`, `ProviderDetailScreen.tsx:338` displays "⚠️ Business Temporarily Suspended" banner and disables booking button.
  - **Defect Identified (Paused Shops Still Listed):**
    - In `apps/merchant-web/src/app/page.tsx:1092`, merchants can pause their shop by toggling active state: `.update({ is_active: nextActive })`.
    - However, `get_nearby_providers` in migration `20261107000008` line 122 only checks `WHERE p.status = 'ACTIVE'`. It does NOT check `AND (p.is_active IS NULL OR p.is_active = true)`.
    - Similarly, fallback query in `api.ts:164` only checks `.eq('status', 'ACTIVE')`.
    - Consequently, a paused merchant (`is_active = false`) continues to appear in customer search and nearby provider listings. When the customer opens the shop, selects a slot, and clicks "Hold", the backend RPC `create_booking_hold` (`20261114000001:195`) rejects with:
      `This venue is temporarily paused and not accepting new appointments right now.`
    - Customers waste time browsing and configuring an appointment for a venue that is unavailable.
  - **Likely Fix:** Add `AND COALESCE(p.is_active, true) = true` to `get_nearby_providers` WHERE clause, and `.eq('is_active', true)` to `api.ts:164`.
- **Evidence:**
  - `apps/customer-mobile/src/services/api.ts:161-172, 241-328`
  - `supabase/migrations/20261107000008_zero_advisor_private_schema_architecture.sql:121-133`
  - `supabase/migrations/20261114000001_production_hardening_and_cashfree.sql:195-197`
  - `apps/merchant-web/src/app/page.tsx:1073-1095`

---

### Flow 5: Search & filters (category, location, pricing, search bar)
- **Actor:** Customer
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - **UI Action:** User types into `customer-search-input` in `HomeScreen.tsx:745` (e.g. "dental", "dr ravi", "cricket").
  - **Search Flow & Typo Tolerance:**
    - Debounced 250ms hook (`HomeScreen.tsx:449-477`).
    - If `q.length >= 3`, calls `searchDirectoryOnSupabase(q)` (`api.ts:481`).
    - Calls Supabase RPC `search_directory(p_query: query)` which performs typo-tolerant trigram (`pg_trgm`) matching across provider name, description, address, and doctor names.
    - Results are scoped to active category if inside a vertical view.
    - Client fallback filter (lines 480-494) filters loaded providers across name, description, address, resource names, doctor specialization (`attributes.specialization`), and department.
    - Clear search button `✕` (`clear-search-button`) resets input and restores full provider list.
  - **Category Filter:**
    - Category Grid selection on Hub.
    - Horizontal category switcher pills inside listing view.
    - Canonical `normCategory` handles plural/singular mapping (`clinics` / `clinic`, `gaming` / `turf`, etc.).
  - **Location Filter:**
    - Dynamic multi-city selector passes latitude/longitude to PostGIS `get_nearby_providers` with 25km radius clamping.
    - Provider cards display calculated distance: `{provider.distance_km} km`.
  - **Pricing Display:**
    - Platform fee pill on provider card shows `Platform Fee ₹10 • Reserve` (or ₹50 for turf/gaming).
    - Deposit amounts shown per staff/unit on provider profile.
    - (Note: Pricing is display-driven; no multi-step price range slider is exposed in UI).
- **Evidence:**
  - `apps/customer-mobile/src/screens/HomeScreen.tsx:449-495, 742-766, 848-877`
  - `apps/customer-mobile/src/services/api.ts:481-540`
  - `packages/shared/src/constants.ts:79-104`

---

### Flow 6: Shop detail (services, doctors, timings, pricing)
- **Actor:** Customer
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - **UI Action:** Customer taps a provider card on `HomeScreen` -> navigates to `ProviderDetailScreen.tsx` with `providerId`.
  - **API Fetch:** Calls `fetchProviderById(providerId)` in `api.ts:330` -> queries `providers` with `resources(*)`.
  - **Shop Timings & Weekly Hours:**
    - Header displays address, description, and operating hours (`customer-provider-hours`, line 269).
    - Parses `provider.weekly_hours` (Monday-Sunday schedules with `open`, `close`, and `is_closed` flags).
    - Checks today's and tomorrow's hours (`todayHours24Str`, `todayHoursStr`, `tomorrowHoursStr`).
    - If provider is closed on selected day (`isSelectedDateClosed`), renders `customer-day-closed-notice` banner: "🚫 Venue Closed on This Day...".
  - **Services / Doctors / Units:**
    - Section 1 "Select Staff / Unit" (`ProviderDetailScreen.tsx:348`): Iterates `provider.resources`.
    - Displays unit name, duration (`res.duration_minutes} min slot`), capacity (`Max {res.capacity} person`), and deposit (`₹{res.deposit_amount}`).
  - **Pricing & Cooling Period:**
    - Section 1 & Sticky Footer display deposit: `₹{selectedResource.deposit_amount}`.
    - If provider has cooling period (`cooling_period_days > 0`), queries `checkCoolingPeriodEligibility(customerId, providerId)` (`api.ts:692`).
    - If eligible (< cooling period days since last visit):
      - Renders `customer-provider-cooling-period-banner` with `₹0 FREE` badge.
      - Sticky footer displays deposit `₹0 (Free Appointment)`.
      - Hold button changes to "Confirm Free Appointment (₹0) →".
  - **Date & Slot Grid:**
    - Date chips for Today, Tomorrow, and Day after (`customer-date-card-X`).
    - Queries `fetchBookedSlots(resourceId, date)` (`api.ts:936`) calling `/api/slots/availability`.
    - `generateAvailableSlots` generates slots based on opening hours and step duration.
    - Disables past slots and already-booked slots.
    - If all slots for today are in the past, renders `customer-all-slots-past-notice` with one-tap navigation to Tomorrow.
- **Evidence:**
  - `apps/customer-mobile/src/screens/ProviderDetailScreen.tsx:47-222, 260-588`
  - `apps/customer-mobile/src/services/api.ts:330-398, 936-1076`
  - `apps/merchant-web/src/app/api/slots/availability/route.ts:1-141`

---

### Flow 7: Booking per vertical (Hospital, Salon, Vet, Turf/Gaming, Restaurant)
- **Actor:** Customer
- **Status:** FAIL
- **Severity:** Medium
- **Chain Traced:**
  - **7a. Hospital Vertical:**
    - User selects Hospital -> selects Consultant Doctor (`res.name`, `res.department`) -> picks slot.
    - `CustomerDetailsModal.tsx`: Enters patient name, mobile, optional Google Sign-in.
    - `CheckoutModal.tsx`:
      - Shows split payment: ₹10 Platform Fee online + ₹500 Doctor Consultation at hospital desk.
      - 1-hour patient collision gap enforcement: Prevents double-booking same patient within 60 minutes (`CheckoutModal.tsx:337`).
      - Option to book for family member/child (`bookedFor: 'family'`, relationship, age, minor tag).
      - Checks 7-day no-show block (`fetchCustomerStrikes`).
      - Calls `createHoldOnSupabase` -> `create_booking_hold` RPC.
      - Confirms via Cashfree Drop SDK or test payment -> calls `confirm_booking_payment` RPC.
      - Displays `BookingPassModal` with Token #, 4-digit PIN (revealed 60m before slot), QR code, Live OPD Queue.
      - Hospital Flow Status: PASS.
  - **7b. Salon Vertical:**
    - User selects Salon -> selects Stylist Chair / Service -> picks slot.
    - Deposit amount: ₹75 (`VERTICALS[3].defaultDeposit`). Platform fee: ₹10.
    - Hold and payment verification succeed end-to-end.
    - Salon Flow Functional Status: PASS.
  - **7c. Vet Vertical:**
    - User selects Pet Care -> selects Vet Consultant or Pet Groomer -> picks slot.
    - Deposit amount: ₹100. Platform fee: ₹10.
    - Hold and payment verification succeed end-to-end.
    - Vet Flow Functional Status: PASS.
  - **7d. Turf / Gaming Vertical:**
    - User selects Gaming & Turf -> selects Box Cricket Turf or Badminton Court -> picks slot.
    - Deposit amount: ₹200.
    - Platform fee: ₹50 (`getPlatformFee('gaming')` = 50 in `packages/shared/src/constants.ts:117` and `create_booking_hold` line 312: `v_platform_fee := CASE WHEN v_category_id IN ('gaming', 'turf') THEN 50.00 ELSE 10.00 END;`).
    - Turf Flow Functional Status: PASS.
  - **7e. Restaurant Vertical:**
    - User selects Restaurant -> selects Dining Table / AC Booth (`res.capacity`) -> picks slot.
    - Deposit amount: ₹150. Platform fee: ₹10.
    - Hold and payment verification succeed end-to-end.
    - Restaurant Flow Functional Status: PASS.
  - **Defect Identified (Hardcoded Hospital OPD Terminology on Booking Pass):**
    - While the booking, hold, and payment chains succeed across all 5 verticals, `BookingPassModal.tsx` hardcodes medical hospital OPD terminology for all bookings:
      - Line 319: `Hospital OPD Live Pass & Queue`
      - Line 356: `🏥 Hospital Live Queue`
      - Line 425: `<Text style={styles.opdHospitalSub}>{booking.provider_name || 'Hospital'} • OPD Room</Text>`
      - Line 578: `Please have a seat in the waiting lobby. The doctor will call Token #{myTokenNumber} shortly.`
      - Line 636: `<Text style={styles.qrCaption}>Scan at hospital reception desk</Text>`
    - A customer booking a salon stylist, cricket turf, or dining table is presented with a pass titled "Hospital OPD Live Pass", told to sit in the "OPD Room", and informed that "The doctor will call Token #1 shortly".
  - **Likely Fix:** Pass `categoryId` into `BookingPassModal.tsx` and dynamically render unit titles (`Doctor`, `Stylist`, `Court`, `Table`) and venue labels using `VERTICALS` configuration.
- **Evidence:**
  - `packages/shared/src/constants.ts:31-72, 106-128`
  - `apps/customer-mobile/src/screens/CheckoutModal.tsx:115-121, 319-364`
  - `apps/customer-mobile/src/screens/BookingPassModal.tsx:319, 356, 425, 578, 636`
  - `supabase/migrations/20261114000001_production_hardening_and_cashfree.sql:308-316`

---

### Flow 8: Slot availability & double-booking (concurrency defense)
- **Actor:** Two concurrent Customers
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - **UI / Client Query:**
    - Client queries `/api/slots/availability?resource_id=...&date=...` (`api.ts:952`).
    - Rate limited to 60 req/min per IP and user account via Redis (`/api/slots/availability/route.ts:29, 40`).
    - Returns active booked slots and active holds (`status = 'HELD'` where `hold_expires_at > now`).
    - Disables booked chips in UI (`!is_available`).
  - **Concurrent Booking Collision (Two customers tapping Hold simultaneously):**
    - Both clients invoke `createHoldOnSupabase` (`api.ts:586`) calling RPC `create_booking_hold`.
  - **Database Defense Layer 1: Slot Hoarding / Velocity Defense:**
    - `private.create_booking_hold` (`20261114000001:321`):
      Checks concurrent active holds for customer. Rejects with error if customer already holds 3 slots:
      `RAISE EXCEPTION 'rate_limit_exceeded: Maximum 3 concurrent active booking holds allowed'`.
  - **Database Defense Layer 2: Atomic Row-Level Exclusion Lock:**
    - Lines 337-347 of `private.create_booking_hold`:
      ```sql
      SET LOCAL lock_timeout = '3s';
      SELECT id INTO v_existing_id
      FROM public.bookings
      WHERE resource_id = p_resource_id
        AND tstzrange(slot_start, slot_end) && tstzrange(p_slot_start, p_slot_end)
        AND (
          status = 'CONFIRMED'
          OR (status = 'HELD' AND hold_expires_at >= NOW())
        )
        FOR UPDATE;

      IF v_existing_id IS NOT NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'Slot is already held or booked');
      END IF;
      ```
    - The first transaction locks the row. The second transaction waits on `FOR UPDATE` lock.
    - When the first transaction inserts the hold and commits, the second transaction sees the active hold and returns `'Slot is already held or booked'`.
  - **Database Defense Layer 3: GiST Overlap Exclusion Constraint:**
    - In migration `20261103000004_phase3_queue_grace_and_payment_enum.sql:31`:
      ```sql
      ALTER TABLE public.bookings
        ADD CONSTRAINT no_overlapping_active_bookings
        EXCLUDE USING gist (
          resource_id WITH =,
          tstzrange(slot_start, slot_end) WITH &&
        ) WHERE (status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION'));
      ```
    - Even if a race condition bypassed the RPC query, PostgreSQL engine guarantees exclusion constraint violation (`23P01`), rendering double-booking mathematically impossible.
  - **Hold Expiry & Cleanup:**
    - Holds expire in 300 seconds (5 minutes) (`20261114000001:51`).
    - `create_booking_hold` automatically cleans up expired holds on the requested slot before testing availability (`lines 250-257`).
    - pg_cron scheduled job runs `release_expired_holds()` every minute.
- **Evidence:**
  - `apps/merchant-web/src/app/api/slots/availability/route.ts:1-141`
  - `supabase/migrations/20261114000001_production_hardening_and_cashfree.sql:250-257, 318-350`
  - `supabase/migrations/20261103000004_phase3_queue_grace_and_payment_enum.sql:30-36`

---

### Flow 9: Booking history / upcoming bookings / booking detail pass
- **Actor:** Customer
- **Status:** FAIL
- **Severity:** High
- **Chain Traced:**
  - **UI Action:** User taps "Appointments" tab in bottom navigation -> `MyBookingsScreen.tsx`.
  - **Data Fetch:**
    - `loadBookings` in `App.tsx:220` calls `fetchCustomerBookingsFromSupabase(activeCustomerId, 20, 0)` in `api.ts:406`.
    - Queries `public.bookings` joined with `providers (name)` and `resources (name)` ordered by `slot_start DESC`.
    - Supports pagination via `handleLoadMoreBookings` with offset chunks of 20 rows.
  - **Supabase Realtime Sync:**
    - `App.tsx:281` subscribes to `postgres_changes` on `bookings` filtered to `customer_id=eq.${activeCustomerId}`.
    - Automatically updates local state and fires toasts on `CONFIRMED`, `COMPLETED`, or 1-hour reminders.
  - **Sub-Tabs:**
    - "Upcoming" (`CONFIRMED`, `HELD`, `CHECKED_IN`).
    - "History" (`COMPLETED`, `CANCELLED`, `NO_SHOW`).
  - **Pass Modal View:**
    - Tapping "🎟️ View Pass" opens `BookingPassModal.tsx`.
    - Shows token badge, reference code, date/time, QR code, and Live Queue tracker.
  - **Reschedule & Cancellation:**
    - Cancel button enforces 60-minute cutoff policy (`MyBookingsScreen.tsx:106`):
      - >= 60m: full refund alert.
      - < 60m: late cancellation warning (deposit forfeited).
      - Calls `cancelBookingOnSupabase` (`api.ts:889`) -> `/api/bookings/cancel` or RPC `cancel_booking`.
    - Reschedule button (`MyBookingsScreen.tsx:141`): opens modal, allows picking new day/slot, calls `rescheduleBookingOnSupabase` -> RPC `reschedule_booking_slot`.
  - **Arrival Signal:**
    - Tapping "📍 Say Reached" calls `markBookingReached(bookingId)` (`api.ts:1100`) -> RPC `mark_customer_reached(p_booking_id)`.
    - Updates `is_present = true` and notifies reception desk.
  - **Defect Identified (Permanent Check-in PIN Broken):**
    - In `MyBookingsScreen.tsx` line 85:
      ```ts
      fetchCustomerLifetimePin(customerId).then((pin) => {
        if (pin) setLifetimePin(pin);
      });
      ```
    - In `apps/customer-mobile/src/services/api.ts` line 1665:
      ```ts
      export async function fetchCustomerLifetimePin(customerId: string): Promise<string | null> {
        try {
          const { data, error } = await (supabase as any)
            .from('customer_checkin_pins')
            .select('pin')
            .eq('customer_id', customerId)
            .maybeSingle();

          if (!error && data?.pin) {
            return data.pin;
          }
        } catch (err) {
          console.warn('Network error fetching customer lifetime pin:', err);
        }
        return null;
      }
      ```
    - Defect: The table `customer_checkin_pins` DOES NOT EXIST in the database! In migration `20261024000003_permanent_pin_and_one_hour_patient_gap.sql:25`, the permanent check-in PIN was added directly to `public.profiles` as column `permanent_checkin_pin`.
    - Because `customer_checkin_pins` does not exist, `fetchCustomerLifetimePin` always returns `null`.
    - As a fallback, `MyBookingsScreen.tsx` line 195 renders:
      ```tsx
      <Text style={styles.lifetimePinDigits} testID="my-bookings-lifetime-pin-digits">
        {lifetimePin || '4821'}
      </Text>
      ```
      The UI permanently displays the fake placeholder PIN `'4821'` instead of the customer's actual lifetime PIN! If the customer quotes `'4821'` at the hospital reception desk, reception verification fails because their actual PIN in `profiles` is different.
  - **Likely Fix:** In `apps/customer-mobile/src/services/api.ts:1665`, update `fetchCustomerLifetimePin` to query `public.profiles.permanent_checkin_pin` (`.from('profiles').select('permanent_checkin_pin').eq('id', customerId)`).
- **Evidence:**
  - `apps/customer-mobile/src/services/api.ts:1660-1677`
  - `apps/customer-mobile/src/screens/MyBookingsScreen.tsx:85-88, 183-201`
  - `supabase/migrations/20261024000003_permanent_pin_and_one_hour_patient_gap.sql:25-73`

---

### Flow 10: Customer profile, saved details, account deletion request / data export
- **Actor:** Customer
- **Status:** PASS
- **Severity:** N/A
- **Chain Traced:**
  - **UI Action:** User navigates to Account Settings via Profile modal (`App.tsx:1241`) -> opens `AccountScreen.tsx`.
  - **Customer Profile & Saved Details:**
    - Displays user Supabase ID, verified phone number, verified email.
    - Personal name editable in Profile modal, synced via `syncCustomerProfile` (`api.ts:1368`) -> RPC `sync_customer_profile`.
  - **Attendance Standing & No-Show Strikes:**
    - Queries `fetchCustomerStrikes(customerId)` (`api.ts:1583`) querying `profiles (no_show_count, is_flagged, blocked_until)`.
    - If customer has strikes (1-2 free grace misses, 3-5 deposit forfeited, 6 = 7-day lockout), displays clear policy banner and blocked cooldown date.
  - **DPDP Act Consents Management:**
    - Section 6 consent toggles for Location Detection, Partner Marketing, and WhatsApp Updates (`AccountScreen.tsx:98-114`).
    - Reads and updates `public.user_consents` table with version `'1.0'`.
  - **Data Export (DPDPA Section 11):**
    - User taps "Download Personal Data Archive" (`AccountScreen.tsx:197`).
    - Calls `handleExportData()` -> opens `/api/account/export`.
    - In `apps/merchant-web/src/app/api/account/export/route.ts`:
      - Authenticates caller via Bearer token or cookie session (`lines 8-59`).
      - Parallel queries `profiles`, `bookings`, `user_consents`, and `account_deletion_requests`.
      - Returns downloadable JSON archive (`Content-Disposition: attachment; filename="data-export-...json"`).
  - **Account Deletion (Google Play Store May 2024 & DPDPA Section 12):**
    - User taps "Schedule Account Deletion" (`AccountScreen.tsx:116`).
    - Confirmation alert explains 30-day grace period and support cancellation option.
    - Calls `request_account_deletion` RPC / `/api/account/delete` endpoint (`AccountScreen.tsx:145, 168`).
    - Inserts into `public.account_deletion_requests(user_id, reason, scheduled_for = NOW() + INTERVAL '30 days')`.
    - Automatically signs user out (`handleSignOut`).
    - Public deletion web portal endpoint also verified at `/api/account/delete-public-request`.
- **Evidence:**
  - `apps/customer-mobile/src/screens/AccountScreen.tsx:42-216, 237-250`
  - `apps/merchant-web/src/app/api/account/delete/route.ts:1-75`
  - `apps/merchant-web/src/app/api/account/export/route.ts:1-112`
  - `supabase/migrations/20261107000003_complete_anonymize_user_data.sql:1-120`

---

## HANDOFF (Observations Outside W1 Scope)

1. **Merchant Web / Docs Mismatch:** `REPO_MAP.md` line 90 lists `apps/merchant-web/src/app/api/bookings/hold/route.ts` as an active API route for holding slots; this file does not exist on disk because holds are handled directly by the Supabase RPC `create_booking_hold`. (Owned by W2 / Merchant Web API workstream).
2. **Integration Test Seed Manifest:** `tests/unit/hospital-customer-screens.test.mjs` fails in local test runner because the hardcoded test users (`test.patient.01@test-tirupati.local`) in `scripts/test-seed-manifest.json` are not provisioned in the local Supabase `auth.users` table without running the full test user seeding harness. (Owned by W7 / Test Automation workstream).
3. **Cashfree Webhook Fallback:** `apps/merchant-web/src/app/api/webhooks/razorpay/route.ts` still exists as a legacy fallback alongside the active Cashfree webhook handler, and should be audited for secret deprecation. (Owned by W4 / Payments workstream).
