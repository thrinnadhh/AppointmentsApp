# Plan: Merchant Multi-Tenant Isolation & Role Scoping

## Overview
Currently, the merchant portal (`apps/merchant-web`) exposes a global venue selector and fetches all businesses across Tirupati. A salon merchant, clinic doctor, turf operator, or restaurant owner has visibility into all other merchants' bookings, resources, and configurations. Furthermore, the UI terminology is generic ("Doctors & Services", "Venues & Businesses") rather than verticalized.

This initiative introduces **strict multi-tenant space isolation and vertical adaptive scoping**:
1. **Salon Merchant Space**: Strictly scoped to their own salon venue, showing only haircut/spa stylists, styling stations/chairs, beauty service bookings, and salon operational controls. Cannot view or access hospitals, turfs, or other salons.
2. **Doctor/Hospital Merchant Space**: Strictly scoped to their own hospital/clinic venue, showing only doctors, OPD consultation rooms, patient queues, token numbers, and medical/prescription workflows. Cannot view or access salons or other clinics.
3. **Super Admin Omniscience**: Full cross-city, cross-merchant visibility, city rollout controls, merchant approval/suspension, audit trail ledger, platform-wide analytics, and optional tenant inspection.

---

## Project Type
**WEB & BACKEND (Next.js 15 Full-Stack + Supabase PostgreSQL RLS)**
- Primary Agents: `project-planner` (planning), `backend-specialist` (database & RLS), `frontend-specialist` (tenant UI & vertical adaptations)
- Recommended Skills: `plan-writing`, `clean-code`, `database-design`, `webapp-testing`

---

## Success Criteria
1. **Hard Tenant Isolation at Database Level**:
   - Supabase PostgreSQL RLS policies enforce that a user with `role = 'merchant'` can only query, insert, or update rows in `providers`, `resources`, `bookings`, and `resource_availability` that belong to their authorized `provider_id`.
   - Any query attempting to access another merchant's `provider_id` returns 0 rows or fails with permission denied.
2. **Deterministic Session & Tenant Bootstrap**:
   - Upon authentication, the merchant portal retrieves the user's authorized venue membership.
   - For single-venue merchants, the portal locks into their venue automatically and hides the global venue switcher.
   - For multi-branch merchants, switching is strictly constrained to venues owned by that merchant.
3. **Adaptive Vertical UI Experience**:
   - When a **Salon** merchant logs in:
     - Navigation reads "Stylists & Stations" (not "Doctors & Services").
     - Booking cards display Stylist name, Chair/Station #, and Service duration.
     - Adding a resource provides Salon-specific fields (e.g. Hair Styling, Facial, Spa, Waxing).
   - When a **Doctor/Hospital** merchant logs in:
     - Navigation reads "Doctors & OPD Rooms".
     - Booking cards display Doctor on duty, Room/Bed #, Medical token, and Prescription attachment link.
     - Adding a resource provides Medical-specific fields (Cardiology, Orthopedics, Pediatrics, OPD timings).
4. **Super Admin Governance Preserved**:
   - Super Admin (`role = 'admin'`) retains universal access to `/admin` and all merchant data across cities.
   - Merchants attempting to access `/admin` are blocked and redirected to their isolated merchant hub.
5. **E2E Test Verification**:
   - Playwright multi-tenant test suite validates Salon isolation, Doctor isolation, and Admin governance with 100% pass rate.

---

## Tech Stack & Architectural Decisions
- **Database**: PostgreSQL on Supabase with Row Level Security (RLS) and `SECURITY DEFINER` helper functions.
- **Tenant Membership Model**:
  - `public.merchant_memberships` table mapping `user_id` -> `provider_id` with `role` (`'owner' | 'manager' | 'staff'`) and `is_active`.
  - Cached `default_provider_id` and `vertical` on `public.profiles` for fast 1-roundtrip session hydration.
- **State Management**: Next.js React Context `MerchantTenantContext` providing `currentTenant`, `vertical`, `isLocked`, and vertical-specific copy dictionaries.
- **Design Tokens**: Strict adherence to `DESIGN.md` (Emerald Green `#059669`, Deep Slate `#0f172a`, Amber Gold `#d97706`, Zero Purple).

---

## File Structure & Impact Matrix

