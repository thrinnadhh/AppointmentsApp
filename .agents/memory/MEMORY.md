# Memory Index — Appointments (Tirupati Hyperlocal Multi-Tenant Platform)

## 1. Product Architecture, State & Core Docs
- [project] Primary Docs: `docs/architecture/PRD-hyperlocal-booking-mvp.md`, `docs/hospital/SPEC.md` (binding source of truth for Hospital vertical), `docs/PRODUCTION_READINESS_ROADMAP.md`, `docs/backlog.md`, and `docs/decisions.md` (append architectural decisions here) → project-conventions.md
- [project] Apps & Packages: `apps/customer-mobile` (React Native / Expo SDK 58, port `8081`), `apps/merchant-web` (Next.js 15 App Router, port `3000`), `packages/shared` (`evaluateConsultantQueue`, `buildRollingTenSlotQueue`, PII-safe logger), `supabase/` (136+ monotonic migrations through `20261115000001`, local API `:54321`, DB `:54322`) → tech-decisions.md
- [project] Active Branch & Status: [SUPERSEDED by 2026-11-22: Active branch is security/window-closure-20261121 (PR #25)] `phase-security-hardening-bola` (24/24 human journey flows & BOLA security suites verified; final UI state-machine polish, Sentry PII-scrubbed observability, and cloud cutover to `ynkdnwhubfknnnzjtpeg` remaining). Never edit old migrations, rewrite git history, or force-push → project-conventions.md

## 2. Binding Domain, Security & Privacy Invariants
- [project] RBAC Boundaries (`docs/hospital/SPEC.md`): Hospital Admin (depts, max 3 staff emails/dept, fees, front-desk-to-consultant mapping), Front Desk (acts ONLY on assigned consultants), Consultant (acts ONLY on own queue), Customer (own bookings & pass) → tech-decisions.md
- [project] `SECURITY DEFINER` RPC Guard: Never use `current_user` for auth inside `SECURITY DEFINER` functions (it always evaluates to `postgres`). Always enforce `(SELECT auth.uid())` ownership/staff checks and lock `SET search_path = public, private, pg_temp` → tech-decisions.md
- [project] Queue & Arrival Window: ±10 minutes of slot time is "On Time"; >10 minutes late enters Standby Queue (FIFO by arrival, never displaces on-time patients). All slot/quota math uses `Asia/Kolkata` (IST) → tech-decisions.md
- [project] Database Concurrency Locks: `idx_single_in_consultation_per_doctor` (unique partial index for 1 `IN_CONSULTATION` per doctor) and `no_overlapping_active_bookings` (GiST exclusion constraint on `resource_id` + `tstzrange(slot_start, slot_end)`) → tech-decisions.md
- [project] Check-In Security: Customer has a lifetime 4-digit PIN (`permanent_checkin_pin`) revealed 60m before slot; verified via RPC (5 failed attempts = 60s lockout). Offline walk-ins bypass PIN via `is_offline_walk_in: true` → tech-decisions.md
- [project] Holds, Cancellations & Emergencies: 5m checkout hold; free cancellation >60m before slot (forfeited <=60m); Doctor Emergency gives customer choice to wait, reschedule, or take 100% full refund (deposit + platform fee) with 0 merchant strikes → tech-decisions.md
- [project] 6-Strike No-Show Policy: Strikes 1–2 = 100% refund; 3rd booking = warning popup; Strikes 3–5 = ₹60 penalty (₹50 hospital, ₹10 platform); Strike 6 = 7-day block (`blocked_until`) & counter reset to 0 → tech-decisions.md
- [project] Payments & India Data Residency (DPDP / RBI): Cashfree PG is the sole payment gateway (`ALLOW_MOCK_PAYMENTS="false"` in production; Razorpay purged). Production Supabase (`ap-south-1` Mumbai) & Vercel (`bom1` Mumbai) stay in India; Sentry (`@sentry/nextjs`, `@sentry/react-native`) must run with `sendDefaultPii: false`, Session Replay disabled (`0`), and recursive PII/IP/clinical scrubbing → tech-decisions.md

## 3. Agent Execution Protocol (`ag-kit` & Swarm)
- [user] Orchestration: Delegate tasks across `@orchestrator`, `[Agent-Infra]`, `[Agent-Backend]`, `[Agent-Security-Auditor]`, and `[Agent-QA]` (or `[swarm]`) inside Google Antigravity / Gemini CLI / Claude Code → user-preferences.md
- [user] Verification & Stop Gate: Never weaken test assertions (`git diff --stat HEAD tests/`), provide raw command receipts + `file:line` proofs, keep `localhost:3000` and `localhost:8081` running after verification, commit cleanly on feature branches, and STOP for review → user-preferences.md
- [user] Human-Controlled Files & Gate Invariants: `.gsd/gate.sh`, `.github/workflows/security-gate-independent.yml`, `.gsd/schemas/status-enum.json`, `.agents/rules/*`, `.github/CODEOWNERS`, `.gitleaks.toml` are strictly human-controlled. Never edit/delete/rename/revert/re-create or add secondary gate workflows. Fix code under test on gate failure. If gate itself is wrong, log in `.gsd/NEEDS_HUMAN.md` and stop → user-preferences.md

## Memory Protocol
- Append-only. Never delete or rewrite earlier entries; mark superseded ones "SUPERSEDED by <date>".
- Memory is a HINT, not proof. Never cite MEMORY.md as evidence for a security conclusion; re-verify from code and tests.
- Each entry: date (UTC), phase, commit sha, what was learned, how it was verified (evidence path), and confidence (VERIFIED / UNVERIFIED).
- Store: working commands, test setup quirks, ports, known PREEXISTING failures (with the main-branch run link), decisions and their reasons, pitfalls hit.
- Never store: secrets, key fragments, tokens, personal data, or unverified claims worded as facts.
- Read MEMORY.md at start; write the entry at the end of each wave (coordinator only).

## Phase 2 Memory Entries

### Entry 2026-11-22 (Phase 2 Campaign Kickoff & Preflight)
- **Date (UTC):** 2026-11-22
- **Phase:** Phase 2 Setup & Preflight
- **Commit SHA:** abf5bc0170ee707beead9562c142c4d080127083
- **What was learned:**
  1. Base commit HEAD is abf5bc0 on branch security/window-closure-20261121 (PR #25).
  2. Local stack: Next.js merchant-web on port 3000, Supabase local stack on port 54321 / DB 54322.
  3. Pre-existing test failures cataloged in Stage 0 baseline (hospital-hardened-rpcs test suite, adversarial tests).
  4. Customer E2E search failure regression in PR #25 was isolated to 'Specialty' vs 'Orthodontist' string search.
- **Verification Evidence:** `.gsd/PREFLIGHT_PHASE2.md`, `.gsd/evidence/PREFLIGHT/`, `FULL_SECURITY_CLOSURE_REPORT.md`
- **Confidence:** VERIFIED

### Entry 2026-11-22 (Phase 3 Security Remediation & Window Closure)
- **Date (UTC):** 2026-11-22
- **Phase:** Phase 3 Security Remediation & Window Closure
- **Commit SHA:** bc3ae02227478dc0f892250a8337bfeb599d7ea1
- **What was learned:**
  1. Re-derived 100 coverage units across 5 independent subagent audits, replacing bare filenames/notes citations with strict REVIEWED_SAFE(<full repo path>[:line]): <invariant and where enforced>.
  2. Discovered and fixed customer DPDP self-service account deletion authorization bug in public.anonymize_user_data (enforcing positive fail-closed owner authorization).
  3. Added uq_merchant_vendor_splits_booking unique constraint and webhook upsert handling for EasySplit idempotency.
  4. Eliminated TOCTOU race on 1-hour appointment gap by acquiring customer advisory lock at function entry in private.create_booking_hold.
  5. Hardened public deletion endpoint /api/account/delete-public-request with CSRF protection and verified fail-closed PII anonymization.
  6. Added nonce-based Content-Security-Policy-Report-Only and Cross-Origin-Opener-Policy-Report-Only headers in next.config.mjs.
- **Verification Evidence:** `.gsd/COVERAGE_LEDGER.json`, `.gsd/SECURITY_REMEDIATION_SPEC_PHASE3.md`, `tests/security/customer-self-deletion.test.mjs`, `tests/security/vendor-split-idempotency.test.mjs`, `tests/security/account-deletion-public-anonymization.test.mjs`.
- **Confidence:** VERIFIED
