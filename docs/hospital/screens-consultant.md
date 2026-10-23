# Hospital Vertical: Doctor / Consultant Web Screens Specification

**Date:** 2026-10-23  
**Status:** Approved  
**Source of Truth:** `docs/hospital/SPEC.md`  
**Governing Design System:** `DESIGN.md` (Tirupati Merchant Command, Emerald `#047857` palette, Inter + Geist Mono, Purple Ban)

---

## 1. Overview & Architecture

Per `docs/hospital/SPEC.md` line 5:
> **Consultant: sees and acts only on their own appointments and queue.**

The Doctor / Consultant workspace provides an autonomous, real-time clinical consultation desk where a doctor can:
1. View only their own patients, queue, and schedule (enforced at database RLS, PostgREST helpers, and Next.js server API routes).
2. Seamlessly call the next patient according to the single-source-of-truth Queue Specification (`packages/shared/src/queue-engine.ts`):
   - **Priority 1**: On-Time patients whose window (`slot_start ± 10m`) is open, earliest booked first.
   - **Priority 2**: Standby Queue (late arrivals) in original booking order (FIFO), if the consultation fits the schedule before the next booked patient.
   - **Priority 3**: Early arrivals whose window has not opened, only to avoid doctor idling.
   - **Priority 4**: Wait / Idle.
3. Conduct the consultation with a live timer, clinical notes, and prescription entry.
4. Conclude consultations atomically with status transition to `COMPLETED`.
5. Trigger Medical Urgency Overrides with audited justifications.
6. Manage mid-day emergency departures or temporary standby.

---

## 2. Screen & Component Architecture

### Route: `/consultation`
- File: `apps/merchant-web/src/app/consultation/page.tsx`
- Layout: Responsive desktop and tablet clinical console.

### Component Breakdown (`apps/merchant-web/src/components/consultation/`)

```
apps/merchant-web/src/components/consultation/
├── ConsultationSessionHeader.tsx   # Doctor metadata, specialty, room, shift toggle, assigned front desks
├── ActiveConsultationCard.tsx        # In-consultation patient, live elapsed timer, notes/prescription, complete CTA
├── UpNextPatientCard.tsx             # Queue engine selected next patient, arrival tag, start consultation CTA
├── ConsultantQueueTabs.tsx           # Waiting Queue (with override), Standby Queue, Completed consultations list
└── MedicalUrgencyOverrideModal.tsx   # Urgency position override modal with audit reason input
```

---

## 3. UI Specifications & Wireframes

### 3.1 Header: `ConsultationSessionHeader.tsx`
- **Doctor Identity**: Full name (e.g., `Dr. A. Sharma`), specialty pill (`Neurology`), provider hospital name.
- **Assigned Front Desk Team**: Badges of assigned receptionists and their ID badge numbers (e.g., `Reception Desk 1 (ID: HOSP-FD-NEURO)`).
- **Shift / Session State Toggle**:
  - `In Session` (Emerald dot): Normal active consultation state.
  - `Taking Break` (Amber dot): Temporarily pauses new auto-calls.
  - `Emergency Departure` (Rose outline button): Prompts emergency cancellation or reassignment.

### 3.2 Active Consultation: `ActiveConsultationCard.tsx`
- **Condition**: Rendered when there is a booking with `status === 'IN_CONSULTATION'`.
- **Patient Profile**:
  - Full Name, Reference Code (`TEST-REF-XX`), Booked Slot (`10:00 AM - 10:15 AM`).
  - Arrival Tag badge: `On Time` (Emerald), `Early` (Sky), or `Late` (Amber).
  - Check-in Time & Method (`Reception Code` or `Manual Mark`).
- **Live Consultation Timer**:
  - Increments every second since `updated_at` / consultation start.
  - Highlights green for standard duration (<= 15 mins), amber if exceeding slot duration.
