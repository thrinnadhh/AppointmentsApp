# Hospital Admin Screen Inventory & Architecture Specification

**Role:** Hospital Admin (Owner / Medical Superintendent / In-Charge)  
**App:** `apps/merchant-web`  
**Branch:** `phase-5a-admin-ui`  
**Source of Truth:** [`docs/hospital/SPEC.md`](file:///Users/trinadh/projects/Appointments/docs/hospital/SPEC.md)

---

## 1. Overview & Authority Boundary

Per `docs/hospital/SPEC.md` line 3:
> "Hospital Admin (owner/in-charge): sees everything in their hospital. Only this role can create departments, add or remove Front Desk members and Consultants (max 3 member emails per department), manage each doctor's services (name, fee, duration), and assign Front Desk members to Consultants."

This document inventories every screen required for the Hospital Admin role, specifying:
- Route and screen title
- Purpose
- API routes utilized
- Allowed and denied actions
- UI states: `Loading`, `Empty`, `Error`, and `Forbidden`
- Gap analysis against the current implementation in [`apps/merchant-web/src/app/team/page.tsx`](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/app/team/page.tsx) (marked as `Exists`, `Partial`, or `Missing`)

---

## 2. Screen Specifications

### Screen 1: Hospital Dashboard (All Departments)
- **Route:** `/` (or `/hospital`)
- **Title:** Hospital Operations Command Center
- **Purpose:** Central real-time visibility across all hospital departments. Displays hospital-wide active consultations, live queues, upcoming bookings, doctor availability, patient flow metrics, and emergency controls.
- **API Routes:**
  - `GET /api/hospital/context`: Resolves caller role (`admin`), hospital provider ID, and accessible departments.
  - `GET /api/hospital/departments`: Retrieves all departments, active module badges, and member tallies.
  - `GET /api/admin/bookings`: Fetches daily hospital appointments across all departments and doctors.
  - `GET /api/admin/resources`: Fetches all consultant desks and active status.
  - `POST /api/doctor/emergency-cancel`: Bulk cancels remaining appointments with 100% full refund and 0 strikes when emergency occurs.
- **Allowed Actions:**
  - View real-time queue metrics across all departments.
  - Filter view by specific department (e.g., Neurology, Neurosurgery, Dermatology, Dentistry) or show "All Departments".
  - Inspect currently active consultation per doctor (`In Consultation` vs `Up Next`).
  - Trigger emergency doctor departure / session cancellation with 100% full refund.
  - Jump directly to department management, team assignments, or audit logs.
- **Denied Actions:**
  - Admitting or starting a patient consultation directly from the executive hospital dashboard without navigating to the specific doctor's desk.
  - Modifying financial transactions directly without audit logging.
- **UI States:**
  - **Loading:** Shimmer skeleton for KPI metric cards, department pill filters, and active consultation desks.
  - **Empty:** "No departments configured. Set up your hospital departments and doctor specialties to activate the command center." (Includes CTA button to `/departments`).
  - **Error:** Red alert banner with retry trigger: "Failed to load hospital operations data."
  - **Forbidden:** Full-screen 403 screen: "Hospital Administrator authority required to access the central operations command center."

---

### Screen 2: Departments Management (Create, Modules, Members & 3-Member Rule)
- **Route:** `/departments`
- **Title:** Department & Specialties Governance
- **Purpose:** Governance screen for hospital specialties. Allows creating departments, toggling allowed modules (`appointments`, `queue_schedule`, `check_in`), viewing active roster members, inviting staff members with 7-day expiry, and revoking staff access. Enforces the strict maximum of 3 member emails per department.
- **API Routes:**
  - `GET /api/hospital/departments`: Fetches all departments with member count and module configurations.
  - `POST /api/hospital/departments`: Creates a new clinical department (name, allowed modules).
  - `PATCH /api/hospital/departments`: Updates department name, active status, or module permissions.
  - `DELETE /api/hospital/departments`: Deletes empty department (protected by database against departments with active bookings).
  - `GET /api/hospital/members?department_id={id}`: Fetches department roster (email, role, status, invite expiry).
  - `POST /api/hospital/members`: Invites a Consultant or Front Desk member to the department (enforces max 3 members via database trigger `trg_check_department_member_limit`).
  - `DELETE /api/hospital/members?id={id}`: Revokes member, immediately cutting RLS access.
- **Allowed Actions:**
  - Create new department with name and selected modules (`appointments`, `queue_schedule`, `check_in`).
  - Toggle department modules.
  - View list of members per department with explicit status pills (`active`, `invited`, `expired`).
  - Invite new staff member by email, specifying role (`consultant` or `front_desk`) and 7-day expiry.
  - Copy invite link or resend invite.
  - Revoke member immediately (frees department quota for a replacement).
  - Delete department if it has zero active bookings.
- **Denied Actions:**
  - Adding a 4th member when department already has 3 active/invited members (rejected with clear error: `"Department already has the maximum of 3 members"`).
  - Adding the Hospital Admin / venue owner as a department staff member.
  - Adding an email already belonging to another department within the same hospital.
  - Deleting a department that contains active patient appointments.
- **UI States:**
  - **Loading:** Tabbed skeleton cards showing department skeletons and member avatar placeholders.
  - **Empty:** "No clinical departments found. Create your first department (e.g. Cardiology, Orthopedics)."
  - **Error:** Alert banner: "Unable to load departments. Please verify hospital credentials."
  - **Forbidden:** 403 Forbidden card: "Only Hospital Administrators can manage departments and modules."

---

### Screen 3: Team Roster & Unified Provisioning (Consultants & Front Desk)
- **Route:** `/team`
- **Title:** Team Directory & Unified Staff Provisioning
- **Purpose:** Master hospital staff directory. Enables Hospital Admins to provision both Consultants and Front Desk staff in **one single step**, capturing full name, email, credentials, role, and department membership simultaneously.
- **API Routes:**
  - `GET /api/hospital/members`: Master list of all staff with department names and roles.
  - `POST /api/hospital/members`: Provisions member with credentials and binds department membership atomically in one step.
  - `DELETE /api/hospital/members`: Revokes staff access and removes membership.
  - `GET /api/admin/resources`: Fetches doctor profiles to verify matching consultant desk.
- **Allowed Actions:**
  - "Add Team Member" modal that provisions user in one step:
    - Full Name
    - Login Email
    - Initial Password
    - Phone Number
    - Hospital Role: `Consultant` or `Front Desk`
    - Department Selection (Dropdown with real-time remaining quota: e.g. "Neurology (2/3 members)")
  - Search staff by name, email, phone, role, or department.
  - Filter by role tab (`All`, `Consultants`, `Front Desk`, `Admins`).
  - Copy login credentials / invite link.
  - Revoke staff member with immediate RLS termination.
- **Denied Actions:**
  - Selecting a department that has reached its 3-member limit (disabled in dropdown with explanation).
  - Submitting without department selection for Consultant or Front Desk.
  - Non-admin altering staff roles or passwords.
- **UI States:**
  - **Loading:** Shimmer table with 5 placeholder rows.
  - **Empty:** "No staff accounts found. Click '+ Add Team Member' to provision your first consultant or receptionist."
  - **Error:** Banner: "Failed to load team roster."
  - **Forbidden:** 403 Forbidden: "Hospital Admin access required to view or manage staff accounts."

---

### Screen 4: Front Desk to Consultant Assignments
- **Route:** `/team/assignments` (or dedicated tab in `/team`)
- **Title:** Reception Desk & Doctor Assignments
- **Purpose:** Assigns Front Desk staff to one or more Consultants. Renders doctor-centric desks showing assigned reception managers, handles multi-doctor assignments (1 Front Desk assigned to multiple Doctors), and enforces mandatory Staff ID Card numbers when a doctor has multiple front desk managers.
- **API Routes:**
  - `GET /api/admin/doctor-assignments`: Returns all doctors with their assigned front desk managers and verified ID cards.
  - `POST /api/admin/doctor-assignments`: Assigns Front Desk staff member to doctor; validates ID card requirement if >= 1 existing manager.
  - `DELETE /api/admin/doctor-assignments`: Unassigns Front Desk staff member from doctor.
- **Allowed Actions:**
  - Assign an existing Front Desk staff member to one or more Consultants.
  - Provision a new Front Desk receptionist directly on a doctor card.
  - Require and validate Staff ID Card number when doctor has >= 1 receptionist assigned.
  - Unassign a Front Desk manager from a specific Consultant.
  - Copy receptionist login email and ID card badge.
- **Denied Actions:**
  - Assigning more than 4 Front Desk managers to a single Consultant.
  - Assigning a Consultant (Doctor) to another doctor as a receptionist.
  - Omitting Staff ID Card number when doctor already has another receptionist assigned.
  - Non-admin attempting assignment changes (403 Forbidden).
- **UI States:**
  - **Loading:** 4 doctor card skeletons with placeholder receptionist pills.
  - **Empty:** "No active doctors found. Configure doctors in Doctor Services before making front desk assignments."
  - **Error:** Error toast: "Failed to update doctor front desk assignment."
  - **Forbidden:** 403 Forbidden screen.

---

### Screen 5: Doctor Services & Consultation Fees
- **Route:** `/resources` (or `/doctor-services`)
- **Title:** Doctor Services & Consultation Fees
- **Purpose:** Manages clinical consultation services per doctor: Consultant Name, Specialty Department, Consultation Fee (`deposit_amount`), Duration in minutes (`duration_minutes`), and Active / On Leave status.
- **API Routes:**
  - `GET /api/admin/resources`: Fetches all resources with department, fee, duration, and active status.
  - `POST /api/admin/resources`: Adds new doctor resource with fee and duration.
  - `PATCH /api/admin/resources`: Updates fee, duration, department, or active status.
  - `DELETE /api/admin/resources`: Deactivates/removes doctor resource.
- **Allowed Actions:**
  - Create new doctor service profile with name, department, consultation fee, and duration.
  - Edit consultation fee (e.g., ₹500, ₹800).
  - Edit slot duration (e.g., 15 min, 20 min, 30 min).
  - Toggle doctor active status (`Active Desk` vs `On Break / Inactive`).
  - Filter doctor services by department.
- **Denied Actions:**
  - Setting zero or negative consultation duration or fee.
  - Non-admin modifying consultation fees or durations.
  - Removing a doctor resource that has active scheduled consultations without reassigning or cancelling.
- **UI States:**
  - **Loading:** Skeleton grid of service cards with fee badges.
  - **Empty:** "No doctor consultation services registered. Click '+ Add Doctor Service' to get started."
  - **Error:** Banner: "Failed to load doctor consultation services."
  - **Forbidden:** 403 Forbidden: "Only Hospital Administrator can manage doctor services and consultation fees."

---

### Screen 6: Doctor Schedule & Leave Management
- **Route:** `/schedule`
- **Title:** Doctor Operating Schedules & Leave
- **Purpose:** Configures weekly session hours (OPD shifts) per doctor and manages doctor leave. Marking a Consultant on leave blocks all new bookings for that date while preserving existing bookings for reassignment or emergency resolution.
- **API Routes:**
  - `GET /api/admin/resources`: Lists doctors to select individual schedules.
  - `GET /api/merchant/schedule`: Fetches operational days and shift hours.
  - `POST /api/merchant/schedule`: Saves weekly operating schedule (e.g. Mon-Fri 09:00 - 17:00, Sat 09:00 - 13:00).
  - `POST /api/doctor/leave`: Marks Consultant on leave for a specific calendar date.
  - `POST /api/doctor/emergency-cancel`: Emergency resolution if doctor falls ill mid-day (full refund to booked patients).
- **Allowed Actions:**
  - Select doctor and configure specific daily operating windows (start time, end time).
  - Toggle working days on/off.
  - Mark doctor on leave for a specific date (renders calendar leave picker).
  - Displays count of affected existing bookings on leave date with direct link to reassign.
- **Denied Actions:**
  - Setting shift end time earlier than start time.
  - Setting operating hours outside hospital venue operating boundaries.
  - Non-admin editing doctor shift hours.
- **UI States:**
  - **Loading:** Schedule time row skeletons.
  - **Empty:** "No doctor selected or no schedule defined."
  - **Error:** Alert: "Failed to update doctor operating schedule."
  - **Forbidden:** 403 Forbidden screen.

---

### Screen 7: Hospital Audit Log
- **Route:** `/audit-logs` (or `/admin/audit-logs`)
- **Title:** Hospital Security & Compliance Audit Log
- **Purpose:** Immutable compliance and audit trail screen per SPEC. Records check-ins, status transitions, doctor-front desk assignments, priority overrides, emergency cancellations, and department changes with actor, timestamp, and metadata.
- **API Routes:**
  - `GET /api/hospital/audit-logs`: Fetches paginated audit logs for the hospital provider.
- **Allowed Actions:**
  - Filter audit logs by action category:
    - `CHECKIN` (Code verified, manual mark present)
    - `STATUS_CHANGE` (Admitted, started, completed, no-show)
    - `ASSIGNMENT_CHANGE` (Front desk assigned/unassigned)
    - `EMERGENCY_CANCEL` (Doctor emergency session cancellation)
    - `OVERRIDE` (Medical urgency queue reorder)
    - `DEPARTMENT_GOVERNANCE` (Member invited, revoked, department created)
  - Search by actor email, patient reference code, or doctor name.
  - Expand JSON metadata payload to inspect before/after states.
  - Date range filtering (Today, Last 7 Days, Last 30 Days).
- **Denied Actions:**
  - Modifying, editing, or deleting any audit log entry (strictly read-only; database enforces immutable append-only).
- **UI States:**
  - **Loading:** Table skeleton showing timestamp and event tag placeholders.
  - **Empty:** "No audit events recorded for the selected filter."
  - **Error:** Alert: "Unable to retrieve audit trail."
  - **Forbidden:** 403 Forbidden screen: "Hospital Administrator authority required to view audit logs."

---

### Screen 8: No-Show & Financial Settings (Read-Only Display)
- **Route:** `/settings/no-show` (or dedicated section in `/settings`)
- **Title:** No-Show Financial Policy & Fee Distribution
- **Purpose:** Transparent, read-only display of hospital no-show financial rules per `SPEC.md` line 13:
  - Doctor allocation: ₹50.00
  - Platform fee: ₹10.00
  - Customer refund: Deposit minus ₹60.00
  - Customer cancellation cutoff: 60 minutes before slot start (>= 60m: full refund; < 60m: forfeited).
  - No-show account status: Reporting flag only (account never blocked).
- **API Routes:**
  - `GET /api/hospital/context`: Fetches venue policy configuration.
  - `GET /api/admin/bookings`: Displays recent no-show counts and financial split metrics.
- **Allowed Actions:**
  - Read-only inspection of the exact deposit distribution formula (₹50 Doctor / ₹10 Platform / Remainder Refund).
  - Inspection of the 60-minute customer cancellation window policy.
  - View aggregate hospital no-show counts and total fees distributed.
- **Denied Actions:**
  - Modifying core platform fee rules without Super Admin authorization (read-only enforcement).
- **UI States:**
  - **Loading:** Policy card skeletons.
  - **Empty:** N/A (Standard policies always exist).
  - **Error:** "Failed to load financial policy parameters."
  - **Forbidden:** 403 Forbidden screen.

---

## 3. Comparison with Current `apps/merchant-web/src/app/team/page.tsx`

| Required Hospital Admin Item | Status in Current Code | Detailed Findings in `team/page.tsx` (1,369 lines) |
| :--- | :---: | :--- |
| **1. Hospital Dashboard (All Departments)** | `MISSING` | `team/page.tsx` is an account directory and assignment screen. The main dashboard (`page.tsx`) contains queue components but has no department tabs, department filtering, or multi-department command view. |
| **2. Departments Management (Create, Modules, Max-3 Rule, Invite, Revoke)** | `MISSING` | `team/page.tsx` has no department CRUD, no module selection (`appointments`, `queue_schedule`, `check_in`), and cannot invite members into departments or enforce the 3-member limit. It only contains a link directing users to `/resources`. |
| **3. Team (Add Front Desk & Consultants in ONE step with Department)** | `PARTIAL` | `team/page.tsx` can create a Front Desk user and assign them to a doctor, but it **cannot** set their department membership, nor can it provision a Consultant in one step with department binding. |
| **4. Assignments (Front Desk to one or more Consultants)** | `EXISTS` | `team/page.tsx` successfully renders doctor cards and assigns/unassigns Front Desk staff using `/api/admin/doctor-assignments`. It also enforces mandatory staff ID cards when a doctor has >1 manager. |
| **5. Doctor Services (Name, Fee, Duration, Active)** | `MISSING` | `team/page.tsx` displays doctor name and fee as read-only on cards, but editing or creating services is completely missing (it redirects to `/resources`). |
| **6. Doctor Schedule and Leave** | `MISSING` | Not present in `team/page.tsx`. General merchant operating hours exist in `/schedule/page.tsx`, but per-doctor session hours, doctor leave marking, and mid-day departure handling are missing. |
| **7. Hospital Audit Log** | `MISSING` | Not present in `team/page.tsx`. System logs exist in `/admin/logs/page.tsx`, but dedicated hospital compliance audit logs (`/api/hospital/audit-logs`) are missing from the merchant navigation. |
| **8. No-Show Amounts (Read-Only Display)** | `MISSING` | `team/page.tsx` does not display no-show financial policies. General settings in `/settings/page.tsx` mention a forfeit toggle, but the SPEC ₹50 doctor / ₹10 platform / remainder refund split is not shown. |

---

## 4. Refactoring Plan: Modularizing `team/page.tsx`

The monolithic 1,369-line `apps/merchant-web/src/app/team/page.tsx` will be decomposed into small, single-purpose components under `apps/merchant-web/src/components/team/`:
1. `DoctorAssignmentCard.tsx`: Dedicated doctor desk card rendering assigned front desk managers, doctor login credentials, and ID badge status.
2. `AssignFrontDeskModal.tsx`: Modal for assigning existing staff or provisioning new receptionists with mandatory ID badge checks.
3. `UnifiedAddStaffModal.tsx`: **New** modal allowing one-step provisioning of Consultants and Front Desk with department selection and 3-member limit validation.
4. `StaffRosterTable.tsx`: Dedicated tabular directory of verified staff accounts with search, role filters, and revocation actions.
5. `TeamMetricsCards.tsx`: Top KPI summary tiles (Total Staff, Doctor Desks, Front Desk Desks, Hospital Admins).

---

## 5. Next Steps (Pending Approval)

Upon receipt of your **"approved"** reply:
1. Build the missing and partial screens matching the exact specifications and names in `SPEC.md`.
2. Decompose `team/page.tsx` into modular components.
3. Integrate audit log calls for all administrative actions.
4. Add page-level test suites (`@playwright/test` or `node:test`).
5. Run the full serial gate (`supabase db reset`, test suites, typecheck, build).
