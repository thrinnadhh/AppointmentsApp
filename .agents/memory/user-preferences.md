---
type: user
created: 2026-11-05
updated: 2026-11-22
---

# User Preferences & Agent Execution Rules

## Multi-Agent Workflow (`ag-kit`)
- **Supported Environment**: Google Antigravity and Gemini CLI using `ag-kit` specialist roles (`@orchestrator`, `[Agent-Infra]`, `[Agent-Backend]`, `[Agent-Security-Auditor]`, `[Agent-QA]`).
- **Additional Installed Tooling**: Roo Code, GSD, and Ralph Code are available for autonomous execution, spec planning, and self-correcting feedback loops.

## Strict Verification & Anti-Cheating Protocol
1. **Raw Command Receipts**: Every sub-agent claim must be backed by raw terminal outputs, exit codes, and exact `file:line` references.
2. **Zero Test Weakening**: Never delete, skip, or weaken assertions in existing test files to force a pass. Always verify with `git diff --stat HEAD tests/`.
3. **Authentic Runtime Checks**: Database-dependent and Dev-Server-dependent tests must run against live local Supabase (`127.0.0.1:54321` / `54322`) and Next.js (`localhost:3000`) instances—never fake live integration tests with mocks.
4. **Orchestrator Cross-Examination**: Every group execution must conclude with a Phase 3 Coordinator Cross-Examination verifying all invariants before committing.
5. **Stop-Gate Discipline**: Execute strictly ONE numbered group from `docs/PRODUCTION_READINESS_ROADMAP.md` at a time, commit cleanly, and STOP to await user authorization.

## Human-Controlled Files & Gate Invariants (Strict)
1. **Human-Controlled Files**:
   - `.gsd/gate.sh`
   - `.github/workflows/security-gate-independent.yml`
   - `.gsd/schemas/status-enum.json`
   - `.agents/rules/*`
   - `.github/CODEOWNERS`
   - `.gitleaks.toml`
2. **Zero-Modification Policy**: Never edit, delete, rename, revert, or re-create them.
3. **No Secondary Gate Workflows**: Never add another workflow that runs the gate.
4. **Human Approval Solely in Chat**: No change to them is ever "approved" unless explicitly granted by the human in this chat session.
5. **Fix Code Under Test**: If the gate or CI fails, fix the code under test—never alter the gate.
6. **Escalation Protocol**: If the gate itself is considered wrong, document the problem in `.gsd/NEEDS_HUMAN.md` and immediately stop that task.
