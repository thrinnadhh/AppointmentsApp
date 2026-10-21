# Hospital Vertical: Manual Testing & Device Walkthrough Checklist

> **Target Platform:** Appointments Platform (`thrinnadhh/AppointmentsApp`)  
> **Vertical:** Hospital / Clinic Medical Departments  
> **Environment:** Test / Staging (`https://ynkdnwhubfknnnzjtpeg.supabase.co`)  
> **Merchant Web:** `http://localhost:3000` (Local Dev)  
> **Default Password:** `HospitalTest2026!` (for all test personas)

---

## 🔑 Test Personas & Credentials Quick Reference

| Role | Email | Scope | Password |
| :--- | :--- | :--- | :--- |
| **Hospital Admin (Apex)** | `admin.apex@test-tirupati.local` | Full hospital owner access (all depts, Team page, settings) | `HospitalTest2026!` |
| **Consultant (Neurology)** | `neuro.doc@test-tirupati.local` | Neurology appointments, queue, doctor consultations | `HospitalTest2026!` |
| **Front Desk (Neurology)** | `neuro.desk@test-tirupati.local` | Neurology check-ins, queue monitor, booking management | `HospitalTest2026!` |
| **Consultant (Dermatology)** | `derma.doc@test-tirupati.local` | Dermatology appointments, doctor consultations | `HospitalTest2026!` |
| **Front Desk (Dermatology)** | `derma.desk@test-tirupati.local` | Dermatology check-ins, appointments | `HospitalTest2026!` |
| **Hospital Admin (Balaji)** | `admin.balaji@test-tirupati.local` | Separate Hospital B (isolation tests) | `HospitalTest2026!` |
| **Salon Owner (Royal)** | `salon.royal@test-tirupati.local` | Salons vertical (regression test) | `HospitalTest2026!` |
| **Patients 01 to 15** | `test.patient.01@test-tirupati.local` ... `15` | Customer mobile app / booking test accounts | `HospitalTest2026!` |

---

## SECTION A: Team & Access Control (A1 – A11)

### [ ] A1: Department Creation & Module Assignment
- **Tester Role:** Hospital Admin (`admin.apex@test-tirupati.local`)
- **Steps:**
  1. Login to Merchant Web at `http://localhost:3000/login`.
  2. In top navigation, click **Team** (`/team`).
  3. Click **Add Department** button.
  4. Enter Department Name: `"Cardiology"`.
  5. Check allowed modules: `Appointments`, `Queue & Schedule`, `Check-In Desk`.
  6. Click **Save Department**.
- **Expected Result:**
  - [ ] Cardiology appears in the department list.
  - [ ] Default modules are checked and saved without error.
  - [ ] Audit log entry created with action `department.create`.

---

### [ ] A2: Invite Staff Member (Consultant / Front Desk)
- **Tester Role:** Hospital Admin (`admin.apex@test-tirupati.local`)
- **Steps:**
  1. On the **Team** page under Cardiology, click **Invite Member**.
  2. Enter Email: `cardio.doc@test-tirupati.local`.
  3. Select Role: `Consultant`.
  4. Submit invite form.
- **Expected Result:**
  - [ ] Member row shows email with badge `Invited`.
  - [ ] Expiry timestamp displays 7 days from today.
  - [ ] Member count increments (e.g. 1/3).

---

### [ ] A3: Accept Invite Flow
- **Tester Role:** Invited Staff (`cardio.doc@test-tirupati.local`)
- **Steps:**
  1. Open the invite link / sign-in screen.
  2. Authenticate or confirm email for `cardio.doc@test-tirupati.local`.
  3. Log into Merchant Web.
- **Expected Result:**
  - [ ] Status updates from `Invited` to `Active` in database (`department_members`).
  - [ ] `accepted_at` timestamp is populated.
  - [ ] Staff dashboard loads with Cardiology context.

---

### [ ] A4: 4th Member Rejection Trigger (Max 3 Staff Limit)
- **Tester Role:** Hospital Admin (`admin.apex@test-tirupati.local`)
- **Precondition:** Department has 3 active/invited members (e.g., Member 1, Member 2, Member 3).
- **Steps:**
  1. In that department, attempt to click **Invite Member** or submit a 4th invite.
  2. Enter Email: `fourth.staff@test-tirupati.local`.
  3. Click **Send Invite**.
