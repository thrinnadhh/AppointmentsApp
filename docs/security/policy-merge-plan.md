# Policy Merge Plan & Security Gate Audit

Documenting the consolidation of multiple permissive policies across the 12 flagged tables, per Phase 3 rules and Rule 5 Security Gate.

---

## Security Gate Methodology (Rule 5)
Before modifying or merging any policy on a table:
1. Print every policy's exact `roles`, `cmd`, `qual` (USING), and `with_check` (WITH CHECK).
2. Check for over-permissive definitions (e.g. `USING (true)`, writes without tenant/ownership checks, cross-tenant leaks).
3. If any policy is broader than intended, flag it immediately as a **SECURITY FINDING** under Open Questions and do not silently preserve or tighten without reporting.
4. Verify all rewrites with `tests/security/access-matrix/diff-matrix.mjs <table_name>` to prove 0 behavioral deviation.

---

## 1. Table-by-Table Contributor Matrix & Merge Blueprint

### 1. `bookings`
- **Current Policies**:
  - SELECT: `allow_reading_bookings` (authenticated), `hospital_members_read_accessible_bookings` (authenticated)
  - UPDATE: `allow_updating_bookings` (authenticated), `hospital_members_update_accessible_bookings` (authenticated)
- **Security Gate Inspection**:
  - `allow_reading_bookings`: Customer own rows (`auth.uid() = customer_id`), Admin (`is_admin()`), Non-hospital merchant (`provider_id IN get_user_authorized_providers()`).
  - `hospital_members_read_accessible_bookings`: Hospital providers only (`is_hospital_provider(provider_id)`). Accessible if admin or assigned doctor/frontdesk.
- **Merge Strategy**:
  - Merge SELECT into single `bookings_select_policy` TO authenticated using `(A) OR (B)`.
  - Merge UPDATE into single `bookings_update_policy` TO authenticated using `(A) OR (B)` with explicit `WITH CHECK`.

### 2. `cities`
- **Current Policies**:
  - `Allow public read cities` (public, SELECT, `USING (true)`)
  - `allow_read_active_cities` (anon/authenticated, SELECT, `USING (status = 'ACTIVE')`)
  - `Allow admin full manage cities` (authenticated, ALL)
- **Security Gate Finding**:
  - ⚠️ `Allow public read cities` has `USING (true)`, which exposes inactive/planned/paused cities to anon, contradicting the intent of `allow_read_active_cities`.
  - Documented as a SECURITY FINDING under Open Questions.
- **Merge Strategy**:
  - Consolidate SELECT to single policy `cities_select_policy` TO anon, authenticated.
  - Split `Allow admin full manage cities` into INSERT, UPDATE, DELETE for authenticated.

### 3. `city_settlements`
- **Current Policies**:
  - `Admins manage settlements` (public, ALL)
  - `City directors view own settlement` (public, SELECT)
- **Security Gate Inspection**:
  - Both policies lacked `TO` clause, auto-granting to `anon`, `authenticator`, etc.
- **Merge Strategy**:
  - Scope to `TO authenticated`.
  - Single SELECT policy: `city_settlements_select_policy` TO authenticated: `(public.is_admin()) OR (EXISTS (profiles WHERE id = (select auth.uid()) AND role = 'city_director' AND assigned_city_id = city_id))`.
  - Split writes to INSERT, UPDATE, DELETE for `authenticated` with `public.is_admin()`.

### 4. `city_waitlist`
- **Current Policies**:
  - `Admins only read city waitlist` (authenticated, SELECT)
  - `Allow admin manage city waitlist` (authenticated, ALL)
- **Security Gate Inspection**:
  - Both policies check admin role, but ALL includes SELECT, causing duplicate permissive SELECT policies for `authenticated`.
- **Merge Strategy**:
  - Single SELECT: `city_waitlist_select_policy` TO authenticated: `public.is_admin()`.
  - Split manage policy into INSERT, UPDATE, DELETE for `authenticated`.

