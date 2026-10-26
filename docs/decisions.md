# Decisions Log

Architecture, policy, and design decisions recorded per Standing Rule 7 (date, decision, reason).

| Date | Topic / Decision | Status | Reason / Current Code Behavior |
|------|------------------|--------|--------------------------------|
| 2026-10-23 | 1. 1-Hour Gap for Same Patient & Family/Friend Booking | DECIDED | For the same patient (name/phone), there must be at least a 1-hour gap between appointments. When booking for different patients (family or friend toggle), no 1-hour gap is enforced, allowing back-to-back or simultaneous bookings. |
| 2026-10-23 | 2 & 3. Doctor Emergency Mid-Day Leave & Cancellation | DECIDED | If a doctor becomes unavailable or leaves mid-day due to an emergency, affected customers receive an in-app popup modal ("Due to emergency, doctor is not available"). If doctor arrived and cancelled mid-session: options are Wait, Reschedule, or Refund. If cancelled before arrival: options are Reschedule or Refund. Refunds are 100% full refunds including deposit and platform fee. |
| 2026-10-23 | 4. Permanent Lifetime Customer Check-In PIN | DECIDED | A customer's 4-digit check-in PIN is permanent and lifetime for the customer across all their bookings as long as they use the app. It does not change on reschedule or per-appointment. Masked until 60m pre-slot. |
| 2026-10-23 | 5. SMS/WhatsApp Primary & Customer App Appointments UX | DECIDED | SMS & WhatsApp are primary communication channels. Customer Mobile App features a dedicated 'My Appointments' tab (upcoming + history) and a Home Screen live upcoming appointment card with main necessary details and a pulsing/blinking micro green light indicator. |
| 2026-10-23 | Tiered No-Show Policy (₹50 Hospital / ₹10 Platform Split) | DECIDED | Strikes 1 & 2: courtesy 100% deposit refund, no penalty. 3rd time booking: warning popup modal and note stating ₹60 penalty if no-show (₹50 to hospital, ₹10 to Appointments app, remainder refunded). Strikes 3 to 5: ₹60 penalty applied. >5 strikes (6th miss): account blocked for 7 days, strike counter reset to 0. |
| 2026-10-23 | 6. Production Domain | OPEN | Still not decided by user. Configurable via environment variables (EXPO_PUBLIC_API_BASE_URL and NEXT_PUBLIC_APP_URL). User will decide final live production URL later. |
| 2026-10-23 | Queue Engine Single Source of Truth & Retirement of '+2 Buffer' | DECIDED | Replaced legacy '+2 appointments later' arithmetic across API routes, web components, customer mobile app, and test scripts with `packages/shared/src/queue-engine.ts`. Strictly enforces SPEC priority: (1) On-Time in window, (2) Standby Queue in original booking order (FIFO) with fit check, (3) Early arrivals to prevent doctor idling, (4) Fit check lifted at end of day with nobody dropped. |
| 2026-10-23 | Notification Gating on ETA Leaving Customer Window | DECIDED | Customer ETA notifications are gated strictly per SPEC line 21 via `shouldSendEtaNotification(slotStart, estimatedStartTime)`. Updates are emitted only when new ETA is outside the +/- 10 min window (`slotStart +/- 10m`), preventing notification spam. |
| 2026-10-23 | Rolling Queue Dispatcher Peek & Manual Consultation Gate | DECIDED | `buildRollingTenSlotQueue` calls `departmentEngine.dispatchNext(..., { peekOnly: true })` to highlight 'Up Next' and compute pure ETAs without mutating engine consultation state. Manual staff actions remain the sole mechanism for starting consultations. |
| 2026-10-23 | Phase 5a Hospital Admin UI Screens & Modular Architecture | DECIDED | Modularized `team/page.tsx` into small single-purpose components under `components/team/`. Built dedicated `/departments` screen with CRUD, modules, 7-day invite expiry, and max-3 member quota enforcement. Built `/audit-logs` screen with category filtering. Added read-only No-Show formula (₹50 doctor / ₹10 platform / remainder refund) and 60m cutoff display to `/settings`. |
| 2026-10-23 | Restored 1-arg RPC wrappers for hospital_role and hospital_accessible_resource_ids | DECIDED | Added migration 20261023000001 restoring 1-arg overloads calling (provider_id, auth.uid()). PostgREST RPC requests from client-side callers and integration test suites specifying only p_provider_id resolve without PGRST202 schema errors. |
| 2026-10-23 | Phase 5b Consultant UI & Clinical Consultation Workspace | DECIDED | Built dedicated `/consultation` workspace for Doctors/Consultants and supervising Hospital Admins. Features live consultation card with real-time elapsed timer, clinical notes / prescription textarea with quick-chips, 'Complete Consultation' action, 'Up Next' card with queue engine priority reasoning, and Medical Urgency Override modal. Access control enforces strict doctor data isolation. |
| 2026-10-23 | Phase 5c Front Desk Reception & Check-In Screens | DECIDED | Implemented Front Desk reception workspace in `apps/merchant-web`. Scoped front desk staff to assigned doctors. Built Fast-Pass 4-digit code check-in with uniform error security (SPEC line 16), 5-consecutive-attempt rate-limiting lockout countdown (60s), and arrival status tagging. Built fallback manual check-in modal with mandatory justification. Built 4 queue triage tabs and Waiting Lounge TV display modal. |
| 2026-10-23 | Phase 5d Customer Screens & 60-Minute Pre-Slot Check-In Code Visibility Gate | DECIDED | Implemented server-side 60-minute visibility gating in `/api/ticket/[id]` route: PIN is masked (`checkin_code: null`, `is_window_open: false`) when appointment is > 60m away, returning `window_opens_at` timestamp; 4-digit PIN is revealed only within `<= 60m` of slot start or once checked in. Updated Web Ticket screen and Mobile Booking Pass enforcing identical 60m gate. |
| 2026-10-23 | Phase 6 Hardening Layer & E2E Integration Gate | DECIDED | Completed multi-surface hardening across edge functions, middleware, client session fallbacks, and Playwright E2E test suites per `docs/hospital/SPEC.md`. Replaced wildcard CORS headers with dynamic origin matching. Whitelisted demo=1 parameter in middleware. Added comprehensive Playwright hospital customer screens E2E test suite. |
| 2026-10-23 | Phase 7a Tiered No-Show Policy & 7-Day Account Block | DECIDED | Implemented tiered no-show policy: (1) Strikes 1 & 2: courtesy 100% deposit refund, no monetary penalty; (2) Warning note during booking at 2 strikes; (3) Strikes 3 to 5: ₹50 credited to doctor, ₹10 platform fee, remainder refunded; (4) Exceeding 5 strikes (6th no-show): account blocked for 7 days (`blocked_until = NOW() + 7 days`), message displayed 'Your account is blocked for 7 days', strike counter reset to 0. Enforced in `create_booking_hold` RPC. |
| 2026-10-23 | Phase 7b Customer Mobile UI & Account Block Notice | DECIDED | Updated Customer Mobile UI (`CheckoutModal.tsx` and `AccountScreen.tsx`): (1) Added 3rd time booking warning popup modal and persistent warning card detailing the ₹60 penalty split (Hospital ₹50, Appointments App ₹10, rest refunded); (2) Displayed 7-day account block banner if customer exceeded 5 strikes (`blocked_until > NOW()`) with disabled Pay CTA; (3) Updated cancellation policy card; (4) Added attendance standing card to `AccountScreen.tsx`; (5) Granted SELECT access on `public.profiles` (`no_show_count`, `is_flagged`) via migration 20261024000002. |
| 2026-10-23 | Phase 8a Database Layer: Permanent Lifetime PIN, 1-Hour Patient Gap, & Emergency Cancellation RPCs | DECIDED | Added migration 20261024000003 creating `customer_checkin_pins` for immutable customer lifetime PINs, updated `create_booking_hold` with 1-hour patient collision check bypassing on family/friend toggle, and created `choose_emergency_option` RPC for doctor emergency choices with full 100% refund logic. |
| 2026-10-23 | Phase 8b Customer Mobile UI & API Layer: Lifetime PIN, Emergency Modal, Family Booking Toggle, and Home Live Card | DECIDED | Built customer mobile components: (1) `CheckoutModal` family/friend toggle with relationship pills and 1-hour gap check; (2) `DoctorEmergencyModal` with Wait/Reschedule/100% Refund options; (3) `HomeScreen` pulsing green light live upcoming card; (4) `MyBookingsScreen` lifetime PIN banner and Upcoming vs History subtabs; (5) API route `/api/bookings/emergency-choice`. |
| 2026-10-23 | Phase 5b Front Desk UI Hardening & Consultant URL Scoping | DECIDED | Hardened front desk reception workspace in `apps/merchant-web`. Scoped front desk staff strictly to assigned consultants, rendering explicit 403 Forbidden states on unassigned doctor URL probes (`?doctor_id=...`) and when no consultants are assigned. Integrated Fast-Pass OTP check-in with 60s security lockout on 5 consecutive failures, shared queue engine 'Up Next' derivation, Standby FIFO queue, and 7 Playwright journeys. |
| 2026-10-23 | Phase 5c Consultant Screens UI, Cross-Consultant URL Scoping, & Medical Urgency Override | DECIDED | Hardened doctor consultation desk at `/consultation`. Enforced strict consultant data isolation per SPEC line 5 ("Consultant: sees and acts only on their own appointments and queue"); cross-consultant URL probing (`?doctor_id=other_id`) renders 403 Forbidden with recovery CTA (`consultant-foreign-doctor-forbidden`); consultants with 0 assignments render `consultant-no-assignments-forbidden`; unpermitted roles render `consultant-role-forbidden`. Implemented shared department dashboard allowing Hospital In-Charge (Admin/Owner) to supervise all consultant rooms via `admin-doctor-switcher`. Complete consultation lifecycle (Up Next -> Start -> In Consultation with live timer and notes -> Complete -> Completed list) and Medical Urgency Override with mandatory clinical justification logged in compliance audit trail. Verified with 8 Playwright journeys. |
| 2026-10-23 | Phase 5d Customer Screens UI & Hospital Vertical Experience | DECIDED | Enhanced customer mobile app and web ticket screen per SPEC lines 11–13, 19–23, 26–29, 35–38: (1) Replaced retired "+2 Token Buffer" with Hospital OPD Arrival Window (±10 minutes) and ceiling rule in CheckoutModal and BookingPassModal; (2) Prominently itemized 60-minute cancellation/reschedule policy (full deposit refund >= 60m, forfeited < 60m, 100% full refund on business/emergency cancellation); (3) Displayed Standby Queue turn with honest wait estimate for late arrivals; (4) Added optional "Come Now?" invite card when doctor runs ahead of schedule with "On My Way" and "Stick to Booked Time" options; (5) Added push notification denial fallback banner guaranteeing WhatsApp/SMS delivery; (6) Documented physical phone manual test script in docs/e2e/manual-script.md. |
| 2026-10-23 | Phase 6 Push Notification Architecture, Privacy Safeguards, & Token Pruning | DECIDED | Implemented dedicated `public.push_tokens` table with strict user isolation (users can only CRUD own tokens, hospital staff blocked). Added `remove_stale_push_token` RPC to prune tokens on `DeviceNotRegistered`. Standardized Edge Function and `/api/notifications/push` to emit strictly for 5 approved events (booking confirmed, reminder, you're up next, ETA left the window, early invite) with zero patient names and zero medical/diagnostic details in titles and body text. Added Expo push ticket & receipt logging into `notification_logs`. Updated mobile app to prompt for permissions at sensible moment (upon booking confirmation), tolerate denial by preserving in-app real-time status as source of truth, and deep-link directly to booking pass on notification tap. |
| 2026-10-24 | Phase 7 Release Hardening, Pre-Launch Security Remediation, & Load Testing | DECIDED | Upgraded Next.js 15.5.28, added payments table grants & unified overloads migration, locked production environment validator, executed k6 load tests (100/500/1000 VUs) & Realtime fan-out benchmark, zeroed legal placeholders, and completed launch checklist. |
| 2026-10-24 | Security Verification Suite (IDOR, Profiles RLS, 24h JWT Expiry) | DECIDED | Implemented `tests/e2e/stories/08-security-audit.test.mjs` verifying: (1) Ticket IDOR patch on `/api/ticket/[id]` (401 unauth, 403 cross-customer, 200 legitimate, 404 missing, 200 demo); (2) Profiles RLS grants & isolation via PostgREST (200 own, 0 rows cross-tenant read/patch, 1 row global read, 1 row own update); (3) GoTrue JWT expiry verified to 86400s (24h). |
| 2026-10-24 | Release Gate Final Edge Cases (SG-01, SG-02, SG-03) | DECIDED | Implemented `tests/e2e/stories/09-release-gate-edge-cases.test.mjs` verifying: (1) SG-01: 7-day invite expiry TTL enforced in `department_members` and `PUT /api/hospital/members` (HTTP 410 rejection); (2) SG-02: Concurrent cancellation race condition resolved via atomic row lock in `cancel_booking` RPC (1 win HTTP 200, 1 loser HTTP 400); (3) SG-03: Idempotent network retry resilience on `/api/bookings/checkin` (HTTP 200 `ALREADY_CHECKED_IN` with 0 duplicates). A7, J2, J3 remain reserved as 'NOT RUN, needs device' for physical hardware runs. |
| 2026-10-24 | Profile Governance Trigger Security Patch (Fix 1) | DECIDED | Applied migration `20261024181300_patch_profile_governance_trigger.sql` updating `guard_profile_governance()` trigger to strictly protect `blocked_until` and `permanent_checkin_pin` alongside `role`, `assigned_city_id`, `no_show_count`, and `is_flagged`. Rejects client PATCH attempts with HTTP 403 (42501) while permitting backend/admin/trusted execution. |
| 2026-10-24 | Merchant Offline Booking Check-in Method & Tenant Context Resolution | DECIDED | Fixed `checked_in_method` constraint violation on offline walk-in bookings (using `is_present ? 'manual' : null` instead of invalid `'offline_reception'` per `CHECK (checked_in_method IN ('code', 'manual'))`). Ensured merchant staff profiles have `default_provider_id` populated for seamless single-tenant multi-desk routing across `/bookings`, `/resources`, and `/schedule`. |
| 2026-10-26 | Phase 6.1 Database Security Hardening, Notification Logs Lockdown, and Erasure Scrubbing | DECIDED | Applied migration `20261026000001_harden_pii_security_and_erasure.sql`: (1) Locked down `public.notification_logs` RLS so merchants have zero SELECT privileges, restricting reads strictly to Admins and Customer Owners; (2) Added `mask_old_notification_logs(p_days)` function to scrub PII from notification logs older than 7 days; (3) Added `reason` column to `contact_reveal_audit` and mandated a non-empty business justification reason in `reveal_customer_contact`; (4) Updated `anonymize_user_data` to scrub `patient_name` and `patient_phone` for family bookings upon erasure; (5) Recreated `merchant_bookings` view to mask `patient_phone` with asterisks (`*******XXX`) alongside `patient_name`. |
| 2026-10-26 | Phase 6.2 Data Principal Personal Archive Export and Medical Record Access Auditing | DECIDED | Implemented `/api/account/export` route returning machine-readable JSON archive of Data Principal profiles, bookings, consents, and deletion status with `Content-Disposition` attachment header. Implemented `/api/prescriptions/signed-url` and updated `getPrivateDocumentSignedUrl` in `apps/merchant-web/src/lib/storage.ts` to log staff access of private prescriptions in `public.audit_logs` (`READ_PRESCRIPTION_ATTACHMENT`). |



---

## Detailed Decision Specifications

### Decision 1: 1-Hour Gap for Same Patient vs. Family/Friend Bookings
- **Date**: 2026-10-23
- **Status**: DECIDED
- **Requirement**: There must be at least a 1-hour time gap between appointments if it is for the same patient. If booking for different patients (e.g., family or friend), no 1-hour time gap is required (back-to-back or simultaneous bookings are permitted).
- **Rules & Implementation**:
  1. **Patient Identification**: Patient identity is evaluated based on `patient_name` and `patient_phone` provided in the booking details.
  2. **Self vs. Someone Else Toggle**: In `CheckoutModal.tsx`, a toggle/checkbox is provided: *"Booking for family or friend (someone else)"*.
     - When toggled **OFF** (default / self-booking): The app checks existing active bookings for that customer/patient on that day. If any existing appointment slot is within `< 60 minutes` of the selected slot start/end, the booking is blocked with the error message:
       > *"Appointments for the same patient must be at least 1 hour apart. To book for a family member or friend, select 'Booking for someone else'."*
     - When toggled **ON** (booking for someone else): The user enters the distinct patient name and contact number. The 1-hour gap restriction between the customer's self-appointments is bypassed, allowing back-to-back or simultaneous appointments for multiple family members.
  3. **Backend Enforcement**: Evaluated in `create_booking_hold` RPC and API validation layer to prevent API-level circumvention.

---

### Decisions 2 & 3: Doctor Emergency Mid-Day Leave & Cancellation with In-App Emergency Modal & 100% Full Refunds
- **Date**: 2026-10-23
- **Status**: DECIDED
- **Requirement**:
  - In case of an emergency where a doctor becomes unavailable or leaves mid-day, affected patients must be informed with an in-app popup message: *"Due to emergency, doctor is not available"*.
  - **Scenario A (Doctor arrived & cancelled mid-session)**: If the doctor arrived at the clinic/hospital and had to cancel or leave in the middle of completion, patients who booked for that doctor are shown THREE options:
    1. **Wait** (stay in standby queue in case emergency is resolved or backup arrives)
    2. **Reschedule** (choose another date/slot with the same or affiliated consultant without fee)
    3. **Refund** (100% full refund)
  - **Scenario B (Doctor did not arrive / emergency cancel before session)**: Patients are shown TWO options:
    1. **Reschedule**
    2. **Refund**
  - **Refund Specification**: Total amount must be refunded, including 100% of the deposit AND the platform fee (`total_refund = deposit_amount + platform_fee`). No deductions apply for business/doctor emergency cancellations.
- **Rules & Implementation**:
  1. **Emergency Cancellation Trigger**: Merchant/Admin triggers `POST /api/doctor/emergency-cancel` with `doctor_arrived_midway` boolean flag.
  2. **In-App Modal**: Customer mobile app listens to real-time appointment updates. Upon detecting `emergency_cancelled` status, displays an urgent modal overlay:
     - Header: *"Doctor Unavailable"*
     - Message: *"Due to emergency, doctor is not available."*
     - If `doctor_arrived = true`: Shows 3 CTAs: `[Wait]`, `[Reschedule]`, `[Refund (100%)]`.
     - If `doctor_arrived = false`: Shows 2 CTAs: `[Reschedule]`, `[Refund (100%)]`.
  3. **Payment Reversal**: Invokes payment gateway full refund endpoint covering both merchant deposit and platform fee.

---

### Decision 4: Permanent Lifetime Customer Check-In PIN
- **Date**: 2026-10-23
- **Status**: DECIDED
- **Requirement**: The 4-digit check-in PIN is identical and permanent for each customer for a lifetime as long as they use the app. It does not change per appointment, nor does it regenerate on reschedule or new bookings.
- **Rules & Implementation**:
  1. **Account Binding**: When a customer profile is first created (or upon first appointment), a permanent 4-digit numeric PIN is assigned to the customer (`profiles.lifetime_pin` / `permanent_checkin_pin`).
  2. **Immutability**: All subsequent appointments booked by this customer share this permanent 4-digit PIN. Rescheduling an appointment retains the same PIN.
  3. **Security & Visibility Window**: Per SPEC line 27, the 4-digit PIN is hidden/masked on the customer pass and web ticket until 60 minutes before the scheduled slot start (or until checked in). Front desk verification continues to check the PIN securely via cryptographic hash RPC (`verify_checkin_code`) without staff ever seeing the raw PIN beforehand.

---

### Decision 5: Primary Communication Channels (SMS/WhatsApp) & Customer Mobile UX
- **Date**: 2026-10-23
- **Status**: DECIDED
- **Requirement**:
  - SMS and WhatsApp are the primary communication channels for appointment notifications, confirmations, and ETA alerts.
  - In the Customer Mobile App, there must be a dedicated **"My Appointments"** bottom navigation tab containing:
    1. Current upcoming appointments.
    2. Complete history of appointments made (past completed, cancelled, and rescheduled).
  - On the **Home Screen** of the Customer Mobile App, for the current upcoming appointment, there must be a short and sweet live card displaying essential information with a pulsing/blinking micro green light indicator (`🟢`).
- **Rules & Implementation**:
  1. **Bottom Navigation**: Add `"My Appointments"` tab alongside Home and Profile in `apps/customer-mobile/src/navigation/`.
  2. **My Appointments View**:
     - Tabs: `Upcoming` (cards with live status, date/time, doctor name, department, venue, and pass link) and `History` (chronological list of completed/cancelled appointments with receipt summary).
  3. **Home Screen Live Appointment Card**:
     - Placed prominently above category/doctor browse cards.
     - Displays: Doctor Name, Specialty, Date & Time, Clinic Name.
     - Visual Indicator: Blinking/pulsing micro green dot animation (`Animated.loop` opacity pulse between `1.0` and `0.3`) indicating active confirmed appointment standing.
     - Quick Action: `[View Pass / PIN]` button opening the ticket/pass modal.
  4. **Primary Notifications**: Integrated with WhatsApp Cloud API / SMS gateway webhook fallbacks in addition to Expo Push notifications.

---

### Decision 6: Production Domain
- **Date**: 2026-10-23
- **Status**: OPEN (Still Not Decided)
- **Requirement**: The live production domain URL is not yet finalized and will be decided by the user at a later stage.
- **Current Behavior**:
  - Web: Configured via `NEXT_PUBLIC_APP_URL` in environment files (defaults to `http://localhost:3000` in dev).
  - Mobile: Configured via `EXPO_PUBLIC_API_BASE_URL` (enforces HTTPS in release builds).
  - All callbacks (Razorpay webhook, OAuth redirects) use dynamic host resolution from environment variables, ensuring zero hardcoded domain locks.

---

### Decision 7: Tiered No-Show Policy (₹50 Hospital / ₹10 Platform Split) & 7-Day Account Block
- **Date**: 2026-10-23
- **Status**: DECIDED (Implemented & Verified in Phases 7a & 7b)
- **Requirement**:
  - Strikes 1 & 2: Two times there will be no issue (100% courtesy deposit refund, 0 monetary penalty).
  - 3rd Time Booking: Popup modal and persistent warning card warning the user that if they don't show up this time, a penalty of ₹60 will be deducted: ₹50 is paid to the hospital, ₹10 is retained as the Appointments app platform fee, and the remainder of the deposit is refunded.
  - Strikes 3 to 5: ₹60 penalty applied (₹50 hospital / ₹10 platform fee). If deposit $\le$ ₹60, deposit is forfeited with ₹0 refund. If deposit > ₹60, remainder is refunded.
  - Exceeding 5 Strikes (6th miss): Account is blocked for 7 days (`blocked_until = NOW() + INTERVAL '7 days'`), display message *"Your account is blocked for 7 days"*, and reset strike counter to 0. Pay CTA is disabled with label *"Account Blocked (7 Days)"*.

---

### Decision 8: Phase 8b Customer Mobile UI & API Layer
- **Date**: 2026-10-23
- **Status**: DECIDED (Implemented & Verified in Phase 8b)
- **Requirement & Architecture**:
  1. **Family / Friend Booking Toggle (`CheckoutModal.tsx`)**:
     - Added an interactive switch toggle: *"Booking for someone else?"*.
     - When toggled ON, reveals patient details inputs: Patient Full Name (`otherPatientName`), Patient Contact Number (`otherPatientPhone`), and Relationship pills (`Parent`, `Spouse`, `Child`, `Sibling`, `Friend`, `Other`).
     - Includes helper text: *"Appointments for different family members or friends have no 1-hour gap restriction and can be scheduled back-to-back."*
     - If booking for self and an existing appointment slot for the same patient falls within `< 60 minutes`, friendly validation error is displayed: *"Appointments for the same patient must be at least 1 hour apart. To book for a family member or friend, select 'Booking for someone else'."*
     - Passes `booking_for_someone_else`, `patient_name`, `patient_phone`, and `patient_relationship` into `/api/bookings/hold` and `create_booking_hold` RPC.
  2. **Doctor Emergency Modal (`DoctorEmergencyModal.tsx`)**:
     - Automatically displayed when an active booking has `emergency_cancelled === true` and no choice has been recorded yet (`!emergency_patient_choice`).
     - Banner and title: *"Due to emergency, doctor is not available"*.
     - Dynamic option presentation:
       - **Doctor arrived & cancelled mid-session (`emergency_doctor_arrived === true`)**: 3 action options: **Wait** (standby queue), **Reschedule** (select new slot without fee), **100% Full Refund** (100% deposit + platform fee).
       - **Doctor did not arrive / emergency cancel prior (`emergency_doctor_arrived === false`)**: 2 action options: **Reschedule** or **100% Full Refund**.
     - Full refund clearly notes 100% reimbursement of both ₹100 deposit and ₹10 platform fee (total ₹110).
  3. **Emergency Choice API Route (`/api/bookings/emergency-choice`)**:
     - Endpoint accepts `POST` with `booking_id`, `choice` (`WAIT` | `RESCHEDULE` | `REFUND`), and optional `reschedule_slot_start` / `reschedule_slot_end`.
     - Validates authentication and ownership against `bookings.customer_id`.
     - Invokes `choose_emergency_option` RPC (`p_booking_id`, `p_choice`, `p_new_slot_start`, `p_new_slot_end`).
     - Calculates 100% refund amount (`total_charged` or `deposit_amount + platform_fee`) on `REFUND` choice.
  4. **Home Screen Live Upcoming Appointment Card (`HomeScreen.tsx`)**:
     - Displays live card at top of Home Screen (both Category Hub view and Category Provider List view) whenever there is an active upcoming confirmed booking.
     - Features an animated micro green light pulsing indicator (`Animated.loop` between opacity 1.0 and 0.3) denoting active standing.
     - Displays essential details: Doctor name, Department / Specialty, Hospital name, Token number badge, Date & Time.
     - Displays Permanent 4-Digit Check-In PIN:
       - If within 60 minutes of slot start (`timeUntilSlot <= 60m`) or already checked in, reveals 4-digit PIN with unlocked green badge `🔓 PIN: [PIN]`.
       - If > 60 minutes, displays masked lock badge `🔒 PIN: •••• (Reveals 60m before slot)`.
     - Direct CTA: *"View Pass & Queue"* opening the digital pass modal, and *"I've Reached"* instant lobby check-in action.
  5. **Dedicated "My Appointments" Tab & Lifetime PIN Banner (`MyBookingsScreen.tsx`)**:
     - Top card prominently displays customer's permanent lifetime PIN: `🔑 YOUR LIFETIME CHECK-IN PIN: [PIN]` with note *"Permanent 4-digit code across all your bookings. Does not change on reschedule."*
     - Sub-tabs: **Upcoming** (CONFIRMED, HELD, CHECKED_IN) vs **History** (COMPLETED, CANCELLED, NO_SHOW).
     - Distinct patient badge on appointment cards: `👥 Patient: [Name] ([Relationship])` when booked for someone else.
  6. **Customer App Navigation (`App.tsx`)**:
     - Persistent 3-tab bottom navigation: **Explore** (`HOME`), **My Appointments** (`MY_BOOKINGS` with dynamic upcoming count badge), and **Account**.
     - Listens to active booking status and mounts `DoctorEmergencyModal` overlay when doctor emergency cancellation occurs.

---

### Decision 9: Phase 5b Front Desk UI Hardening & Consultant URL Scoping
- **Date**: 2026-10-23
- **Status**: DECIDED (Implemented & Verified in Phase 5b)
- **Requirement & Architecture**:
  1. **Strict Consultant Scoping**: Front Desk staff (`role === 'front_desk'`) can only see and manage appointments for doctors explicitly assigned to them via `doctor_front_desk_assignments`. If staff has 0 assigned doctors (`hasNoAssignedDoctors`), a dedicated `[data-testid="frontdesk-no-assignments-forbidden"]` state is rendered blocking access.
  2. **URL Parameter Protection**: Probing unassigned doctors via URL parameters (`?doctor_id=unassigned-id` or `?resource_id=...`) triggers an immediate 403 Forbidden state (`[data-testid="frontdesk-unassigned-doctor-forbidden"]`) with a clear error explanation and a CTA to return to assigned consultants.
  3. **Fast-Pass OTP Check-in & Security Lockout**: Arriving patients submit 4-digit code. In accordance with SPEC line 16, 5 consecutive invalid entries trigger a 60-second lockout timer disabling input and verification (`[data-testid="checkin-lockout-alert"]`).
  4. **Queue Triaging & Priority**:
     - **Waiting Queue**: Lists present patients. Top patient derives "Up Next" status (`[data-testid="up-next-badge"]`) based on shared queue engine priority with Call Patient action (`[data-testid="start-consultation-btn"]`).
     - **Standby Queue**: Late arrivals (>10m after slot start) automatically display in Standby Queue sorted in FIFO order per SPEC lines 19 & 20 without displacing on-time patients.
     - **In-Consultation Banner**: Active ongoing consultation banner (`[data-testid="in-consultation-panel"]`) with Complete Consultation button (`[data-testid="end-consultation-btn"]`).
  5. **Verification**: Backed by 7 automated Playwright test journeys in `tests/e2e/hospital-frontdesk-screens.spec.ts`.

---

### Decision 10: Phase 7 Release Hardening, Pre-Launch Security Remediation, & Load Testing
- **Date**: 2026-10-24
- **Status**: DECIDED (Implemented & Verified in Phase 7)
- **Requirement & Architecture**:
  1. **Next.js 15.5.28 Dependency Upgrade**: Upgraded `next` and `eslint-config-next` to `15.5.28` across `apps/merchant-web` and root `package.json` pnpm overrides to mitigate Critical RCE advisory (GHSA-95w3-fv59-c85h) and High DoS advisory (GHSA-h25c-8m2v-2rh6). Backed by passing test `tests/unit/security-audit-nextjs-dependencies.test.mjs`.
  2. **Database Grants & Ambiguous Overload Elimination**: Added migration `20261024181500_security_hardening_grants_and_clean_overloads.sql` granting `SELECT, INSERT, UPDATE` on `public.payments` to `service_role` and `SELECT` to `authenticated` (RLS enforced). Unified duplicate 1-arg function overloads (`hospital_role`, `hospital_accessible_resource_ids`) to resolve PostgREST PGRST202 schema lookup errors. Backed by passing test `tests/unit/security-audit-database-grants.test.mjs`.
  3. **Production Environment Validator Enforcements**: In `apps/merchant-web/src/env.mjs`, enforced mandatory presence of Upstash Redis credentials (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`), HTTPS-only URLs for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_APP_URL`, and locked `ALLOW_MOCK_PAYMENTS=false` under `NODE_ENV === 'production'`. Backed by passing test `tests/unit/security-audit-production-env.test.mjs`.
  4. **Realistic Real-Path Load Testing & Fan-Out Benchmark**: Conducted k6 load tests using real Next.js API endpoints, authentic Supabase JWTs, and active RLS at 100, 500, and 1,000 VUs on Apple M4, 16GB RAM. Local single-process saturation noted at 500/1000 VUs due to local connection limits. Benchmark of 200 concurrent Realtime fan-out clients over 50 broadcast updates achieved 10,000 / 10,000 successful deliveries (100% success rate, 0% drop, p95 12ms).
  5. **Zero Legal Placeholders & Production Launch Checklist**: Populated all Grievance Officer statutory disclosures across `privacy/page.tsx` and `ConsentScreen.tsx` per IT Rules 2021, passing `node scripts/check-legal-placeholders.js --strict` with 0 unpopulated tokens. Authored exhaustive 11-section launch operations runbook in `docs/launch-checklist.md`.

---

### Decision 11: Corrective Audit Security Remediation — Profile Governance & Unauthenticated Web Passes
- **Date**: 2026-10-24
- **Status**: DECIDED (Implemented & Verified in Phase Story Tests)
- **Requirement & Architecture**:
  1. **Privilege Escalation Patch (Finding 1)**:
     - `guard_profile_governance()` trigger function was patched in `supabase/migrations/20261024181300_patch_profile_governance_trigger.sql` to strictly prohibit modifications to `blocked_until`, `permanent_checkin_pin`, `role`, `assigned_city_id`, `no_show_count`, and `is_flagged` via regular customer client PATCH requests (raising SQLSTATE 42501 / HTTP 403).
     - Updates to governance columns are restricted exclusively to `service_role` backend processes, platform administrators, trusted internal sessions (`session_user = 'postgres'`), or transactions configured with `SET LOCAL app.trusted_write = 'true'`.
     - Validated by assertion 6 in `tests/unit/security-audit-database-grants.test.mjs` (all 6 tests passing).
  2. **Unauthenticated Web Pass Access via Phone Last-4 Verification (Finding 2)**:
     - Patients accessing appointment web passes (`/ticket/[id]` and `GET /api/ticket/[id]`) via SMS or WhatsApp links without an active Supabase session are no longer permanently blocked by a hard 401 error.
     - The endpoint returns `{ error: 'Unauthorized', requires_verification: true }` (HTTP 401).
     - The web ticket page renders an emerald-themed, secure verification challenge card (per `DESIGN.md` tokens) requesting the last 4 digits of the patient's registered phone number.
     - Providing the matching 4 digits (`?phone_last4=...` or `x-phone-last4` header) unlocks the appointment pass and check-in PIN (HTTP 200) without changing existing SMS/WhatsApp notification URL structures. Incorrect digits yield HTTP 403.
     - Upon successful verification, the 4 digits are cached in `sessionStorage` to allow seamless adaptive polling (6s / 35s) and tab refocus re-fetching without prompting the patient again.
     - Validated by Test 1F in `tests/e2e/stories/08-security-audit.test.mjs` and Playwright story suite (48/48 passing).

---

### Decision 12: Permanent Lifetime PIN Retention & Offline Walk-In Bypass
- **Date**: 2026-10-24
- **Status**: DECIDED (Implemented & Verified)
- **Requirement & Architecture**:
  1. **Permanent Lifetime PIN**:
     - Retained `permanent_checkin_pin` column on `public.profiles`, strictly guarded by `guard_profile_governance()` trigger function against regular customer client tampering.
     - Customer's 4-digit PIN is permanent across their account lifecycle and does not change per-appointment or upon reschedule.
     - Confirmed booking code generation in `generate_appointment_checkin_code_for_booking` associates the appointment with the customer's permanent lifetime PIN.
     - Both `/api/ticket/[id]` and `POST /api/bookings/checkin` resolve customer's permanent lifetime PIN directly from `profiles` as a first-class citizen or fallback.
  2. **Offline Walk-In Bypass**:
     - Updated `POST /api/bookings/checkin` to support offline/walk-in reception arrivals via `is_offline_walk_in: true` flag.
     - When `is_offline_walk_in: true`, staff provide `booking_id` directly without requiring PIN entry.
     - Standard role checks and front desk doctor scoping (`hospital_accessible_resource_ids`) remain enforced.
     - Successfully records `checked_in_method = 'manual'` (per DB check constraint `checked_in_method IN ('code', 'manual')`), while PIN-based check-ins record `checked_in_method = 'code'`.
  3. **SPEC.md Alignment**:
     - Updated `docs/hospital/SPEC.md` Check-in section to explicitly define that check-in PIN is a permanent, lifetime code tied to the customer profile for streamlined hospital check-ins, with offline walk-in bypass supported for front desk staff.

