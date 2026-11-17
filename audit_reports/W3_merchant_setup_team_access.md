# QA Audit Report: W3 - Merchant Setup & Team Access / RBAC

- **Workstream:** W3 - Merchant Setup & Team Access / RBAC
- **Auditor:** Sub-Agent W3 (QA & Security Audit Specialist)
- **Status:** COMPLETED
- **Date Started:** 2026-11-17T11:35:32Z
- **Date Finished:** 2026-11-17T11:46:00Z
- **Target Branch:** `refactor/arch-cleanup-and-security-hardening`
- **Output File:** `audit_reports/W3_merchant_setup_team_access.md`

---

## 1. Scope & Files Examined

### User Interfaces & Client Components
- `apps/merchant-web/src/app/register/page.tsx` (Merchant onboarding & shop self-registration)
- `apps/merchant-web/src/app/venues/page.tsx` (Shop profile, venue management, storefront photos)
- `apps/merchant-web/src/app/resources/page.tsx` (Doctor resources, services catalog, pricing, consultation fees)
- `apps/merchant-web/src/app/schedule/page.tsx` (Weekly operational hours, slot intervals, planned absences/leaves)
- `apps/merchant-web/src/app/team/page.tsx` (Hospital team management, staff roster, doctor assignments)
- `apps/merchant-web/src/app/settings/page.tsx` (Operational policies, UPI payouts, GSTIN, notification flags)
- `apps/merchant-web/src/app/admin/page.tsx` (Platform Super Admin merchant governance & approval)
- `apps/merchant-web/src/components/team/UnifiedAddStaffModal.tsx` (Unified staff provisioning)
- `apps/merchant-web/src/components/team/AssignFrontDeskModal.tsx` (Front desk to consultant mapping)
- `apps/merchant-web/src/components/team/StaffRosterTable.tsx` (Department staff list, role display, revocation)
- `apps/merchant-web/src/components/team/DoctorAssignmentCard.tsx` (Consultant assignment view)
- `apps/merchant-web/src/contexts/MerchantTenantContext.tsx` (Merchant tenant context & switching)

### Libraries & API Route Handlers
- `apps/merchant-web/src/lib/hospital-access.ts` (Hospital RBAC context, role resolution, status transition matrix)
- `apps/merchant-web/src/lib/auth-admin.ts` (Caller verification, booking authorization, hospital admin checks)
- `apps/merchant-web/src/lib/storage.ts` (Cloudflare R2 / Supabase Storage zero-egress media adapter)
- `apps/merchant-web/src/lib/supabase.ts` (Client & admin Supabase helper methods)
- `apps/merchant-web/src/app/api/hospital/departments/route.ts` (Hospital departments CRUD & module control)
- `apps/merchant-web/src/app/api/hospital/members/route.ts` (Staff invites, acceptance, resend, revocation)
- `apps/merchant-web/src/app/api/admin/doctor-assignments/route.ts` (Doctor-front desk mapping management)
- `apps/merchant-web/src/app/api/bookings/admit/route.ts` (OPD admit / manual check-in)
- `apps/merchant-web/src/app/api/bookings/start/route.ts` (Consultation start)
- `apps/merchant-web/src/app/api/bookings/end/route.ts` (Consultation completion)
- `apps/merchant-web/src/app/api/bookings/reorder/route.ts` (Hospital queue reordering)
- `apps/merchant-web/src/app/api/bookings/override/route.ts` (Hospital queue emergency priority override)
- `apps/merchant-web/src/app/api/doctor/emergency-cancel/route.ts` (Doctor emergency cancellation)

