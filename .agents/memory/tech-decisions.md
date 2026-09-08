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

