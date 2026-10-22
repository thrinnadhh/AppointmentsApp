# Appointments Backend (Kotlin / Spring Boot) — [DEPRECATED]

> **ARCHITECTURAL STATUS: DEPRECATED / LEGACY PROTOTYPE**  
> As of Phase 1 of the platform architecture consolidation, the Spring Boot API in `apps/backend` is **deprecated** in favor of the production **Supabase (PostgreSQL + RLS + Edge Functions) + Next.js App Router API** architecture.

---

## Single Source of Truth Standards

1. **Database Schema & Migrations**:
   - The **canonical single source of truth** for all database migrations and schema definitions is **`supabase/migrations/`**.
   - `apps/backend/src/main/resources/db/migration/V1__initial_schema.sql` is obsolete and superseded by the 80+ migrations in `supabase/migrations/`.
   - Do NOT run Flyway migrations from this package against production databases.

2. **API Routes & Business Logic**:
   - Customer mobile app (`apps/customer-mobile`) and Merchant web dashboard (`apps/merchant-web`) communicate directly with Supabase and Next.js App Router endpoints (`apps/merchant-web/src/app/api/*`).
   - Background jobs (hold release, reminders, notifications) are executed via atomic PostgreSQL RPCs scheduled by `pg_cron` and authenticated Edge Functions.

3. **Status of this Package**:
   - Kept strictly for reference and legacy test fixtures.
   - Built artifacts (`bin/`, `.kotlin/`, `build/`) are excluded from version control.