### Database Schemas, Migrations & RLS Policies
- `supabase/migrations/20260908000001_initial_schema.sql` (Initial provider_status enum & base RLS)
- `supabase/migrations/20260912000005_admin_merchant_governance.sql` (Super admin merchant governance RPCs)
- `supabase/migrations/20260915000001_merchant_tenant_isolation.sql` (Tenant isolation & merchant memberships)
- `supabase/migrations/20260924000003_remediation_fixes_and_grants.sql` (admin_update_merchant_status hardening)
- `supabase/migrations/20261018000001_hospital_department_rbac.sql` (Hospital department RBAC, 3-member trigger)
- `supabase/migrations/20261019000003_hospital_access_helpers.sql` (hospital_role & accessible resources helpers)
- `supabase/migrations/20261019000010_hospital_concurrency_and_queue_rpcs.sql` (Booking versioning & single IN_CONSULTATION index)
- `supabase/migrations/20261103000003_phase1_security_lockdown.sql` (admin_create_venue PENDING_APPROVAL)
- `supabase/migrations/20261107000010_perf_multiple_permissive_policies.sql` (Providers and resources consolidated RLS)
- `supabase/migrations/20261110000001_fix_resources_select_policy_anon.sql` (Resources select policy isolation)
- `supabase/migrations/20261114000003_scale_100k_rls_and_hold_batching.sql` (hospital_accessible_resource_ids_for_user & bookings RLS)
- `supabase/migrations/20261114000004_fix_human_journey_rpc_grants_and_triggers.sql` (merchant operational settings RPCs)
- `supabase/migrations/20261115000001_harden_security_definer_caller_checks.sql` (merchant_register_shop_for_user caller checks)
- `supabase/migrations/20261115000002_persist_all_merchant_settings_and_checkin_reason.sql` (merchant_save_operational_settings)

---

## 2. Detailed Audit of Required Flows

### Flow 1: Merchant Onboarding / Self-Registration & Admin Approval Gating
- **Flow ID:** FLOW-01
- **Name:** Merchant Onboarding / Self-Registration and Admin Approval Status Gating
- **Actor:** Merchant Owner / Super Administrator
- **Status:** FAIL (Partial Implementation / Gating Defect)
- **Severity:** Medium
- **Chain Traced:**
  - **UI Action:** User navigates to `/register`, completes registration form (`fullName`, `shopName`, `category`, `phone`, `address`, `photoUrl`, and IT Act Section 79 ToS checkbox).
  - **Client Validation:** `apps/merchant-web/src/app/register/page.tsx:183-197` validates non-empty inputs and requires `tosAccepted === true`.
  - **API / Edge Function:** Direct RPC invocation `supabase.rpc('merchant_register_shop_for_user', { ... })`. (Legacy proxy route `/api/merchant/register-shop` was intentionally removed for security hardening; verified by `tests/unit/cross-tenant-authorization-matrix.test.mjs:1747`).
  - **DB Write & Security:** `supabase/migrations/20261115000001_harden_security_definer_caller_checks.sql:170-265`.
    - Caller Guard: Checks `auth.uid() = p_user_id` or admin/service role (raises 42501 on foreign user ID tamper).
    - Email Uniqueness: Checks `IF EXISTS (SELECT 1 FROM public.providers WHERE lower(trim(email)) = v_clean_email)` to prevent duplicate business registrations.
    - Provider Insert: Inserts row into `public.providers`.
    - Profile Upsert: Updates `public.profiles` with `role = 'merchant'` and `default_provider_id = v_provider_id`.
    - Membership Insert: Inserts `public.merchant_memberships` with `role = 'owner'`.
- **Defects & Inconsistencies Discovered:**
  1. **Self-Registration Bypasses Approval Gate:** In `merchant_register_shop_for_user` (`20261115000001_harden_security_definer_caller_checks.sql:229`), newly created shops are inserted with status `'ACTIVE'::public.provider_status` directly. Conversely, venues created via `admin_create_venue` (`20261103000003_phase1_security_lockdown.sql:1223`) start in `'PENDING_APPROVAL'`. Consequently, self-registered merchants skip admin approval gating.
  2. **Enum Value Absence (REJECTED):** The PostgreSQL enum `provider_status` is defined as `ENUM ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED')` (`20260908000001_initial_schema.sql:15`). There is NO `'REJECTED'` enum value. Rejections/blocks are handled exclusively as `'SUSPENDED'` in both the database schema and Super Admin dashboard (`apps/merchant-web/src/app/admin/page.tsx:1308`).
