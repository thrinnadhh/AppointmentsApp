# Task Plan: Supabase Backend + Customer Mobile App + Merchant Web App

## 1. Goal
Transition the Hyperlocal Booking Platform MVP from Kotlin/Spring Boot single-web PWA to:
- **Database & BaaS**: Supabase (PostgreSQL, RLS, Auth, Edge Functions)
- **Customer App**: Mobile Application (React Native with Expo)
- **Merchant App**: Web Application (Next.js 15 App Router)

## 2. Dependencies & Assigned Agents
- `database-architect`: Supabase schema, RLS policies, hold locking function, seed data
- `backend-specialist`: Supabase Edge Functions & API integration
- `frontend-specialist`: Next.js 15 Merchant Webapp dashboard & availability management
- `mobile-developer`: React Native (Expo) Customer Mobile App
- `project-planner`: Task breakdown & coordination

## 3. Tasks Breakdown

### Phase 1: Core Specifications & Memory Updates
- [x] Update [PRD-hyperlocal-booking-mvp.md](file:///Users/trinadh/projects/Appointments/PRD-hyperlocal-booking-mvp.md) (Customer mobile app scope, deposit flows)
- [x] Update [Architecture-hyperlocal-booking-mvp.md](file:///Users/trinadh/projects/Appointments/Architecture-hyperlocal-booking-mvp.md) (Supabase + Expo + Next.js architecture)
- [x] Update [API-Spec-hyperlocal-booking-mvp.md](file:///Users/trinadh/projects/Appointments/API-Spec-hyperlocal-booking-mvp.md) (Supabase REST + Edge functions)
- [x] Update [.agents/memory/tech-decisions.md](file:///Users/trinadh/projects/Appointments/.agents/memory/tech-decisions.md) & [.agents/memory/MEMORY.md](file:///Users/trinadh/projects/Appointments/.agents/memory/MEMORY.md)
- [x] Create [DESIGN.md](file:///Users/trinadh/projects/Appointments/DESIGN.md) (Visual token contract & UI principles)

### Phase 2: Supabase Schema & Data Layer (`database-architect`)
- [x] Initialize Supabase project configuration (`supabase/config.toml`)
- [x] Create initial migration with tables: `categories`, `sub_categories`, `providers`, `resources`, `resource_availability`, `slots`, `bookings`, `payments`, `profiles` ([20260908000001_initial_schema.sql](file:///Users/trinadh/projects/Appointments/supabase/migrations/20260908000001_initial_schema.sql))
- [x] Implement atomic slot hold function `create_booking_hold(p_resource_id, p_slot_start, p_slot_end, p_customer_id)` with row-level locks
- [x] Configure Row Level Security (RLS) policies for Customer, Provider, and Admin
- [x] Create seed data for Tirupati businesses across 5 verticals ([seed.sql](file:///Users/trinadh/projects/Appointments/supabase/seed.sql))

### Phase 3: Monorepo Setup & Merchant Web App (`frontend-specialist`)
- [x] Initialize root [package.json](file:///Users/trinadh/projects/Appointments/package.json) with pnpm workspace ([pnpm-workspace.yaml](file:///Users/trinadh/projects/Appointments/pnpm-workspace.yaml))
- [x] Scaffold shared types package (`@appointments/shared` in [packages/shared](file:///Users/trinadh/projects/Appointments/packages/shared))
- [x] Scaffold `apps/merchant-web` using Next.js 15 App Router + Tailwind CSS
- [x] Build Merchant Overview Dashboard ([page.tsx](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/app/page.tsx))
- [x] Build Resource & Capacity Configuration ([resources/page.tsx](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/app/resources/page.tsx))
- [x] Build Weekly Availability Manager ([schedule/page.tsx](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/app/schedule/page.tsx))
- [x] Build Bookings Calendar & Status Triage ([bookings/page.tsx](file:///Users/trinadh/projects/Appointments/apps/merchant-web/src/app/bookings/page.tsx))

### Phase 4: Customer Mobile App (`mobile-developer`)
- [x] Scaffold `apps/customer-mobile` using React Native / Expo with TypeScript
- [x] Build Category & Nearby Provider discovery for Tirupati ([HomeScreen.tsx](file:///Users/trinadh/projects/Appointments/apps/customer-mobile/src/screens/HomeScreen.tsx))
- [x] Build Resource & Slot Picker with interactive slots ([ProviderDetailScreen.tsx](file:///Users/trinadh/projects/Appointments/apps/customer-mobile/src/screens/ProviderDetailScreen.tsx))
- [x] Build 5-Minute Slot Hold Countdown & Deposit Checkout ([CheckoutModal.tsx](file:///Users/trinadh/projects/Appointments/apps/customer-mobile/src/screens/CheckoutModal.tsx))
- [x] Build My Bookings & Reschedule / Cancel screens ([MyBookingsScreen.tsx](file:///Users/trinadh/projects/Appointments/apps/customer-mobile/src/screens/MyBookingsScreen.tsx))
- [x] Build root navigation & state flow ([App.tsx](file:///Users/trinadh/projects/Appointments/apps/customer-mobile/App.tsx))

### Phase 5: Verification & Testing
- [x] Run `python3 .agents/scripts/validate_kit.py` ([PASS] 0 errors, 0 warnings)
- [x] Run `python3 .agents/scripts/checklist.py .` ([PASS] 8 passed, 0 failed, 2 skipped)
- [x] Run lint checks across monorepo (`pnpm lint` -> [PASS])
- [x] Run TypeScript type checks across all projects (`tsc --noEmit` -> [PASS])