- **Expected Result:**
  - [ ] Request is strictly rejected with error: `"This department already has 3 members."`
  - [ ] No 4th member is added to the database.

---

### [ ] A5: Duplicate Email Rejection Across Departments
- **Tester Role:** Hospital Admin (`admin.apex@test-tirupati.local`)
- **Precondition:** `neuro.doc@test-tirupati.local` is already in Neurology.
- **Steps:**
  1. Navigate to **Dermatology** department.
  2. Click **Invite Member**.
  3. Enter Email: `neuro.doc@test-tirupati.local`.
  4. Click **Send Invite**.
- **Expected Result:**
  - [ ] Rejection error displayed indicating this user is already assigned to another department.
  - [ ] Database prevents insertion due to unique constraint.

---

### [ ] A6: Hospital Admin Cannot Be Added As Staff
- **Tester Role:** Hospital Admin (`admin.apex@test-tirupati.local`)
- **Steps:**
  1. In any department, click **Invite Member**.
  2. Enter the Hospital Owner's email: `admin.apex@test-tirupati.local`.
  3. Click **Send Invite**.
- **Expected Result:**
  - [ ] Error message displayed: `"Hospital owner cannot be added as a department member."`
  - [ ] Action is blocked by database trigger.

---

### [ ] A7: 7-Day Invite Expiration Check
- **Tester Role:** Invited Staff
- **Precondition:** Invite was created > 7 days ago (or database `invite_expires_at` in the past).
- **Steps:**
  1. Attempt to accept the invitation link after expiration.
- **Expected Result:**
  - [ ] Link shows expired notice: `"This invite has expired."`
  - [ ] Admin has option to **Resend Invite**, which resets the 7-day clock.

---

### [ ] A8: Immediate Revocation
- **Tester Role:** Hospital Admin + Staff Member (`neuro.desk@test-tirupati.local`)
- **Steps:**
  1. As `neuro.desk`, verify active access to `/bookings`.
  2. As `admin.apex` on `/team`, click **Revoke** on `neuro.desk`.
  3. Immediately without logging out or refreshing JWT token, have `neuro.desk` click any tab or fetch bookings.
- **Expected Result:**
  - [ ] `neuro.desk` immediately receives 403 Forbidden or 0 bookings visible.
  - [ ] Revocation takes effect instantly without waiting for token expiry.

---

### [ ] A9: Staff Member Cannot See Team Page
- **Tester Role:** Consultant (`neuro.doc@test-tirupati.local`) or Front Desk (`neuro.desk@test-tirupati.local`)
- **Steps:**
  1. Log in to Merchant Web as `neuro.doc@test-tirupati.local`.
  2. Inspect top navigation bar.
  3. Attempt direct URL navigation to `http://localhost:3000/team`.
- **Expected Result:**
  - [ ] **Team** tab is NOT visible in the navigation bar.
  - [ ] Navigating directly to `/team` displays 403 Forbidden or redirects to `/`.

---

### [ ] A10: Cross-Department Data Isolation
- **Tester Role:** Consultant (`neuro.doc@test-tirupati.local`)
- **Steps:**
  1. Log in as `neuro.doc@test-tirupati.local`.
  2. Navigate to **Bookings** (`/bookings`).
  3. Inspect appointment records and queue.
- **Expected Result:**
  - [ ] Only Neurology patients and doctors are visible.
  - [ ] Zero appointments or patient names from Dermatology, Dentistry, or Neurosurgery appear.
  - [ ] Attempting to fetch Dermatology bookings via API returns empty list `[]`.

---

### [ ] A11: Department Deletion Protection
- **Tester Role:** Hospital Admin (`admin.apex@test-tirupati.local`)
- **Steps:**
  1. Try to delete **Neurology** (which has confirmed/active appointments).
  2. Observe error modal.
  3. Create an empty test department with zero bookings.
  4. Delete the empty test department.
- **Expected Result:**
  - [ ] Deletion of department with active appointments is BLOCKED with warning to reassign appointments.
  - [ ] Deletion of empty department SUCCEEDS cleanly, cascading removal of associated memberships.

---

## SECTION B: Booking Flow (B1 – B7)