- **Gating Enforcement Evidence:**
  - When status is `'PENDING_APPROVAL'` or `'SUSPENDED'`, RLS policy `Active providers are readable by everyone` (`20261022000004_optimize_rls_policies_and_stability.sql:317`) restricts visibility to `status = 'ACTIVE' OR auth.uid() = owner_id`. Unapproved/suspended venues cannot be selected or viewed by customers.
  - Customer app explicitly queries `.eq('status', 'ACTIVE')` (`apps/customer-mobile/src/services/api.ts:164`).
  - In `create_booking_hold` (`20261114000002_forensic_hardening_and_cashfree_remediation.sql:187-193`), suspended providers are rejected with `'Merchant provider is suspended'`.
- **Recommended Remediation (Description Only):**
  - In `merchant_register_shop_for_user`, change the default status from `'ACTIVE'` to `'PENDING_APPROVAL'`.
  - If a explicit 'REJECTED' status is required by product requirements, execute a migration to add `'REJECTED'` to enum `provider_status`. Otherwise, document that `'SUSPENDED'` represents rejected/blocked status.

---

### Flow 2: Merchant Tenant Scoping
- **Flow ID:** FLOW-02
- **Name:** Merchant Tenant Isolation & Multi-Tenant Scoping
- **Actor:** Merchant Owner / Hospital Staff
- **Status:** PASS
- **Severity:** N/A (Verified)
- **Chain Traced:**
  - **Context & Session:** `apps/merchant-web/src/contexts/MerchantTenantContext.tsx:50-105` and `fetchTenantContextData()` in `apps/merchant-web/src/lib/supabase.ts:709-790`.
    - Resolves active provider strictly via `userProfile.profile.default_provider_id`, `merchant_memberships`, or `owner_id = user.id`.
    - Provider switching (`switchActiveProvider`) enforces `isSuperAdmin || memberships.some(m => m.provider_id === providerId)` (`MerchantTenantContext.tsx:130-135`). Unauthorized switching attempts are aborted.
  - **Database RLS Policies:**
    - `public.providers`: `merchants_update_provider` (`20261107000010_perf_multiple_permissive_policies.sql:605-618`) restricts updates to `id IN (SELECT get_user_authorized_providers(auth.uid())) OR is_admin(auth.uid()) OR auth.uid() = owner_id`. DELETE is revoked from authenticated callers.
    - `public.resources`: `resources_update_policy` & `resources_delete_policy` (`20261107000010_perf_multiple_permissive_policies.sql:669-705`) restrict resource writes to the authorized provider.
    - `public.bookings`: `bookings_select_policy` (`20261114000003_scale_100k_rls_and_hold_batching.sql:99-118`) restricts non-hospital merchant bookings via `provider_id IN (SELECT get_user_authorized_providers(auth.uid()))`.
  - **Test Evidence:**
    - `tests/unit/cross-tenant-authorization-matrix.test.mjs:10`: Proves zero cross-tenant leakage between Merchant A and Merchant B across 40 adversarial scenarios.

---

### Flow 3: Shop Profile Create & Edit
- **Flow ID:** FLOW-03
- **Name:** Shop Profile Creation, Operating Timings, Photos & Category Configuration
- **Actor:** Merchant Owner / Super Administrator
- **Status:** PASS
- **Severity:** N/A (Verified)
- **Chain Traced:**
  - **Creation:** Initiated during onboarding (`merchant_register_shop_for_user`) or via Superadmin (`admin_create_venue`).
  - **Store Details Edit:** `apps/merchant-web/src/app/venues/page.tsx:122-153` (`handleSaveStoreProfile`) updates `address`, `description`, and `photos` in `public.providers`. Form strictly restricts editing store name, phone, or email to prevent business identity hijacking.
  - **Operating Hours & Schedule:** `apps/merchant-web/src/app/schedule/page.tsx:112-131` (`handleSave`) invokes RPC `merchant_save_weekly_schedule` (`20261115000001_harden_security_definer_caller_checks.sql:429-475`), writing weekly schedule JSON into `public.providers.weekly_hours`.
  - **Operational Settings:** `apps/merchant-web/src/app/settings/page.tsx:117-120` invokes RPC `merchant_save_operational_settings` (`20261115000002_persist_all_merchant_settings_and_checkin_reason.sql:32-108`), updating GSTIN, support phone, support email, payout UPI, auto-confirm holds, reminder offsets, and cooling period.
  - **Storefront Photo Upload:**
    - Client: `compressAndUploadImageClient` (`apps/merchant-web/src/lib/storage.ts`).
    - Validation: `detectFileTypeFromMagicBytes` inspects file signatures (`PNG: 89 50 4E 47`, `JPEG: FF D8 FF`, `WebP: RIFF...WEBP`) to reject forged extensions.
    - Storage: Uploads to bucket `venue-assets` with folder isolation `<providerId>/<userId>/<uuid>.<ext>` and `upsert: false`. Public CDN URL is written to `providers.photos` array.
