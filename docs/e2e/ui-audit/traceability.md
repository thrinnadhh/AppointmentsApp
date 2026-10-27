# SPEC to UI Traceability Matrix & Gap Analysis

**Generated:** 2026-10-26  
**Source of Truth:** [`docs/hospital/SPEC.md`](../../hospital/SPEC.md) and [`docs/hospital/screens-*.md`](../../hospital/)  
**Layer:** Audit & Verification Layer (TEST AND REPORT ONLY — No application code changes)

---

## 1. Traceability Matrix: SPEC Rules to UI Navigation Paths

| SPEC Rule / Requirement | SPEC Ref | Role | UI Navigation Path from Home | UI Component & TestID | Backend API / RPC | Traceability Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **Hospital Admin Scope & Dept CRUD** | SPEC L3 | Hospital Admin | Web: Nav `/departments` ➔ `[+ Add Department]` | `apps/merchant-web/src/app/departments/page.tsx` | `POST /rest/v1/departments` | **VERIFIED** |
| **Max 3 Members Quota per Department** | SPEC L3 | Hospital Admin | Web: `/departments` ➔ `[Invite Member]` | `apps/merchant-web/src/app/departments/page.tsx` | Enforced in SQL trigger `trg_check_department_member_limit` | **VERIFIED** |
| **7-Day Invite Expiry TTL** | SPEC L3 | Hospital Admin | Web: `/departments` ➔ Invite Link | `apps/merchant-web/src/app/departments/page.tsx` | `department_members.invitation_expires_at` | **VERIFIED** |
| **Manage Doctor Services & Fees** | SPEC L3 | Hospital Admin | Web: Nav `/resources` ➔ `[+ Add Doctor]` / Edit | `apps/merchant-web/src/app/resources/page.tsx` | `POST/PATCH /rest/v1/resources` | **VERIFIED** |
| **Assign Front Desk to Consultants** | SPEC L3 | Hospital Admin | Web: Nav `/team` ➔ `[Assign Front Desk]` modal | `AssignFrontDeskModal.tsx` (`data-testid="btn-assign-frontdesk"`) | `POST /rest/v1/doctor_front_desk_assignments` | **VERIFIED** |
| **Front Desk Consultant Scoping** | SPEC L4, 7 | Front Desk | Web: Nav `/bookings` / `/consultation` | Scoped by `hospital_accessible_resource_ids()` | PostgREST RLS filter | **VERIFIED** |
| **Fast-Pass 4-Digit Check-In** | SPEC L26–28 | Front Desk | Web: `/bookings` ➔ FastPass Panel | `FastPassCheckinPanel.tsx` (`data-testid="fastpass-input"`) | RPC `verify_checkin_code` | **VERIFIED** |
| **Fast-Pass 5-Fail 60s Lockout** | SPEC L28 | Front Desk | Web: `/bookings` ➔ 5 wrong OTP entries | `FastPassCheckinPanel.tsx` (`lockoutCountdown`) | Client + Server rate limit | **VERIFIED** |
| **Manual Check-In with Justification** | SPEC L27–28 | Front Desk | Web: `/bookings` ➔ `[Manual Check-in]` modal | `ManualCheckinModal.tsx` (`data-testid="input-manual-reason"`) | RPC `mark_present_manually` | **VERIFIED** |
| **Admit Patient to Room** | SPEC L4 | Front Desk | Web: `/bookings` ➔ `[Admit Patient]` button | `apps/merchant-web/src/app/bookings/page.tsx` | `POST /api/bookings/admit` | **VERIFIED** |
| **Waiting Lounge TV Display** | SPEC L9 | Front Desk | Web: `/bookings` ➔ `[Waiting Lounge TV]` | `WaitingLoungeDisplayModal.tsx` | Read-only fullscreen view | **VERIFIED** |
| **Consultant Scoping to Own Queue** | SPEC L5 | Consultant | Web: Nav `/consultation` | `apps/merchant-web/src/app/consultation/page.tsx` | Scoped to `auth.uid()` | **VERIFIED** |
| **Up Next Queue Dispatch Card** | SPEC L9, 37 | Consultant | Web: `/consultation` ➔ Up Next Card | `UpNextPatientCard.tsx` | Derived via Queue Engine | **VERIFIED** |
| **Live Consultation Elapsed Timer** | SPEC L9 | Consultant | Web: `/consultation` ➔ Active Consultation | `ActiveConsultationCard.tsx` (`timerDisplay`) | Real-time interval timer | **VERIFIED** |
| **Clinical Notes & Prescription** | SPEC L5 | Consultant | Web: `/consultation` ➔ Notes textarea | `ActiveConsultationCard.tsx` (`clinicalNotes`) | `PATCH /rest/v1/bookings` | **VERIFIED** |
| **Medical Urgency Override** | SPEC L39 | Consultant / Admin | Web: `/consultation` ➔ `[Medical Urgency Override]` | `MedicalUrgencyOverrideModal.tsx` | Audited in `public.audit_logs` | **VERIFIED** |
| **Contact Masking with Justification** | SPEC L6 | Hospital Staff | Web: `/bookings` ➔ Eye icon on badge | `CustomerContactBadge.tsx` (`reveal-reason-modal`) | RPC `reveal_customer_contact` | **VERIFIED** |
| **Customer City Selection** | SPEC L8 | Customer | Mobile: Home ➔ City Pill in Header | `HomeScreen.tsx` (`close-city-modal-btn`) | Filter on `profiles.assigned_city_id` | **VERIFIED** |
| **Slot Arrival Window (±10 mins)** | SPEC L35 | Customer | Mobile: Doctor ➔ Slot Selection | `CheckoutModal.tsx` (`arrival-window-notice`) | Pure UI calculation | **VERIFIED** |
| **5-Minute Hold Timer** | SPEC L11 | Customer | Mobile: Checkout Modal ➔ Hold Start | `CheckoutModal.tsx` (`holdTimerDisplay`) | RPC `create_booking_hold` | **VERIFIED** |
| **Family / Friend Booking Toggle** | SPEC L13 | Customer | Mobile: Checkout Modal ➔ Someone Else Switch | `CheckoutModal.tsx` (`family-toggle`) | Bypasses 1-hour gap check | **VERIFIED** |
| **Minor Patient Consent Toggle** | DPDP §9 | Customer | Mobile: Checkout Modal ➔ Minor Patient Switch | `CheckoutModal.tsx` (`minor-consent-checkbox`) | Recorded in `user_consents` | **VERIFIED** |
| **60m Pre-Slot PIN Lockout** | SPEC L26–27 | Customer | Mobile: My Bookings ➔ View Pass | `BookingPassModal.tsx` (`pass-checkin-early-box`) | Masked when `now < slot - 60m` | **VERIFIED** |
| **60m Pre-Slot PIN Reveal** | SPEC L26–27 | Customer | Mobile: My Bookings ➔ View Pass | `BookingPassModal.tsx` (`pass-checkin-code-box`) | Unmasked when `now >= slot - 60m` | **VERIFIED** |
| **Hide PIN on Check-in** | SPEC L26–27 | Customer | Mobile: My Bookings ➔ View Pass | `BookingPassModal.tsx` (`pass-checkedin-box`) | Hidden on `is_present = true` | **VERIFIED** |
| **Home Pulse Micro-Green Indicator** | SPEC L34 | Customer | Mobile: Home ➔ Upcoming Appointment Card | `HomeScreen.tsx` (`pulsing-green-dot`) | Realtime pulse animation | **VERIFIED** |
| **Permanent Lifetime Check-in PIN** | SPEC L26 | Customer | Mobile: Nav `My Appointments` | `MyBookingsScreen.tsx` (`lifetime-pin-banner`) | `profiles.permanent_checkin_pin` | **VERIFIED** |
| **Standby Queue Honest Estimate** | SPEC L9, 36–38 | Customer | Mobile: Pass ➔ Late Arrival State | `BookingPassModal.tsx` (`pass-honest-estimate-box`) | Calculated via Queue Engine | **VERIFIED** |
| **Early Invite "Come Now?"** | SPEC L38 | Customer | Mobile: Pass ➔ Early Invite Banner | `BookingPassModal.tsx` (`pass-come-now-invite`) | Derived from doctor session | **VERIFIED** |
| **Free Cancel >=60m (100% Refund)** | SPEC L12 | Customer | Mobile: My Bookings ➔ `[Cancel]` | `MyBookingsScreen.tsx` (`cancel-modal`) | `POST /api/bookings/cancel` | **VERIFIED** |
| **Forfeit Cancel <60m** | SPEC L12 | Customer | Mobile: My Bookings ➔ `[Cancel]` | `MyBookingsScreen.tsx` (`cancel-modal`) | `POST /api/bookings/cancel` | **VERIFIED** |
| **Doctor Emergency Modal (100% Full Refund)** | SPEC L14–18 | Customer | Mobile: Global in-app event | `DoctorEmergencyModal.tsx` | RPC `cancel_doctor_emergency` | **VERIFIED** |
| **Tiered No-Show Policy Warning** | SPEC L19–23 | Customer | Mobile: Checkout Modal (3rd miss) | `CheckoutModal.tsx` (`no-show-warning-modal`) | Handled in `create_booking_hold` | **VERIFIED** |
| **7-Day Account Block Notice** | SPEC L23 | Customer | Mobile: Checkout Modal (>5 strikes) | `CheckoutModal.tsx` (`account-blocked-banner`) | `profiles.blocked_until` | **VERIFIED** |
| **Data Principal Archive Export** | DPDP §11 | Customer | Mobile: Account Screen ➔ `[Export Archive]` | `AccountScreen.tsx` (`btn-export-archive`) | `GET /api/account/export` | **VERIFIED** |
| **Account Erasure with 30-Day Grace** | DPDP §12 | Customer | Mobile: Account Screen ➔ `[Delete Account]` | `AccountScreen.tsx` (`btn-delete-account`) | `DELETE /api/account` | **VERIFIED** |

