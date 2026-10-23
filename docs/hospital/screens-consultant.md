# Hospital Vertical: Doctor / Consultant Web Screens Specification

**Date:** 2026-10-23  
**Status:** Awaiting Approval (Step 1)  
**Layer:** UI Layer (`apps/merchant-web`)  
**Branch:** `phase-5c-consultant-ui`  
**Source of Truth:** `docs/hospital/SPEC.md`  
**Governing Design System:** `DESIGN.md` (Tirupati Merchant Command, Emerald `#047857` primary, Slate background, Geist Mono, Purple Ban)

---

## 1. Overview & Core Authority Boundaries

Per `docs/hospital/SPEC.md`:
> - **Line 5:** "Consultant: sees and acts only on their own appointments and queue."
> - **Line 3:** "Hospital Admin (owner/in-charge): sees everything in their hospital. Only this role can create departments, add or remove Front Desk members and Consultants... assign Front Desk members to Consultants."
> - **Line 7:** "Department members see only their department's appointments; per-Consultant assignment is an additional gate. Hospital vertical only; other verticals unchanged."
> - **Line 38:** "Staff can manually override a position for medical urgency (Hospital Admin or Consultant), always logged."

The Consultant screen provides an autonomous clinical workspace mounted at `/consultation`. It is purpose-built to eliminate distraction, prevent clinical errors, and enforce strict data isolation between medical practitioners.

---

## 2. Feature Inventory & Current Implementation Status

| Feature / Requirement | SPEC Reference | Description | Status (`exists` / `partial` / `missing`) | Notes / Gaps |
| :--- | :--- | :--- | :--- | :--- |
| **1. My Queue: Up Next** | SPEC L35-37 | Computes next patient via `HospitalDepartmentQueueEngine.dispatchNext(..., { peekOnly: true })` following priority: (1) On-Time in window, (2) Standby FIFO with fit-check, (3) Early arrivals to prevent doctor idling, (4) Idle/Wait. Displays call patient CTA. | **EXISTS** | Implemented with `data-testid="up-next-patient-card"` and `data-testid="up-next-badge"`. Verified in Playwright Journey 1 & 2. |
| **2. My Queue: In Consultation** | SPEC L8-9 | Shows current patient undergoing consultation, live elapsed duration timer, clinical prescription/notes textarea with chips, and "Complete Consultation" CTA. | **EXISTS** | Implemented with `data-testid="in-consultation-panel"`, `data-testid="consultation-timer"`, and `data-testid="consultation-notes-input"`. Verified in Playwright Journey 2 & 3. |
| **3. My Queue: Waiting Lounge** | SPEC L9, 36 | Lists checked-in On-Time and Early patients present in clinic waiting area. Shows slot time, arrival tag (`On Time`, `Early`), token number, and medical urgency override action. | **EXISTS** | Implemented with `data-testid="tab-waiting"` and `data-testid="waiting-queue-list"`. Verified in Playwright Journey 1. |
| **4. My Queue: Standby Queue** | SPEC L9, 36-37 | Dedicated tab for late patients (checked in >10m after booked slot). Served in FIFO order during gaps or after on-time queue without displacing on-time patients. | **EXISTS** | Implemented with `data-testid="tab-standby"`, `data-testid="standby-queue-list"`, and FIFO rule banner. Verified in Playwright Journey 8. |
| **5. Today's Appointments** | SPEC L5, 9 | Full view of all appointments scheduled for today for this consultant across all statuses (`BOOKED`, `CHECKED_IN`, `IN_CONSULTATION`, `COMPLETED`, `NO_SHOW`). | **EXISTS** | Implemented with `data-testid="tab-all-slots"` and `data-testid="all-slots-queue-list"`. Verified in Playwright Journey 1. |
| **6. Start Consultation** | SPEC L4, 9 | Action to admit and call Up Next patient (`POST /api/bookings/start`). Atomically transitions booking from `CHECKED_IN` to `IN_CONSULTATION`, starts live consultation timer, and sets doctor status to busy. | **EXISTS** | Implemented with `data-testid="start-consultation-btn"`. Verified in Playwright Journey 2. |
| **7. End Consultation** | SPEC L4, 9 | Action to conclude active consultation (`POST /api/bookings/end`). Transitions booking from `IN_CONSULTATION` to `COMPLETED`, saves clinical notes/prescriptions, logs audit event, and frees doctor for next patient. | **EXISTS** | Implemented with `data-testid="end-consultation-btn"`. Verified in Playwright Journey 3. |
| **8. Manual Override with Reason (Logged)** | SPEC L38 | Modal to prioritize a patient for medical urgency (e.g. chest pain, pediatric respiratory distress). Prompts for target position and mandatory clinical reason. Calls `POST /api/bookings/override` and writes to `audit_logs`. | **EXISTS** | Implemented with `data-testid="medical-urgency-override-modal"` and `data-testid="submit-override-btn"`. Verified in Playwright Journey 4. |
| **9. Nothing from other Consultants (Strict Isolation)** | SPEC L5, 7 | Consultant sees and acts **only** on their own queue. Probing another consultant's URL (e.g., `?doctor_id=other_doc_id` or `?resource_id=other_id`) is strictly denied with an explicit 403 Forbidden screen. | **EXISTS** | Implemented with `data-testid="consultant-foreign-doctor-forbidden"` and `data-testid="return-to-my-desk-btn"`. Verified in Playwright Journey 5. |
| **10. Shared Dashboard: Consultant vs In-Charge** | SPEC L3, 5 | Both roles use `/consultation`. Consultant is locked to own resource with no switcher; Hospital Admin has consultant selector dropdown to supervise any doctor's room. | **EXISTS** | Implemented with `data-testid="admin-doctor-switcher"`. Verified in Playwright Journey 7. |
| **11. Four States per Screen** | System Quality Gate | All screens/views must explicitly support 4 UI states: `Loading`, `Empty`, `Error`, and `Forbidden / Denied`. | **EXISTS** | Implemented across all cards and tested with explicit test IDs (`consultant-loading-skeleton`, `active-consultation-idle`, `empty-waiting-queue`, `consultant-error-banner`, `consultant-foreign-doctor-forbidden`). |