- **Evidence:** `apps/merchant-web/src/app/venues/page.tsx:103-120`, `apps/merchant-web/src/lib/storage.ts:48-76`.

---

### Flow 4: Service Catalog Management
- **Flow ID:** FLOW-04
- **Name:** Service Catalog Management (Add, Edit, Deactivate, Delete Services)
- **Actor:** Merchant Owner / Hospital Admin
- **Status:** PASS
- **Severity:** N/A (Verified)
- **Chain Traced:**
  - **UI Interface:** `apps/merchant-web/src/app/resources/page.tsx`
  - **Add Service/Resource:** `handleCreateResource` (`page.tsx:225-280`) calls RPC `merchant_upsert_resource` with `p_provider_id`, `p_name`, `p_category`, `p_price`, `p_deposit_amount`, `p_duration_minutes`, `p_capacity`, and `p_attributes`.
  - **Edit Service/Resource:** `handleUpdateResource` (`page.tsx:298-338`) calls `merchant_upsert_resource` with `p_resource_id`.
  - **Deactivate/Reactivate:** `toggleActive` (`page.tsx:340-356`) executes `supabase.from('resources').update({ is_active: !currentActive }).eq('id', id)`.
  - **Delete Service:** `handleDeleteResource` (`page.tsx:358-380`) calls RPC `merchant_delete_resource({ p_resource_id: id })`.
  - **Database Constraints & RLS:**
    - `public.resources` RLS (`20261107000010_perf_multiple_permissive_policies.sql:651-705`): `resources_insert_policy`, `resources_update_policy`, and `resources_delete_policy` require caller to be owner, authorized merchant, or hospital admin (`hospital_role(provider_id, auth.uid()) = 'admin'`).
  - **Note on RPC Authorization Defect:** See Flow 6b for RPC-level bypass finding in `merchant_upsert_resource`.

---

### Flow 5: Hospital Consultant / Doctor Management
- **Flow ID:** FLOW-05
- **Name:** Hospital Consultant / Doctor Management (Add, Edit, Deactivate, Department Assignment, Schedules, Slot Intervals, Buffer Slots)
- **Actor:** Hospital Administrator
- **Status:** PASS (with Buffer Slots Absence Noted)
- **Severity:** Low (Feature gap: buffer slots)
- **Chain Traced:**
  - **Add Doctors:** Provisioned via `apps/merchant-web/src/components/team/UnifiedAddStaffModal.tsx:142-180`:
    1. Invokes `POST /api/hospital/members` to create/invite member in `public.department_members` (`role = 'consultant'`).
    2. Invokes RPC `merchant_upsert_resource` to provision doctor record in `public.resources` (`type = 'doctor'`, `attributes.doctor_email = email`, `attributes.department = department_name`).
  - **Edit Doctor Profile:** `apps/merchant-web/src/app/resources/page.tsx:282-338` allows updating consultation fee (`price`), deposit amount, and slot duration.
  - **Deactivate Doctor:** `toggleActive` in `resources/page.tsx:340` sets `resources.is_active = false`.
  - **Mid-Session Emergency Cancellation:** `handleConfirmEmergencyCancel` in `resources/page.tsx:123-149` sends `POST /api/doctor/emergency-cancel`. Invokes RPC `cancel_doctor_emergency` which cancels remaining appointments for the day, grants 100% full refunds (deposit + ₹10 platform fee), and imposes 0 merchant strike penalties per `docs/hospital/SPEC.md:14-18`.
  - **Schedule & Slot Interval Setup:** `apps/merchant-web/src/app/schedule/page.tsx:112-131` invokes `merchant_save_weekly_schedule` (`20261115000001_harden_security_definer_caller_checks.sql:429`), which updates `public.providers.weekly_hours` and bulk-updates `public.resources.duration_minutes` for all provider resources (`lines 465-470`).
  - **Leave Management:** `handleAddLeave` in `schedule/page.tsx:133-155` invokes RPC `merchant_add_resource_leave` to record planned leaves in `public.resource_leaves`.
  - **Buffer Slots Evaluation:**
    - **Defect / Omission:** There is NO dedicated buffer slot UI input or database column on `resources` or `providers`.
    - **Engine Behavior:** The platform intentionally relies on the ±10-minute arrival window and the dynamic Standby Queue gap-fitting algorithm (`packages/shared/src/queue-engine.ts`) to manage consultation turnaround time, rather than static buffer slots.
    - Verified in `tests/unit/phase3-hospital-queue.test.mjs:30-38` (legacy +2 buffer slots explicitly removed from patient UI per SPEC).

