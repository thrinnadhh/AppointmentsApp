# Front Desk Screen Inventory & Architecture Specification

**Role:** Front Desk Receptionist (and supervising Hospital Admins)  
**App:** `apps/merchant-web`  
**Branch:** `phase-5b-frontdesk-ui`  
**Source of Truth:** [`docs/hospital/SPEC.md`](file:///Users/trinadh/projects/Appointments/docs/hospital/SPEC.md)

---

## 1. Overview & Authority Boundary

Per `docs/hospital/SPEC.md` lines 4 & 27:
> - **Front Desk**: "assigned to one or more Consultants and can act ONLY on those Consultants' appointments and queues: verify check-in codes, mark present manually, mark No Show, admit patients, start and end consultations."
> - **Consultant Scoping**: "Department members see only their department's appointments; per-Consultant assignment is an additional gate. Hospital vertical only; other verticals unchanged."
> - **Check-In Security**: "4-digit check-in PIN is permanent and lifetime for the customer across all their bookings as long as they use the app... Staff verify it through a function only and can never read codes. 5 wrong attempts lock that staff user for 60 seconds. Unauthorized, other-shop and invalid codes return the identical error. Manual mark-present exists as a logged fallback."

This specification provides the complete UI architecture, state machines, API interactions, and gap analysis for Front Desk screens in `apps/merchant-web`.

---

## 2. Front Desk Screen Specifications

### Screen 1: Front Desk Reception & Triage Command Center
- **Route:** `/` (when `category_id === 'hospital'` and user role is `front_desk` or `admin`)
- **Title:** Reception & Patient Triage Desk
- **Purpose:** Central operational workspace for clinic receptionists to verify incoming patients via 4-digit fast-pass check-in code, triage late arrivals into the Standby Queue, monitor the Live Queue, inspect "Up Next" predictions from the shared queue engine, execute manual check-in fallbacks with staff reasons, admit patients, manage consultations (start/end), and mark no-shows.
- **API Routes Utilized:**
  - `GET /api/hospital/context`: Resolves caller role (`front_desk`), provider ID, and `accessibleResourceIds` (assigned consultants via `doctor_front_desk_assignments`).
  - `GET /api/merchant/bookings`: Fetches today's appointments strictly scoped to assigned doctors.
  - `POST /api/bookings/checkin`: Verifies 4-digit lifetime check-in code via `verify_appointment_checkin_code` RPC, assigns arrival tags (`On Time`, `Early`, `Late`), and updates status to `CHECKED_IN`.
  - `POST /rest/v1/rpc/mark_present_manually`: Fallback manual check-in recording staff justification reason.
  - `POST /api/bookings/admit`: Moves checked-in patient from lobby to doctor waiting area (`status = 'WAITING'`).
  - `POST /api/bookings/start`: Calls patient into doctor's consultation room (`status = 'IN_CONSULTATION'`).
  - `POST /api/bookings/end`: Completes patient consultation (`status = 'COMPLETED'`).
  - `POST /rest/v1/rpc/record_no_show`: Marks unreached patient as no-show with tiered financial split (₹50 hospital / ₹10 platform).
- **Allowed Actions:**
  - Select among assigned consultants (or view aggregate queue of all assigned consultants).
  - Verify patient 4-digit check-in PIN with instant feedback.
  - Trigger manual check-in fallback with mandatory justification reason when patient lacks phone/app access.
  - View Live Queue (10-slot rolling queue), Waiting Queue, Standby Queue, Expected Today, and Completed lists.
  - Inspect "Up Next" candidate chosen deterministically by `HospitalDepartmentQueueEngine`.
  - Admit, Call/Start Consultation, and End Consultation for assigned doctor appointments.
  - Mark No Show for patients whose session has passed.
  - Launch full-screen Waiting Lounge TV Display kiosk mode.
- **Denied Actions:**
  - Viewing appointments or queues for unassigned consultants (enforced in UI filter and strictly gated with `403 Forbidden` in API).
  - Reading or viewing patient 4-digit PINs (staff can only verify PINs through the verification RPC).
  - Manually checking in a patient without entering a justification reason.
  - Bypassing the 60-second lockout after 5 consecutive incorrect PIN attempts.
  - Overriding medical urgency or reordering queues unless authorized as Hospital Admin.
  - Accessing non-hospital vertical features or bypassing vertical scoping.
- **The Four UI States:**
  - **Loading:** Shimmer skeleton for Reception Header, FastPass Checkin Input, Quick Metric counters, and Queue Roster cards.
  - **Empty:** When assigned consultants have zero appointments scheduled today: "No appointments scheduled for your assigned consultants today."
  - **Error:** Red alert banner with retry trigger: "Failed to load front desk reception queues. Check your connection or hospital authorization."
  - **Forbidden:** Full-page or panel `403 Forbidden` state displayed when:
    1. Caller role is not authorized for the hospital (`role !== 'front_desk'` and `role !== 'admin'`).
    2. **Zero Assigned Consultants:** If a Front Desk member has **no consultants assigned** (`accessibleResourceIds.length === 0`), displays:
       > *"Access Restricted: You are not currently assigned to any consultants. Please contact your Hospital Administrator to assign doctor desks to your reception account."*
    3. **Unassigned Doctor URL Probe:** If the user attempts to load an unassigned doctor's queue via URL query param (`?doctor_id=unassigned-id`), displays:
       > *"403 Forbidden: You do not have permission to view or manage appointments for this consultant."*

---

## 3. Core Component Architecture

### Component A: Consultant Selector & Assignment Gating (`FrontDeskHeader.tsx`)
- **Assigned Doctors Dropdown & Badges:**
  - Displays badges for assigned doctors with Department and Room numbers.
  - Single-doctor filter dropdown for multi-doctor staff (locks strictly to assigned doctors).
  - Displays staff identity, role badge (`Front Desk Staff`), active reception session indicator, and quick statistics counters:
    - `Waiting Queue` count
    - `Standby Queue` count
    - `Expected Today` count
    - `Completed Today` count
- **Forbidden State (No Assigned Consultants):**
  - If `hospitalContext.accessibleResourceIds` is empty, replaces queue UI with an explicit Forbidden card blocking access and preventing fallback to unassigned doctors.
- **URL Scoping Guard:**
  - Validates `selectedDoctorId` against `accessibleResourceIds`. Rejects unassigned doctor IDs provided in URL.

### Component B: Fast-Pass Check-In Panel (`FastPassCheckinPanel.tsx`)
- **4-Digit Code Entry:**
  - Numeric 4-digit input with auto-focus and auto-advance.
  - Submits to `POST /api/bookings/checkin`.
- **Exact Uniform Error Handling (SPEC line 27):**
  - Invalid code, cross-hospital code, or unauthorized code returns identical error: `"Invalid check-in code"`.
- **5-Attempt Rate-Limiting Lockout (SPEC line 27):**
  - Tracks consecutive failed attempts in component state.
  - On the 5th consecutive failure: Disables input and verification button, activates a prominent countdown timer banner: *"Security Lockout: 5 consecutive failed attempts. Please wait 60 seconds."*
  - Clears lockout automatically once the 60-second cooldown expires.
- **Arrival Tagging (SPEC line 9 & 35-37):**
  - Evaluates arrival timestamp relative to `slot_start`:
    - `slot_start - 10m` to `slot_start + 10m` -> **On Time** (placed in `Waiting Queue`).
    - Before `slot_start - 10m` -> **Early** (placed in `Waiting Queue`, early idle prevention candidate).
    - After `slot_start + 10m` -> **Late** (placed in `Standby Queue`).
  - Displays instant success alert with arrival tag and assigned queue.
- **Manual Fallback CTA:**
  - Prominent "Manual Mark Present" button opening `ManualCheckinModal.tsx`.

### Component C: Manual Check-In Fallback Modal (`ManualCheckinModal.tsx`)
- **Trigger:** Accessible for patients arriving without phone, with dead battery, or SMS delivery failure.
- **Fields:**
  - Fast search by patient name, contact number, or booking reference code.
  - **Mandatory Staff Justification Reason** textarea (minimum 5 characters, e.g., *"Patient phone battery dead; physical ID verified at front desk"*).
- **Audit Logging:**
  - Calls `mark_present_manually` RPC, writing staff UID, timestamp, and justification reason to `audit_logs`.

### Component D: Queue Triage Roster & "Up Next" Engine (`FrontDeskQueueTabs.tsx`)
Contains four dedicated queue tabs:
1. **Waiting Queue:**
   - Displays patients checked in and waiting in lobby.
   - Highlights **"Up Next"** patient badge computed directly from `HospitalDepartmentQueueEngine.dispatchNext(..., { peekOnly: true })`.
   - Cards display: Token #, Patient Name, Phone Mask (`CustomerContactBadge`), Arrival Tag (`On Time`, `Early`), Arrival Time, Doctor Name, Room #.
   - Actions: `[Admit Patient]`, `[Start Consultation]`.
2. **Standby Queue (Late Patients):**
   - Displays late arrivals strictly ordered by original booking time (FIFO).
   - Informational banner explaining SPEC rules: *"Late patients never displace an on-time patient. Accommodated in free gaps without disrupting on-time appointments."*
   - Fit check indicator: Displays whether upcoming schedule gap fits the doctor's 15m consultation duration.
   - Actions: `[Admit to Next Gap]`.
3. **Expected Today (Not Checked In):**
   - Booked patients for the operational day whose slots have not yet arrived or are pending check-in.
   - Search bar for quick lookup by phone or name.
   - Action: `[Mark No Show]` (active once slot and session have passed, opens confirmation showing ₹50 hospital / ₹10 platform fee breakdown).
4. **Completed Today:**
   - Chronological list of completed consultations with completion timestamps.

### Component E: Waiting Lounge TV Kiosk Display Mode (`WaitingLoungeDisplayModal.tsx`)
- Clean, high-contrast, distraction-free display designed for wall-mounted TV screens in waiting areas.
- **Privacy Safe:** Displays Token #, masked patient name (e.g., `Rajesh K.`), Doctor Name, Room #, and Status (`In Consultation`, `Up Next`, `Waiting`).
- Auto-refreshes every 15 seconds.

---

## 4. Comparison & Gap Analysis Matrix

Comparing Front Desk requirements against existing pages:
- `/`: Merchant Operations Dashboard (`apps/merchant-web/src/app/page.tsx`)
- `/bookings`: Bookings Management (`apps/merchant-web/src/app/bookings/page.tsx`)
- `/schedule`: Schedule & Doctor Leave Management (`apps/merchant-web/src/app/schedule/page.tsx`)

| Feature / Requirement | Page `/` (Overview) | Page `/bookings` | Page `/schedule` | Status & Gap Details |
|---|---|---|---|---|
| **Vertical Isolation Guard** | **Exists** (`isHospitalVenue` check) | **Missing** (generic all verticals) | **Missing** (generic all verticals) | Hospital front desk components are isolated on `/` behind `isHospitalVenue`. `/bookings` and `/schedule` do not check vertical or role. |
| **Consultant Selector (Assigned Only)** | **Partial** | **Missing** | **Missing** | Selector exists on `/`, but if Front Desk has 0 assigned doctors (`accessibleResourceIds.length === 0`), code falls back to returning all doctors instead of showing a strict `403 Forbidden` state. |
| **Forbidden State when No Consultants Assigned** | **Missing** | **Missing** | **Missing** | Neither `/` nor `/bookings` currently shows an explicit Forbidden state when `accessibleResourceIds.length === 0`. |
| **Unassigned Consultant URL Protection** | **Partial** | **Missing** | **Missing** | API returns 403, but UI does not validate URL query params (`?doctor_id=...`) to block access if staff tries to query an unassigned doctor. |
| **4-Digit Code Fast-Pass Check-In Panel** | **Exists** (`FastPassCheckinPanel.tsx`) | **Missing** | **Missing** | Implemented on `/`. Has 4-digit input, auto-advance, and submits to `/api/bookings/checkin`. |
| **Uniform Error Security (`Invalid check-in code`)** | **Exists** | **Missing** | **Missing** | Implemented in API and UI: unauthorized, cross-shop, and invalid codes return identical error message. |
| **5-Wrong-Attempts 60-Second Lockout** | **Exists** | **Missing** | **Missing** | Implemented in `FastPassCheckinPanel.tsx`: 5 failures lock input and verify button for 60 seconds with countdown. |
| **Manual Fallback Check-In with Reason** | **Exists** (`ManualCheckinModal.tsx`) | **Missing** | **Missing** | Implemented on `/`: modal enforces staff justification reason and calls `mark_present_manually` RPC. |
| **Today's List with SPEC Arrival Tags** | **Exists** (`FrontDeskQueueTabs.tsx`) | **Partial** (generic status only) | **Missing** | `On Time`, `Early`, `Late`, `Expected` tags implemented on `/`. `/bookings` only shows generic database statuses. |
| **Live Queue (Rolling 10-Slot Visualizer)** | **Partial** | **Missing** | **Missing** | `RollingTenSlotQueue` exists in codebase and is used on `/consultation`, but is not rendered in the Front Desk view on `/`. |
| **Waiting Queue & Standby Queue (FIFO)** | **Exists** (`FrontDeskQueueTabs.tsx`) | **Missing** | **Missing** | Implemented on `/` with FIFO ordering and SPEC line 19-20 gap-fitting explanation. |
| **"Up Next" from Shared Queue Engine** | **Partial** | **Missing** | **Missing** | Queue engine calculates `Up Next` in `queue-scheduler.ts` and on `/consultation`, but the "Up Next" badge is missing from `FrontDeskQueueTabs.tsx` waiting queue cards. |
| **Start & End Consultation Actions** | **Exists** | **Partial** (generic status dropdown) | **Missing** | Implemented on `/`: invokes `/api/bookings/start` and `/api/bookings/end`. |
| **Mark No Show with Financial Split Notice** | **Exists** | **Partial** (generic button) | **Missing** | Implemented on `/`: modal informs staff of ₹50 doctor / ₹10 platform fee split before invoking `record_no_show`. |
| **Minimum Patient Data Display** | **Exists** (`CustomerContactBadge`) | **Partial** (exposes full profile) | **Missing** | Implemented on `/`: Token #, Patient Name, masked phone, slot time, arrival tag. |
| **Waiting Lounge TV Kiosk Display** | **Exists** (`WaitingLoungeDisplayModal.tsx`) | **Missing** | **Missing** | Implemented on `/`: high-contrast, privacy-safe display for waiting rooms. |

---

## 5. Audit: Is It Already Built or Checked Before?

### Direct Answer:
**YES, it was previously built and verified in Phase 5c (`phase-5c-frontdesk-ui`), BUT with 3 specific gaps identified above that must be addressed:**

1. **What is Already Built & Checked:**
   - Header, Consultant selector dropdown and quick stat cards (`FrontDeskHeader.tsx`).
   - 4-Digit Fast-Pass Check-In Panel with uniform error message (`FastPassCheckinPanel.tsx`).
   - 5-consecutive-attempt rate-limiting lockout with 60-second countdown timer.
   - Manual Fallback Check-In modal with mandatory justification reason (`ManualCheckinModal.tsx`).
   - Front Desk Queue Tabs for Waiting, Standby (FIFO with fit rules), Expected, and Completed (`FrontDeskQueueTabs.tsx`).
   - Start, End Consultation, Admit Patient, and Mark No Show flows (`/api/bookings/start`, `/api/bookings/end`, `/api/bookings/admit`, `record_no_show`).
   - Waiting Lounge TV View kiosk display modal (`WaitingLoungeDisplayModal.tsx`).
   - Unit test suite: `tests/unit/hospital-frontdesk-screens.test.mjs` (all 9 tests passing).
   - Playwright E2E suite: `tests/e2e/hospital-frontdesk-screens.spec.ts` (4 journeys passing).

2. **The 3 Gaps to Fix in Step 2:**
   - **Gap 1: Zero Assigned Consultants Forbidden State**: In `apps/merchant-web/src/app/page.tsx` line 491, if `accessibleResourceIds` is empty, the code currently falls back to showing all doctors. It must be updated to render a clean, explicit `403 Forbidden` card: *"Access Restricted: You are not assigned to any consultants. Contact your Hospital Administrator."*
   - **Gap 2: Unassigned Consultant URL Scoping**: In `apps/merchant-web/src/app/page.tsx`, validate URL query parameters (e.g. `?doctor_id=...`). If an unassigned doctor ID is passed, block display and render the forbidden state.
   - **Gap 3: "Up Next" Indicator on Front Desk Waiting Queue**: Wire the shared queue engine's `Up Next` candidate into `FrontDeskQueueTabs.tsx` so the top waiting patient badge displays `Up Next • Next in Line`.

---

## 6. Verification & Testing Plan for Step 2

Once approved, Step 2 will verify and complete the Front Desk experience via:
1. **Unit Test Suite (`tests/unit/hospital-frontdesk-screens.test.mjs`)**:
   - Verify Front Desk context returns only assigned doctor IDs.
   - Verify 4-digit checkin code verification with arrival tags (`On Time`, `Early`, `Late`).
   - Verify uniform error response for invalid and cross-shop codes.
   - Verify 5-attempt rate-limiting lockout.
   - Verify cross-doctor isolation (unassigned doctor actions return 403).
   - Verify manual mark-present RPC with audit logging.
2. **Playwright E2E Suite (`tests/e2e/hospital-frontdesk-screens.spec.ts`)**:
   - Journey 1: Check in by valid 4-digit code.
   - Journey 2: 5 wrong code attempts trigger the 60-second security lock.
   - Journey 3: Late patient (> 10m after slot start) automatically moves to Standby Queue.
   - Journey 4: "Up Next" candidate follows SPEC priority rules.
   - Journey 5: Unassigned consultant's queue data is unreachable by URL query parameter (`?doctor_id=unassigned-id`), rendering the Forbidden state.
3. **Full Gate Execution**:
   - `supabase db reset`
   - `node scripts/seed-hospital-test-data.mjs`
   - Serial unit test suites (`node scripts/run-all-unit-tests-serially.mjs`)
   - `pnpm typecheck`
   - `ALLOW_MOCK_PAYMENTS=false pnpm build`
   - Playwright test run
