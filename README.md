# Tirupati Hyperlocal Booking Platform

> Multi-vertical appointment booking system for clinics, salons, gaming turfs, restaurants, and pet care — designed for the Tirupati hyperlocal market.

## Architecture

```
appointments-monorepo/
├── apps/
│   ├── merchant-web/       # Next.js 15 — Admin & merchant dashboard
│   └── customer-mobile/    # Expo (React Native) — Customer booking app
├── packages/
│   └── shared/             # Shared types, schemas, constants
├── supabase/
│   ├── migrations/         # PostgreSQL schema, RLS, stored procedures
│   ├── functions/          # Edge functions (cron, webhooks)
│   └── seed.sql            # Demo data for development
└── tests/
    └── e2e/                # Playwright E2E test suite
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend (Web)** | Next.js 15, React 18, Tailwind CSS 3 |
| **Frontend (Mobile)** | Expo 57, React Native 0.86 |
| **Backend** | Supabase (PostgreSQL 15, RLS, Auth, Realtime, Edge Functions) |
| **Payments** | Razorpay (HMAC SHA256 webhook verification) |
| **Shared Types** | TypeScript 5, pnpm workspaces |
| **Testing** | Playwright (E2E), TypeScript strict mode |

## Prerequisites

- Node.js ≥ 18
- pnpm ≥ 8
- Supabase project (free tier works)

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment variables
cp apps/merchant-web/.env.example apps/merchant-web/.env.local
cp apps/customer-mobile/.env.example apps/customer-mobile/.env
# Fill in your Supabase URL and anon key

# 3. Apply database migrations
# Use the Supabase CLI or dashboard to run files in supabase/migrations/ in order

# 4. Seed demo data (optional)
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
# Run E2E tests (requires merchant-web dev server running)
npx playwright test

# TypeScript type checking
pnpm --filter @appointments/merchant-web typecheck
pnpm --filter @appointments/customer-mobile typecheck
```

## Key Features

- **Deposit-backed booking**: 5-minute hold → payment → confirmation flow
- **Multi-vertical support**: Clinics, salons, gaming, restaurants, pets
- **Realtime sync**: Supabase Realtime channels for instant booking updates
- **Anti-no-show system**: Deposit forfeiture + customer flagging after 4 no-shows
- **Role-based access**: Admin, merchant, and customer roles with RLS policies
- **Razorpay integration**: Webhook-verified payment confirmation

## License

ISC
