# Manual Test Scripts (Physical Device Required)

These test cases require physical mobile hardware or native Expo Go interaction (camera QR scan, native OS backgrounding/kill, native permissions denial, and offline/airplane mode toggling) and cannot be fully automated headlessly in Node.js / Playwright.

---

## Suite 1: Canonical Terminology & Screen Label Audit

**Objective:** Verify that every customer screen and web ticket page strictly uses the identical names specified in [`docs/hospital/SPEC.md`](file:///Users/trinadh/projects/Appointments/docs/hospital/SPEC.md) lines 8–9.

### Canonical Terminology Reference Table
| Category | Canonical Terms (Must Match Exactly) | Forbidden / Retired Variants |
| :--- | :--- | :--- |
| **Roles** | `Hospital Admin`, `Front Desk`, `Consultant` | `Doctor`, `Doctor's Assistant`, `Receptionist`, `Staff` |
| **Arrival Tags** | `On Time`, `Early`, `Late`, `Expected` | `Delayed`, `Punctual`, `Ahead`, `Pending` |
| **Statuses** | `Booked`, `Checked In`, `Waiting`, `Up Next`, `In Consultation`, `Completed`, `No Show` | `Scheduled`, `Admitted`, `Serving`, `Done`, `Absent` |
| **Queues** | `Live Queue`, `Waiting Queue`, `Standby Queue` | `Late Buffer Queue`, `Buffer Queue`, `Overflow Queue` |

### Step-by-Step Test Procedure:
1. **Home Screen (`HomeScreen.tsx`)**:
   - Inspect top hero appointment card (`home-live-appointment-card`).
   - Verify indicator label: `🟢 LIVE UPCOMING APPOINTMENT`.
   - Verify slot time display includes: `Arrival Window: [Time] – [Time] (±10m)`.
   - Verify check-in code box reads: `🔑 Permanent Check-in PIN (LIFETIME)`.
2. **Booking & Checkout Modal (`CheckoutModal.tsx`)**:
   - Select an available slot for a hospital consultant.
   - In the Checkout Sheet, verify header: `Arrival Window: Booked Time ± 10 Minutes`.
   - Verify ceiling rule: *"The booked time is a ceiling. Starting earlier is always allowed when you are present and the doctor is free."*
   - Verify policy card title: `🛡️ Cancellation & Refund Policy`.
   - Verify cancellation terms: *"Free cancellation & reschedule up to 60 minutes before slot — 100% deposit refunded. Within 60 minutes: Deposit is forfeited."*
   - Verify no-show text: *"Two times no-show: 100% courtesy deposit refund. 3rd to 5th no-show: ₹60 penalty (₹50 to hospital, ₹10 to Appointments app), rest refunded. Exceeding 5 no-shows: Account blocked for 7 days."*
3. **Digital Booking Pass Modal (`BookingPassModal.tsx`)**:
   - Open pass for a confirmed appointment.
   - Verify Arrival Window card: `Arrival Window: Booked Time ± 10 Minutes` with `±10m Window` pill.
   - Verify status stepper sequence: `Booked` ➔ `Checked In` ➔ `Waiting` ➔ `Up Next` ➔ `In Consultation` ➔ `Completed`.
   - Prior to 60m: Verify locked box shows `🔒 Check-in Code Opening Soon: Your 4-digit reception OTP will appear here 60 minutes before your slot`.
   - Within 60m: Verify unlocked box reads `RECEPTION CHECK-IN CODE` with 4-digit numeric code.
   - After Check-in: Verify PIN is **hidden** and replaced by emerald badge `✓ Verified Present at Reception`.
   - If Late: Verify Standby box reads `STANDBY QUEUE ASSIGNED: Standby #X` and honest estimate: *"The doctor will see you in gaps between on-time patients or at the end of the session. You will never be dropped!"*
4. **Web OPD Patient Ticket (`/ticket/[id]`)**:
   - Open ticket URL on a mobile web browser (Chrome / Safari).
   - Verify header reads: `OPD Patient Ticket` with hospital address and reference code.
   - Verify arrival window card: `OPD Arrival Window (±10 Mins)` with ceiling explanation.
   - Verify rolling queue headers: `Now Serving`, `Up Next`, `Waiting Lounge`.

---

## Suite 2: App Kill & Restart State Restoration

**Objective:** Verify that native OS process kill, memory eviction, and manual app restarts seamlessly restore authenticated user session, active bookings, permanent check-in PIN, and live queue position.

### Step-by-Step Test Procedure:
1. **Initial Setup**:
   - Log into the customer mobile app on a physical Android or iOS device.
   - Book or select an active appointment for today.
   - Open the digital pass to confirm the live queue position and 4-digit check-in PIN.
2. **Force-Quit App**:
   - On iOS: Swipe up from the bottom edge and hold, then swipe up on the Appointments card to force-quit the app process.
   - On Android: Open the App Switcher / Overview screen and swipe the Appointments app away (or go to Settings ➔ Apps ➔ Appointments ➔ Force Stop).
3. **Relaunch**:
   - Tap the Appointments app icon on the home screen to relaunch from a cold start.
4. **State Verification**:
   - **Authentication Session**: App must launch directly into the authenticated state without prompting for mobile number, OTP, or password.
   - **Home Screen Live Card**: The active upcoming appointment card must immediately render at the top with the pulsing micro green light (`🟢`).
   - **Check-in Code Continuity**: Open the booking pass. The 4-digit PIN must match the previous PIN exactly (confirming lifetime immutability).
   - **Queue Continuity**: Verify that the assigned token number and queue standing match the backend database state without duplicate record creation.

---

## Suite 3: Airplane Mode Toggle & Reconnection Live Queue Sync

**Objective:** Verify that loss of cellular/Wi-Fi connectivity does not crash the app, and that restoring connection automatically reconnects Supabase Realtime channels and updates queue status, pure ETA, and consultation progression.

### Step-by-Step Test Procedure:
1. **Preparation**:
   - Open the Appointments app on a phone with active cellular and Wi-Fi connection.
   - Navigate to the active booking pass or the web ticket page (`/ticket/[id]`).
   - Note the current queue state: e.g. Token #2 in consultation, your Token #4 in Waiting.
2. **Sever Connection (Airplane Mode ON)**:
   - Swipe open the device Control Center / Quick Settings.
   - Enable **Airplane Mode** (disabling both Wi-Fi and Cellular data).
   - Return to the Appointments app.
3. **Offline Behavior Audit**:
   - App must remain completely responsive (no white screens, unhandled promise rejections, or frozen touch targets).
   - Pass continues to display the permanent check-in code and cached arrival window.
   - On web ticket (`/ticket/[id]`), the offline banner appears: `⚠️ Offline mode — showing cached ticket data. Reconnect to refresh live queue.`
4. **Merchant Desktop Simulation**:
   - On the Merchant desktop dashboard, complete Token #2 and advance Token #3 into consultation.
5. **Restore Connection (Airplane Mode OFF)**:
   - Swipe open Control Center / Quick Settings.
   - Turn **Airplane Mode OFF** and wait 3–5 seconds for Cellular/Wi-Fi reconnection.
6. **Reconnection Sync Audit**:
   - App automatically catches network reconnection event.
   - On web ticket: Banner displays `🟢 Reconnected — live queue status updated!`.
   - On mobile pass: Live queue position automatically decrements to reflect Token #3 in consultation and Token #4 as `Up Next` without requiring manual page refresh or pull-to-refresh.
   - Live wait time and pure ETA recalculate accurately based on current doctor consultation pacing.

---

## Suite 4: Push Notification Denial Fallback Behavior

**Objective:** Verify that when a user denies push notification permissions during onboarding or in OS system settings, the app gracefully falls back to SMS & WhatsApp as guaranteed in SPEC lines 28–29.

### Step-by-Step Test Procedure:
1. **Permission Denial**:
   - On iOS: Go to **Settings ➔ Appointments ➔ Notifications ➔ Allow Notifications: OFF**.
   - On Android: Go to **Settings ➔ Apps ➔ Appointments ➔ Notifications ➔ Show notifications: OFF**.
   - Or on web: In browser site settings, set **Notifications: Blocked**.
2. **App Launch & Audit**:
   - Open the Appointments mobile app.
   - Observe the Home screen and the digital booking pass.
3. **Banner Verification**:
   - Verify the reassurance banner appears with testID `home-push-denied-notice` and `push-denied-fallback-banner`:
     > *"🔔 Push Notifications Disabled: Updates, live ETAs, and your reception PIN will be delivered via WhatsApp and SMS."*
4. **Booking Lifecycle Execution**:
   - Complete a booking or trigger a status change (e.g., reception check-in).
   - Verify the customer profile is not flagged or blocked due to missing `ExponentPushToken`.
   - Verify Supabase Edge Function `send-booking-notification` safely falls back to WhatsApp Cloud API / SMS gateway dispatch.
   - Confirm receipt of appointment confirmation and 60-minute reception PIN reminder via SMS or WhatsApp message on the real phone.