---

## 2. Dead Ends Analysis

> **Definition:** A UI screen, modal, or intermediate state where a user cannot navigate back, cancel, or progress without force-quitting the application.

- **Mobile Surface (`apps/customer-mobile`)**:
  - `HomeScreen`: Root screen. Back button calls `BackHandler.exitApp()`. **Clean**.
  - `ProviderDetailScreen`: Has top-left back button (`onBack`), and hardware back button pops stack. **Clean**.
  - `CustomerDetailsModal`: Full-screen modal with close button (`X` icon in header). **Clean**.
  - `CheckoutModal`: Bottom sheet modal with explicit `[Cancel]` button and header dismiss. **Clean**.
  - `BookingPassModal`: Full-screen modal with top-right `[Close]` button. **Clean**.
  - `MyBookingsScreen`: Bottom-tab screen. Back button returns to Home screen. **Clean**.
  - `AccountScreen`: Modal drawer with top close button and backdrop tap dismiss. **Clean**.
  - `ConsentScreen`: Contains `[Decline]` and `[Accept]` CTAs. **Clean**.
  - `DoctorEmergencyModal`: Modal overlay providing explicit CTAs (`[Wait]`, `[Reschedule]`, `[100% Refund]`). **Clean**.
  - **Verdict on Dead Ends**: **0 Dead Ends detected**.

