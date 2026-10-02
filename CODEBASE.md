# Codebase Architecture & System Map

**OS:** macOS / Linux / POSIX  
**Repository Type:** Monorepo (`pnpm` workspace + Gradle backend)  
**Primary Language:** TypeScript (Next.js, Expo, Edge Functions) & Kotlin (Spring Boot)

---

## 1. Directory Layout & Package Boundaries

```
Appointments/
├── apps/
│   ├── customer-mobile/       # React Native / Expo Mobile Application
│   │   ├── src/
│   │   │   ├── screens/       # Customer UI (Home, Search, Details, Booking, Profile)
│   │   │   ├── services/      # API clients, auth, notifications
│   │   │   └── types/         # Client-side domain types
│   │   └── app.json           # Expo SDK 52 configuration
│   │
│   ├── merchant-web/          # Next.js 15 Web Dashboard
│   │   ├── src/
│   │   │   ├── app/           # App Router (routes, API endpoints, admin, bookings)
│   │   │   ├── lib/           # Server libraries (auth-admin, storage, redis, supabase)
│   │   │   └── middleware.ts  # Edge route protection, CORS, rate-limiting
│   │   └── next.config.mjs    # Next.js build config, CSP headers
│   │
│   └── backend/               # Spring Boot 3 & Kotlin Slot Availability Service
│       ├── src/main/kotlin/com/appointments/
│       │   ├── availability/  # Slot generator, rules, AvailabilityController
│       │   ├── bookings/      # BookingController, BookingService, repositories
│       │   ├── common/        # SecurityService, SecurityConfig, JwtAuthFilter
│       │   ├── identity/      # AuthWebhookController, UserService, UserEntity
│       │   └── merchants/     # MerchantEntity, StaffRepository, MerchantRepository
│       └── build.gradle.kts   # Gradle configuration
│
├── packages/
│   └── shared/                # Monorepo shared library
│       └── src/               # Schemas, Zod models, and constants
│
├── supabase/                  # Supabase Database & Edge Functions
│   ├── migrations/            # Flyway / Supabase SQL schema migrations
│   └── functions/             # Deno Edge Functions (send-booking-notification, etc.)
│
├── tests/                     # Playwright End-to-End Test Suites
│   ├── e2e/                   # phase1-bola-defense.spec.ts, phase2-tenant-isolation.spec.ts
│   └── fixtures/              # Test fixtures (test-fixtures.ts, merchant-portal, customer-app)
│
├── .agents/                   # Antigravity (AG Kit) agents, skills, and memory
└── .planning/                 # GSD Project planning (PROJECT.md, ROADMAP.md, STATE.md, CODEBASE.md)
```

---

## 2. Key Modules & Technical Roles

| Module | Core Responsibility | Key Files |
|---|---|---|
| **Payment Verification** | Cryptographic signature verification, order amount binding | `apps/merchant-web/src/app/api/bookings/confirm/route.ts`<br>`apps/merchant-web/src/app/api/payments/verify/route.ts` |
| **Tenant Access Guard** | BOLA protection, provider authorization, staff role checks | `apps/merchant-web/src/lib/auth-admin.ts`<br>`apps/backend/src/main/kotlin/com/appointments/common/security/SecurityService.kt` |
| **Media & Storage** | Binary magic-byte detection, path isolation, signed URLs | `apps/merchant-web/src/lib/storage.ts` |
| **Slot Engine** | Sub-millisecond availability generation, recurring schedules | `apps/backend/src/main/kotlin/com/appointments/availability/AvailabilityController.kt` |
| **Auth Webhook Ingress** | Constant-time webhook ingress authentication | `apps/backend/src/main/kotlin/com/appointments/identity/AuthWebhookController.kt` |
| **Public Directory** | Sanitized discovery search RPC omitting customer PII | `supabase/migrations/20261001000001_harden_search_directory_and_permissions.sql` |

---

## 3. Critical Data Models & Schemas

1. **`providers`**: Business listings (Clinics, Salons, Restaurants, Turfs, Pet Care).
   - Columns: `id`, `name`, `category_id`, `owner_id`, `status` (`ACTIVE`/`INACTIVE`), `latitude`, `longitude`, `photos`.
2. **`resources`**: Bookable units under a provider (Doctor, Chair, Table, Court, Groomer).
   - Columns: `id`, `provider_id`, `name`, `deposit_amount`, `is_active`, `department`.
3. **`bookings`**: Customer reservations.
   - Columns: `id`, `customer_id`, `provider_id`, `resource_id`, `slot_start`, `slot_end`, `status` (`HELD`, `PENDING_PAYMENT`, `CONFIRMED`, `CANCELLED`, `COMPLETED`), `gateway_order_id`, `deposit_amount`.
4. **`merchant_memberships`**: Staff association with providers.
   - Columns: `id`, `user_id`, `provider_id`, `role`.

---

## 4. Primary Developer & Verification Workflows

```bash
# 1. Monorepo dependencies
pnpm install

# 2. Run Next.js Merchant Web development server
pnpm dev:merchant

# 3. Build & test Spring Boot backend
cd apps/backend && ./gradlew test

# 4. Run automated security regression suites
node --test test-validation.mjs
node --test test-security.mjs

# 5. Run Playwright E2E suites
pnpm test:e2e
```
