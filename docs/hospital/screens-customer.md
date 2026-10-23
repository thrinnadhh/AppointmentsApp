# Hospital Vertical: Customer Screens Specification & Gap Analysis

**Date:** 2026-10-23  
**Status:** Awaiting Approval (Step 1 — No Code)  
**Layer:** UI Layer (`apps/customer-mobile` and `apps/merchant-web` `/ticket/[id]`)  
**Branch:** `phase-5d-customer-ui`  
**Source of Truth:** [`docs/hospital/SPEC.md`](file:///Users/trinadh/projects/Appointments/docs/hospital/SPEC.md)  
**Governing Design System:** [`DESIGN.md`](file:///Users/trinadh/projects/Appointments/DESIGN.md) (Tirupati Merchant Command, Emerald `#047857` primary, Slate `#0f172a` text, Geist Mono, Purple Ban)

---

## 1. Overview & Authority Boundaries

Per `docs/hospital/SPEC.md`:
> - **Line 6:** "Customer: sees only their own bookings and their own check-in code."
> - **Lines 8–9:** "Names (identical on every screen):
>   Roles: Hospital Admin, Front Desk, Consultant.
>   Arrival tags: On Time, Early, Late, Expected.
>   Statuses: Booked, Checked In, Waiting, Up Next, In Consultation, Completed, No Show.
>   Queues: Live Queue, Waiting Queue, Standby Queue (late patients)."
> - **Line 11:** "A booking is confirmed by paying a deposit. The hold lasts one value everywhere (code, tests, jobs, gateway order expiry): 5 minutes unless I change it."
> - **Line 12:** "Customer cancels or reschedules free if at least 60 minutes remain before the slot; otherwise the deposit is forfeited. If the business cancels: full refund."
> - **Line 13:** "There must be at least a 1-hour gap between appointments for the same patient. When booking for different patients (family or friend), no 1-hour gap is required (back-to-back or simultaneous bookings are permitted)."
> - **Lines 14–18:** "In case of emergency when a doctor becomes unavailable or leaves mid-day... Refunds are 100% full refunds, including the full platform fee and deposit amount."
> - **Lines 19–23:** "No Show means the patient never checked in before the doctor's session ended.
>   - Strikes 1 & 2: Two times there will be no issue (100% courtesy deposit refund, no monetary penalty).
>   - Third time booking (with 2 prior misses): Warning popup modal and note stating: 'Two times there will be no issue, but for the third time: if you don't show up this time, there will be a penalty of ₹60. In ₹60, ₹50 will be given to the hospital and ₹10 to the Appointments app. The rest of your deposit will be refunded.'
>   - Strikes 3 to 5: ₹50 goes to the hospital, ₹10 to the Appointments app, and the rest (deposit minus 60) is refunded to customer.
>   - Exceeding 5 strikes (6th no-show): account is blocked for 7 days (`blocked_until = NOW() + INTERVAL '7 days'`), display 'Your account is blocked for 7 days', and reset the strike counter to 0."
> - **Lines 26–27:** "4-digit check-in PIN is permanent and lifetime for the customer across all their bookings as long as they use the app. It does not change on reschedule or per-appointment. PIN is shown to the customer on their ticket/booking pass from 60 minutes before the slot until check-in."
> - **Lines 28–33:** "SMS & WhatsApp are primary communication channels. Customer Mobile App features a dedicated 'My Appointments' tab showing active/upcoming and complete history. On the Home Screen, for the current upcoming appointment, a short and sweet live card displays essential details with a pulsing/blinking micro green light indicator."
> - **Lines 35–38:** "Arrival window is plus or minus 10 minutes of the booked time. The booked time is a ceiling: starting earlier is always allowed when the patient is present and the doctor is free... Standby Queue in original booking order, only if the consultation finishes before the next booked patient's time... Nobody is dropped... Live ETA is recomputed on every check-in, start and end; the customer is notified only when the ETA leaves their window. When the doctor runs early an optional 'come now?' invite goes out; declining changes nothing."

---

## 2. Feature Inventory & Current Implementation Status

| # | Feature / Requirement | SPEC Reference | Description | Status | Current Code vs Gap |
| :- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Booking Flow Arrival Window (±10 mins)** | SPEC L35 | In booking/checkout flow, explicitly display the arrival window as `Booked Time ± 10 minutes` (e.g. 09:50 AM – 10:10 AM for a 10:00 AM slot). Highlight that booked time is a ceiling: starting earlier is always allowed if patient is present and doctor is free. | **EXISTS** | Implemented in `CheckoutModal.tsx` (`testID="arrival-window-notice"`, `arrival-window-box`) with exact arrival range, ±10m badge, and ceiling rule. |
| **2** | **Deposit & 60-Minute Cancellation Text** | SPEC L11–12 | Clear fee breakdown itemizing refundable deposit and platform fee. Prominent cancellation policy stating free cancellation and reschedule $\ge 60$m before slot with 100% deposit refund; deposit forfeited if cancelled $< 60$m; 100% full refund on business/emergency cancellation. | **EXISTS** | Implemented in `CheckoutModal.tsx` (`testID="cancellation-policy-card"`), `MyBookingsScreen.tsx`, and `/api/bookings/cancel`. |
| **3** | **My Bookings Roster** | SPEC L30–32 | Dedicated "My Appointments" tab with `Upcoming` (active, confirmed, checked-in) and `History` (completed, cancelled, no-show) subtabs, plus customer's permanent lifetime PIN banner. | **EXISTS** | Fully implemented in `apps/customer-mobile/src/screens/MyBookingsScreen.tsx` with upcoming cards, history archive, and lifetime PIN banner card. |
| **4** | **Booking Pass: 60m Pre-Slot Code & Hide on Check-in** | SPEC L26–27 | 4-digit PIN is locked with countdown when $> 60$m before slot. Revealed within $\le 60$m of slot start. Once checked in (`is_present` or `status === 'CHECKED_IN'`), the 4-digit code is immediately hidden and replaced by verified emerald presence badge. | **EXISTS** | Implemented in `BookingPassModal.tsx` (L500–534) and `apps/merchant-web/src/app/ticket/[id]/page.tsx` (L365–410). Verified by unit tests and Playwright journeys. |
| **5** | **Live Status with Position & ETA** | SPEC L8–9, 38 | Dynamic progression stepper (`Booked` ➔ `Checked In` ➔ `Waiting` ➔ `Up Next` ➔ `In Consultation` ➔ `Completed`), live queue position number, and recomputed pure ETA. Home Screen pulsing micro green light live card. | **EXISTS** | Implemented in `BookingPassModal.tsx`, `HomeScreen.tsx` (pulsing micro green light, arrival window ±10m), and web ticket `RollingTenSlotQueue`. |
| **6** | **Standby Queue Position with Honest Estimate** | SPEC L9, 36–37 | When patient checks in late (>10m after booked slot), they are placed in Standby Queue in original booking order (FIFO). Pass displays exact Standby position and honest wait estimate ("Called during gap between on-time patients or after on-time queue; you will never be dropped"). | **EXISTS** | Implemented in `BookingPassModal.tsx` (`testID="pass-late-queue-token"`, `pass-honest-estimate-box`) and web ticket (`data-testid="ticket-standby-banner"`). |
| **7** | **Optional "Come Now?" Invite** | SPEC L38 | When the doctor runs ahead of schedule, an optional in-app invite appears: "Doctor running ahead of schedule! Would you like to come in now?". Options: "I'm On My Way" (marks early arrival intent) or "Stick to Booked Time" (dismisses). Declining changes nothing. | **EXISTS** | Implemented in `BookingPassModal.tsx` (`testID="pass-come-now-invite"`, `come-now-accept-btn`, `come-now-decline-btn`) and web ticket (`data-testid="ticket-come-now-invite"`). |
| **8** | **Cancel & Reschedule Workflows** | SPEC L12 | In-app actions to cancel or reschedule. Validates 60-minute window: $\ge 60$m triggers free action with 100% refund/transfer; $< 60$m shows warning that deposit is forfeited. | **EXISTS** | Implemented in `MyBookingsScreen.tsx` (L101–160, 443–524) and wired to `/api/bookings/cancel` and `/api/bookings/reschedule`. |
| **9** | **No-Show Rule Text (₹50 / ₹10 Split)** | SPEC L19–23 | Clear policy text: Strikes 1 & 2 courtesy 100% refund; warning popup modal on 3rd booking if 2 prior misses (₹50 to hospital, ₹10 to Appointments app, remainder refunded); strikes 3–5 penalty applied; $>5$ strikes (6th) blocks account for 7 days. | **EXISTS** | Implemented in `CheckoutModal.tsx` (L722–770, 838–841) and `AccountScreen.tsx`. Fully tested in Phase 7b. |
| **10** | **Notification Denied Fallback Banner** | SPEC L28–29 | If push notifications are disabled or denied by patient in system settings, the app displays a prominent informational reassurance banner: "Push notifications disabled. All queue updates, ETA changes, and check-in codes will be sent via WhatsApp and SMS." | **EXISTS** | Implemented in `BookingPassModal.tsx` (`testID="push-denied-fallback-banner"`) and `HomeScreen.tsx` (`testID="home-push-denied-notice"`). |

---

## 3. Screen Specifications & Architecture

### Screen 1: Hospital Booking & Checkout Sheet (`CheckoutModal.tsx`)
- **File:** `apps/customer-mobile/src/screens/CheckoutModal.tsx`
- **Trigger:** Tapping a doctor's slot on `ProviderDetailScreen.tsx`.
- **UI Components & Layout:**
  1. **Slot & Arrival Window Card (`testID="arrival-window-notice"`)**:
     - Booked slot time: e.g. `10:00 AM – 10:15 AM`.
     - Prominent Arrival Window: `09:50 AM – 10:10 AM` (marked with `Arrival Window: Booked Time ± 10 mins`).
     - Rule Callout: *"The booked time is a ceiling. Starting earlier is always allowed when you are present and the doctor is free."*
     - Replaces legacy "+2 Token Buffer" card entirely.
  2. **Patient Details & Family/Friend Toggle**:
     - Checkbox/switch: `"Booking for family or friend (someone else)"`.
     - If unchecked (self): validates 1-hour minimum gap from user's other appointments.
     - If checked: bypasses 1-hour gap per SPEC line 13.
  3. **Deposit & Fee Itemization**:
     - Refundable Booking Deposit: `₹100` (waived for free follow-ups).
     - Platform Convenience Fee: `₹25`.
     - GST notice and Total Payable.
  4. **Cancellation & 60-Minute Policy Box**:
     - ✅ Free cancellation & reschedule up to 60 minutes before your slot (100% deposit refunded).
     - ⚠️ Under 60 minutes: Deposit is forfeited to the clinic.
     - 🛡️ Clinic/Doctor Cancellation: 100% full refund including platform fee.
  5. **No-Show Policy & Warning Modal**:
     - Strikes 1 & 2: 100% courtesy refund, no monetary penalty.
     - On 3rd booking attempt (with 2 prior misses): Warning popup modal detailing ₹60 penalty split (₹50 Hospital, ₹10 Appointments app, rest refunded).
     - Strikes 3–5: ₹60 penalty applied.
     - 6th miss: Account blocked for 7 days (`blocked_until > NOW()`) with blocked Pay button.

---

### Screen 2: Dedicated "My Appointments" Screen (`MyBookingsScreen.tsx`)
- **File:** `apps/customer-mobile/src/screens/MyBookingsScreen.tsx`
- **Navigation:** Main bottom tab bar ("My Appointments" / `calendar` icon).
- **UI Components & Layout:**
  1. **Permanent Lifetime PIN Header Card (`testID="lifetime-pin-banner"`)**:
     - Displays customer's immutable 4-digit PIN (`font-mono text-2xl`).
     - Subtitle: *"Your permanent check-in PIN for all visits. It never changes on reschedule or future visits."*
  2. **Segmented Subtabs**:
     - `Upcoming` (active confirmed/checked-in visits).
     - `History` (completed, cancelled, no-show visits).
  3. **Appointment Card Elements**:
     - Doctor Name & Specialty.
     - Hospital / Clinic Name & Address.
     - Booked Slot & Arrival Window (`±10 mins`).
     - Canonical Status Pill (`Booked`, `Checked In`, `Waiting`, `Up Next`, `In Consultation`, `Completed`, `Cancelled`, `No Show`).
  4. **Card Action Buttons**:
     - `[View Pass]`: Opens digital pass modal.
     - `[I've Reached]`: Lets reception know patient has entered the facility.
     - `[Reschedule]`: Modal with new date/slot picker, carrying over deposit.
     - `[Cancel]`: Triggers cancellation with 60-minute refund vs forfeiture prompt.

---

### Screen 3: Digital OPD Booking Pass (`BookingPassModal.tsx`)
- **File:** `apps/customer-mobile/src/screens/BookingPassModal.tsx`
- **Purpose:** Active pass presented at hospital reception counter.
- **UI Components & Layout:**
  1. **Hospital & Doctor Tenancy**:
     - Hospital name, Doctor name, Department, Room number, and Date.
  2. **4-Digit Check-in PIN Gate (SPEC Line 27)**:
     - **Before 60-minute window (`now < slot_start - 60m`)**:
       - Locked State (`testID="pass-checkin-early-box"`).
       - Icon: 🔒.
       - Title: *"Check-in Code Opening Soon"*.
       - Description: *"Your 4-digit reception OTP will appear here 60 minutes before your slot (at [time])."*
     - **Within 60-minute window (`slot_start - 60m <= now < checked_in`)**:
       - Unlocked State (`testID="pass-checkin-code-box"`).
       - Big numeric PIN: e.g. `4821` (`testID="pass-checkin-code-number"`).
       - Instruction: *"Show or tell this code at reception counter."*
     - **After Check-in (`isCheckedIn = true`)**:
       - Code box is **HIDDEN**.
       - Replaced with Emerald Verified Badge (`testID="pass-checkedin-box"`):
         *"✓ Verified Present at Reception. Please have a seat in the waiting lounge. Dr. [Name] will call Token #[X] shortly."*
  3. **Arrival Window Card (`testID="pass-arrival-window-card"`)**:
     - Displays: `Arrival Window: Booked Time ± 10 mins`.
     - Subtext: *"Starting earlier is allowed when you are present and the doctor is free."*
  4. **Live Queue & Pure ETA Card**:
     - Shows current serving token, user's queue position, and pure calculated ETA.
     - Live status stepper: `Booked` ➔ `Checked In` ➔ `Waiting` ➔ `Up Next` ➔ `In Consultation` ➔ `Completed`.
  5. **Standby Queue Position & Honest Estimate (Late Arrivals)**:
     - Triggered when patient checked in late (`>10 mins after slot`).
     - Display:
       - Tag: `Standby Queue #X`.
       - Honest Estimate: *"You arrived after your scheduled window. You are placed in the Standby Queue in original booking order. The doctor will see you in gaps between on-time patients (~X mins wait) or at the end of the session. You will never be dropped."*
  6. **Optional "Come Now?" Early Invite (`testID="pass-come-now-invite"`)**:
     - Triggered when doctor runs ahead of schedule and engine signals early fit.
     - Card:
       - Header: *"Doctor Running Ahead of Schedule ⚡"*
       - Text: *"Dr. [Name] is ready for early consultations. Can you arrive now?"*
       - Actions: `[I'm On My Way]` (confirms early arrival) and `[Keep Booked Time]` (dismisses).
       - Reassurance: *"Declining changes nothing. Your booked slot at [Time] remains 100% guaranteed."*
  7. **Notification Denied Fallback Alert (`testID="push-denied-fallback-banner"`)**:
     - Shown if device push permissions are denied:
       *"🔔 Push Notifications Off: Don't worry! Live queue updates, ETA changes, and check-in codes are sent directly via WhatsApp and SMS."*

---

### Screen 4: Web OPD Patient Ticket (`apps/merchant-web/src/app/ticket/[id]/page.tsx`)
- **File:** `apps/merchant-web/src/app/ticket/[id]/page.tsx`
- **Route:** `/ticket/[id]`
- **Purpose:** Universal link dispatched via SMS/WhatsApp, viewable in any mobile or desktop web browser without app install.
- **UI Components & Layout:**
  1. **60-Minute PIN Visibility Gate**:
     - Server-side masked via `/api/ticket/[id]` (`checkin_code: null`, `is_window_open: false` when $> 60$m).
     - Locked countdown box when $> 60$m (`data-testid="checkin-pin-locked-box"`).
     - Revealed 4-digit PIN with copy button when $\le 60$m (`data-testid="customer-checkin-pin"`).
     - PIN completely hidden after check-in, replaced with verified presence banner (`data-testid="verified-present-banner"`).
  2. **Arrival Window Display**:
     - Explicit arrival window: `Booked Time ± 10 mins`.
  3. **Live Rolling Ten-Slot Queue & Pure ETA**:
     - Visual token board showing who is In Consultation, Up Next, and Waiting.
     - Pure recomputed ETA time stamp.
  4. **Standby Queue Honest Estimate**:
     - Displays standby queue status and honest wait time explanation for late arrivals.
  5. **Doctor Emergency Notification Modal (`DoctorEmergencyModal.tsx`)**:
     - Real-time detection of doctor emergency cancellation.
     - Shows Wait/Reschedule/100% Refund options.

---

### Screen 5: Customer Mobile Home Screen Live Card (`HomeScreen.tsx`)
- **File:** `apps/customer-mobile/src/screens/HomeScreen.tsx`
- **Purpose:** High-visibility hero banner at top of Customer Home screen for today's active upcoming appointment.
- **UI Components & Layout:**
  1. **Pulsing Micro Green Dot (`🟢`) Animation**:
     - Micro-animated green beacon pulsing continuously.
     - Live label: *"UPCOMING TODAY"* or *"ACTIVE VISIT"*.
  2. **Essential Appointment Details**:
     - Doctor Name & Specialty.
     - Hospital / Clinic Name.
     - Booked Slot & `±10 min` Arrival Window.
  3. **Quick Actions**:
     - `[View Pass / PIN]`: Instantly opens `BookingPassModal`.
     - `[I've Reached]`: One-tap lobby check-in signal.
  4. **Notification Denied Alert**:
     - Small dismissible pill alerting patient that WhatsApp/SMS is being used for alerts.

---

## 4. Step 2 Implementation Plan (Post-Approval)

Upon receiving `"approved"`, the following changes will be implemented in Step 2:

1. **`apps/customer-mobile/src/screens/CheckoutModal.tsx`**:
   - Replace retired "+2 Token Buffer" card with canonical `±10 Min Arrival Window` card and ceiling rule.
   - Refine 60m cancellation policy text to make deposit forfeiture under 60m and 100% business refund explicit.
2. **`apps/customer-mobile/src/screens/BookingPassModal.tsx`**:
   - Add the optional `"Come Now?"` invite card when doctor is running early with `I'm On My Way` vs `Keep Booked Time` buttons.
   - Refine Standby Queue card with honest estimate text per SPEC line 36–37.
   - Add notification denied fallback banner reminding patient of WhatsApp/SMS delivery.
3. **`apps/merchant-web/src/app/ticket/[id]/page.tsx`**:
   - Add arrival window display (`±10 mins`) and Standby Queue honest estimate banner.
   - Add early arrival invite indicator when doctor runs ahead of schedule.
4. **`apps/customer-mobile/src/screens/HomeScreen.tsx`**:
   - Add notification fallback alert when push permissions are denied.
5. **Physical Device E2E Manual Script (`docs/e2e/manual-script.md`)**:
   - Document manual test steps for real phone testing:
     - Exact label names on every screen.
     - App restart restores state from local storage and Supabase session.
     - Airplane mode toggle then reconnect updates queue position and ETA.
6. **Verification Gate**:
   - Run `pnpm typecheck`.
   - Run mobile test script (`pnpm --filter @appointments/customer-mobile test` / test-all).
   - Run production web build (`ALLOW_MOCK_PAYMENTS=false pnpm build`).
   - Run serial test suites and report counts.

---

## 5. Implementation Status
Step 1 approved by user. Step 2 built and verified.
- Hospital OPD Arrival Window (±10 minutes) and ceiling rule implemented in `CheckoutModal.tsx`, `BookingPassModal.tsx`, `HomeScreen.tsx`, and `/ticket/[id]`.
- 60-Minute Cancellation / Reschedule policy prominently itemized.
- Standby Queue honest estimate banner implemented.
- Optional "Come Now?" invite implemented.
- Notification denied fallback banner implemented.
- Real phone manual script authored in `docs/e2e/manual-script.md`.
- All gates passed.
