# Completion & Honesty Protocol
## Allowed statuses (nothing else may be written anywhere)
VERIFIED_CLOSED | FIXED_UNVERIFIED | OPEN | UNCONFIRMED | FALSE_POSITIVE | BLOCKED(<reason>) | NEEDS_HUMAN(<action>) | DEFERRED(<reason>) | NOT_EXAMINED(<scope>) | IN_PROGRESS | REVIEWED_SAFE | FINDING(<id>)
"Done", "complete", "all clear", "100%", "should be fine" are NOT statuses.
## VERIFIED_CLOSED requires ALL of
1. Regression test FAILS on the pre-fix commit (red evidence from run_and_record.sh).
2. Same test PASSES on the fix (green evidence).
3. Mutation check: revert the fix, test fails again; restore.
4. A fresh zero-context agent re-ran 1-3 itself with the same result.
5. The original scanner or rule no longer flags it.
Missing any one means FIXED_UNVERIFIED at most.
## Evidence rules
- Results come only from tool output saved under .gsd/evidence/. Never type an exit code or pass/fail by hand.
- Re-read a file:line at the moment you cite it. Never cite from memory or from another agent's report.
- If a tool, skill or file is missing or fails, record BLOCKED_TOOL and name the fallback. Never simulate output.
- Subagent self-reports are claims, not evidence. The coordinator re-verifies with git diff and re-running tests.
## Anti-skip rules
- Every inventory item needs a disposition with a concrete proof reference: file:line plus the reasoning that makes it safe. "Reviewed, looks safe" is invalid.
- Not examined means NOT_EXAMINED. A guess stated as fact is a violation.
- Report CI as IN_PROGRESS until the job concludes. Quote the conclusion from `gh run view --json`.
- After 3 consecutive failures on one task: write a state dump to .gsd/STATE_DUMP_<task>.md, stop that worker, start a fresh worker from the dump.
## Final message format
Start with "NOT PROVEN / OPEN" (complete list), then corrections to earlier claims, then the closure table. Success claims never precede the open list. If the open list is empty, state why you believe that and what was not examined.
