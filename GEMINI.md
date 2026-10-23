<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

## Standing rules
1. docs/hospital/SPEC.md is the source of truth. If a task conflicts with it, stop and ask me.
2. One layer per task: database, API, shared logic, UI, or hardening. Touch only that layer's files, and list any other file you changed with the reason.
3. Every bug fix starts with a failing test.
4. Before finishing, run the full gate: supabase db reset, then all test suites serially, then typecheck and build. Show the counts.
5. Never weaken or delete a test. Never edit an old migration. Every database change is a new migration or seed; no manual changes to the local database. Local database only. Never print secrets.
6. A bug found in another layer goes into docs/backlog.md (layer, symptom, how to reproduce) and is not fixed now unless it blocks the current task.
7. Every decision goes into docs/decisions.md (date, decision, reason).
8. Work on a branch named phase-N-name created from the integration branch; commit in small steps; do not merge.
9. End every task with a report: files changed, tests added, gate result with counts, backlog items, questions for me.
