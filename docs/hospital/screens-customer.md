# Customer Screen Inventory & Architecture Specification

**Role:** Customer (Patient / Booked User)  
**Apps:** `apps/customer-mobile` & `apps/merchant-web` (`/ticket/[id]`)  
**Branch:** `phase-5d-customer-ui`  
**Source of Truth:** [`docs/hospital/SPEC.md`](file:///Users/trinadh/projects/Appointments/docs/hospital/SPEC.md)

---

## 1. Overview & Authority Boundary

Per `docs/hospital/SPEC.md` line 6:
> "Customer: sees only their own bookings and their own check-in code."

Per `docs/hospital/SPEC.md` lines 8-9:
> "Names (identical on every screen):
> Roles: Hospital Admin, Front Desk, Consultant.
> Arrival tags: On Time, Early, Late, Expected.
> Statuses: Booked, Checked In, Waiting, Up Next, In Consultation, Completed, No Show.
> Queues: Live Queue, Waiting Queue, Standby Queue (late patients)."

This document inventories every customer-facing screen and pass view across the mobile app and web ticket interface, specifying:
- Component / Route name
- Exact layout and interaction specifications
- 60-minute pre-slot check-in code gating
- Live ETA and early arrival invitation ("Come Now?") interactions
- Cancellation and rescheduling rules (60-minute policy)
- Privacy masking and data isolation boundaries

---

## 2. Screen Specifications

### Screen 1: Mobile OPD Booking Pass (`BookingPassModal.tsx`)
- **App:** `apps/customer-mobile/src/screens/BookingPassModal.tsx`
- **Purpose:** Primary digital pass presented by patient upon arriving at hospital reception or doctor's door.
- **Key Sections:**
  1. **Header & Tenancy**: Hospital name, Doctor name & specialty, date, and booked slot time (`HH:MM AM/PM`).
  2. **4-Digit Fast-Pass Check-In Code Box**:
     - **Before 60-minute window (`now < slotStart - 60m`)**: Code is locked. Displays countdown badge: `"Check-in Code Opening Soon: Your 4-digit reception OTP will appear here 60 minutes before your slot."`
     - **Within 60-minute window (`slotStart - 60m <= now < checked_in`)**: High-contrast, large-format 4-digit PIN (`font-mono text-4xl`, e.g. `4821`) with instructions: `"Show or tell this code at reception counter."`
     - **After Check-In (`status === 'CHECKED_IN' || is_present`)**: Code box flips to verified status with emerald checkmark, verified arrival tag (`On Time`, `Early`, or `Late`), and prompt: `"You are checked in! Please have a seat in the waiting lounge. Token #X."`
  3. **Live Status Stepper & Progress Tracking**:
     - Real-time progression through canonical SPEC statuses:
       `Booked` ➔ `Checked In` ➔ `Waiting` ➔ `Up Next` ➔ `In Consultation` ➔ `Completed`
  4. **Arrival Window Card**:
     - Highlights arrival window: `Booked Time ± 10 minutes`.
     - Explicit reminder: `"Arrival window is ±10 minutes of booked time. Starting earlier is permitted if the doctor is free."`
  5. **Early Arrival Invite ("Come Now?") Card**:
     - Triggers when the doctor runs ahead of schedule and engine indicates capacity for early patient consultation.
     - Optional prompt: `"Doctor is ahead of schedule! Can you come early?"` with `"I'm On My Way"` or `"Stick to Booked Time"` options.
     - Note: Declining or ignoring changes nothing; patient's booked window remains guaranteed.
  6. **Cancel / Reschedule Actions**:
     - Gated by 60-minute cutoff (`now <= slotStart - 60m` = 100% deposit refund; `now > slotStart - 60m` = deposit forfeited warning).

---

### Screen 2: Web OPD Patient Ticket (`apps/merchant-web/src/app/ticket/[id]/page.tsx`)
- **App:** `apps/merchant-web`
- **Route:** `/ticket/[id]`
- **Purpose:** Universal link shared via SMS/WhatsApp allowing patients to view their live ticket, attendance status, and queue position from any browser without installing an app.
- **Key Sections:**
  1. **Hospital & Reference Header**: Hospital name, address, reference code badge (`TEST-REF-X`).
  2. **60-Minute Check-in PIN Gate**:
     - Gated identically to mobile app: code is revealed only when `now >= slotStart - 60m`.
     - Prior to 60m, displays `"PIN Unlocks at [Time] (60m before slot)"`.
  3. **Live Queue & Real-time ETA**:
     - Rolling queue sequence showing current Token serving and estimated time to consultation.
  4. **Monthly Attendance & Follow-up Calendar**:
     - Visual tracking of completed visits and follow-up consultation scheduling.

---

### Screen 3: My Bookings Roster (`MyBookingsScreen.tsx`)
- **App:** `apps/customer-mobile/src/screens/MyBookingsScreen.tsx`
- **Purpose:** Master list of all past, present, and upcoming hospital and clinic appointments for the logged-in patient.
- **Key Sections:**
  1. **Appointment Cards**:
     - Doctor name, department pill badge, hospital name, date, slot time, and token number.
     - Canonical status pill (`Booked`, `Checked In`, `In Consultation`, `Completed`, `Cancelled`, `No Show`).
  2. **Quick Actions**:
     - `View Pass`: Opens `BookingPassModal`.
     - `I've Reached`: Triggers `POST /api/bookings/reach` informing reception of lobby presence.
     - `Reschedule`: Opens date/time selector with 60-minute policy validation.
     - `Cancel`: Triggers cancellation with refund/forfeit alert depending on 60m window.

---

## 3. Data Isolation & Security Boundaries

1. **Strict Customer Data Scoping**:
   - The customer can only query and view bookings where `customer_id = auth.uid()` via Supabase RLS.
   - Endpoint `/api/ticket/[id]` masks patient phone and details so public URL sharing does not expose sensitive medical history or PII.
2. **Check-In Code Protection**:
   - Staff cannot view or reverse-lookup check-in codes from the UI.
   - Customer only sees code when `now >= slot_start - 60m`.
3. **No-Show Account Protection**:
   - SPEC line 13: Customer accounts are **never blocked** for no-shows (counted for reporting only).