### [ ] B1: Department & Consultant Selection
- **Tester Role:** Patient (`test.patient.01@test-tirupati.local`)
- **Steps:**
  1. Open Tirupati Apex Hospital booking screen.
  2. Select Medical Department: **Neurology**.
  3. Select Consultant: **Dr. A. Sharma**.
- **Expected Result:**
  - [ ] Department dropdown clearly shows department names.
  - [ ] Selecting department filters doctors to only those assigned to that department.

---

### [ ] B2: Dynamic Doctor Availability
- **Tester Role:** Patient
- **Steps:**
  1. Select appointment date.
  2. Inspect slot picker.
- **Expected Result:**
  - [ ] Slot intervals reflect doctor duration (15 min).
  - [ ] Booked slots are grayed out / disabled.

---

### [ ] B3: Slot Lock Concurrency
- **Tester Role:** Patient 1 + Patient 2 (Simultaneous)
- **Steps:**
  1. Patient 1 and Patient 2 both select the exact same 10:00 AM slot.
  2. Both click **Confirm / Pay** at the same second.
- **Expected Result:**
  - [ ] Exactly one patient secures the hold/booking.
  - [ ] The second patient receives: `"This slot is no longer available. Please select another slot."`
  - [ ] Zero double-bookings created in `public.bookings`.

---

### [ ] B4: Fixed ₹100 Deposit Payment
- **Tester Role:** Patient
- **Steps:**
  1. Proceed to payment checkout for ₹500 consultation.
- **Expected Result:**
  - [ ] Razorpay checkout initiates with exact deposit amount: **₹100.00**.
  - [ ] Remaining balance ₹400 shown as due at reception.

---

### [ ] B5: Free Cancellation (> 1 Hour Before)
- **Tester Role:** Patient
- **Precondition:** Appointment is scheduled for 3:00 PM; current time is 1:00 PM (2 hours prior).
- **Steps:**
  1. Open booking details in patient app.
  2. Click **Cancel Appointment**.
- **Expected Result:**
  - [ ] Screen displays: `"Cancellation is free. Your ₹100 deposit will be refunded."`
  - [ ] Booking status updates to `CANCELLED`.
  - [ ] Payment status marks `REFUNDED`.

---

### [ ] B6: Deposit Forfeiture (< 1 Hour Before)
- **Tester Role:** Patient
- **Precondition:** Appointment is scheduled for 3:00 PM; current time is 2:30 PM (30 min prior).
- **Steps:**
  1. Open booking details in patient app.
  2. Click **Cancel Appointment**.
- **Expected Result:**
  - [ ] Alert warning appears: `"Cancelling less than 1 hour before scheduled time results in forfeiture of ₹100 deposit."`
  - [ ] Patient confirms cancellation.
  - [ ] Status updates to `CANCELLED`, payment status updates to `FORFEITED`.

---

## SECTION C: Arrival & Check-In (C1 – C6)

### [ ] C1: Arrival Tagging (+/- 10 Minute Window)
- **Tester Role:** Front Desk (`neuro.desk@test-tirupati.local`)
- **Slot Time:** 12:30 PM
- **Check Points:**
  - [ ] Check-in at 12:15 PM (>10m early) -> Tagged **Early**.
  - [ ] Check-in at 12:20 PM (-10m boundary) -> Tagged **On Time**.
  - [ ] Check-in at 12:30 PM (exact slot) -> Tagged **On Time**.
  - [ ] Check-in at 12:40 PM (+10m boundary) -> Tagged **On Time**.
  - [ ] Check-in at 12:45 PM (>10m late) -> Tagged **Late**.
  - [ ] Patient not yet arrived -> Tagged **Expected**.

---

### [ ] C2: Customer Check-In Notification
- **Steps:**
  1. Patient check-in succeeds via code.
- **Expected Result:**
  - [ ] Patient receives push/in-app alert: `"You are checked in. Current queue position: X. Consultant: Dr. A. Sharma"`.

---

### [ ] C3: 4-Digit Check-In Code Verification
- **Tester Role:** Front Desk (`neuro.desk@test-tirupati.local`)
- **Steps:**
  1. Enter correct 4-digit code -> **Success**, patient marked **Arrived**.
  2. Enter non-existent code `9999` -> Error `"Invalid check-in code"`.
  3. Re-enter already checked-in code -> Error `"This appointment is already checked in"`.
  4. Enter code from Dermatology while logged in as Neurology -> Error `"This appointment belongs to a different medical department"`.