- **Prescription / Clinical Notes**:
  - Textarea with auto-expanding height.
  - Quick action chips: "Routine Follow-up", "Vitals Normal", "Medication Prescribed", "Referred for Diagnostics".
  - Preserves drafts in state / local storage.
- **Action CTAs**:
  - Primary CTA: **Complete Consultation** (`POST /api/bookings/end` or `POST /api/bookings/complete`) -> Transitions to `COMPLETED`, records `STATUS_CHANGE` audit log, frees doctor.
  - Secondary CTA: **Emergency Refer / Flag**.

### 3.3 Up Next: `UpNextPatientCard.tsx`
- **Condition**: Highlighted when doctor is free and checked-in patients exist.
- **Next Patient Selection**:
  - Computed via `HospitalDepartmentQueueEngine.dispatchNext(..., { peekOnly: true })`.
  - Explains priority: e.g., *"On-Time Patient (Slot: 10:30 AM)"* or *"Standby Patient filling 20-min schedule gap"*.
- **Primary CTA**: **Call Patient / Start Consultation** (`POST /api/bookings/start`).
  - Transitions booking from `CHECKED_IN` / `WAITING` to `IN_CONSULTATION`.
  - Atomically enforced in database (only 1 simultaneous active consultation per doctor).

### 3.4 Queue Tabs: `ConsultantQueueTabs.tsx`
Three dedicated tabs:

1. **Waiting Queue (X)**:
   - Checked-in and on-time patients currently present in the waiting lounge.
   - Shows token / queue position, arrival tag, slot time, and live ETA.
   - Action: **Prioritize for Medical Urgency** button.

2. **Standby Queue (Y)**:
   - Late patients (checked in >10 minutes after scheduled slot).
   - Explanatory banner: *"Late arrivals are placed on standby. They are served during schedule gaps or after all on-time patients without displacement."*
   - Shows original slot time, actual arrival time, and gap-fit evaluation.

3. **Completed Consultations (Z)**:
   - Summary of today's completed patients.
   - Displays completion timestamp, duration, and prescription status.

### 3.5 Medical Urgency Override Modal: `MedicalUrgencyOverrideModal.tsx`
Per SPEC line 21:
> *"Staff can manually override a position for medical urgency (Hospital Admin or Consultant), always logged."*
- Form fields:
  - Patient Name & Current Position.
  - Target Position (e.g. Move to Position #1 / Next).
  - Clinical Urgency Reason (Mandatory text: e.g. "Acute chest pain, immediate triage required").
- Execution:
  - Calls `POST /api/bookings/override`.
  - Logs `QUEUE_OVERRIDE` to `public.audit_logs` with `actor_id`, `before`, `after`, and `reason`.

---

## 4. Permission & Security Boundary Matrix

| User Persona | Access to `/consultation` | Visible Resources & Bookings | Actions Allowed |
| :--- | :--- | :--- | :--- |
| **Hospital Admin** | Full Access | All doctors in hospital | Supervise, start, end, medical override, reassign |
| **Consultant** | Scoped Access | **Own bound resource ONLY** | Start consultation, end consultation, medical override |
| **Front Desk** | Blocked / Redirected | None on this screen | Must use reception check-in desk |
| **Customer** | 403 Forbidden | None | None |

---

## 5. UI States & Edge Cases

1. **Loading State**:
   - Polished Emerald pulse skeleton cards for session header, active patient, and queue tabs.
2. **Idle State (No Active Patient)**:
   - Clean slate icon: *"Consultation room is ready. Select 'Call Patient' to begin."*
3. **Empty Queue State**:
   - *"No patients waiting in queue. Next appointment at [Time]."*
4. **Forbidden State (403)**:
   - Displays dedicated access alert: *"Doctor credentials required. You must be bound to a hospital consultant resource to enter this workspace."*
5. **Session Interruption Safety**:
   - If the browser tab is refreshed mid-consultation, active consultation state is rehydrated immediately from the database booking with `status = 'IN_CONSULTATION'`. No work or timer is lost.