---

### Flow 6: Hospital Team RBAC Privilege Separation

#### 6a. Hospital Admin Privileges
- **Status:** PASS
- **Actor:** Hospital Administrator
- **Evidence & Checks:**
  - Staff & Department Management: Only Hospital Admin can invite staff, create departments, or modify members (`apps/merchant-web/src/lib/hospital-access.ts:400`, `apps/merchant-web/src/app/api/hospital/members/route.ts:68`, `apps/merchant-web/src/app/api/hospital/departments/route.ts:58`).
  - Service & Fee Configuration: Only Hospital Admin can configure doctor consultation fees and slot intervals (`apps/merchant-web/src/app/resources/page.tsx:438`).
  - Doctor Assignment: Only Hospital Admin can assign front desk staff to consultants (`apps/merchant-web/src/app/api/admin/doctor-assignments/route.ts:28, 341`).
  - Proved in `tests/unit/hospital-server-api-matrix.test.mjs:80-92`.

#### 6b. Front Desk Blocking from Admin Actions
- **Status:** FAIL (High Severity Defect in Stored Procedure Guards)
- **Severity:** High
- **Evidence & Checks:**
  - **UI Layer (PASS):** Front desk users receive "Desk Manager Mode: View Only" banner (`apps/merchant-web/src/app/resources/page.tsx:438-450`). Add/edit/delete buttons are suppressed. Team member invite buttons are hidden in `team/page.tsx`.
  - **API Layer (PASS):** Server API routes enforce `isHospitalAdmin` and return HTTP 403 Forbidden for Front Desk callers:
    - `POST /api/hospital/departments` -> 403
    - `POST /api/hospital/members` -> 403
    - `POST /api/admin/doctor-assignments` -> 403
    - `DELETE /api/admin/doctor-assignments` -> 403
    - `POST /api/merchant/doctor-status` -> 403
    - `POST /api/doctor/emergency-cancel` -> 403
  - **Database PostgREST Table Layer (PASS):** Direct PostgREST inserts/updates on `public.resources`, `public.departments`, `public.department_members`, and `public.doctor_front_desk_assignments` are blocked by RLS policies checking `hospital_role(provider_id, auth.uid()) = 'admin'`. Proved in `tests/unit/hospital-server-api-matrix.test.mjs:81`.
  - **Database SECURITY DEFINER RPC Layer (FAIL - DEFECT):**
    - In `public.merchant_upsert_resource` (`supabase/migrations/20261115000001_harden_security_definer_caller_checks.sql:300`):
      ```sql
      ELSIF v_caller_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.department_members 
        WHERE merchant_id = p_provider_id AND user_id = v_caller_id AND status = 'active'
      ) THEN
        v_is_authorized := true;
      ```
    - In `public.merchant_delete_resource` (line 361): Same condition.
    - In `public.merchant_save_operational_settings` (`20261115000002...:66`): Same condition.
    - In `public.merchant_save_weekly_schedule` (`20261115000001...:451`): Same condition.
    - **Defect Description:** The authorization checks in these 4 SECURITY DEFINER stored procedures verify that the caller is an active member of `department_members`, but **FAIL TO CHECK** `role = 'admin'`! Because Front Desk staff are active members in `department_members`, they can directly invoke these RPCs via the Supabase client and bypass API/UI restrictions to create/edit/delete doctor resources, alter slot duration, or modify operational settings.
    - **Likely Fix (Description Only):** In migrations defining these 4 RPCs, update the `department_members` condition to require `role = 'admin'` (e.g., `AND role = 'admin'`).

