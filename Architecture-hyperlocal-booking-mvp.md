# Architecture Document
## Hyperlocal Booking Platform (Working Title) — MVP v1

---

## 1. Architectural Approach

**Architecture: Supabase BaaS + Multi-Client Monorepo.**

This is an agile MVP designed for low overhead and near-zero infrastructure cost:
- **Backend & Data Layer**: **Supabase** acts as the central backend platform providing PostgreSQL database, Row Level Security (RLS), Phone OTP Authentication, Storage, and Edge Functions.
- **Customer Client**: **Native Mobile App (React Native / Expo)** for seamless customer discovery, geolocation in Tirupati, slot booking, and push notifications.
- **Merchant Client**: **Web Dashboard (Next.js 15 App Router)** for zero-install provider onboarding, resource catalog setup, weekly schedule configuration, and appointment management.
- **Monorepo**: Lightweight pnpm workspace containing `apps/customer-mobile`, `apps/merchant-web`, `packages/shared`, and `supabase/`.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Database & BaaS | Supabase (PostgreSQL) | Native relational power, Row Level Security, instant REST APIs, and free-tier affordability |
| Concurrency & Locking | PostgreSQL Advisory / Row-Level Locks | Atomic 5-minute slot holds directly in database functions without needing a separate Redis instance |
| Edge / Custom APIs | Supabase Edge Functions (TypeScript) | Webhook handlers (Razorpay), refund triggers, and complex transactional workflows |
| Customer Client | React Native (Expo) | Cross-platform iOS & Android, native location services, fast iteration, push notifications |
| Merchant Client | Next.js 15 (React + Tailwind CSS) | Responsive desktop/tablet dashboard, SSR/SSG capabilities, fast browser onboarding |
| Auth | Supabase Auth (Phone OTP) | Secure SMS-based passwordless authentication for both customers and merchant staff |
| File Storage | Supabase Storage | Merchant storefront photos, clinic logos, and resource images |
| Payments | Razorpay / PayU | One-time deposit capture (₹50–₹200) and programmatic automated refunds via API |
| Shared Logic | `packages/shared` (TypeScript) | Shared database types (generated from Supabase), Zod schemas, domain constants |

---

## 3. Domain Model

- **Category** — top-level vertical (Hospital, Restaurant, Gaming/Turf, Salon, Pet)
- **SubCategory** — e.g. Pet Hospital / Pet Grooming under Pet
- **Provider** — a business listing; belongs to a Category (+ optional SubCategory), has location (lat/lng, address) and operating hours
- **Resource** — the actual bookable unit under a Provider: doctor, table, court-lane, stylist chair, groomer. Carries a business-set `depositAmount` and category-specific `attributes` (JSONB)
- **ResourceAvailability** — weekly recurring schedule rules (day of week, start time, end time, slot duration)
- **Slot** — a discrete bookable time window + capacity for a specific Resource
- **Booking** — links Customer + Resource + Slot
  - `status`: `HELD → PENDING_PAYMENT → CONFIRMED → COMPLETED / CANCELLED / NO_SHOW`
  - `paymentStatus`: `PENDING → CAPTURED → REFUNDED → FORFEITED`
  - `depositAmount`, `holdExpiresAt`, `gatewayPaymentId`
- **Payment** — ledger record of the gateway transaction: charge, refund, or forfeiture
- **Customer** — end user profile tracking a rolling 12-month `noShowCount`
- **User** — Supabase Auth user record linked to customer or merchant profiles via RLS

---

## 4. Booking & Payment Lifecycle

1. **Hold Creation**: Customer selects a slot in the mobile app. Calls `create_booking_hold()` stored procedure.
   - Applies row-level lock (`SELECT ... FOR UPDATE`)
   - Checks that the slot is not already held or confirmed
   - Creates a booking record with `status = 'HELD'`, setting `hold_expires_at = NOW() + INTERVAL '5 minutes'`
2. **Deposit Payment**: Mobile app initiates Razorpay deposit checkout with `depositAmount` → status changes to `PENDING_PAYMENT`.
3. **Payment Confirmation**: Razorpay webhook triggers Supabase Edge Function:
   - Validates webhook signature
   - Updates booking `status = 'CONFIRMED'`, `paymentStatus = 'CAPTURED'`
4. **Hold Expiry**: If hold expires before payment webhook arrives, the slot is released automatically and status moves to `CANCELLED`.
5. **Double-Booking Guard**: A partial unique index on `(resource_id, slot_start)` where `status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')` guarantees no double-booking at the database level.

**Cancellation & Reschedule Policy:**
- **Free Window (> 1 hour before slot start)**:
  - Reschedule: Slot is updated, deposit carries over without new charge.
  - Cancellation: Edge Function triggers programmatic refund via Razorpay API (`paymentStatus = 'REFUNDED'`).
- **Late Window (≤ 1 hour) or No-Show**:
  - Customer-initiated: `paymentStatus = 'FORFEITED'`. Funds settle to business minus platform fee.
  - Business-initiated: Customer is **always** refunded in full (`paymentStatus = 'REFUNDED'`).
- **Repeat No-Shows**: Increment `Customer.noShowCount`. If `noShowCount >= 4` in a rolling 12 months, customer account is flagged.

---

## 5. System Architecture & API Boundaries

- **Supabase PostgREST**: Direct, typed client queries with Row Level Security (RLS) for catalog browsing, provider profiles, and booking queries.
- **Supabase Database Functions**:
  - `create_booking_hold()`: Atomic hold creation with concurrency lock
  - `release_expired_holds()`: Scheduled cleanup of expired holds
- **Supabase Edge Functions**:
  - `handle-payment-webhook`: Verifies Razorpay webhook signatures, updates booking and payment records
  - `process-booking-cancellation`: Validates cancellation timing and calls payment gateway refund API
  - `send-notification`: Dispatches transactional SMS (MSG91/Twilio) and pre-slot reminders
- **Client Applications**:
  - `apps/customer-mobile`: Expo React Native app using `@supabase/supabase-js`
  - `apps/merchant-web`: Next.js 15 App Router dashboard using `@supabase/ssr`

---

## 6. Monorepo Structure

```
Appointments/
├── apps/
│   ├── customer-mobile/       # React Native / Expo Mobile App
│   └── merchant-web/          # Next.js 15 Merchant Web Dashboard
├── packages/
│   └── shared/                # Shared TypeScript types, Zod schemas, constants
├── supabase/
│   ├── migrations/            # Version-controlled PostgreSQL schemas & RLS
│   ├── functions/             # Supabase Edge Functions (Deno / TypeScript)
│   ├── seed.sql               # Seed data for Tirupati providers across 5 verticals
│   └── config.toml            # Supabase local environment configuration
├── PRD-hyperlocal-booking-mvp.md
├── Architecture-hyperlocal-booking-mvp.md
└── API-Spec-hyperlocal-booking-mvp.md
```

