# Manual Actions & Credential Rotation Requirements

**Date:** 2026-11-20  
**Classification:** Immediate Security Operations & Infrastructure Governance  

> [!WARNING]
> Removing exposed credentials from source code does NOT revoke them. Any credential ever committed to git history or exposed in logs must be rotated at the upstream provider immediately.

---

## 1. Upstream Credentials Requiring Immediate Rotation / Revocation

| Target Identifier | Provider | Source / Git Location | Exposed In | Required Action |
|:---|:---|:---|:---|:---|
| **Supabase Project Anon Key** | Supabase (`ynkdnwhubfknnnzjtpeg`) | `scripts/e2e-trinadh-hospital-test.mjs:19`, `tests/e2e/payment-full-flow.spec.ts:7`, `tests/e2e/compliance-pages.spec.ts:342` | Git Commits `9305ab5c`, `34b7d2c7`, `5e515195` | **ROTATE IMMEDIATELY** in Supabase Project Dashboard (`Project Settings -> API -> Regenerate Anon Key`). |
| **Supabase Service Role Key** | Supabase (`ynkdnwhubfknnnzjtpeg`) | `scripts/e2e-trinadh-hospital-test.mjs:21` | Git Commit `9305ab5c` | **ROTATE IMMEDIATELY** in Supabase Project Dashboard (`Project Settings -> API -> Generate New Service Role Key`). Ensure new key is updated in deployment secrets (Vercel, GitHub Actions) and local `.env`. |
| **Git Commit History Scrub** | GitHub Repository | Commit history of `AppointmentsApp` | Historical Git Tree | Run `git-filter-repo` or BFG Repo-Cleaner to purge references from git commit objects after key rotation, followed by force-push to remote. |

---

## 2. Infrastructure & Dashboard Settings Requiring Human Verification

| Scope | Service / Component | Action Description | Justification |
|:---|:---|:---|:---|
| **Cashfree Payout KYC** | Cashfree Merchant Dashboard | Audit and verify merchant vendor split assignments for any connected merchants. Ensure zero unverified vendor accounts are approved for live settlement. | Precaution against unauthorized split payout routing. |
| **Meta WhatsApp Business** | Meta Developer Portal | Verify Webhook Callback URL and ensure `WA_APP_SECRET` and `WA_VERIFY_TOKEN` match values configured in Supabase Edge Function secrets. | Guarantees authentic incoming WhatsApp webhook delivery. |
| **Upstash Redis** | Upstash Console | Verify production Redis credentials are bound in Vercel production environment so fail-closed rate limiters operate normally. | Protects against OTP and booking hold flooding. |