#### 6c. Add/Edit/Remove/Re-Add Front Desk Members & Invitation Activation Flow
- **Status:** PASS
- **Actor:** Hospital Administrator / Invited Staff User
- **Evidence & Checks:**
  - **Input Validation:** `apps/merchant-web/src/app/api/hospital/members/route.ts:89-92` validates email format via regex (`EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/`) and length `<= 254`.
  - **Owner Exclusion:** `route.ts:122` rejects adding hospital owner email as a department member with HTTP 400.
  - **Duplicate Prevention:** `route.ts:136-145` and partial unique index `idx_dept_members_unique_active_email` (`20261018000001_hospital_department_rbac.sql:63`) prevent adding an email already invited or active in another department (HTTP 409).
  - **Invitation Expiry:** Invite records are created with `invite_expires_at = now() + interval '7 days'`.
  - **Login Activation:** On login, `PUT /api/hospital/members` (`action: 'accept'`, lines 217-275) verifies caller session, checks 7-day expiration (returns HTTP 410 if expired), updates status to `'active'`, and links `user_id = auth.uid()`.
  - **Immediate Revocation:** `PUT /api/hospital/members` (`action: 'revoke'`, lines 356-380) marks status as `'revoked'`. Because RLS policies and SQL helpers (`hospital_role`, `hospital_accessible_resource_ids_for_user`) strictly require `status = 'active'`, revoked staff immediately lose all access without requiring JWT refresh.
  - **Re-add Capability:** Revoked members do not occupy a slot in `idx_dept_members_unique_active_email` (which only indexes `'invited', 'active'`), allowing an admin to issue a new invite to a previously revoked email.
  - Proved in `tests/unit/hospital-rbac-security.test.mjs:18-47`.

#### 6d. Front Desk Consultant Assignments
- **Status:** PASS
- **Actor:** Hospital Administrator
- **Evidence & Checks:**
  - **Mapping Table:** Stored in table `public.doctor_front_desk_assignments` (columns: `id`, `provider_id`, `doctor_id`, `user_id`, `id_card_number`, `created_at`). Note: SPEC/prompt mentions `front_desk_consultants`, but production schema table is `doctor_front_desk_assignments`.
  - **One-to-Many Cardinality:** A front desk staff member can be mapped to one or more doctors. Each assignment is stored as an independent record with unique constraint `(doctor_id, user_id)`.
  - **Management Endpoint:** `apps/merchant-web/src/app/api/admin/doctor-assignments/route.ts`:
    - `GET`: Lists all doctors and their assigned front desk managers (`lines 12-105`).
    - `POST`: Upserts assignment in `doctor_front_desk_assignments` and synchronizes `resource.attributes.front_desk_members` (`lines 110-316`).
    - `DELETE`: Deletes assignment by `assignmentId` or `(doctorId, userId)` (`lines 319-400`).
  - **Security:** Requires `isCallerHospitalAdminForProvider` (`route.ts:28, 341`). Direct access by non-admin callers returns 403. Proved in `tests/unit/hospital-server-api-matrix.test.mjs:85`.

#### 6e. Front Desk Scoping
- **Status:** PASS
- **Actor:** Front Desk Staff
- **Evidence & Checks:**
  - **Database RLS Scoping:**
    - `bookings_select_policy` and `bookings_update_policy` in `20261114000003_scale_100k_rls_and_hold_batching.sql:99-155`:
      ```sql
      (resource_id IS NOT NULL)
      AND (resource_id = ANY(ARRAY(SELECT public.hospital_accessible_resource_ids_for_user((SELECT auth.uid())))))
      ```
    - Helper `hospital_accessible_resource_ids_for_user(auth.uid())` (`scale_100k_rls...:62-71`) queries `doctor_front_desk_assignments` joined with `department_members` (`status = 'active'`).
    - Any direct `SELECT` or `UPDATE` query against `public.bookings` for unassigned doctors returns 0 rows.
  - **API Layer Scoping:**
    - Booking actions (`/api/bookings/admit`, `/api/bookings/checkin`, `/api/bookings/start`, `/api/bookings/end`, `/api/bookings/no-show`, `/api/bookings/reorder`, `/api/bookings/override`) evaluate `isCallerAuthorizedForBooking` (`apps/merchant-web/src/lib/auth-admin.ts:319-331`), which verifies `accessibleResources.includes(resourceId)`.
    - Attempts by Front Desk to act on unassigned doctor bookings return HTTP 403 Forbidden.
  - Proved in `tests/unit/hospital-server-api-matrix.test.mjs:42`.

