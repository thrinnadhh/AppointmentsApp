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
