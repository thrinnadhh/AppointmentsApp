# Memory Index — Appointments (Tirupati Hyperlocal Multi-Tenant Platform)

## 1. Product Architecture & Core Docs
- [project] Primary Docs: `docs/architecture/PRD-hyperlocal-booking-mvp.md`, `docs/hospital/SPEC.md` (binding source of truth for Hospital vertical), `docs/PRODUCTION_READINESS_ROADMAP.md`, and `docs/backlog.md` → project-conventions.md
- [project] Apps & Packages: `apps/customer-mobile` (React Native/Expo), `apps/merchant-web` (Next.js 15 App Router, port 3000), `apps/backend`, `packages/shared` (`evaluateConsultantQueue`, `buildRollingTenSlotQueue`), `supabase/` (134 migrations, local API `:54321`, DB `:54322`) → tech-decisions.md
- [project] Active Branch: `fix/production-readiness` (Groups 1 & 2 ACCEPTED; Groups 3–9 PENDING). Never rewrite git history, force-push, or touch production → project-conventions.md

## 2. Binding Hospital Domain Invariants (`docs/hospital/SPEC.md`)
- [invariant] RBAC Boundaries: Hospital Admin (depts, max 3 staff emails/dept, fees, front-desk-to-consultant mapping), Front Desk (acts ONLY on assigned consultants), Consultant (acts ONLY on own queue), Customer (own bookings & pass) → tech-decisions.md
- [invariant] Queue & Arrival Window: ±10 minutes of slot time is "On Time"; >10 minutes late enters Standby Queue (FIFO by arrival, never displaces on-time patients). All slot/quota math uses `Asia/Kolkata` (IST) → tech-decisions.md
- [invariant] Database Concurrency Locks: `idx_single_in_consultation_per_doctor` (unique partial index for 1 `IN_CONSULTATION` per doctor) and `no_overlapping_active_bookings` (GiST exclusion constraint on `resource_id` + `tstzrange(slot_start, slot_end)`) → tech-decisions.md
- [invariant] Check-In Security: Customer has a lifetime 4-digit PIN (`permanent_checkin_pin`) revealed 60m before slot; verified via RPC (5 failed attempts = 60s lockout). Offline walk-ins bypass PIN via `is_offline_walk_in: true` → tech-decisions.md
- [invariant] Holds, Cancellations & Emergencies: 5m checkout hold; free cancellation >60m before slot (forfeited <=60m); Doctor Emergency gives customer choice to wait, reschedule, or take 100% full refund (deposit + platform fee) with 0 merchant strikes → tech-decisions.md
- [invariant] 6-Strike No-Show Policy: Strikes 1–2 = 100% refund; 3rd booking = warning popup; Strikes 3–5 = ₹60 penalty (₹50 hospital, ₹10 platform); Strike 6 = 7-day block (`blocked_until`) & counter reset to 0 → tech-decisions.md

## 3. Agent Execution Protocol (`ag-kit`)
- [user] Orchestration: Delegate tasks across `@orchestrator`, `[Agent-Infra]`, `[Agent-Backend]`, `[Agent-Security-Auditor]`, and `[Agent-QA]` inside Google Antigravity / Gemini CLI → user-preferences.md
- [user] Verification & Stop Gate: Never weaken test assertions (`git diff --stat HEAD tests/`), provide raw command receipts + `file:line` proofs, run Orchestrator Cross-Examination, commit cleanly, and STOP after each numbered group → user-preferences.md