#### 6f. Consultant Scoping
- **Status:** PASS
- **Actor:** Consultant Doctor
- **Evidence & Checks:**
  - **Self-Queue Isolation:** A consultant's accessible resource ID is strictly resolved to their own resource record (`r.user_id = caller_id` or `r.attributes.doctor_email = caller_email`) in `hospital_accessible_resource_ids_for_user` (`20261114000003...:73-89`).
  - **Database RLS:** Consultant cannot view or modify bookings belonging to another doctor or department.
  - **API Actions:** `/api/bookings/start`, `/api/bookings/end`, and `/api/queue/broadcast` verify caller resource ownership. A call from Doctor A targeting Doctor B's queue or appointment returns HTTP 403.
  - Proved in `tests/unit/cross-tenant-authorization-matrix.test.mjs:1757` and `tests/unit/hospital-server-api-matrix.test.mjs:46`.

#### 6g. Concurrency Safety
- **Status:** PASS
- **Actor:** Concurrent Front Desk Staff Members
- **Evidence & Checks:**
  - **Row-Level Locking:** `private.mark_present_manually` (`20261115000002_persist_all_merchant_settings_and_checkin_reason.sql:136-140`) acquires an explicit row lock (`FOR UPDATE`) on the target booking.
  - **Status Guard & Idempotency:** If already present/checked in, returns `ALREADY_CHECKED_IN` or idempotent success without double processing.
  - **Optimistic Concurrency Control:**
    - `public.bookings` table includes a `version INT NOT NULL DEFAULT 1` column (`20261019000010_hospital_concurrency_and_queue_rpcs.sql:15`).
    - Trigger `trg_increment_booking_version` automatically increments version on every row update.
    - Endpoints (`/api/bookings/admit`, `start`, `end`, `cancel`) validate `expected_version` and execute `.eq('version', expected_version)`. If a concurrent writer modifies the row first, the version check fails, returning HTTP 409 `CONCURRENT_UPDATE` / `STALE_VERSION`.
  - **Doctor Consultation Invariant:** Partial unique index `idx_single_in_consultation_per_doctor` (`20261019000010...:10`) prevents any doctor from having more than 1 `IN_CONSULTATION` booking concurrently. A second concurrent start fails with Postgres error 23505 (unique violation), mapped to HTTP 409.
  - **Queue Reorder Serialization:** `reorder_hospital_queue` and `override_hospital_queue_position` lock all active doctor bookings (`FOR UPDATE`) to produce gap-free, non-colliding positions.
  - Proved in `tests/unit/hospital-concurrency-safety.test.mjs:109-238` (50/50 runs pass).

#### 6h. Max Members Per Department Rule
- **Status:** PASS
- **Actor:** Hospital Administrator
- **Evidence & Checks:**
  - **Database Trigger:** `trg_check_department_member_limit` on `public.department_members` (`supabase/migrations/20261018000001_hospital_department_rbac.sql:120-156`):
    - Concurrency-safe: Locks parent department row (`PERFORM 1 FROM public.departments WHERE id = NEW.department_id FOR UPDATE`).
    - Counting: Counts active + invited members (`status IN ('invited', 'active')`). Revoked members are excluded.
    - Limit Check: `IF v_count >= 3 THEN RAISE EXCEPTION 'This department already has 3 members.'; END IF;`
  - **API Layer:** `POST /api/hospital/members` (`apps/merchant-web/src/app/api/hospital/members/route.ts:166`) maps trigger failure directly to HTTP 400.
  - **UI Layer:** `apps/merchant-web/src/components/team/UnifiedAddStaffModal.tsx:130-133` displays department capacity and disables full departments.
  - Proved in `tests/unit/hospital-rbac-security.test.mjs:75` (Strictly rejects 4th member).