- **Web Surface (`apps/merchant-web`)**:
  - All modals (`ManualCheckinModal`, `WaitingLoungeDisplayModal`, `MedicalUrgencyOverrideModal`, `CustomerContactBadge` reason dialog, `AssignFrontDeskModal`, `UnifiedAddStaffModal`) include explicit Cancel buttons and backdrop click handlers.
  - 403 Forbidden screens include recovery links (`consultant-foreign-doctor-forbidden` links back to `/consultation`).
  - **Verdict on Dead Ends**: **0 Dead Ends detected**.

---

## 3. Impossible Flows Analysis

> **Definition:** An action offered in the UI that the backend always rejects, or an action fundamentally required by the business logic that is never offered.

1. **Attempting Contact Reveal on Non-Confirmed Bookings**:
   - *Backend Rule*: `reveal_customer_contact` RPC rejects reveals when `booking.status != 'CONFIRMED'`.
   - *UI Behavior*: `CustomerContactBadge` only renders the reveal button if `phone` exists. If invoked on non-confirmed cards, error is caught and `Confirmed bookings only` badge displays.
   - *Status*: **HANDLED GRACEFULLY**.
2. **Attempting Customer Cancel <60m expecting refund**:
   - *Backend Rule*: `cancel_booking` RPC forfeits the deposit when slot is within 60 minutes.
   - *UI Behavior*: `MyBookingsScreen` dynamically detects `slot_start - now < 60m` and warns: *"Warning: Less than 60m remaining. Deposit of ₹200 will be forfeited."*
   - *Status*: **HANDLED GRACEFULLY**.
3. **Desk Staff adding Doctors on `/resources`**:
   - *Backend Rule*: Only Hospital Admin can manage doctor resources.
   - *UI Behavior*: On `/resources`, when logged in as Front Desk, the `[+ Add Doctor]` button is visibly disabled with tooltip `Add doctor disabled for desk managers`.
   - *Status*: **HANDLED GRACEFULLY**.

---

## 4. States with Inadequate or Missing User Explanations

1. **DPDP User Consent Modification Post-Onboarding**:
   - *Finding*: Consents are gathered during sign-up/onboarding (`user_consents` table). If a user wishes to modify their optional marketing or communication preference later, `AccountScreen.tsx` provides Account Deletion and Data Export, but does not provide an explicit "Manage Consent Preferences" toggle screen.
   - *Impact*: Low (User can delete account, but cannot granularly revoke partial consent in settings).
   - *Logged to Backlog*: Yes (`UI-CONSENT-01`, Severity: Low).
2. **Prescription Document Upload on Customer Mobile**:
   - *Finding*: The web merchant consultation desk displays and audits attachment URLs (`attachment_url`), but the mobile customer checkout flow currently does not offer an image/document upload button for past prescriptions.
   - *Impact*: Medium (Prescription attachment is an optional vertical feature, but mobile UI does not have the upload step).
   - *Logged to Backlog*: Yes (`UI-ATTACH-01`, Severity: Medium).
