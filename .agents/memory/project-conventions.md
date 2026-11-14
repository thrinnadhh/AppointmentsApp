---
type: project
created: 2026-11-05
updated: 2026-11-13
---

# Project Conventions & Governance

## Branch & Git Hygiene
- **Dedicated Branches**: Always use a dedicated branch for major changes. Active production-readiness work lives on `fix/production-readiness`.
- **Forbidden Git Operations**: Never rewrite git history, never run `git push --force`, never purge history automatically (`git filter-repo` must only be output as a dry-run runbook for the user), and never touch production environments.
- **Migration Immutability**: Never rename applied migrations in `supabase/migrations/` (134 migrations reconciled with 0 duplicate prefixes). Add new forward migrations instead.
- **Environment Files**: Only `.env.example` may be tracked in git. All `.env.local` or secret files must remain untracked.
- **Versioning**: Component metadata uses SemVer while toolkit releases use CalVer.

## Test Suites & Commands
- **Unit Tests**: `node --test tests/unit/*.test.mjs` (28 suites, 245 tests baseline).
- **Script Tests**: `tests/scripts/test-*.mjs` (18 suites, 324 tests baseline).
- **Stress & Concurrency Suite**: `node scripts/stress-test-queue-invariants.mjs`.
- **Merchant Dev Server Startup**: Requires DPDP Grievance Officer variables:
  `NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME="Aarav Sharma" NEXT_PUBLIC_GRIEVANCE_OFFICER_EMAIL="grievance@appointments.example.com" NEXT_PUBLIC_GRIEVANCE_OFFICER_PHONE="+91 98765 43210" pnpm dev:merchant`
- **External Payment Test Safety**: Any test touching Razorpay must immediately hard-fail if any configured key begins with `rzp_live_`.