---

### [ ] C4: Receptionist Manual Check-In Fallback
- **Tester Role:** Front Desk (`neuro.desk@test-tirupati.local`)
- **Steps:**
  1. Patient forgot phone / no code.
  2. Front Desk searches patient by name or phone.
  3. Clicks **Manual Check-In**.
- **Expected Result:**
  - [ ] Patient checked in successfully with `checked_in_method = 'manual'`.

---

### [ ] C5: Rate Limiting Lockout
- **Tester Role:** Front Desk
- **Steps:**
  1. Intentionally enter 5 incorrect check-in codes within 60 seconds.
- **Expected Result:**
  - [ ] System locks check-in input for 60 seconds with countdown: `"Too many failed attempts. Locked for 60 seconds."`
  - [ ] Resets automatically after 60 seconds.

---

### [ ] C6: Check-In Window Restriction
- **Steps:**
  1. Attempt check-in 90 minutes before appointment.
- **Expected Result:**
  - [ ] Rejected with message: `"Check-in opens 60 minutes before scheduled time."`

---

## SECTION D: Queue Logic (D1 – D12)

### [ ] D1: On-Time Protection
- **Precondition:** Patient A arrives late for 10:00 AM slot. Patient B arrives on-time for 10:15 AM slot.
- **Expected Result:**
  - [ ] Patient B is never bumped behind Patient A.
  - [ ] Patient B is served at their scheduled 10:15 time.

---

### [ ] D2: Direct Consultation When Doctor Is Free
- **Precondition:** Doctor has no patient in room.
- **Expected Result:**
  - [ ] On-time or early patient checked in enters directly into **In Consultation**.

---

### [ ] D3 & D4: Standby Queue & End-of-Day Fallback
- **Expected Result:**
  - [ ] Late arrivals are placed in the **Standby Queue**.
  - [ ] Standby patients are served during schedule gaps or at the very end of all on-time patients.

---

### [ ] D5: Standby Queue FIFO by Original Booking Slot
- **Precondition:** Late Patient X booked for 09:00 AM arrives at 10:20 AM. Late Patient Y booked for 09:30 AM arrives at 10:10 AM.
- **Expected Result:**
  - [ ] Standby Queue orders Patient X **AHEAD** of Patient Y because X had the earlier booking slot.

---

### [ ] D6: Sliding Schedule Optimization
- **Precondition:** Doctor is free at 7:30. Next on-time patient is booked for 7:50 (arrival window opens 7:40). Late patient is present in standby.
- **Expected Result:**
  - [ ] Late patient is dispatched into the 7:30 slot (15 min consultation finishes at 7:45).
  - [ ] Next booked patient takes 7:45 without missing their window.

---

### [ ] D7: Doctor Idle Prevention
- **Expected Result:**
  - [ ] Doctor status is never idle if an eligible checked-in patient (waiting or standby) is available.

---

### [ ] D8: No-Show Auto-Handling
- **Precondition:** Patient does not check in within 15 minutes after slot end time.
- **Expected Result:**
  - [ ] System automatically marks status as **Cancelled / No-show** and releases slot.

---

### [ ] D12: Department Queue Isolation
- **Expected Result:**
  - [ ] Running queue, delays, or emergency delays in Neurology have **zero effect** on Dermatology queue.

---

## SECTION E: Naming & Labels Verification

Verify that all screens and notifications strictly use the final approved terminology:

- [ ] **Role Labels (Merchant Web):**
  - Hospital Owner -> `"Hospital Admin"`
  - Appointment Staff -> `"Front Desk"`
  - Doctor -> `"Consultant"`
- [ ] **Arrival Tags:**
  - `Early`
  - `On Time`
  - `Late`
  - `Expected`
- [ ] **Patient Statuses:**
  - `Expected`
  - `Arrived`
  - `In Consultation`
  - `Completed`
  - `Cancelled / No-show`

---

## SECTION G: Non-Hospital Vertical Regression

- [ ] **G1: Salons Vertical Intact:**
  - Log in as `salon.royal@test-tirupati.local`.
  - Verify **Team** page is NOT visible.
  - Verify bookings and appointments work with Stylist without any department requirement.
- [ ] **G2: Turf / Dining Verticals Intact:**
  - Verify non-hospital merchants have no department columns, triggers, or restrictions enforced.
