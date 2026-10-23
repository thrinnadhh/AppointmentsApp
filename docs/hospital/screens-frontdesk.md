# Front Desk Reception & Check-In Screens Specification

## Overview
Phase 5c defines the user interface and interaction flows for the **Front Desk** role (and supervising **Hospital Admins**) in the Hospital Vertical (`apps/merchant-web`).
The Front Desk is the operational nerve center of the clinic/hospital floor, responsible for rapid patient reception, code verification, standby queue triage, manual fallback check-in, and waiting lounge queue communication.

Per `docs/hospital/SPEC.md`, this interface must strictly uphold role gates, arrival tag rules, 5-attempt rate-limiting security, uniform error responses, and exact naming across all components.

---

## 1. Role & Permission Boundaries
- **Front Desk**:
  - Assigned to one or more Consultants via `doctor_front_desk_assignments`.
  - Can view and act **ONLY** on their assigned Consultants' appointments and queues.
  - Permitted actions:
    1. Verify 4-digit check-in codes (`POST /api/bookings/checkin` via `verify_appointment_checkin_code` RPC).
    2. Mark present manually as a logged fallback with mandatory reason (`mark_present_manually` RPC).
    3. Admit patients into consultation waiting area (`POST /api/bookings/admit`).
    4. Call patients / Start consultation (`POST /api/bookings/start`).
    5. Complete consultation (`POST /api/bookings/end`).
    6. Mark No Show with financial split audit (`record_no_show` RPC).
- **Hospital Admin**:
  - Supervises all departments and doctors across the hospital.
  - Can switch between all doctors or view aggregate queues.
- **Consultant**:
  - Directed to `/consultation`. Can only see and act on own consultations.
- **Unauthorized Roles**:
  - Customer or non-hospital staff receive `403 Forbidden`.

---

## 2. Naming Standards (Identical Across All Screens)
- **Roles**: `Hospital Admin`, `Front Desk`, `Consultant`.
- **Arrival Tags**: `On Time`, `Early`, `Late`, `Expected`.
- **Statuses**: `Booked`, `Checked In`, `Waiting`, `Up Next`, `In Consultation`, `Completed`, `No Show`.
- **Queues**: `Live Queue`, `Waiting Queue`, `Standby Queue (late patients)`.

---

## 3. Screen Structure & Component Architecture

### A. Reception Desk Header (`FrontDeskHeader.tsx`)
- **Staff Identity & Role**: Front Desk Staff name/email and role badge.
- **Assigned Doctors Roster**:
  - Displays badges for assigned doctors with their Department and Room numbers.
  - Single-doctor filter dropdown for multi-doctor staff (locks to assigned doctors).
- **Session Quick Stats**:
  - Total Checked In today (`Waiting Queue` count).
  - Standby Queue count.
  - Expected remaining count.
  - Completed count.
- **Waiting Lounge TV Display Button**:
  - Launches full-screen/modal kiosk display mode for patient waiting areas.

### B. Fast Pass Check-In Panel (`FastPassCheckinPanel.tsx`)
- **4-Digit Code Input**:
  - Clean numeric input with auto-focus and auto-advance.
  - Submits to `POST /api/bookings/checkin` (`verifyCheckinCodeRpc`).
- **5-Attempt Rate-Limiting Lockout**:
  - In accordance with SPEC line 16 ("5 wrong attempts lock that staff user for 60 seconds").
  - Tracks consecutive failures locally in session/state with countdown timer.
  - Disables input and verify button for 60 seconds with active security alert banner.
- **Uniform Error Security**:
  - Invalid code, cross-hospital code, or unauthorized code returns identical error: `"Invalid check-in code"`.
- **Arrival Tag Calculation & Success Card**:
  - Computes arrival tag relative to `slot_start`:
    - `slot_start - 10m` to `slot_start + 10m` -> **On Time** (placed in `Waiting Queue`).
    - Before `slot_start - 10m` -> **Early** (placed in `Waiting Queue`, early idle prevention candidate).
    - After `slot_start + 10m` -> **Late** (automatically placed into `Standby Queue`).
  - Highlights queue placement clearly to reception staff.

### C. Manual Check-In Fallback Modal (`ManualCheckinModal.tsx`)
- **Fallback Trigger**: "Manual Mark Present" button for patients arriving with dead phone battery or SMS issues.
- **Input Fields**:
  - Patient search (booking reference or phone).
  - Mandatory staff justification reason (e.g., "Patient phone dead", "Walk-in verification").
- **Audit Logging**:
  - Submits through `markPresentManuallyRpc` (`mark_present_manually`), recording staff ID, timestamp, and justification reason.

### D. Front Desk Queue Triage Roster (`FrontDeskQueueTabs.tsx`)
1. **Waiting Queue**:
   - Patients who are checked in and waiting.
   - Shows arrival tag (`On Time`, `Early`), arrival time, token #, and assigned doctor.
   - Action: "Admit Patient" / "Call Patient" (`POST /api/bookings/start`).
2. **Standby Queue (late patients)**:
   - Late patients ordered strictly by original booking time (FIFO).
   - Informational header explaining gap-fitting rules: "Late arrivals are placed in free gaps without displacing on-time patients".
   - Fit check indicator: indicates whether next gap fits doctor's 15m consultation.
   - Action: "Admit to Next Gap" / "Prioritize".
3. **Expected Today (Not Checked In)**:
   - Booked patients for the operational day.
   - Arrival status: "Expected" (or countdown to arrival window).
   - Fast Search Bar by Phone Number, Patient Name, or Reference Code.
   - Action: "Mark No Show" (enabled once slot and session have passed, shows ₹50 doctor / ₹10 platform / refund breakdown).
4. **Completed Today**:
   - History of finished consultations with timestamps.

### E. Waiting Lounge TV / Kiosk Display Mode (`WaitingLoungeDisplayModal.tsx`)
- Clean, high-contrast, distraction-free display intended for wall-mounted TV screens in waiting areas.
- **Privacy Safe**: Displays only Token #, obfuscated patient name (e.g., `Rajesh K.`), Doctor Name, Room #, and Current Status (`In Consultation`, `Up Next`, `Waiting`).
- Auto-refreshes every 15 seconds to keep waiting patients informed without staff intervention.

---

## 4. Verification & Testing Strategy
- Unit test suite: `tests/unit/hospital-frontdesk-screens.test.mjs`
  - Front Desk context scoping (only assigned doctor appointments visible).
  - Check-in code verification and arrival tag assignment.
  - 5-attempt rate-limiting lockout mechanism.
  - Uniform error response for cross-shop/invalid codes.
  - Manual check-in fallback with audit logging.
- E2E test suite: `tests/e2e/hospital-frontdesk-screens.spec.ts`
  - Check-in desk input and code verification.
  - Waiting Queue vs Standby Queue triage display.
  - Manual mark present modal flow.
  - Waiting Lounge TV display kiosk mode rendering.
