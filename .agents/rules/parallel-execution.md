# Parallel Execution Rules (fast AND correct)
1. Coordinator alone writes global ledgers (.gsd/SECURITY_OPEN_WINDOWS.json, COVERAGE_LEDGER.json, WAVE_PLAN, DECISIONS, MEMORY.md). Workers write only to their own evidence dir (.gsd/evidence/<TASK_ID>/) and their own result file (.gsd/results/<TASK_ID>.json).
2. One git worktree per worker (git worktree add ../wt-<TASK_ID> -b task/<TASK_ID>). Never share a working directory or git index between parallel workers. Coordinator merges task branches in dependency order with --no-ff, then runs the wave gate.
3. Packets are strictly file-disjoint. Before dispatch, the coordinator computes each packet's file set from the ledger and writes it to .gsd/LOCKS.json; any overlap means merge the packets or serialize them. A worker touching a file outside its lock set is rejected.
4. Isolate test state: each worker gets its own local database or schema and its own port (e.g. base port + worker index). No shared mutable test data.
5. Concurrency cap: at most 6 simultaneous workers; discovery and read-only audit tasks can fan out wider, edit tasks cannot. Always run the stall monitor.
6. Cheap-first loop for speed: workers run only packet-scoped tests plus typecheck/lint on touched files. The FULL suite runs once per wave gate, and once at the end, never per worker.
7. Cache the BASELINE results by commit sha; do not re-run baseline unless the base moved.
8. Each worker prompt contains ONLY: packet, target files, regression test path, relevant invariants, and the three rule files. Not the whole conversation.
9. Fresh agents for verification: never let the agent that wrote a fix be the one that verifies it.
10. Fail fast: a worker that cannot reproduce red within 2 attempts returns UNCONFIRMED rather than fixing blindly.