```
Appointments/
├── supabase/
│   └── migrations/
│       └── 20260915000001_merchant_tenant_isolation.sql   # [NEW] Membership table & RLS policies
├── packages/
│   └── shared/
│       └── src/
│           └── types.ts                                   # [MODIFY] Add MerchantMembership & TenantContext types
├── apps/
│   └── merchant-web/
│       └── src/
│           ├── contexts/
│           │   └── MerchantTenantContext.tsx              # [NEW] Multi-tenant provider & vertical scoping hook
│           ├── components/
│           │   ├── Navigation.tsx                         # [MODIFY] Dynamic vertical nav labels & admin gate
│           │   └── TenantSelector.tsx                     # [NEW] Scoped selector (only user's branches, or admin lens)
│           ├── lib/
│           │   ├── supabase.ts                            # [MODIFY] Tenant-scoped queries & membership resolution
│           │   └── vertical-config.ts                     # [NEW] Vertical dictionaries (Salon vs Doctor vs Turf vs Dining)
│           └── app/
│               ├── layout.tsx                             # [MODIFY] Wrap with MerchantTenantProvider
│               ├── page.tsx                               # [MODIFY] Scoped dashboard metrics & vertical quick actions
│               ├── resources/page.tsx                     # [MODIFY] Scoped resource list & verticalized creation modal
│               ├── bookings/page.tsx                      # [MODIFY] Scoped bookings queue & vertical card details
│               └── venues/page.tsx                        # [MODIFY] Show only owned venue(s), lock edit to owner
└── tests/
    └── e2e/
        ├── merchant-tenancy-isolation.spec.ts             # [NEW] Dedicated E2E isolation & RBAC suite
        └── pages/
            └── merchant-portal.page.ts                    # [MODIFY] Update locators for verticalized elements
```

---

## Detailed Task Breakdown

### Phase 1: Database & RLS Foundation (P0 - Security & Data)
- **Task 1.1: Tenant Membership Schema & Profiles Migration**
  - **Agent**: `backend-specialist` | **Skill**: `database-design`
  - **Input**: `supabase/migrations/`
  - **Action**: Create migration `20260915000001_merchant_tenant_isolation.sql`:
    1. Create `public.merchant_memberships` table (`id`, `user_id`, `provider_id`, `role`, `created_at`).
    2. Add `default_provider_id` to `public.profiles`.
    3. Seed memberships for demo accounts:
       - `naturals.salon@tirupati-appointments.com` -> Naturals Salon & Spa provider.
       - `svims.clinic@tirupati-appointments.com` -> SVIMS Specialty Clinic provider.
  - **Output**: Migration file applied cleanly to Supabase.
  - **Verify**: Querying `merchant_memberships` returns correct mappings for demo users.

- **Task 1.2: Row-Level Security (RLS) Isolation Policies**
  - **Agent**: `backend-specialist` | **Skill**: `clean-code`
  - **Input**: Database tables `providers`, `resources`, `bookings`, `resource_availability`.
  - **Action**:
    1. Define helper function `public.get_user_authorized_provider_ids() RETURNS SETOF UUID`.
    2. Enforce strict `SELECT/INSERT/UPDATE` policies on `providers`, `resources`, and `bookings` where `provider_id IN (SELECT get_user_authorized_provider_ids()) OR is_admin()`.
  - **Output**: Multi-tenant isolation active at PostgreSQL level.
  - **Verify**: Executing query as Salon user for Clinic booking returns 0 records.

---

### Phase 2: Shared Types & Vertical Configuration (P1 - Core Domain)
- **Task 2.1: Types Extension**
  - **Agent**: `backend-specialist` | **Skill**: `clean-code`
  - **Input**: `packages/shared/src/types.ts`
  - **Action**: Export `MerchantMembership`, `TenantRole`, `BusinessVertical`, and `TenantContextState`.
  - **Output**: Updated `types.ts` built and available to workspace apps.
  - **Verify**: `npm run build` succeeds without type errors.

