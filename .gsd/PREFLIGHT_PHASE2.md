# Preflight Verification: Phase 2 Campaign (Part 0)

**Date:** 2026-11-22  
**Branch:** `security/window-closure-20261121` (PR #25)  
**Campaign Charter:** Autonomous, unattended, evidence-gated Phase 2 security campaign.  
**Rule Resolution Principle:** Where governance documents conflict, the stricter security/integrity rule wins. MEMORY.md is treated strictly as HINTS, never proof; all claims must be empirically re-verified from live code and tests. Ambiguous decisions are logged conservatively in `.gsd/DECISIONS.md` without pausing execution.

---

## 1. Inventory of Read Governance Documents

| # | File Path | Status | Quoted Proof / Governing Rule |
|---|---|---|---|
| 1 | `AGENTS.md` | READ | Line 45: `"5. Never weaken or delete a test. Never edit an old migration. Every database change is a new migration or seed; no manual changes to the local database. Local database only. Never print secrets."` |
| 2 | `CLAUDE.md` | READ | Line 43: `"3. Every bug fix starts with a failing test."` |
| 3 | `MEMORY.md` (`.agents/memory/MEMORY.md`) | READ | Line 10: `"- [project] SECURITY DEFINER RPC Guard: Never use current_user for auth inside SECURITY DEFINER functions (it always evaluates to postgres). Always enforce (SELECT auth.uid()) ownership/staff checks and lock SET search_path = public, private, pg_temp"` |
| 4 | `.gemini/GEMINI.md` | READ | Line 22: `"4. Verify Empirically — No 'trust me, it works'"` |
| 5 | `.agents/rules/core-protocol.md` | READ | Line 23: `"- Rule Priority: P0 (Workspace Rules in .agents/rules/) > P1 (Agent .md) > P2 (SKILL.md). All rules are binding."` |
| 6 | `.agents/rules/code-rules.md` | READ | Line 23: `"> 🔴 Mobile + frontend-specialist = WRONG. Mobile = mobile-developer ONLY."` |
| 7 | `.gsd/DECISIONS.md` | READ | Line 6: `"Principle: 'The user is asleep. Do NOT stop to ask for approval at any stage. When a decision is ambiguous, choose the most conservative option, log it in .gsd/DECISIONS.md, and continue.'"` |
| 8 | `.gsd/PREFLIGHT.md` | READ | Line 10: `"Execution Standard: Strictly wrapped and verified via bash .gsd/run_and_record.sh"` |
| 9 | `.gsd/MANUAL_ACTIONS.md` | READ | Line 6: `"Governing Standard: Global Rule R5 ('No force-push, no pushes to main/default, no merging. Never print, commit, or log secrets. For any secret found in history, record it in the report as \'ROTATION REQUIRED (human action)\'. Do not attempt rotation.')"` |
| 10 | `FULL_SECURITY_CLOSURE_REPORT.md` | READ | Line 31: `"Mandatory RED -> GREEN -> MUTATION protocol executed for Wave 2 (TASK-W2-01), Wave 4 (TASK-W4-01), and Phase 2 CSRF Guard (MODWEB-006)."` |

---

## 2. Conflict Analysis & Precedence Resolution

1. **Socratic Gate vs. Unattended Execution:**
   - `.agents/rules/code-rules.md` specifies an interactive Socratic Gate asking questions before execution.
   - `.gsd/DECISIONS.md` and user directive specify: "Autonomous, unattended, evidence-gated... The user is asleep. Do NOT stop to ask for approval at any stage. When a decision is ambiguous, choose the most conservative option, log it in `.gsd/DECISIONS.md`, and continue."
   - **Resolution:** The unattended execution directive and DECISIONS.md take precedence. All decisions and edge cases are recorded in `.gsd/DECISIONS.md` with conservative security defaults.

2. **Memory Reliability:**
   - MEMORY.md provides architectural hints and historical findings.
   - **Resolution:** As mandated, MEMORY.md content is treated solely as unverified hints; any assertion relied upon during Phase 2 must have an empirical proof artifact under `.gsd/evidence/`.

3. **Status Taxonomy & Gate Checks:**
   - `.agents/rules/completion-honesty.md` (to be created in Part 1) establishes strict closed vocabulary: `VERIFIED_CLOSED | FIXED_UNVERIFIED | OPEN | UNCONFIRMED | FALSE_POSITIVE | BLOCKED(<reason>) | NEEDS_HUMAN(<action>) | DEFERRED(<reason>) | NOT_EXAMINED(<scope>) | IN_PROGRESS`.
   - **Resolution:** This vocabulary overrides any informal claims in earlier reports.