---

## 3. Shared Department Dashboard: Consultant vs. In-Charge (Hospital Admin)

Both the individual **Consultant** and the **Hospital In-Charge (Admin/Owner)** access the consultation workflow via the same URL route: `/consultation`.

### How the Dual-Persona Workflow Operates:

```
                                 /consultation
                                       │
                      ┌────────────────┴────────────────┐
                      ▼                                 ▼
             Role: Consultant                  Role: Hospital Admin
                      │                                 │
           ┌──────────┴──────────┐            ┌─────────┴─────────┐
           │ Bound to 1 Doctor   │            │ Supervise All     │
           │ Resource ID         │            │ Department Doctors│
           └──────────┬──────────┘            └─────────┬─────────┘
                      │                                 │
           ┌──────────▼──────────┐            ┌─────────▼─────────┐
           │ URL ?doctor_id=X    │            │ URL ?doctor_id=X  │
           │ If X != my_id:      │            │ Allows any doctor │
           │ ⛔ 403 FORBIDDEN    │            │ in hospital.      │
           └──────────┬──────────┘            └─────────┬─────────┘
                      │                                 │
           ┌──────────▼──────────┐            ┌─────────▼─────────┐
           │ No Doctor Switcher  │            │ Doctor Switcher   │
           │ Pure Clinical Desk  │            │ Dropdown in Header│
           └─────────────────────┘            └───────────────────┘
```

1. **Context Resolution (`/api/hospital/context`)**:
   - The screen fetches `hospitalContext` to determine the user's role (`consultant`, `admin`, `owner`, `front_desk`).
   - If the user is `front_desk` or a customer: access is immediately rejected with a **403 Forbidden** restricted workspace state (`data-testid="consultant-role-forbidden"`).

2. **When Authenticated as a Consultant**:
   - The user has an assigned consultant resource (`hospitalContext.assignedDoctorIds[0]`).
   - **Strict URL Scoping**:
     - If the URL contains `?doctor_id=other_id` (or `?resource_id=other_id`), the app verifies if `other_id` equals the consultant's own assigned ID.
     - If it does **NOT** match: the UI renders an immediate **403 Forbidden** card (`data-testid="consultant-foreign-doctor-forbidden"`) stating:
       > *"Access Denied: You are not authorized to view or manage consultations for another Consultant. You may only access your own assigned consultation desk."*
     - No patient data, queue, or schedule from the other doctor is ever fetched or rendered.
   - **Header Display**:
     - No doctor switcher dropdown is displayed.
     - Doctor's name, department pill, and room number are static.
     - Shows assigned Front Desk receptionists for direct communication.

