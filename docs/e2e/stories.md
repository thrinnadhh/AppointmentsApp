# Scenario-Based End-to-End "Story" Specification: Hospital Vertical

> **Source of Truth:** [`docs/hospital/SPEC.md`](file:///Users/trinadh/projects/Appointments/docs/hospital/SPEC.md)  
> **Scope:** 6 Hospitals (`story-h1` to `story-h6`), 6 Customers (`U1` to `U6`), Staff Roster, Platform Admin.  
> **Rule:** Every expected result is strictly derived from SPEC.md. Steps marked **REPORT** document the current empirical behavior for open decisions without hard assertions.

---

## 1. Cast of Characters & Infrastructure

### 1.1 Hospitals & Clinics

| ID | Code / Prefix | Description | Departments & Capacity | Consultants | Front Desk Roster | Deposit & Slot Duration | City | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **H1** | `story-h1` | Large Multi-Specialty Hospital | 4 Departments: Neurology, Dermatology, Dentistry, Neurosurgery | 5 Consultants (Dr. Sharma, Dr. Patel [Neuro]; Dr. Reddy [Derma]; Dr. Rao [Dental]; Dr. Varma [Neurosur]) | 3 Front Desk staff (FD-1 assigned to Sharma & Patel; FD-2 to Reddy; FD-3 to Rao & Varma) | ₹200 Deposit; 10-minute slots | Tirupati | `ACTIVE` (Approved) |
| **H2** | `story-h2` | Single Doctor Clinic | 1 Department: General Medicine | 1 Consultant (Dr. Kumar) | 1 Front Desk (FD-Solo) | ₹100 Deposit; 15-minute slots | Tirupati | `ACTIVE` (Approved) |
| **H3** | `story-h3` | Capacity & Governance Limits | 2 Departments: Cardiology (at max 3-member quota), Orthopedics | 2 Consultants | 1 Shared Front Desk across departments | ₹500 Deposit; 15-minute slots | Tirupati | `ACTIVE` (Approved) |
| **H4** | `story-h4` | Availability Edge Hospital | 1 Department: Pediatrics | 2 Consultants: Dr. Leave (on leave all day), Dr. Emergency (unavailable mid-day) | 1 Front Desk | ₹200 Deposit; 10-minute slots | Tirupati | `ACTIVE` (Approved) |
| **H5** | `story-h5` | Second City Isolation Hospital | 1 Department: Ophthalmology | 1 Consultant | 1 Front Desk | ₹200 Deposit; 15-minute slots | Nellore | `ACTIVE` (Approved) |
| **H6** | `story-h6` | Onboarding & Lifecycle Hospital | 1 Department: ENT | 1 Consultant | 1 Front Desk | ₹100 Deposit; 10-minute slots | Tirupati | Dynamic: `UNREGISTERED` $\rightarrow$ `PENDING` $\rightarrow$ `APPROVED` $\rightarrow$ `SUSPENDED` |

### 1.2 Customers (Patients)

| ID | Persona | Typical Journey / Role in Stories | Phone Number | City |
| :--- | :--- | :--- | :--- | :--- |
| **U1** | Happy Path Patient | Signs up via OTP, consents, books on time, checks in with 4-digit code, completes consultation, deletes account clean. | `+919848011101` | Tirupati |
| **U2** | Canceller & Rescheduler | Tests free cancellation (>= 60m), late cancellation (< 60m forfeited), reschedule (retained code), hospital cancellation refund. | `+919848011102` | Tirupati |
| **U3** | Chronically Late Patient | Arrives 15 minutes late (> +10m window) in H1 and H2; routed to Standby Queue; verifies FIFO ordering & no leapfrogging. | `+919848011103` | Tirupati |
| **U4** | Repeat No-Show Patient | Misses slot 1 (courtesy refund), misses slot 2 (courtesy refund), warned on booking 3 (₹60 split notice), misses slot 3 (penalty applied). | `+919848011104` | Tirupati |
| **U5** | Present but Unreached Patient | Checks in on time, hospital runs over / closes session without seeing U5; verifies NOT a no-show, full refund / free reschedule. | `+919848011105` | Tirupati |
| **U6** | Concurrency, Security & Edge Abuser | Competes in 50 concurrent race bookings against U1; tests cross-tenant IDOR probes; deletion with active holds and bookings. | `+919848011106` | Tirupati |

### 1.3 Administrative Staff
- **Hospital Admins:** `admin.story-h1@hospital-test.local` through `admin.story-h6@hospital-test.local` (Hospital Admin / In-Charge role).
- **Platform Admin:** `platform.admin@appointments-platform.local` (Superadmin governance role).

---

## 2. Story Steps Specification

### Group 1: Registration and Onboarding (ST-01 to ST-04)

#### ST-01: Customer Phone OTP Registration, Consents & Rate Limiting
- **Actor:** Customer `U1` (`+919848011101`).
- **Action:**
  1. Trigger `POST /auth/v1/otp` with valid phone.
  2. Verify 6 rapid consecutive OTP requests are throttled with HTTP 429 / rate-limit response.
  3. Submit invalid OTP (`000000`) $\rightarrow$ verify 400 Bad Request error.
  4. Submit valid OTP $\rightarrow$ session token returned, `public.profiles` row created with role `customer`.
  5. Record explicit DPDPA user consent in `public.user_consents` (telecom/SMS, privacy policy, terms).
- **Expected Result (SPEC line 6, 28):** Profile created; consents timestamped; wrong/rapid OTP correctly rate-limited and rejected; no backdoor tokens allowed.

#### ST-02: Profile Updating, City Selection & Row-Level Isolation
- **Actor:** Customer `U1`.
- **Action:**
  1. `U1` updates profile with full name ("U1 Anand"), email, and selected city "Tirupati".
  2. `U1` queries `public.profiles` for own profile $\rightarrow$ receives row.
  3. Unauthenticated client and other customers query `U1`'s profile row $\rightarrow$ receive 0 rows / 403 Forbidden.
- **Expected Result (SPEC line 6):** Customer can update and read own profile; strict RLS blocks cross-customer profile reading.

#### ST-03: Merchant Hospital Registration, Platform Approval & Suspension
- **Actor:** Hospital Owner `H6` and Platform Admin.
- **Action:**
  1. `H6` owner registers provider via `POST /api/providers/register` $\rightarrow$ initial status `PENDING`, `is_active = false`.
  2. Customer `U1` searches hospitals in Tirupati $\rightarrow$ `H6` is invisible.
  3. Platform Admin updates `H6` status to `ACTIVE`, `is_active = true`.
  4. `U1` searches hospitals $\rightarrow$ `H6` is visible and selectable.
  5. Customers book slots on `H6`.
  6. Platform Admin suspends `H6` (`status = 'SUSPENDED'`, `is_active = false`).
  7. **REPORT:** Check what happens to existing confirmed bookings (are they preserved, cancelled, or refunded?).
- **Expected Result (SPEC line 40, 45-46):** Pending/suspended hospitals invisible to customer discovery; suspension behavior on existing bookings documented.

#### ST-04: Hospital Admin Setup: Departments, Consultants, Services & Quotas
- **Actor:** Hospital Admin `H1` and `H3`, Front Desk staff.
- **Action:**
  1. `H1` Admin creates 4 departments (Neurology, Dermatology, Dentistry, Neurosurgery).
  2. `H1` Admin creates 5 Consultants with services, duration (10m), fees, and schedules (`09:00-13:00`, `16:00-20:00`).
  3. `H1` Admin assigns Front Desk staff (FD-1 assigned to 2 Consultants).
  4. `H3` Admin attempts to add a 4th member to a department already having 3 members $\rightarrow$ blocked with quota limit error.
  5. Inactive doctor service toggled `is_active = false` $\rightarrow$ hidden from slot booking.
  6. Front Desk staff attempts to add a consultant or create a department $\rightarrow$ rejected with 403 Forbidden.
- **Expected Result (SPEC lines 3-5):** Only Hospital Admin can manage departments, consultants, and assignments; max 3 members per department strictly enforced; front desk restricted from admin actions.

---

### Group 2: Discovery and Booking (ST-10 to ST-16)

#### ST-10: City Isolation in Discovery
- **Actor:** Customer `U1` (selected city: Tirupati).
- **Action:** Customer queries active hospitals via `GET /api/categories/clinics/providers?city=Tirupati`.
- **Expected Result (SPEC line 7):** Returns H1, H2, H3, H4 (Tirupati); `H5` (Nellore) is strictly excluded.

#### ST-11: Schedule-Bound Future Slot Lists & Leave Filtering
- **Actor:** Customer `U1`.
- **Action:**
  1. Query slots for Dr. Sharma (H1) $\rightarrow$ only future slots within active session hours (`09:00-13:00`, `16:00-20:00`) appear.
  2. Query slots for Dr. Leave (H4, marked on leave for test day) $\rightarrow$ 0 available slots returned.
- **Expected Result (SPEC line 11, 45):** Slots match doctor's schedule; inactive/leave doctors display 0 bookable slots.

#### ST-12: Booking Hold, Payment Deposit, 4-Digit Code & Arrival Window
- **Actor:** Customer `U1` booking Dr. Sharma (H1) 10:00 AM slot.
- **Action:**
  1. Call `POST /api/bookings/hold` $\rightarrow$ 5-minute hold created (`hold_expires_at = NOW() + 5m`).
  2. Process ₹200 deposit payment capture webhook (`payment.captured`).
  3. Verify booking status transitions to `CONFIRMED`.
  4. Verify permanent 4-digit numeric check-in PIN exists in database.
  5. Verify booking confirmation shows Arrival Window: `09:50 AM - 10:10 AM` (slot_start $\pm$ 10m).
  6. Verify notification event logged in `notification_logs` for hospital and patient.
- **Expected Result (SPEC lines 11, 26, 35):** Hold lasts 5 minutes; deposit confirms booking; 4-digit code generated; $\pm$ 10m window displayed.

#### ST-13: Abandoned Hold Expiration & Webhook Idempotency
- **Actor:** Customer `U2`.
- **Action:**
  1. `U2` holds a slot but abandons payment. Advance test clock by 6 minutes.
  2. Attempt payment or check slot availability $\rightarrow$ hold expired, slot reopens.
  3. For a successful booking, send duplicate Razorpay `payment.captured` webhook with identical `order_id` and `payment_id`.
- **Expected Result (SPEC line 11):** Expired holds release slots; duplicate webhooks are idempotent (1 booking, 1 payment record, 0 double charging).

#### ST-14: Concurrent Race on Same Slot (50 Iterations)
- **Actor:** Customers `U1` and `U6`.
- **Action:** 50 sequential runs where `U1` and `U6` fire simultaneous `create_booking_hold` requests for the exact same doctor and slot.
- **Expected Result (SPEC line 11):** In 100% of runs (50/50), exactly one customer acquires the hold (`201 Created`); the loser receives clear conflict error (`409 Conflict` / exclusion constraint rejection). Zero double-bookings.

#### ST-15: Overlapping Bookings with Two Different Doctors
- **Actor:** Customer `U1`.
- **Action:** `U1` books 10:00 AM - 10:15 AM with Dr. Kumar (H2) and simultaneously attempts 10:00 AM - 10:10 AM with Dr. Rao (H1).
- **Expected Result (SPEC lines 13, 44):** **REPORT** current code behavior (Does PostgreSQL GiST constraint allow overlapping slots across different `resource_id`s for the same customer?).

#### ST-16: Schedule Boundary & Midnight IST Slot Correctness
- **Actor:** Customer `U1`.
- **Action:**
  1. Attempt booking at 08:50 AM (outside 09:00 session start) $\rightarrow$ rejected.
  2. Book last slot of evening session (19:50 - 20:00) $\rightarrow$ succeeds.
  3. Query slots bridging across midnight IST (00:00 IST) $\rightarrow$ verifies day-of-week and date strings match Asia/Kolkata calendar without off-by-one UTC shifts.
- **Expected Result (SPEC line 35):** Bookings outside session hours rejected; boundary slots valid; timezone strictly `Asia/Kolkata`.

---

### Group 3: Before the Visit (ST-20 to ST-23)

#### ST-20: 60-Minute Pre-Slot PIN Visibility Gate & Reminder Dispatch
- **Actor:** Customer `U1`, Dr. Sharma 11:00 AM slot.
- **Action:**
  1. Set test clock to 09:30 AM (> 60m pre-slot). Query `/api/ticket/[id]` $\rightarrow$ `checkin_code` is `null`, `is_window_open` is `false`.
  2. Advance test clock to 10:01 AM (59m pre-slot). Query `/api/ticket/[id]` $\rightarrow$ 4-digit PIN is revealed (`is_window_open` is `true`).
  3. Verify 1-hour appointment reminder notification queued exactly once.
- **Expected Result (SPEC lines 27, 38):** PIN strictly masked until $\le$ 60 minutes before scheduled slot; reminder dispatched without duplication.

#### ST-21: Customer Cancellation Cutoff (>= 60m Refund vs < 60m Forfeited)
- **Actor:** Customer `U2`.
- **Action:**
  1. `U2` cancels Appointment A with 75 minutes remaining $\rightarrow$ booking status `CANCELLED`, 100% deposit refunded, slot immediately reopens.
  2. `U2` books Appointment B. Advance clock to 59 minutes 59 seconds before slot. `U2` attempts cancellation $\rightarrow$ status `CANCELLED`, deposit forfeited (₹0 refund).
- **Expected Result (SPEC line 12):** Free cancellation $\ge$ 60m with full refund; deposit forfeited $<$ 60m.

#### ST-22: Customer Reschedule Policy & Code Immutability
- **Actor:** Customer `U2`.
- **Action:** `U2` reschedules an appointment with 90 minutes remaining to a later slot with the same doctor.
- **Expected Result (SPEC lines 12, 26, 47):** Free reschedule; old slot released; new slot confirmed; **REPORT** whether permanent 4-digit PIN remains identical.

#### ST-23: Business / Hospital Initiated Cancellation
- **Actor:** Hospital Admin `H1`.
- **Action:** Hospital cancels a confirmed appointment (e.g. equipment malfunction).
- **Expected Result (SPEC line 12):** 100% full refund issued (deposit + platform fee); patient notified.

---

### Group 4: Visit Day — Clock Driven (ST-30 to ST-38)

#### ST-30: On-Time Customer Happy Path (Check-in $\rightarrow$ In Consultation $\rightarrow$ Completed)
- **Actor:** Customer `U1`, Dr. Sharma (H1), Slot 10:00 AM.
- **Action:**
  1. Clock at 09:55 AM (inside $\pm$ 10m window). Front Desk submits U1's 4-digit PIN.
  2. Verify arrival tag is **On Time**, status **Waiting**, appears as **Up Next**.
  3. Doctor calls patient $\rightarrow$ status **In Consultation**, live timer active.
  4. Attempt second check-in using same code $\rightarrow$ rejected (cannot reuse).
  5. Doctor ends consultation $\rightarrow$ status **Completed**, appears in customer history.
- **Expected Result (SPEC lines 9, 27, 30, 36):** Code verified; tagged On Time; transitions Up Next $\rightarrow$ In Consultation $\rightarrow$ Completed; code cannot be reused.

#### ST-31: Early Arrival Prioritization & Doctor Idling Prevention
- **Actor:** Customer `U2` (Early, 10:30 slot arriving 10:05), Customer `U1` (On Time, 10:10 slot arriving 10:05).
- **Action:** Doctor finishes earlier patient at 10:06 AM.
- **Expected Result (SPEC line 36):** On Time patient whose window is open (`U1`) is seen first. Early patient (`U2`) is seen only to prevent doctor idling if no on-time patient is present.

#### ST-32: Late Arrival (Standby Queue, FIFO Ordering, No Leapfrogging)
- **Actor:** Customer `U3` (booked 10:00 AM, arrives at 10:16 AM, > 10m late).
- **Action:**
  1. Front Desk verifies `U3` code $\rightarrow$ tagged **Late**, placed into **Standby Queue**.
  2. On Time patient `U1` (10:15 slot) checks in at 10:14 AM $\rightarrow$ placed in Waiting Queue.
  3. Doctor becomes free at 10:16 AM.
- **Expected Result (SPEC lines 36-37):** Late patient never displaces present On Time patient. `U3` is served in free gap only if consultation fits before next booked patient; otherwise served when all booked patients finish.

#### ST-33: Complete No-Show Lifecycle (Strikes 1 to 3 & Penalty Split)
- **Actor:** Customer `U4` in H1 (₹200 deposit).
- **Action:**
  1. Miss 1: `U4` does not check in. Session ends $\rightarrow$ tagged **No Show**. Strike count = 1. 100% deposit refunded (courtesy).
  2. Miss 2: `U4` misses another slot $\rightarrow$ Strike count = 2. 100% deposit refunded.
  3. Booking 3: `U4` initiates 3rd booking $\rightarrow$ Warning modal / note displayed detailing ₹60 penalty.
  4. Miss 3: `U4` misses 3rd slot $\rightarrow$ Strike count = 3. Penalty applied: ₹50 to hospital, ₹10 to platform, ₹140 refunded. Account NOT blocked.
  5. `U4` books 4th appointment $\rightarrow$ booking succeeds.
- **Expected Result (SPEC lines 20-23):** Strikes 1-2 courtesy refund; Strike 3 warning displayed; Strike 3 penalty ₹50/₹10 split, remainder refunded; account not blocked at 3 strikes.

#### ST-34: Checked In but Unreached by Session End (Not a No-Show)
- **Actor:** Customer `U5`.
- **Action:** `U5` checks in on time and waits in clinic. Session ends due to doctor emergency or clinic closing without seeing `U5`.
- **Expected Result (SPEC line 24):** Patient is explicitly NOT a no-show (strike count = 0); entitled to free reschedule or 100% full refund.

#### ST-35: Front Desk Security Lockout & Cross-Doctor Scoping
- **Actor:** Front Desk `FD-1` (H1).
- **Action:**
  1. Submit 5 consecutive invalid check-in codes $\rightarrow$ user locked out for 60 seconds.
  2. Verify other staff users (`FD-2`) can still verify codes.
  3. Advance clock 61 seconds $\rightarrow$ lockout cleared.
  4. Submit code from `H2` hospital or unassigned consultant $\rightarrow$ returns uniform error `{"error": "Invalid check-in code"}` with zero leak of patient or clinic existence.
  5. Front Desk performs manual mark-present with justification $\rightarrow$ logged in `audit_logs` with staff `user_id`.
- **Expected Result (SPEC lines 16, 27):** 5-failure 60s lockout; uniform error on foreign codes; manual check-in logged.

#### ST-36: Concurrent Front Desk Actions & Multi-Consultant Queues
- **Actor:** Front Desk `FD-1` (assigned to Dr. Sharma & Dr. Patel) and `FD-2`.
- **Action:**
  1. Two staff click "Start Consultation" on same patient simultaneously $\rightarrow$ exactly one succeeds (optimistic locking `version` check), other receives concurrency conflict.
  2. `FD-1` switches between Dr. Sharma and Dr. Patel queues $\rightarrow$ both queues accessible and functional.
  3. `FD-1` attempts to access Dr. Reddy's queue $\rightarrow$ denied with 403 Forbidden.
- **Expected Result (SPEC lines 4, 7):** Optimistic concurrency lock prevents duplicate transitions; assigned front desk manages multiple consultants; unassigned access blocked.

#### ST-37: 30-Minute Consultation Overrun, ETA Gating & Medical Urgency Override
- **Actor:** Dr. Sharma (H1).
- **Action:**
  1. Consultation runs 30 minutes over. Queue engine pushes later ETAs forward.
  2. Verify notification sent to downstream customer ONLY if new ETA leaves their $\pm$ 10m window.
  3. When doctor runs early, optional "Come Now?" invite dispatched.
  4. Hospital Admin or Consultant triggers Medical Urgency Override to move emergency patient to top $\rightarrow$ logged in `audit_logs`.
- **Expected Result (SPEC lines 38):** ETAs update; notifications gated to window departures; medical overrides logged.

#### ST-38: Consultant Becomes Unavailable Mid-Day
- **Actor:** Dr. Emergency (H4).
- **Action:** Dr. Emergency leaves mid-day with 3 pending confirmed patients. Admin triggers `POST /api/doctor/emergency-cancel`.
- **Expected Result (SPEC lines 14-18, 46):** In-app popup modal shown ("Due to emergency, doctor is not available"); if doctor arrived midway: options Wait / Reschedule / 100% Refund; **REPORT** current remaining queue behavior.

---

### Group 5: Money & Financial Reconciliation (ST-40)

#### ST-40: End-of-Day Financial Invariant Reconciliation
- **Actor:** Platform Financial Auditor across H1, H2, H3, H4, H5.
- **Action:** For each hospital, reconcile the entire day's financial ledger:
  $$\text{Total Deposits Collected} = \text{Total Refunds} + \text{Doctor Shares} + \text{Platform Shares} + \text{Forfeited Amounts}$$
- **Expected Result (SPEC lines 12, 18, 22):** Mathematical equality holds across all ledger entries; admin dashboard revenue matches database sums; zero double-refund discrepancies.

---

### Group 6: Account Lifecycle & DPDPA Deletion (ST-50 to ST-53)

#### ST-50: Clean Customer Account Deletion (No Active Bookings)
- **Actor:** Customer `U1`.
- **Action:** `U1` requests account deletion via `POST /api/account/delete`.
- **Expected Result (SPEC line 6, launch checklist §9, 10):**
  1. `U1` session invalidated, cannot log in.
  2. Profile personal details (phone, email, full name) scrubbed/anonymized.
  3. Notification logs, push tokens, and file attachments scrubbed.
  4. Consents revoked.
  5. Front desk and doctor screens show anonymized placeholder (e.g. `[Deleted Patient]`), phone unreadable.
  6. Financial records retained in anonymized form for accounting audit compliance.

#### ST-51: Account Deletion with Active Holds or Confirmed Bookings
- **Actor:** Customer `U6`.
- **Action:**
  1. Attempt deletion with an active 5-minute hold.
  2. Attempt deletion with an upcoming confirmed booking.
- **Expected Result (SPEC line 40):** **REPORT** current behavior (Does API reject deletion, or cancel bookings with refund?).

#### ST-52: Re-Registration with Same Phone After Deletion
- **Actor:** Customer `U1` phone (`+919848011101`).
- **Action:** Phone triggers `POST /auth/v1/otp` after previous account was deleted.
- **Expected Result (SPEC line 40):** **REPORT** current behavior (Is a brand new clean profile created, or does old profile reactivate?).

#### ST-53: Staff Removal & Consultant De-allocation Mid-Day
- **Actor:** Hospital Admin `H1`.
- **Action:**
  1. Front desk member status updated to `revoked` $\rightarrow$ active session immediately denied on next API call.
  2. Consultant de-allocated or removed while having future confirmed bookings $\rightarrow$ **REPORT** what happens to existing bookings.
- **Expected Result (SPEC lines 3, 45):** Revocation immediately cuts access; consultant removal on existing bookings reported.

---

### Group 7: Cross-Hospital & Cross-Customer Isolation Matrix (ST-60)

#### ST-60: Exhaustive 6 Hospitals x 6 Customers Isolation Matrix
- **Actor:** All 6 Customers (`U1` - `U6`), All Staff roles (`H1` - `H6`).
- **Action:**
  1. Each customer attempts to `GET /api/ticket/[other_id]`, `POST /api/bookings/cancel` on other customers' bookings.
  2. Each front desk attempts to access other hospitals' check-in RPCs and queues.
  3. Each consultant attempts to query peer doctors' appointments.
  4. Platform Admin queries cross-hospital aggregated metrics.
- **Expected Result (SPEC lines 3-7):**
  - Customer-to-customer probes: 100% blocked (403/404) with zero personal data leakage in errors.
  - Staff cross-hospital probes: 100% blocked by RLS and application authorization guards.
  - Consultant cross-doctor probes: 100% blocked.
  - Platform Admin can inspect platform-wide audit logs.

---

## 3. Test Execution Map & Deliverables

```
docs/e2e/stories.md (Specification)
       │
       ▼
tests/e2e/stories/
  ├── seed.mjs (Cast Seeder & .local/story-accounts.md Writer)
  ├── 01-registration-onboarding.test.mjs (ST-01 to ST-04)
  ├── 02-discovery-booking.test.mjs (ST-10 to ST-16)
  ├── 03-before-visit.test.mjs (ST-20 to ST-23)
  ├── 04-visit-day.test.mjs (ST-30 to ST-38)
  ├── 05-money-reconciliation.test.mjs (ST-40)
  ├── 06-account-lifecycle.test.mjs (ST-50 to ST-53)
  └── 07-isolation-matrix.test.mjs (ST-60)
       │
       ▼
docs/e2e/stories-report.md (Results & Report Matrix)
docs/e2e/stories-manual.md (Real Phone App Verification Script)
docs/backlog.md (Any Uncovered Defects)
```