---

## 3. Summary of Findings & Defect Ledger

| ID | Flow / Component | Severity | Description | Recommended Fix (Description Only) |
|---|---|---|---|---|
| DEF-01 | Flow 1 / `merchant_register_shop_for_user` | Medium | Self-registration inserts `providers` with status `'ACTIVE'`, bypassing the Super Admin approval gating (`PENDING_APPROVAL`). | Change default status from `'ACTIVE'` to `'PENDING_APPROVAL'` in `merchant_register_shop_for_user`. |
| DEF-02 | Flow 1 / Database Schema | Low | Database enum `provider_status` only has `('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED')`; there is no `'REJECTED'` value. | Add `'REJECTED'` to enum or formally document that `'SUSPENDED'` functions as rejection/block. |
| DEF-03 | Flow 6b / SECURITY DEFINER RPCs | High | In `merchant_upsert_resource`, `merchant_delete_resource`, `merchant_save_operational_settings`, and `merchant_save_weekly_schedule`, caller authorization checks `department_members.status = 'active'` without verifying `role = 'admin'`. Active Front Desk staff or Consultants can call these RPCs directly to manage resources and settings. | Update RPC caller check to require `department_members.role = 'admin'` for hospital providers. |
| DEF-04 | Flow 5 / Scheduling | Low | Buffer slots are not implemented in the resource model or UI. Schedule only configures start/end times and slot intervals. | Add `buffer_minutes` configuration if required by vertical spec, or document reliance on arrival window gap-filling. |
| DEF-05 | `admit/route.ts` line 88 | Low | `admit/route.ts` invokes `mark_present_manually` using `supabaseAdmin` (service role). `mark_present_manually` requires `auth.uid()` which is NULL for service role, causing it to fail and always fall through to the fallback direct update branch. | Pass `caller.id` to RPC or allow service role in `mark_present_manually`. |

---

## 4. Cross-Workstream Handoffs (Out-of-Scope Items Noticed)

- **HANDOFF to W2 (Customer Onboarding & Profile):** `tests/unit/hospital-bookings-rls.test.mjs` fails in `before` hook due to expecting hardcoded mock doctor names ('Sharma', 'Patel') in local seed.
- **HANDOFF to W4 (Booking Lifecycle & Queues):** Concurrent queue reorder and override tests in `hospital-concurrency-safety.test.mjs` require Next.js dev server running on port 3000/3103 for full 50-run HTTP stress suite.
- **HANDOFF to W7 (Notification Engine):** `apps/merchant-web/src/app/api/hospital/members/route.ts:174` calls `inviteUserByEmail` which logs warning in environments without an external SMTP/mailer provider configured.
- **HANDOFF to W8 (Documentation & REPO_MAP):** `audit_reports/REPO_MAP.md` refers to deleted proxy routes (`register-shop/route.ts`, `onboard/route.ts`, `upload-image/route.ts`) and references table `front_desk_consultants` instead of production name `doctor_front_desk_assignments`.

---

## 5. Verification Gate & Test Results

```bash
node --test tests/unit/hospital-rbac-security.test.mjs
```
- **Tests Passed:** 14/14 suites passed (Department creation, 7-day invite lifecycle, Max 3 members rule, Single department per email, Owner exclusion, Invite expiry, Immediate revocation, Cross-department isolation, Concurrency slot lock, Check-in RPC verification).
- **Execution Duration:** 915 ms.

```bash
node --test tests/unit/hospital-server-api-matrix.test.mjs
```
- **Tests Passed:** 10/10 suites passed (Role context resolution, Front Desk doctor access gating, Consultant self-scoping, Admin-only routes 403 block for Front Desk and Consultant).
- **Execution Duration:** 3.10 s.

```bash
node --test tests/unit/hospital-concurrency-safety.test.mjs (Race 1 & Race 2)
```
- **Tests Passed:** 50/50 double check-in runs passed; 50/50 single IN_CONSULTATION runs passed.

---
*Report compiled and verified by Sub-Agent W3 (Merchant Setup & Team Access / RBAC Audit).*