3. **When Authenticated as Hospital In-Charge (Admin / Owner)**:
   - The In-Charge holds supervisory authority over all consultants in the hospital.
   - **Supervisory Switcher**:
     - Displays a Consultant Selector dropdown (`data-testid="admin-doctor-switcher"`) in the header.
     - The In-Charge can select any active doctor to inspect their live consultation room, monitor wait times, view clinical queue progress, and assist with emergency triage or position overrides.
   - **URL Query Permission**:
     - May supply `?doctor_id=any_id` in the URL to jump directly to any consultant's consultation desk.

---

## 4. Detailed Component & State Specifications

### 4.1 Header: `ConsultationSessionHeader.tsx`
- **Doctor Profile**: Full name, department badge (`Cardiology`, `Neurology`), clinic/hospital name, room number.
- **Session Status**:
  - `Active Session` (Emerald pulse indicator): Normal consultation operations.
  - `Taking Break` (Amber icon): Pauses automated patient calling.
  - `Off Duty / Emergency Departure` (Rose outline): Signals doctor emergency mid-day departure per SPEC lines 14-18.
- **Assigned Front Desk Staff**: Badges with receptionist names and ID card numbers (e.g. `HOSP-FD-01`).
- **In-Charge Selector**: Rendered only when `isHospitalAdmin === true`.

### 4.2 Active Consultation Card: `ActiveConsultationCard.tsx`
- **Status Indicator**: Blinking green dot with `"IN CONSULTATION"`.
- **Patient Profile**: Name, booking reference, arrival tag (`On Time`, `Early`, `Late`), checked-in time.
- **Live Elapsed Timer**: Running clock (`MM:SS`) since consultation started. Turns amber if exceeding slot duration (15m).
- **Clinical Prescription & Notes**: Auto-expanding textarea with quick-action symptom and prescription chips.
- **CTAs**:
  - `Complete Consultation` (`data-testid="end-consultation-btn"`): Invokes `POST /api/bookings/end` -> marks `COMPLETED`, logs audit entry, resets timer.

### 4.3 Up Next Patient Card: `UpNextPatientCard.tsx`
- **Priority Indicator**: Explains why this patient is next (e.g., *"Priority 1: On-Time Scheduled Patient (Slot: 10:15 AM)"* or *"Priority 2: Standby Patient filling schedule gap"*).
- **Patient Summary**: Name, scheduled slot, arrival status badge, wait time.
- **CTA**:
  - `Call Patient / Start Consultation` (`data-testid="start-consultation-btn"`): Disabled if a consultation is already active; otherwise calls `POST /api/bookings/start` and transitions patient to `IN_CONSULTATION`.

### 4.4 Queue Tabs: `ConsultantQueueTabs.tsx`
Four dedicated tabs:
1. **Waiting Lounge** (`data-testid="tab-waiting"`):
   - Checked-in on-time and early patients waiting in clinic.
   - Action: `Prioritize (Urgency)` button opening override modal.
2. **Standby Queue** (`data-testid="tab-standby"`):
   - Late arrivals (>10 mins late).
   - Shows FIFO order, arrival time, and schedule gap fit explanation.
3. **Completed Today** (`data-testid="tab-completed"`):
   - Patients completed today with duration and timestamp.
4. **Today's Appointments / All Slots** (`data-testid="tab-all-slots"`):
   - Complete daily appointment list with statuses: `Booked`, `Checked In`, `In Consultation`, `Completed`, `No Show`.

### 4.5 Medical Urgency Override Modal: `MedicalUrgencyOverrideModal.tsx`
- **Trigger**: Click `Prioritize (Urgency)` on any patient in Waiting Lounge.
- **Inputs**:
  - Target queue position (default: `#1 - Up Next`).
  - Mandatory clinical justification (textarea, minimum 10 characters, e.g. *"Acute chest pain with diaphoresis"*).
- **Execution**:
  - Submits to `POST /api/bookings/override`.
  - Records `QUEUE_OVERRIDE` in `public.audit_logs`.
  - Re-orders queue immediately and closes modal.