### 5. `department_members`
- **Current Policies**:
  - `hospital_admin_manage_department_members` (authenticated, service_role, ALL)
  - `members_view_own_membership` (authenticated, SELECT)
- **Security Gate Inspection**:
  - ALL overlaps with SELECT. `members_view_own_membership` contains unwrapped `auth.jwt()`.
- **Merge Strategy**:
  - Single SELECT: `department_members_select_policy` TO authenticated combining hospital admin read OR own membership read with wrapped `(select auth.jwt())`.
  - Split writes into INSERT, UPDATE, DELETE for hospital admin.

### 6. `departments`
- **Current Policies**:
  - `hospital_admin_manage_departments` (authenticated, service_role, ALL)
  - `members_view_own_department` (authenticated, SELECT)
- **Merge Strategy**:
  - Single SELECT: `departments_select_policy` TO authenticated combining hospital admin read OR department member read.
  - Split writes into INSERT, UPDATE, DELETE for hospital admin.

### 7. `doctor_front_desk_assignments`
- **Current Policies**:
  - `hospital_admin_manage_doctor_assignments` (authenticated, service_role, ALL)
  - `hospital_admin_read_doctor_assignments` (authenticated, service_role, SELECT)
- **Security Gate Inspection**:
  - The USING clause of both policies is 100% IDENTICAL.
- **Merge Strategy**:
  - Drop duplicate `hospital_admin_read_doctor_assignments`.
  - Split `hospital_admin_manage_doctor_assignments` into separate SELECT, INSERT, UPDATE, DELETE policies.

### 8. `merchant_memberships`
- **Current Policies**:
  - `members_view_own_memberships` (public, SELECT)
  - `store_owners_manage_memberships` (authenticated, ALL)
- **Merge Strategy**:
  - Scope `members_view_own_memberships` to `TO authenticated`.
  - Merge SELECT: store owner read OR own membership read.
  - Split store owner writes into INSERT, UPDATE, DELETE.

### 9. `notification_logs`
- **Current Policies**:
  - `Allow trusted and service role write to notification logs` (public, ALL)
  - `Admins and customer owners read notification logs` (authenticated, SELECT)
- **Security Gate Inspection**:
  - `Allow trusted and service role write to notification logs` is intended for writes, but using `FOR ALL` inadvertently exposed it to SELECT.
- **Merge Strategy**:
  - Change write policy to `FOR INSERT, UPDATE, DELETE`.
  - Wrap `(SELECT auth.role())` and `(SELECT current_setting('app.trusted_write', true))`.
  - Single SELECT: `Admins and customer owners read notification logs`.

### 10. `profiles`
- **Current Policies**:
  - `users_update_own_profile` (authenticated, UPDATE)
  - `Users can update own profile` (authenticated, UPDATE)
- **Security Gate Inspection**:
  - Exact duplicate policy definitions.
- **Merge Strategy**:
  - Drop `Users can update own profile`.
  - Retain `users_update_own_profile` with wrapped `(SELECT auth.uid()) = id`.

### 11. `providers`
- **Current Policies**:
  - `Merchants can update own provider` (public, UPDATE)
  - `merchants_update_own_provider` (public, UPDATE)
- **Security Gate Inspection**:
  - Exact duplicate / subset: `owner_id = auth.uid()` is already subsumed by `get_user_authorized_providers(auth.uid())`.
- **Merge Strategy**:
  - Drop `Merchants can update own provider`.
  - Scope `merchants_update_own_provider` to `TO authenticated`.

### 12. `resources`
- **Current Policies**:
  - Pairs of `Merchants can insert/update/delete resources` vs `merchants_insert/update/delete_resources`
  - Plus `hospital_admin_manage_resources` (ALL)
  - Plus `Active resources are readable by everyone` (SELECT)
- **Merge Strategy**:
  - Keep `Active resources are readable by everyone` for SELECT (TO public, authenticated).
  - Consolidate INSERT, UPDATE, DELETE into single policies per command TO authenticated combining merchant authorization and hospital admin authorization.
