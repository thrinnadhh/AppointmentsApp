# Admin Application Streamlining & Clutter Removal Plan

## Goal
Streamline the Admin experience across `/admin` and `/admin/logs` by removing redundant UI sections, fixing broken calculations (such as `NaN%`), paginating massive test data dumps, and contextualizing the top navigation for platform administrators.

## Tasks
- [x] Task 1: Fix broken KPI calculations in `apps/merchant-web/src/app/admin/page.tsx` (resolve `NaN% Completion Velocity` and calculate real counts from active city/merchant state) → Verify: KPI cards show valid numbers without `NaN` or phantom zeros.
- [x] Task 2: Replace duplicated embedded logs in Section 5 of `/admin` with a clean Observability Health widget linking to `/admin/logs` → Verify: `/admin` no longer embeds a second full log table; single source of truth is `/admin/logs`.
- [x] Task 3: Paginate and condense the Pre-Launch Waitlist table in Section 3 of `/admin` (show top 5-10 recent demand signals with territory summary) → Verify: DOM size on `/admin` drops from 1,800+ elements to <400 elements.
- [x] Task 4: Clean up redundant controls in the admin hero header (remove duplicate Sign Out button and duplicate refresh triggers) → Verify: One clear Sign Out and Refresh control in the header.
- [x] Task 5: Contextualize global navigation in `Navigation.tsx` when on `/admin` routes (hide merchant-only venue tabs like Doctors/Schedule when in platform admin mode, showing Admin Hub, System Logs, and Switch to Merchant App) → Verify: Navbar displays relevant admin options without dead venue tabs.
- [x] Task 6: Beautify Audit Trail in Section 4 with human-readable event badges instead of raw JSON dumps → Verify: Audit entries display clean action badges and timestamps.
- [x] Task 7: Full E2E DevTools verification with `@mcp:chrome-devtools-mcp:` on `/admin` and `/admin/logs` → Verify: Clean layout, fast scrolling, zero console errors, zero NaN values.

## Done When
- [x] Zero `NaN` or unformatted raw JSON errors on `/admin`.
- [x] No duplicate log tables between `/admin` and `/admin/logs`.
- [x] Admin navigation is focused on platform administration rather than individual shop settings.
- [x] Page weight and DOM complexity are reduced by over 60%.

## Notes
- Supabase RPC `get_admin_velocity_analytics` does not return `completed_bookings` or `merchant_funnel`, so calculations must fall back gracefully to real counts from loaded cities and providers.