---

## 5. The Four States Per Screen

Every component and route view under `/consultation` strictly implements all 4 states:

| Screen / Component | 1. Loading State | 2. Empty State | 3. Error State | 4. Forbidden / Denied State (403) |
| :--- | :--- | :--- | :--- | :--- |
| **Workspace Root (`/consultation`)** | Emerald pulse skeleton cards for header, active room, and queue tabs (`data-testid="consultant-loading-skeleton"`). | Clean slate banner: *"No appointments scheduled for this consultant today."* | Red error banner with retry sync button (`data-testid="consultant-error-banner"`). | **403 Card**: Non-consultant/non-admin blocked (`data-testid="consultant-role-forbidden"`). Foreign doctor URL probe blocked (`data-testid="consultant-foreign-doctor-forbidden"`). |
| **Active Consultation Card** | Pulsing card skeleton with animated timer bar. | Slate card with stethoscope icon: *"Doctor is free. Select 'Call Patient' to begin next consultation."* (`data-testid="active-consultation-idle"`) | Error badge if completing consultation fails with error message and retry button. | Read-only view if viewed by unauthorized spectator. |
| **Up Next Card** | Skeleton pill and button shimmer. | *"No patients waiting in queue. Next scheduled slot at [Time]."* (`data-testid="up-next-empty"`) | Error alert on call patient network failure. | Disabled actions when viewing across unpermitted doctor boundaries. |
| **Queue Tabs** | Tab skeleton with list placeholders. | Individual empty states per tab: *"No patients waiting"*, *"No patients on standby"*, *"No completed consultations yet"*. | Error banner on queue fetch failure with manual `Sync Queue` CTA. | Tab contents hidden if doctor scoping check fails. |

---

## 6. Step 2 Planned Playwright Journeys

After approval, the following automated E2E test journeys will be implemented and validated in `tests/e2e/hospital-consultant-screens.spec.ts`:

1. **Journey 1: Full Queue Lifecycle (Up Next -> Start -> In Consultation -> End -> Completed)**:
   - Consultant opens `/consultation`.
   - Verifies "Up Next" patient according to SPEC priority.
   - Clicks `[Call Patient / Start Consultation]`.
   - Verifies patient transitions to Active Consultation card (`data-testid="in-consultation-card"`) with running timer.
   - Enters prescription notes and clicks `[Complete Consultation]`.
   - Verifies patient moves to `Completed Today` tab with timestamp.
2. **Journey 2: Medical Urgency Position Override (Logged)**:
   - Consultant selects a patient in the Waiting Lounge and clicks `[Prioritize (Urgency)]`.
   - Enters clinical reason *"Acute severe chest pain, immediate ECG triage required"*.
   - Submits override.
   - Verifies patient is moved to Position #1 in queue and audit log event is recorded.
3. **Journey 3: Another Consultant's URL Access Denied (403 Forbidden)**:
   - Logged-in Consultant attempts to open `/consultation?doctor_id=foreign-doctor-uuid`.
   - Verifies system intercepts the request and renders explicit 403 Forbidden state (`data-testid="consultant-foreign-doctor-forbidden"`).
   - Verifies foreign consultant's patient appointments are completely unreachable.
4. **Journey 4: Hospital In-Charge (Admin) Department Dashboard Supervision**:
   - In-Charge logs in and visits `/consultation`.
   - Verifies Consultant Switcher dropdown is present.
   - Switches between different consultants in the department and verifies respective queues load accurately.
5. **Journey 5: Standby Queue & Today's Appointments View**:
   - Verifies late patients appear in Standby Queue tab with arrival tags and FIFO explanation.
   - Verifies "All Slots Today" tab displays full caseload with correct status badges.

---

## 7. Verification Gate Checklist (Step 2 Execution)
1. `supabase db reset` (clean migration check)
2. `scripts/seed-hospital-test-data.mjs` (seed clean test data)
3. Serial execution of all unit test suites (`node scripts/run-all-unit-tests-serially.mjs`)
4. Playwright E2E suite (`tests/e2e/hospital-consultant-screens.spec.ts`)
5. Full workspace typecheck (`pnpm typecheck`)
6. Production build (`ALLOW_MOCK_PAYMENTS=false pnpm build`)
