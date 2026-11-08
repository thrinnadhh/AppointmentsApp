# Tirupati Hyperlocal Booking Platform

> Multi-vertical appointment booking system for clinics, salons, gaming turfs, restaurants, and pet care — designed for the Tirupati hyperlocal market.

## Architecture

```
appointments-monorepo/
├── apps/
│   ├── merchant-web/       # Next.js 15 — Admin & merchant dashboard
│   ├── customer-mobile/    # Expo SDK 58 (React Native) — Customer booking app
│   └── backend/            # Spring Boot (Legacy / Deprecated; superseded by Next.js + Supabase)
├── packages/
│   └── shared/             # Shared types, schemas, queue algorithms, constants
├── supabase/
│   ├── migrations/         # PostgreSQL schema, RLS, stored procedures (155 migrations)
│   ├── functions/          # Edge functions (cron, webhooks)
│   └── seed.sql            # Demo data for development
├── scripts/                # Verification, seed, and CI test runner scripts
└── tests/
    ├── unit/               # Fast serial node:test unit suites
    ├── scripts/            # Security, advisor, and integration test scripts
    └── e2e/                # Playwright E2E test suite
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend (Web)** | Next.js 15, React 18, Tailwind CSS 3 |
| **Frontend (Mobile)** | Expo 58, React Native 0.88, React 19 |
| **Backend** | Supabase (PostgreSQL 15, RLS, Auth, Realtime, Edge Functions) |
| **Payments** | Razorpay (HMAC SHA256 webhook verification) |
| **Shared Types** | TypeScript 5, pnpm workspaces |
| **Testing** | Node test runner (serial unit suites), pgTAP (database), Playwright (E2E) |

## Prerequisites

- Node.js ≥ 22.0.0
- pnpm ≥ 9
- Supabase CLI & Docker (for local Supabase dev instance)

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment variables
cp apps/merchant-web/.env.example apps/merchant-web/.env.local
cp apps/customer-mobile/.env.example apps/customer-mobile/.env
# Fill in your Supabase URL and anon key

# 3. Generate local PostgREST asymmetric signing key (ES256)
# Required by supabase/config.toml (signing_keys_path = "./signing_keys.json")
node scripts/generate-signing-keys.mjs

# 4. Apply database migrations
# Use the Supabase CLI or dashboard to run files in supabase/migrations/ in order

# 5. Seed demo data (optional)
# Run supabase/seed.sql against your database
```

## Development

```bash
# Merchant dashboard (http://localhost:3000)
pnpm dev:merchant

# Customer mobile app (Expo web at http://localhost:8081)
pnpm dev:mobile
```

## Environment Variables

### Merchant Web (`apps/merchant-web/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase publishable (anon) key |
| `RAZORPAY_WEBHOOK_SECRET` | ✅ (production) | HMAC secret for webhook verification |

### Customer Mobile (`apps/customer-mobile/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase publishable (anon) key |
| `EXPO_PUBLIC_API_BASE_URL` | ❌ | API base URL for server routes |

## Testing

```bash
# Run unit test suites serially (Standing Rule 4)
node scripts/run-all-unit-tests-serially.mjs

# Run security & advisor tests
pnpm test:security

# TypeScript type checking across all workspaces
pnpm -r --if-present typecheck

# Run E2E tests (requires merchant-web dev server running)
npx playwright test
```

## Key Features

- **Deposit-backed booking**: 5-minute hold → payment → confirmation flow
- **Multi-vertical support**: Clinics & Hospitals, Salons, Gaming Turfs, Restaurants, Pet Care
- **Hospital Vertical (SPEC.md)**: Department governance (max 3 staff/dept), front-desk doctor assignments, permanent check-in PIN revealed 60m pre-slot, doctor emergency departure refund flow
- **Realtime sync**: Supabase Realtime channels for instant booking updates
- **6-Strike Anti-no-show policy**: Strikes 1–2 courtesy refund, strikes 3–5 ₹60 penalty split, 6th strike triggers 7-day account block (SPEC.md)
- **Role-based access**: Admin, hospital admin, front desk, consultant, merchant, and customer roles with locked-down RLS policies
- **Razorpay integration**: Webhook-verified payment confirmation

## License

ISC