- **Task 2.2: Vertical Configuration Matrix (`vertical-config.ts`)**
  - **Agent**: `frontend-specialist` | **Skill**: `frontend-architecture`
  - **Input**: Category IDs (`salons`, `clinics`, `gaming`, `restaurants`, `pets`).
  - **Action**: Create config defining:
    - Labels: Resource Singular/Plural (Stylist vs Doctor vs Turf vs Table).
    - Unit Labels: Station/Chair vs OPD Room vs Court vs Table.
    - Action terminology: Appointment vs Consultation vs Match vs Dining.
    - Department presets: (Salon: Hair, Spa, Skin, Nails vs Clinic: Cardiology, Dental, Ortho).
    - Attribute schemas: (Salon: Gender service, Hair wash included vs Clinic: Specialization, Registration #).
  - **Output**: `apps/merchant-web/src/lib/vertical-config.ts`.
  - **Verify**: Unit test or node evaluation imports and resolves config correctly for each vertical.

---

### Phase 3: Tenant Context & Client-Side Scoping (P1 - State & Scoping)
- **Task 3.1: `MerchantTenantContext` Provider**
  - **Agent**: `frontend-specialist` | **Skill**: `clean-code`
  - **Input**: `apps/merchant-web/src/contexts/MerchantTenantContext.tsx`
  - **Action**:
    1. On session init, fetch user profile, memberships, and active provider.
    2. Provide `currentProvider`, `vertical`, `isSuperAdmin`, `isLocked`, and `verticalConfig`.
    3. Expose scoped query wrappers so pages don't manually deal with filtering.
  - **Output**: Context provider wrapping `apps/merchant-web/src/app/layout.tsx`.
  - **Verify**: Context accurately reports Salon vertical when logged in as Salon, and Clinic vertical when logged in as SVIMS.

- **Task 3.2: Scoped Navigation & Admin Guard**
  - **Agent**: `frontend-specialist` | **Skill**: `frontend-design`
  - **Input**: `apps/merchant-web/src/components/Navigation.tsx`
  - **Action**:
    1. Dynamically render "Stylists & Stations" for Salons, "Doctors & OPD" for Clinics, "Courts & Turfs" for Gaming.
    2. Show active business name badge in header.
    3. Hide the `/admin` link for regular merchants; only display for Super Admin.
  - **Output**: Adaptive, tenant-aware navigation header.
  - **Verify**: Visual check confirms Salon user sees "Stylists & Stations" with Naturals Salon badge.

---

### Phase 4: Verticalized Page Adaptations (P2 - UI/UX)
- **Task 4.1: Scoped Overview Dashboard (`page.tsx`)**
  - **Agent**: `frontend-specialist` | **Skill**: `frontend-design`
  - **Input**: `apps/merchant-web/src/app/page.tsx`
  - **Action**:
    1. Lock dashboard to `currentProvider.id`.
    2. Display vertical-tailored quick stats (e.g., "Active Stylists on Duty" vs "OPD Doctors Active").
    3. Filter booking metrics and diagnostics strictly to the tenant.
  - **Output**: Focused merchant dashboard without cross-venue pollution.
  - **Verify**: Metrics match only current provider's bookings.

- **Task 4.2: Verticalized Resources Management (`resources/page.tsx`)**
  - **Agent**: `frontend-specialist` | **Skill**: `frontend-design`
  - **Input**: `apps/merchant-web/src/app/resources/page.tsx`
  - **Action**:
    1. Restrict resource creation and listing to `currentProvider.id`.
    2. Use `verticalConfig` for modal title, labels, and department options.
    3. Prevent Salon owner from choosing medical departments or doctor types.
  - **Output**: Specialized resource manager per vertical.
  - **Verify**: Salon modal offers Stylist/Spa options; Clinic modal offers Doctor/Specialist options.

- **Task 4.3: Scoped Bookings Queue (`bookings/page.tsx`)**
  - **Agent**: `frontend-specialist` | **Skill**: `frontend-design`
  - **Input**: `apps/merchant-web/src/app/bookings/page.tsx`
  - **Action**:
    1. Remove open venue switcher dropdown for merchants (replace with locked badge, or multi-branch switcher if user has > 1 venue).
    2. Filter bookings strictly to `currentProvider.id`.
    3. Adapt booking card actions (e.g. Clinic shows Prescription upload, Salon shows Service checklist).
  - **Output**: Clean, isolated booking management queue.
  - **Verify**: Salon bookings view shows 0 hospital bookings.

---

### Phase 5: Verification & E2E Test Suite (Phase X)
- **Task 5.1: Multi-Tenant Playwright Test (`merchant-tenancy-isolation.spec.ts`)**
  - **Agent**: `test-engineer` | **Skill**: `webapp-testing`
  - **Input**: `tests/e2e/merchant-tenancy-isolation.spec.ts`
  - **Action**: Write and run comprehensive E2E tests:
    - `[Salon Tenant]`: Login as Naturals Salon -> verify "Stylists & Stations" nav, verify only Naturals bookings visible, verify no access to SVIMS.
    - `[Clinic Tenant]`: Login as SVIMS Clinic -> verify "Doctors & OPD Rooms" nav, verify only SVIMS patients visible, verify no salon controls.
    - `[Tamper Test]`: Attempt to query/view another provider via URL param -> system confines to tenant boundary.
    - `[Super Admin]`: Login as Admin -> verify omniscient access to `/admin`, multi-city rollout, and all merchants.
  - **Output**: E2E test file passing synchronously.
  - **Verify**: `npx playwright test tests/e2e/merchant-tenancy-isolation.spec.ts` passes 100%.

---

## Phase X: Final Verification Checklist
- [ ] TypeScript type checks pass: `npx tsc --noEmit`
- [ ] Next.js merchant web builds without errors: `npm run build --prefix apps/merchant-web`
- [ ] Playwright E2E isolation tests pass: `npx playwright test tests/e2e/merchant-tenancy-isolation.spec.ts`
- [ ] No purple color violations (`DESIGN.md` compliance)
- [ ] RLS policies confirmed active on PostgreSQL tables
- [ ] Zero regression on existing customer mobile app and admin dashboard
