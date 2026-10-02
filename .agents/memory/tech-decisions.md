---
type: project
created: 2026-07-18
updated: 2026-07-18
---

# Technical Decisions

- Component metadata uses SemVer while the toolkit release keeps CalVer.
- `manifest.json` and `manifest.lock.json` must remain synchronized with component frontmatter.
- Database: Supabase (PostgreSQL with RLS, Supabase Auth with SMS OTP, Storage, and Edge Functions).
- Customer Platform: Native Mobile Application built with React Native (Expo) for iOS and Android.
- Merchant Platform: Web Application built with Next.js 15 App Router and Tailwind CSS.
- Monorepo: Managed via pnpm workspaces (`apps/customer-mobile`, `apps/merchant-web`, `packages/shared`, `supabase/`).
- Payment Gateway: Standardized on Razorpay (Orders API, HMAC-SHA256 signature verification, and UPI Intent checkout) for Indian domestic collections and deposit holds.
- Cooling Period / Free Follow-up: Configurable `cooling_period_days` on providers (hospitals/clinics standard: 20 days). When rebooked within window from a prior confirmed appointment, fees are waived to ₹0 (`is_followup: true`), Razorpay gateway order is bypassed, and direct 1-click confirmation is recorded.
- Security & Cancellation Architecture: Cancellation initiator (`CUSTOMER` vs `MERCHANT`) is derived strictly from verified authenticated JWT caller in both SQL RPC (`cancel_booking`) and Edge Functions. Customer callers cannot spoof `MERCHANT` cancellations to evade deposit forfeitures. Refund-eligible cancellations keep `payments.status` in `CAPTURED` until single-winner atomic claim in `/api/bookings/cancel` promotes to `REFUND_PENDING` and triggers Razorpay API. Testing bypass headers (`x-customer-id`) are strictly gated behind `ENABLE_E2E_BYPASS=true` and disabled by default in production.


