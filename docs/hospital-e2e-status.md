# Hospital E2E status - 24 Oct 2026, 12:26 am IST

## 1. Verdict: NOT READY

Reason: run incomplete: 3 not run, 0 blocked.
Branch: phase-7-release, last commit bff5031 "fix(security): enforce Upstash credentials, https-only URLs, and mock payments lock in production env validator", 91 commit(s) since e2e/base.
Result files read: 19 (case-map.md, leg_sa1.md, leg_sa2.md, leg_sa3.md, leg_sa4.md, leg_sa5.md, leg_sa6.md, leg_sa7.md, manual-script.md, phase2.md, sa1.md, sa2.md, sa3.md, sa4.md, sa5.md, sa6.md, sa7.md, sa8.md, hospital-e2e-report.md).
WARNING: the newest result file is older than the latest commit. Re-run the tests before trusting this.

## 2. Scoreboard

Only PASS counts as passed. Blocked, skipped, flaky and not-run cases are not passes.

| Workstream | Planned | PASS | FAIL | BLOCKED | FLAKY | Not run | Pass rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA1 Setup and roles | 9 | 8 | 0 | 0 | 0 | 1 | 89% |
| SA2 Booking and payments | 10 | 10 | 0 | 0 | 0 | 0 | 100% |
| SA3 Cancel, reschedule, money | 9 | 9 | 0 | 0 | 0 | 0 | 100% |
| SA4 Check-in | 8 | 8 | 0 | 0 | 0 | 0 | 100% |
| SA5 Queue integration | 14 | 14 | 0 | 0 | 0 | 0 | 100% |
| SA6 Randomized simulation | 1 | 1 | 0 | 0 | 0 | 0 | 100% |
| SA7 ETA and notifications | 7 | 7 | 0 | 0 | 0 | 0 | 100% |
| SA8 Resilience and regression | 7 | 5 | 0 | 0 | 0 | 2 | 71% |
| P2 Phase 2 (orchestrator) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |
| **Total** | 68 | 65 | 0 | 0 | 0 | 3 | 96% |

Of the passes, 64 are automated and 1 manual.

## 3. Defects

| Severity | Total | Open | Fixed | Flaky | Deferred |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 0 | 0 |
| Medium | 1 | 0 | 1 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 | 0 |

No open Critical or High defects.

Fixed: 1.

## 4. Policy questions that need your decision

These cases only record what the app does today. For each, decide whether that behavior is right.

- B7 (one customer booking overlapping slots): PASS - ** The same customer books overlapping slots: report the current behavior. Same doctor: rejected by exclusion 
- C2 (does a late-cancelled slot reopen?): PASS - ** Does a late-cancelled slot reopen? Late-cancelled slot reopens immediately for new booking without exclusio
- C3 (what happens to the check-in code on reschedule): PASS - ** What happens to the check-in code on reschedule Original check-in code is retained and remains valid for th
- G3 (deposit for a Standby patient who is present and served): PASS - ** Deposit for a Standby patient who is present and served Standby patient served: deposit retained as CAPTURE
- A6 (Consultant on leave with existing bookings): PASS - ** A Consultant marks leave for a day: no new bookings. Report what happens to existing bookings. Consultant m
- J6 (Consultant unavailable mid-day): PASS - ** A Consultant becomes unavailable mid-day: report how the remaining queue is handled Consultant deactivated 

## 5. Key checks

- Worked examples: MET (E1=PASS, E2=PASS)
- Randomized simulation: MET (E15=PASS)
- Money cases: MET (B5=PASS, B6=PASS, C1=PASS, C2=PASS, C3=PASS, C4=PASS, C5=PASS, C6=PASS, G2=PASS, G3=PASS, G4=PASS)
- Check-in security: MET (D4=PASS, D5=PASS)
- Non-hospital regression: MET (K1=PASS, K2=PASS)
- Race tests (n/50 lines found): 9 found, 0 below 50
- Per-Consultant access isolation: MET

## 6. Performance

J4 full-day load: PASS - ** Full-Day 250 Patient High-Throughput Load Test Processed 250/250 bookings across 5 consultants & 3 front desks in 2.49s (100.4 

## 7. Coverage and risk

- Workstreams with no result file: none.
- Cases passed by manual check: E12.
- Cases not run: A7, J2, J3.

## 8. Release gate

- MET: Zero open Critical and High defects
- MET: All money cases pass (B5, B6, C1-C6, G2-G4)
- MET: Race tests pass 50 out of 50
- MET: Worked examples and simulation pass (E1, E2, E15)
- MET: Check-in security passes (D4, D5)
- MET: Access isolation tests pass (docs/hospital-test-report.md)
- MET: Non-hospital regression passes (K1, K2)
- UNVERIFIED: Policy questions decided by you

## 9. Next steps

1. Re-run the tests (results are older than the latest commit).
2. Run the 3 case(s) that have not run yet.
3. You: decide the policy questions in section 4.
4. Re-run this report: node scripts/e2e-status.mjs

---

# Hospital E2E status - 21 Oct 2026, 1:57 pm IST

## 1. Verdict: NOT READY

Reason: run incomplete: 3 not run, 0 blocked.
Branch: refactor/arch-cleanup-and-security-hardening, last commit ee8aad3 "test(simulation): link E15 to real HospitalDepartmentQueueEngine and update case-map", 14 commit(s) since e2e/base.
Result files read: 12 (case-map.md, manual-script.md, phase2.md, sa1.md, sa2.md, sa3.md, sa4.md, sa5.md, sa6.md, sa7.md, sa8.md, hospital-e2e-report.md).
WARNING: 5 result(s) reuse case ids from another workstream and were ignored (see section 7).

## 2. Scoreboard

Only PASS counts as passed. Blocked, skipped, flaky and not-run cases are not passes.

| Workstream | Planned | PASS | FAIL | BLOCKED | FLAKY | Not run | Pass rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA1 Setup and roles | 9 | 8 | 0 | 0 | 0 | 1 | 89% |
| SA2 Booking and payments | 10 | 10 | 0 | 0 | 0 | 0 | 100% |
| SA3 Cancel, reschedule, money | 9 | 9 | 0 | 0 | 0 | 0 | 100% |
| SA4 Check-in | 8 | 8 | 0 | 0 | 0 | 0 | 100% |
| SA5 Queue integration | 14 | 14 | 0 | 0 | 0 | 0 | 100% |
| SA6 Randomized simulation | 1 | 1 | 0 | 0 | 0 | 0 | 100% |
| SA7 ETA and notifications | 7 | 7 | 0 | 0 | 0 | 0 | 100% |
| SA8 Resilience and regression | 7 | 5 | 0 | 0 | 0 | 2 | 71% |
| P2 Phase 2 (orchestrator) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |
| **Total** | 68 | 65 | 0 | 0 | 0 | 3 | 96% |

Of the passes, 64 are automated and 1 manual.

## 3. Defects

| Severity | Total | Open | Fixed | Flaky | Deferred |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 0 | 0 |
| Medium | 1 | 0 | 1 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 | 0 |

No open Critical or High defects.

Fixed: 1.

## 4. Policy questions that need your decision

These cases only record what the app does today. For each, decide whether that behavior is right.

- B7 (one customer booking overlapping slots): PASS - ** SA2 (`sa2.md`) The same customer books overlapping slots: report the current behavior. Same doctor: rejecte
- C2 (does a late-cancelled slot reopen?): PASS - ** SA3 (`sa3.md`) Does a late-cancelled slot reopen? Late-cancelled slot reopens immediately for new booking w
- C3 (what happens to the check-in code on reschedule): PASS - ** SA3 (`sa3.md`) What happens to the check-in code on reschedule Original check-in code is retained and remai
- G3 (deposit for a Standby patient who is present and served): PASS - ** SA3 (`sa3.md`) Deposit for a Standby patient who is present and served Standby patient served: deposit reta
- A6 (Consultant on leave with existing bookings): PASS - ** SA1 (`sa1.md`) A Consultant marks leave for a day: no new bookings. Report what happens to existing booking
- J6 (Consultant unavailable mid-day): PASS - ** SA8 (`sa8.md`) A Consultant becomes unavailable mid-day: report how the remaining queue is handled. Consult

## 5. Key checks

- Worked examples: MET (E1=PASS, E2=PASS)
- Randomized simulation: MET (E15=PASS)
- Money cases: MET (B5=PASS, B6=PASS, C1=PASS, C2=PASS, C3=PASS, C4=PASS, C5=PASS, C6=PASS, G2=PASS, G3=PASS, G4=PASS)
- Check-in security: MET (D4=PASS, D5=PASS)
- Non-hospital regression: MET (K1=PASS, K2=PASS)
- Race tests (n/50 lines found): 5 found, 0 below 50
- Per-Consultant access isolation: MET

## 6. Performance

J4 full-day load: PASS - ** P2 (`phase2.md`) Full-Day 250 Patient High-Throughput Load Test Processed 250/250 bookings across 5 consultants & 3 front desks

## 7. Coverage and risk

- Workstreams with no result file: none.
- Cases passed by manual check: E12.
- Cases not run: A7, J2, J3.

Ignored results (the case id belongs to another workstream, so it probably describes a different test):
- sa3.md reports D1, which belongs to SA4
- sa3.md reports D2, which belongs to SA4
- sa3.md reports D5, which belongs to SA4
- sa3.md reports D6, which belongs to SA4
- sa3.md reports D7, which belongs to SA4

## 8. Release gate

- MET: Zero open Critical and High defects
- MET: All money cases pass (B5, B6, C1-C6, G2-G4)
- MET: Race tests pass 50 out of 50
- MET: Worked examples and simulation pass (E1, E2, E15)
- MET: Check-in security passes (D4, D5)
- MET: Access isolation tests pass (docs/hospital-test-report.md)
- MET: Non-hospital regression passes (K1, K2)
- UNVERIFIED: Policy questions decided by you

## 9. Next steps

1. Run the 3 case(s) that have not run yet.
2. You: decide the policy questions in section 4.
3. Re-run this report: node scripts/e2e-status.mjs

---

# Hospital E2E status - 21 Oct 2026, 1:31 pm IST

## 1. Verdict: NOT READY

Reason: run incomplete: 3 not run, 0 blocked.
Branch: refactor/arch-cleanup-and-security-hardening, last commit 9234d03 "fix(queue): pull in early patient when doctor idle and no standby fits (E8)", 13 commit(s) since e2e/base.
Result files read: 12 (case-map.md, manual-script.md, phase2.md, sa1.md, sa2.md, sa3.md, sa4.md, sa5.md, sa6.md, sa7.md, sa8.md, hospital-e2e-report.md).

## 2. Scoreboard

Only PASS counts as passed. Blocked, skipped, flaky and not-run cases are not passes.

| Workstream | Planned | PASS | FAIL | BLOCKED | FLAKY | Not run | Pass rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA1 Setup and roles | 9 | 8 | 0 | 0 | 0 | 1 | 89% |
| SA2 Booking and payments | 10 | 10 | 0 | 0 | 0 | 0 | 100% |
| SA3 Cancel, reschedule, money | 9 | 9 | 0 | 0 | 0 | 0 | 100% |
| SA4 Check-in | 8 | 8 | 0 | 0 | 0 | 0 | 100% |
| SA5 Queue integration | 14 | 14 | 0 | 0 | 0 | 0 | 100% |
| SA6 Randomized simulation | 1 | 1 | 0 | 0 | 0 | 0 | 100% |
| SA7 ETA and notifications | 7 | 7 | 0 | 0 | 0 | 0 | 100% |
| SA8 Resilience and regression | 7 | 5 | 0 | 0 | 0 | 2 | 71% |
| P2 Phase 2 (orchestrator) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |
| **Total** | 68 | 65 | 0 | 0 | 0 | 3 | 96% |

Of the passes, 64 are automated and 1 manual.

## 3. Defects

| Severity | Total | Open | Fixed | Flaky | Deferred |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 0 | 0 |
| Medium | 1 | 0 | 1 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 | 0 |

No open Critical or High defects.

Fixed: 1.

## 4. Policy questions that need your decision

These cases only record what the app does today. For each, decide whether that behavior is right.

- B7 (one customer booking overlapping slots): PASS - ** SA2 (`sa2.md`) The same customer books overlapping slots: report the current behavior. Same doctor: rejecte
- C2 (does a late-cancelled slot reopen?): PASS - ** SA3 (`sa3.md`) Does a late-cancelled slot reopen? Late-cancelled slot reopens immediately for new booking w
- C3 (what happens to the check-in code on reschedule): PASS - ** SA3 (`sa3.md`) What happens to the check-in code on reschedule Original check-in code is retained and remai
- G3 (deposit for a Standby patient who is present and served): PASS - ** SA3 (`sa3.md`) Deposit for a Standby patient who is present and served Standby patient served: deposit reta
- A6 (Consultant on leave with existing bookings): PASS - ** SA1 (`sa1.md`) A Consultant marks leave for a day: no new bookings. Report what happens to existing booking
- J6 (Consultant unavailable mid-day): PASS - ** SA8 (`sa8.md`) A Consultant becomes unavailable mid-day: report how the remaining queue is handled. Consult

## 5. Key checks

- Worked examples: MET (E1=PASS, E2=PASS)
- Randomized simulation: MET (E15=PASS)
- Money cases: MET (B5=PASS, B6=PASS, C1=PASS, C2=PASS, C3=PASS, C4=PASS, C5=PASS, C6=PASS, G2=PASS, G3=PASS, G4=PASS)
- Check-in security: MET (D4=PASS, D5=PASS)
- Non-hospital regression: MET (K1=PASS, K2=PASS)
- Race tests (n/50 lines found): 6 found, 0 below 50
- Per-Consultant access isolation: MET

## 6. Performance

J4 full-day load: PASS - ** P2 (`phase2.md`) Full-Day 250 Patient High-Throughput Load Test Processed 250/250 bookings across 5 consultants & 3 front desks

## 7. Coverage and risk

- Workstreams with no result file: none.
- Cases passed by manual check: E12.
- Cases not run: A7, J2, J3.

## 8. Release gate

- MET: Zero open Critical and High defects
- MET: All money cases pass (B5, B6, C1-C6, G2-G4)
- MET: Race tests pass 50 out of 50
- MET: Worked examples and simulation pass (E1, E2, E15)
- MET: Check-in security passes (D4, D5)
- MET: Access isolation tests pass (docs/hospital-test-report.md)
- MET: Non-hospital regression passes (K1, K2)
- UNVERIFIED: Policy questions decided by you

## 9. Next steps

1. Run the 3 case(s) that have not run yet.
2. You: decide the policy questions in section 4.
3. Re-run this report: node scripts/e2e-status.mjs

---

# Hospital E2E status - 21 Oct 2026, 1:28 pm IST

## 1. Verdict: NOT READY

Reason: run incomplete: 3 not run, 0 blocked.
Branch: refactor/arch-cleanup-and-security-hardening, last commit 9234d03 "fix(queue): pull in early patient when doctor idle and no standby fits (E8)", 13 commit(s) since e2e/base.
Result files read: 12 (case-map.md, manual-script.md, phase2.md, sa1.md, sa2.md, sa3.md, sa4.md, sa5.md, sa6.md, sa7.md, sa8.md, hospital-e2e-report.md).

## 2. Scoreboard

Only PASS counts as passed. Blocked, skipped, flaky and not-run cases are not passes.

| Workstream | Planned | PASS | FAIL | BLOCKED | FLAKY | Not run | Pass rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA1 Setup and roles | 9 | 8 | 0 | 0 | 0 | 1 | 89% |
| SA2 Booking and payments | 10 | 10 | 0 | 0 | 0 | 0 | 100% |
| SA3 Cancel, reschedule, money | 9 | 9 | 0 | 0 | 0 | 0 | 100% |
| SA4 Check-in | 8 | 8 | 0 | 0 | 0 | 0 | 100% |
| SA5 Queue integration | 14 | 14 | 0 | 0 | 0 | 0 | 100% |
| SA6 Randomized simulation | 1 | 1 | 0 | 0 | 0 | 0 | 100% |
| SA7 ETA and notifications | 7 | 7 | 0 | 0 | 0 | 0 | 100% |
| SA8 Resilience and regression | 7 | 5 | 0 | 0 | 0 | 2 | 71% |
| P2 Phase 2 (orchestrator) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |
| **Total** | 68 | 65 | 0 | 0 | 0 | 3 | 96% |

Of the passes, 64 are automated and 1 manual.

## 3. Defects

| Severity | Total | Open | Fixed | Flaky | Deferred |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 0 | 0 |
| Medium | 1 | 0 | 1 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 | 0 |

No open Critical or High defects.

Fixed: 1.

## 4. Policy questions that need your decision

These cases only record what the app does today. For each, decide whether that behavior is right.

- B7 (one customer booking overlapping slots): PASS - ** The same customer books overlapping slots: report the current behavior. Same doctor: rejected by exclusion 
- C2 (does a late-cancelled slot reopen?): PASS - ** Does a late-cancelled slot reopen? Late-cancelled slot reopens immediately for new booking without exclusio
- C3 (what happens to the check-in code on reschedule): PASS - ** What happens to the check-in code on reschedule Original check-in code is retained and remains valid for th
- G3 (deposit for a Standby patient who is present and served): PASS - ** Deposit for a Standby patient who is present and served Standby patient served: deposit retained as CAPTURE
- A6 (Consultant on leave with existing bookings): PASS - ** A Consultant marks leave for a day: no new bookings. Report what happens to existing bookings. Consultant m
- J6 (Consultant unavailable mid-day): PASS - ** A Consultant becomes unavailable mid-day: report how the remaining queue is handled Consultant deactivated 

## 5. Key checks

- Worked examples: MET (E1=PASS, E2=PASS)
- Randomized simulation: MET (E15=PASS)
- Money cases: MET (B5=PASS, B6=PASS, C1=PASS, C2=PASS, C3=PASS, C4=PASS, C5=PASS, C6=PASS, G2=PASS, G3=PASS, G4=PASS)
- Check-in security: MET (D4=PASS, D5=PASS)
- Non-hospital regression: MET (K1=PASS, K2=PASS)
- Race tests (n/50 lines found): 6 found, 0 below 50
- Per-Consultant access isolation: MET

## 6. Performance

J4 full-day load: PASS - ** P2 (`phase2.md`) Full-Day 250 Patient High-Throughput Load Test Processed 250/250 bookings across 5 consultants & 3 front desks

## 7. Coverage and risk

- Workstreams with no result file: none.
- Cases passed by manual check: E12.
- Cases not run: A7, J2, J3.

## 8. Release gate

- MET: Zero open Critical and High defects
- MET: All money cases pass (B5, B6, C1-C6, G2-G4)
- MET: Race tests pass 50 out of 50
- MET: Worked examples and simulation pass (E1, E2, E15)
- MET: Check-in security passes (D4, D5)
- MET: Access isolation tests pass (docs/hospital-test-report.md)
- MET: Non-hospital regression passes (K1, K2)
- UNVERIFIED: Policy questions decided by you

## 9. Next steps

1. Run the 3 case(s) that have not run yet.
2. You: decide the policy questions in section 4.
3. Re-run this report: node scripts/e2e-status.mjs

---

# Hospital E2E status - 21 Oct 2026, 12:58 pm IST

## 1. Verdict: NOT READY

Reason: 1 open Critical/High defect(s).
Branch: refactor/arch-cleanup-and-security-hardening, last commit e60083e "docs(e2e): create master case-map.md with all 68 planned cases", 9 commit(s) since e2e/base.
Result files read: 12 (case-map.md, manual-script.md, phase2.md, sa1.md, sa2.md, sa3.md, sa4.md, sa5.md, sa6.md, sa7.md, sa8.md, hospital-e2e-report.md).

## 2. Scoreboard

Only PASS counts as passed. Blocked, skipped, flaky and not-run cases are not passes.

| Workstream | Planned | PASS | FAIL | BLOCKED | FLAKY | Not run | Pass rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA1 Setup and roles | 9 | 8 | 0 | 0 | 0 | 1 | 89% |
| SA2 Booking and payments | 10 | 10 | 0 | 0 | 0 | 0 | 100% |
| SA3 Cancel, reschedule, money | 9 | 8 | 1 | 0 | 0 | 0 | 89% |
| SA4 Check-in | 8 | 7 | 1 | 0 | 0 | 0 | 88% |
| SA5 Queue integration | 14 | 13 | 1 | 0 | 0 | 0 | 93% |
| SA6 Randomized simulation | 1 | 1 | 0 | 0 | 0 | 0 | 100% |
| SA7 ETA and notifications | 7 | 7 | 0 | 0 | 0 | 0 | 100% |
| SA8 Resilience and regression | 7 | 5 | 0 | 0 | 0 | 2 | 71% |
| P2 Phase 2 (orchestrator) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |
| **Total** | 68 | 62 | 3 | 0 | 0 | 3 | 91% |

Of the passes, 61 are automated and 1 manual.

Problem cases:
- C6 FAIL: ** SA3 (`sa3.md`) Cancelling twice, or after check-in or completion, is rejected. cancel_booking RPC allows cancelling after check
- D4 FAIL: ** SA4 (`sa4.md`) Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for a
- E8 FAIL: ** SA5 (`sa5.md`) An early patient is pulled in only when the doctor would otherwise idle and no Standby patient fits. dispatchNex

## 3. Defects

| Severity | Total | Open | Fixed | Flaky | Deferred |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 1 | 1 | 0 | 0 | 0 |
| Medium | 2 | 1 | 1 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 | 0 |

Open Critical and High defects:
- [High] Severity:** HIGH (docs/e2e/sa3.md)

Fixed: 1.

## 4. Policy questions that need your decision

These cases only record what the app does today. For each, decide whether that behavior is right.

- B7 (one customer booking overlapping slots): PASS - ** SA2 (`sa2.md`) The same customer books overlapping slots: report the current behavior. Same doctor: rejecte
- C2 (does a late-cancelled slot reopen?): PASS - ** SA3 (`sa3.md`) Does a late-cancelled slot reopen? Late-cancelled slot reopens immediately for new booking w
- C3 (what happens to the check-in code on reschedule): PASS - ** SA3 (`sa3.md`) What happens to the check-in code on reschedule Original check-in code is retained and remai
- G3 (deposit for a Standby patient who is present and served): PASS - ** SA3 (`sa3.md`) Deposit for a Standby patient who is present and served Standby patient served: deposit reta
- A6 (Consultant on leave with existing bookings): PASS - ** SA1 (`sa1.md`) A Consultant marks leave for a day: no new bookings. Report what happens to existing booking
- J6 (Consultant unavailable mid-day): PASS - ** SA8 (`sa8.md`) A Consultant becomes unavailable mid-day: report how the remaining queue is handled. Consult

## 5. Key checks

- Worked examples: MET (E1=PASS, E2=PASS)
- Randomized simulation: MET (E15=PASS)
- Money cases: NOT MET (B5=PASS, B6=PASS, C1=PASS, C2=PASS, C3=PASS, C4=PASS, C5=PASS, C6=FAIL, G2=PASS, G3=PASS, G4=PASS)
- Check-in security: NOT MET (D4=FAIL, D5=PASS)
- Non-hospital regression: MET (K1=PASS, K2=PASS)
- Race tests (n/50 lines found): 6 found, 0 below 50
- Per-Consultant access isolation: MET

## 6. Performance

J4 full-day load: PASS - ** P2 (`phase2.md`) Full-Day 250 Patient High-Throughput Load Test Processed 250/250 bookings across 5 consultants & 3 front desks

## 7. Coverage and risk

- Workstreams with no result file: none.
- Cases passed by manual check: E12.
- Cases not run: A7, J2, J3.

## 8. Release gate

- NOT MET: Zero open Critical and High defects
- NOT MET: All money cases pass (B5, B6, C1-C6, G2-G4)
- MET: Race tests pass 50 out of 50
- MET: Worked examples and simulation pass (E1, E2, E15)
- NOT MET: Check-in security passes (D4, D5)
- MET: Access isolation tests pass (docs/hospital-test-report.md)
- MET: Non-hospital regression passes (K1, K2)
- UNVERIFIED: Policy questions decided by you

## 9. Next steps

1. Fix the 1 open Critical/High defect(s) listed in section 3.
2. Investigate the 3 failing case(s) in section 2.
3. Run the 3 case(s) that have not run yet.
4. You: decide the policy questions in section 4.
5. Re-run this report: node scripts/e2e-status.mjs

---

# Hospital E2E status - 21 Oct 2026, 12:57 pm IST

## 1. Verdict: NOT READY

Reason: 1 open Critical/High defect(s).
Branch: refactor/arch-cleanup-and-security-hardening, last commit e60083e "docs(e2e): create master case-map.md with all 68 planned cases", 9 commit(s) since e2e/base.
Result files read: 12 (case-map.md, manual-script.md, phase2.md, sa1.md, sa2.md, sa3.md, sa4.md, sa5.md, sa6.md, sa7.md, sa8.md, hospital-e2e-report.md).
WARNING: the newest result file is older than the latest commit. Re-run the tests before trusting this.

## 2. Scoreboard

Only PASS counts as passed. Blocked, skipped, flaky and not-run cases are not passes.

| Workstream | Planned | PASS | FAIL | BLOCKED | FLAKY | Not run | Pass rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA1 Setup and roles | 9 | 8 | 0 | 0 | 0 | 1 | 89% |
| SA2 Booking and payments | 10 | 10 | 0 | 0 | 0 | 0 | 100% |
| SA3 Cancel, reschedule, money | 9 | 8 | 1 | 0 | 0 | 0 | 89% |
| SA4 Check-in | 8 | 7 | 1 | 0 | 0 | 0 | 88% |
| SA5 Queue integration | 14 | 13 | 1 | 0 | 0 | 0 | 93% |
| SA6 Randomized simulation | 1 | 0 | 1 | 0 | 0 | 0 | 0% |
| SA7 ETA and notifications | 7 | 7 | 0 | 0 | 0 | 0 | 100% |
| SA8 Resilience and regression | 7 | 5 | 0 | 0 | 0 | 2 | 71% |
| P2 Phase 2 (orchestrator) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |
| **Total** | 68 | 61 | 4 | 0 | 0 | 3 | 90% |

Of the passes, 60 are automated and 1 manual.

Problem cases:
- C6 FAIL: ** SA3 (`sa3.md`) Cancelling twice, or after check-in or completion, is rejected. cancel_booking RPC allows cancelling after check
- D4 FAIL: ** SA4 (`sa4.md`) Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for a
- E8 FAIL: ** SA5 (`sa5.md`) An early patient is pulled in only when the doctor would otherwise idle and no Standby patient fits. dispatchNex
- E15 FAIL: ** SA6 (`sa6.md`) Randomized simulation: at least 1,000 random days against the real dispatcher logic. Assert: one consultation at

## 3. Defects

| Severity | Total | Open | Fixed | Flaky | Deferred |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 1 | 1 | 0 | 0 | 0 |
| Medium | 2 | 1 | 1 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 | 0 |

Open Critical and High defects:
- [High] Severity:** HIGH (docs/e2e/sa3.md)

Fixed: 1.

## 4. Policy questions that need your decision

These cases only record what the app does today. For each, decide whether that behavior is right.

- B7 (one customer booking overlapping slots): PASS - ** SA2 (`sa2.md`) The same customer books overlapping slots: report the current behavior. Same doctor: rejecte
- C2 (does a late-cancelled slot reopen?): PASS - ** SA3 (`sa3.md`) Does a late-cancelled slot reopen? Late-cancelled slot reopens immediately for new booking w
- C3 (what happens to the check-in code on reschedule): PASS - ** SA3 (`sa3.md`) What happens to the check-in code on reschedule Original check-in code is retained and remai
- G3 (deposit for a Standby patient who is present and served): PASS - ** SA3 (`sa3.md`) Deposit for a Standby patient who is present and served Standby patient served: deposit reta
- A6 (Consultant on leave with existing bookings): PASS - ** SA1 (`sa1.md`) A Consultant marks leave for a day: no new bookings. Report what happens to existing booking
- J6 (Consultant unavailable mid-day): PASS - ** SA8 (`sa8.md`) A Consultant becomes unavailable mid-day: report how the remaining queue is handled. Consult

## 5. Key checks

- Worked examples: MET (E1=PASS, E2=PASS)
- Randomized simulation: NOT MET (E15=FAIL)
- Money cases: NOT MET (B5=PASS, B6=PASS, C1=PASS, C2=PASS, C3=PASS, C4=PASS, C5=PASS, C6=FAIL, G2=PASS, G3=PASS, G4=PASS)
- Check-in security: NOT MET (D4=FAIL, D5=PASS)
- Non-hospital regression: MET (K1=PASS, K2=PASS)
- Race tests (n/50 lines found): 6 found, 0 below 50
- Per-Consultant access isolation: MET

## 6. Performance

J4 full-day load: PASS - ** P2 (`phase2.md`) Full-Day 250 Patient High-Throughput Load Test Processed 250/250 bookings across 5 consultants & 3 front desks

## 7. Coverage and risk

- Workstreams with no result file: none.
- Cases passed by manual check: E12.
- Cases not run: A7, J2, J3.

## 8. Release gate

- NOT MET: Zero open Critical and High defects
- NOT MET: All money cases pass (B5, B6, C1-C6, G2-G4)
- MET: Race tests pass 50 out of 50
- NOT MET: Worked examples and simulation pass (E1, E2, E15)
- NOT MET: Check-in security passes (D4, D5)
- MET: Access isolation tests pass (docs/hospital-test-report.md)
- MET: Non-hospital regression passes (K1, K2)
- UNVERIFIED: Policy questions decided by you

## 9. Next steps

1. Re-run the tests (results are older than the latest commit).
2. Fix the 1 open Critical/High defect(s) listed in section 3.
3. Investigate the 4 failing case(s) in section 2.
4. Run the 3 case(s) that have not run yet.
5. You: decide the policy questions in section 4.
6. Re-run this report: node scripts/e2e-status.mjs

---

# Hospital E2E status - 21 Oct 2026, 12:56 pm IST

## 1. Verdict: NOT READY

Reason: 1 open Critical/High defect(s).
Branch: refactor/arch-cleanup-and-security-hardening, last commit 4cb1eb8 "test(e2e): workstream SA7 - ETA and notifications F1-F6, G5", 8 commit(s) since e2e/base.
Result files read: 11 (manual-script.md, phase2.md, sa1.md, sa2.md, sa3.md, sa4.md, sa5.md, sa6.md, sa7.md, sa8.md, hospital-e2e-report.md).
WARNING: the newest result file is older than the latest commit. Re-run the tests before trusting this.

## 2. Scoreboard

Only PASS counts as passed. Blocked, skipped, flaky and not-run cases are not passes.

| Workstream | Planned | PASS | FAIL | BLOCKED | FLAKY | Not run | Pass rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA1 Setup and roles | 9 | 8 | 0 | 0 | 0 | 1 | 89% |
| SA2 Booking and payments | 10 | 10 | 0 | 0 | 0 | 0 | 100% |
| SA3 Cancel, reschedule, money | 9 | 8 | 1 | 0 | 0 | 0 | 89% |
| SA4 Check-in | 8 | 7 | 1 | 0 | 0 | 0 | 88% |
| SA5 Queue integration | 14 | 13 | 1 | 0 | 0 | 0 | 93% |
| SA6 Randomized simulation | 1 | 1 | 0 | 0 | 0 | 0 | 100% |
| SA7 ETA and notifications | 7 | 7 | 0 | 0 | 0 | 0 | 100% |
| SA8 Resilience and regression | 7 | 5 | 0 | 0 | 0 | 2 | 71% |
| P2 Phase 2 (orchestrator) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |
| **Total** | 68 | 62 | 3 | 0 | 0 | 3 | 91% |

Of the passes, 61 are automated and 1 manual.

Problem cases:
- C6 FAIL: ** Cancelling twice, or after check-in or completion, is rejected cancel_booking RPC allows cancelling after check-in; expected re
- D4 FAIL: ** Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for an unauthorized 
- E8 FAIL: ** An early patient is pulled in only when the doctor would otherwise idle and no Standby patient fits. dispatchNext returned null

## 3. Defects

| Severity | Total | Open | Fixed | Flaky | Deferred |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 1 | 1 | 0 | 0 | 0 |
| Medium | 2 | 1 | 1 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 | 0 |

Open Critical and High defects:
- [High] Severity:** HIGH (docs/e2e/sa3.md)

Fixed: 1.

## 4. Policy questions that need your decision

These cases only record what the app does today. For each, decide whether that behavior is right.

- B7 (one customer booking overlapping slots): PASS - ** The same customer books overlapping slots: report the current behavior. Same doctor: rejected by exclusion 
- C2 (does a late-cancelled slot reopen?): PASS - ** Does a late-cancelled slot reopen? Late-cancelled slot reopens immediately for new booking without exclusio
- C3 (what happens to the check-in code on reschedule): PASS - ** What happens to the check-in code on reschedule Original check-in code is retained and remains valid for th
- G3 (deposit for a Standby patient who is present and served): PASS - ** Deposit for a Standby patient who is present and served Standby patient served: deposit retained as CAPTURE
- A6 (Consultant on leave with existing bookings): PASS - ** A Consultant marks leave for a day: no new bookings. Report what happens to existing bookings. Consultant m
- J6 (Consultant unavailable mid-day): PASS - ** A Consultant becomes unavailable mid-day: report how the remaining queue is handled Consultant deactivated 

## 5. Key checks

- Worked examples: MET (E1=PASS, E2=PASS)
- Randomized simulation: MET (E15=PASS)
- Money cases: NOT MET (B5=PASS, B6=PASS, C1=PASS, C2=PASS, C3=PASS, C4=PASS, C5=PASS, C6=FAIL, G2=PASS, G3=PASS, G4=PASS)
- Check-in security: NOT MET (D4=FAIL, D5=PASS)
- Non-hospital regression: MET (K1=PASS, K2=PASS)
- Race tests (n/50 lines found): 3 found, 0 below 50
- Per-Consultant access isolation: MET

## 6. Performance

J4 full-day load: PASS - ** Full-Day 250 Patient High-Throughput Load Test Processed 250/250 bookings across 5 consultants & 3 front desks in 1.28s (195.6 

## 7. Coverage and risk

- Workstreams with no result file: none.
- Cases passed by manual check: E12.
- Cases not run: A7, J2, J3.

## 8. Release gate

- NOT MET: Zero open Critical and High defects
- NOT MET: All money cases pass (B5, B6, C1-C6, G2-G4)
- MET: Race tests pass 50 out of 50
- MET: Worked examples and simulation pass (E1, E2, E15)
- NOT MET: Check-in security passes (D4, D5)
- MET: Access isolation tests pass (docs/hospital-test-report.md)
- MET: Non-hospital regression passes (K1, K2)
- UNVERIFIED: Policy questions decided by you

## 9. Next steps

1. Re-run the tests (results are older than the latest commit).
2. Fix the 1 open Critical/High defect(s) listed in section 3.
3. Investigate the 3 failing case(s) in section 2.
4. Run the 3 case(s) that have not run yet.
5. You: decide the policy questions in section 4.
6. Re-run this report: node scripts/e2e-status.mjs

---

# Hospital E2E status - 21 Oct 2026, 12:54 pm IST

## 1. Verdict: NOT READY

Reason: 1 open Critical/High defect(s).
Branch: refactor/arch-cleanup-and-security-hardening, last commit 4501911 "test(e2e): workstream SA2 - booking and payments B1-B9, G1", 7 commit(s) since e2e/base.
Result files read: 11 (manual-script.md, phase2.md, sa1.md, sa2.md, sa3.md, sa4.md, sa5.md, sa6.md, sa7.md, sa8.md, hospital-e2e-report.md).
WARNING: 2 result(s) reuse case ids from another workstream and were ignored (see section 7).
WARNING: the newest result file is older than the latest commit. Re-run the tests before trusting this.

## 2. Scoreboard

Only PASS counts as passed. Blocked, skipped, flaky and not-run cases are not passes.

| Workstream | Planned | PASS | FAIL | BLOCKED | FLAKY | Not run | Pass rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA1 Setup and roles | 9 | 8 | 0 | 0 | 0 | 1 | 89% |
| SA2 Booking and payments | 10 | 10 | 0 | 0 | 0 | 0 | 100% |
| SA3 Cancel, reschedule, money | 9 | 8 | 1 | 0 | 0 | 0 | 89% |
| SA4 Check-in | 8 | 7 | 1 | 0 | 0 | 0 | 88% |
| SA5 Queue integration | 14 | 13 | 1 | 0 | 0 | 0 | 93% |
| SA6 Randomized simulation | 1 | 1 | 0 | 0 | 0 | 0 | 100% |
| SA7 ETA and notifications | 7 | 0 | 0 | 0 | 0 | 7 | 0% |
| SA8 Resilience and regression | 7 | 5 | 0 | 0 | 0 | 2 | 71% |
| P2 Phase 2 (orchestrator) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |
| **Total** | 68 | 55 | 3 | 0 | 0 | 10 | 81% |

Of the passes, 54 are automated and 1 manual.

Problem cases:
- C6 FAIL: ** Cancelling twice, or after check-in or completion, is rejected cancel_booking RPC allows cancelling after check-in; expected re
- D4 FAIL: ** Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for an unauthorized 
- E8 FAIL: ** An early patient is pulled in only when the doctor would otherwise idle and no Standby patient fits. dispatchNext returned null

## 3. Defects

| Severity | Total | Open | Fixed | Flaky | Deferred |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 1 | 1 | 0 | 0 | 0 |
| Medium | 2 | 1 | 1 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 | 0 |

Open Critical and High defects:
- [High] Severity:** HIGH (docs/e2e/sa3.md)

Fixed: 1.

## 4. Policy questions that need your decision

These cases only record what the app does today. For each, decide whether that behavior is right.

- B7 (one customer booking overlapping slots): PASS - ** The same customer books overlapping slots: report the current behavior. Same doctor: rejected by exclusion 
- C2 (does a late-cancelled slot reopen?): PASS - ** Does a late-cancelled slot reopen? Late-cancelled slot reopens immediately for new booking without exclusio
- C3 (what happens to the check-in code on reschedule): PASS - ** What happens to the check-in code on reschedule Original check-in code is retained and remains valid for th
- G3 (deposit for a Standby patient who is present and served): PASS - ** Deposit for a Standby patient who is present and served Standby patient served: deposit retained as CAPTURE
- A6 (Consultant on leave with existing bookings): PASS - ** A Consultant marks leave for a day: no new bookings. Report what happens to existing bookings. Consultant m
- J6 (Consultant unavailable mid-day): PASS - ** A Consultant becomes unavailable mid-day: report how the remaining queue is handled Consultant deactivated 

## 5. Key checks

- Worked examples: MET (E1=PASS, E2=PASS)
- Randomized simulation: MET (E15=PASS)
- Money cases: NOT MET (B5=PASS, B6=PASS, C1=PASS, C2=PASS, C3=PASS, C4=PASS, C5=PASS, C6=FAIL, G2=PASS, G3=PASS, G4=PASS)
- Check-in security: NOT MET (D4=FAIL, D5=PASS)
- Non-hospital regression: MET (K1=PASS, K2=PASS)
- Race tests (n/50 lines found): 3 found, 0 below 50
- Per-Consultant access isolation: MET

## 6. Performance

J4 full-day load: PASS - ** Full-Day 250 Patient High-Throughput Load Test Processed 250/250 bookings across 5 consultants & 3 front desks in 1.28s (195.6 

## 7. Coverage and risk

- Workstreams with no result file: none.
- Cases passed by manual check: E12.
- Cases not run: A7, F1, F2, F3, F4, F5, F6, G5, J2, J3.

Ignored results (the case id belongs to another workstream, so it probably describes a different test):
- sa7.md reports H1, which belongs to SA1
- sa7.md reports H2, which belongs to SA1

## 8. Release gate

- NOT MET: Zero open Critical and High defects
- NOT MET: All money cases pass (B5, B6, C1-C6, G2-G4)
- MET: Race tests pass 50 out of 50
- MET: Worked examples and simulation pass (E1, E2, E15)
- NOT MET: Check-in security passes (D4, D5)
- MET: Access isolation tests pass (docs/hospital-test-report.md)
- MET: Non-hospital regression passes (K1, K2)
- UNVERIFIED: Policy questions decided by you

## 9. Next steps

1. Re-run the tests (results are older than the latest commit).
2. Fix the 1 open Critical/High defect(s) listed in section 3.
3. Investigate the 3 failing case(s) in section 2.
4. Run the 10 case(s) that have not run yet.
5. You: decide the policy questions in section 4.
6. Re-run this report: node scripts/e2e-status.mjs

---

# Hospital E2E status - 21 Oct 2026, 12:13 pm IST

## 1. Verdict: NOT READY

Reason: 2 open Critical/High defect(s).
Branch: refactor/arch-cleanup-and-security-hardening, last commit 244aac1 "test(e2e): workstream SA3 - cancellations, reschedule, money C1-C6 and G2-G4", 4 commit(s) since e2e/base.
Result files read: 11 (manual-script.md, phase2.md, sa1.md, sa2.md, sa3.md, sa4.md, sa5.md, sa6.md, sa7.md, sa8.md, hospital-e2e-report.md).
WARNING: 19 result(s) reuse case ids from another workstream and were ignored (see section 7).
WARNING: the newest result file is older than the latest commit. Re-run the tests before trusting this.

## 2. Scoreboard

Only PASS counts as passed. Blocked, skipped, flaky and not-run cases are not passes.

| Workstream | Planned | PASS | FAIL | BLOCKED | FLAKY | Not run | Pass rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA1 Setup and roles | 9 | 0 | 0 | 0 | 0 | 9 | 0% |
| SA2 Booking and payments | 10 | 0 | 0 | 0 | 0 | 10 | 0% |
| SA3 Cancel, reschedule, money | 9 | 8 | 1 | 0 | 0 | 0 | 89% |
| SA4 Check-in | 8 | 7 | 1 | 0 | 0 | 0 | 88% |
| SA5 Queue integration | 14 | 0 | 0 | 0 | 0 | 14 | 0% |
| SA6 Randomized simulation | 1 | 1 | 0 | 0 | 0 | 0 | 100% |
| SA7 ETA and notifications | 7 | 0 | 0 | 0 | 0 | 7 | 0% |
| SA8 Resilience and regression | 7 | 5 | 0 | 0 | 0 | 2 | 71% |
| P2 Phase 2 (orchestrator) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |
| **Total** | 68 | 24 | 2 | 0 | 0 | 42 | 35% |

Of the passes, 24 are automated and 0 manual.

Problem cases:
- C6 FAIL: ** Cancelling twice, or after check-in or completion, is rejected cancel_booking RPC allows cancelling after check-in; expected re
- D4 FAIL: ** Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for an unauthorized 

## 3. Defects

| Severity | Total | Open | Fixed | Flaky | Deferred |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 2 | 2 | 0 | 0 | 0 |
| Medium | 1 | 0 | 1 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 | 0 |

Open Critical and High defects:
- [High] Severity:** HIGH (docs/e2e/sa3.md)
- [High] DEFECT-D4** [High] verify_checkin_code RPC fails with SQLSTATE 42883: function public.hospital_role(uuid) does not exist (open) (docs/e2e/sa4.md)

Fixed: 1.

## 4. Policy questions that need your decision

These cases only record what the app does today. For each, decide whether that behavior is right.

- B7 (one customer booking overlapping slots): not run yet
- C2 (does a late-cancelled slot reopen?): PASS - ** Does a late-cancelled slot reopen? Late-cancelled slot reopens immediately for new booking without exclusio
- C3 (what happens to the check-in code on reschedule): PASS - ** What happens to the check-in code on reschedule Original check-in code is retained and remains valid for th
- G3 (deposit for a Standby patient who is present and served): PASS - ** Deposit for a Standby patient who is present and served Standby patient served: deposit retained as CAPTURE
- A6 (Consultant on leave with existing bookings): not run yet
- J6 (Consultant unavailable mid-day): PASS - ** A Consultant becomes unavailable mid-day: report how the remaining queue is handled Consultant deactivated 

## 5. Key checks

- Worked examples: UNVERIFIED (E1=not run, E2=not run)
- Randomized simulation: MET (E15=PASS)
- Money cases: NOT MET (B5=not run, B6=not run, C1=PASS, C2=PASS, C3=PASS, C4=PASS, C5=PASS, C6=FAIL, G2=PASS, G3=PASS, G4=PASS)
- Check-in security: NOT MET (D4=FAIL, D5=PASS)
- Non-hospital regression: MET (K1=PASS, K2=PASS)
- Race tests (n/50 lines found): 3 found, 0 below 50
- Per-Consultant access isolation: MET

## 6. Performance

J4 full-day load: PASS - ** Full-Day 250 Patient High-Throughput Load Test Processed 250/250 bookings across 5 consultants & 3 front desks in 1.28s (195.6 

## 7. Coverage and risk

- Workstreams with no result file: none.
- Cases passed by manual check: none.
- Cases not run: A1, A2, A3, A4, A5, A6, A7, H1, H2, B1, B2, B3, B4, B5, B6, B7, B8, B9, G1, E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, F1, F2, F3, F4, F5, F6, G5, J2, J3.

Ignored results (the case id belongs to another workstream, so it probably describes a different test):
- sa1.md reports B1, which belongs to SA2
- sa1.md reports B2, which belongs to SA2
- sa1.md reports B3, which belongs to SA2
- sa1.md reports B4, which belongs to SA2
- sa1.md reports B5, which belongs to SA2
- sa1.md reports B6, which belongs to SA2
- sa2.md reports C1, which belongs to SA3
- sa2.md reports C2, which belongs to SA3
- sa2.md reports C3, which belongs to SA3
- sa2.md reports C4, which belongs to SA3
- sa2.md reports C5, which belongs to SA3
- sa5.md reports F1, which belongs to SA7
- sa5.md reports F2, which belongs to SA7
- sa5.md reports F3, which belongs to SA7
- sa5.md reports F4, which belongs to SA7
- sa5.md reports F5, which belongs to SA7
- sa5.md reports F6, which belongs to SA7
- sa7.md reports H1, which belongs to SA1
- sa7.md reports H2, which belongs to SA1

## 8. Release gate

- NOT MET: Zero open Critical and High defects
- NOT MET: All money cases pass (B5, B6, C1-C6, G2-G4)
- MET: Race tests pass 50 out of 50
- UNVERIFIED: Worked examples and simulation pass (E1, E2, E15)
- NOT MET: Check-in security passes (D4, D5)
- MET: Access isolation tests pass (docs/hospital-test-report.md)
- MET: Non-hospital regression passes (K1, K2)
- UNVERIFIED: Policy questions decided by you

## 9. Next steps

1. Re-run the tests (results are older than the latest commit).
2. Fix the 2 open Critical/High defect(s) listed in section 3.
3. Investigate the 2 failing case(s) in section 2.
4. Run the 42 case(s) that have not run yet.
5. You: decide the policy questions in section 4.
6. Re-run this report: node scripts/e2e-status.mjs

---

# Hospital E2E status - 21 Oct 2026, 8:12 am IST

## 1. Verdict: NOT READY

Reason: run incomplete: 65 not run, 0 blocked.
Branch: refactor/arch-cleanup-and-security-hardening, last commit 0a52206 "feat(e2e): phase 0 shared foundation - tenant factory, virtual test clock, role clients, and smoke test gate", 0 commit(s) since e2e/base.
Result files read: 10 (phase2.md, sa1.md, sa2.md, sa3.md, sa4.md, sa5.md, sa6.md, sa7.md, sa8.md, hospital-e2e-report.md).
WARNING: 35 result(s) reuse case ids from another workstream and were ignored (see section 7).

## 2. Scoreboard

Only PASS counts as passed. Blocked, skipped, flaky and not-run cases are not passes.

| Workstream | Planned | PASS | FAIL | BLOCKED | FLAKY | Not run | Pass rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA1 Setup and roles | 9 | 0 | 0 | 0 | 0 | 9 | 0% |
| SA2 Booking and payments | 10 | 0 | 0 | 0 | 0 | 10 | 0% |
| SA3 Cancel, reschedule, money | 9 | 0 | 0 | 0 | 0 | 9 | 0% |
| SA4 Check-in | 8 | 0 | 0 | 0 | 0 | 8 | 0% |
| SA5 Queue integration | 14 | 0 | 0 | 0 | 0 | 14 | 0% |
| SA6 Randomized simulation | 1 | 0 | 0 | 0 | 0 | 1 | 0% |
| SA7 ETA and notifications | 7 | 0 | 0 | 0 | 0 | 7 | 0% |
| SA8 Resilience and regression | 7 | 0 | 0 | 0 | 0 | 7 | 0% |
| P2 Phase 2 (orchestrator) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |
| **Total** | 68 | 3 | 0 | 0 | 0 | 65 | 4% |

Of the passes, 3 are automated and 0 manual.

## 3. Defects

| Severity | Total | Open | Fixed | Flaky | Deferred |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 0 | 0 |
| Medium | 1 | 0 | 1 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 | 0 |

No open Critical or High defects.

Fixed: 1.

## 4. Policy questions that need your decision

These cases only record what the app does today. For each, decide whether that behavior is right.

- B7 (one customer booking overlapping slots): not run yet
- C2 (does a late-cancelled slot reopen?): not run yet
- C3 (what happens to the check-in code on reschedule): not run yet
- G3 (deposit for a Standby patient who is present and served): not run yet
- A6 (Consultant on leave with existing bookings): not run yet
- J6 (Consultant unavailable mid-day): not run yet

## 5. Key checks

- Worked examples: UNVERIFIED (E1=not run, E2=not run)
- Randomized simulation: UNVERIFIED (E15=not run)
- Money cases: UNVERIFIED (B5=not run, B6=not run, C1=not run, C2=not run, C3=not run, C4=not run, C5=not run, C6=not run, G2=not run, G3=not run, G4=not run)
- Check-in security: UNVERIFIED (D4=not run, D5=not run)
- Non-hospital regression: UNVERIFIED (K1=not run, K2=not run)
- Race tests (n/50 lines found): 3 found, 0 below 50
- Per-Consultant access isolation: MET

## 6. Performance

J4 full-day load: PASS - ** Full-Day 250 Patient High-Throughput Load Test Processed 250/250 bookings across 5 consultants & 3 front desks in 1.28s (195.6 

## 7. Coverage and risk

- Workstreams with no result file: none.
- Cases passed by manual check: none.
- Cases not run: A1, A2, A3, A4, A5, A6, A7, H1, H2, B1, B2, B3, B4, B5, B6, B7, B8, B9, G1, C1, C2, C3, C4, C5, C6, G2, G3, G4, D1, D2, D3, D4, D5, D6, D7, D8, E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, F1, F2, F3, F4, F5, F6, G5, J1, J2, J3, J5, J6, K1, K2.

Ignored results (the case id belongs to another workstream, so it probably describes a different test):
- sa1.md reports B1, which belongs to SA2
- sa1.md reports B2, which belongs to SA2
- sa1.md reports B3, which belongs to SA2
- sa1.md reports B4, which belongs to SA2
- sa1.md reports B5, which belongs to SA2
- sa1.md reports B6, which belongs to SA2
- sa2.md reports C1, which belongs to SA3
- sa2.md reports C2, which belongs to SA3
- sa2.md reports C3, which belongs to SA3
- sa2.md reports C4, which belongs to SA3
- sa2.md reports C5, which belongs to SA3
- sa3.md reports D1, which belongs to SA4
- sa3.md reports D2, which belongs to SA4
- sa3.md reports D5, which belongs to SA4
- sa3.md reports D6, which belongs to SA4
- sa3.md reports D7, which belongs to SA4
- sa4.md reports E1, which belongs to SA5
- sa4.md reports E2, which belongs to SA5
- sa4.md reports E3, which belongs to SA5
- sa4.md reports E4, which belongs to SA5
- sa4.md reports E5, which belongs to SA5
- sa4.md reports E6, which belongs to SA5
- sa5.md reports F1, which belongs to SA7
- sa5.md reports F2, which belongs to SA7
- sa5.md reports F3, which belongs to SA7
- sa5.md reports F4, which belongs to SA7
- sa5.md reports F5, which belongs to SA7
- sa5.md reports F6, which belongs to SA7
- sa6.md reports G1, which belongs to SA2
- sa6.md reports G2, which belongs to SA3
- sa6.md reports G3, which belongs to SA3
- sa6.md reports G4, which belongs to SA3
- sa6.md reports G5, which belongs to SA7
- sa7.md reports H1, which belongs to SA1
- sa7.md reports H2, which belongs to SA1

## 8. Release gate

- MET: Zero open Critical and High defects
- UNVERIFIED: All money cases pass (B5, B6, C1-C6, G2-G4)
- MET: Race tests pass 50 out of 50
- UNVERIFIED: Worked examples and simulation pass (E1, E2, E15)
- UNVERIFIED: Check-in security passes (D4, D5)
- MET: Access isolation tests pass (docs/hospital-test-report.md)
- UNVERIFIED: Non-hospital regression passes (K1, K2)
- UNVERIFIED: Policy questions decided by you

## 9. Next steps

1. Run the 65 case(s) that have not run yet.
2. You: decide the policy questions in section 4.
3. Re-run this report: node scripts/e2e-status.mjs

---

# Hospital E2E status - 21 Oct 2026, 8:08 am IST

## 1. Verdict: NOT READY

Reason: release gate not met: Access isolation tests pass (docs/hospital-test-report.md).
Branch: refactor/arch-cleanup-and-security-hardening, last commit 0a52206 "feat(e2e): phase 0 shared foundation - tenant factory, virtual test clock, role clients, and smoke test gate", 0 commit(s) since e2e/base.
Result files read: 10 (phase2.md, sa1.md, sa2.md, sa3.md, sa4.md, sa5.md, sa6.md, sa7.md, sa8.md, hospital-e2e-report.md).

## 2. Scoreboard

Only PASS counts as passed. Blocked, skipped, flaky and not-run cases are not passes.

| Workstream | Planned | PASS | FAIL | BLOCKED | FLAKY | Not run | Pass rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA1 Setup and roles | 9 | 2 | 0 | 0 | 0 | 7 | 22% |
| SA2 Booking and payments | 10 | 7 | 0 | 0 | 0 | 3 | 70% |
| SA3 Cancel, reschedule, money | 9 | 8 | 0 | 0 | 0 | 1 | 89% |
| SA4 Check-in | 8 | 5 | 0 | 0 | 0 | 3 | 63% |
| SA5 Queue integration | 14 | 6 | 0 | 0 | 0 | 8 | 43% |
| SA6 Randomized simulation | 1 | 0 | 0 | 0 | 0 | 1 | 0% |
| SA7 ETA and notifications | 7 | 7 | 0 | 0 | 0 | 0 | 100% |
| SA8 Resilience and regression | 7 | 0 | 0 | 0 | 0 | 7 | 0% |
| P2 Phase 2 (orchestrator) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |
| **Total** | 68 | 38 | 0 | 0 | 0 | 30 | 56% |

Of the passes, 36 are automated and 2 manual.

## 3. Defects

| Severity | Total | Open | Fixed | Flaky | Deferred |
| --- | --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 0 | 0 |
| Medium | 1 | 0 | 1 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 | 0 |

No open Critical or High defects.

Fixed: 1.

## 4. Policy questions that need your decision

These cases only record what the app does today. For each, decide whether that behavior is right.

- B7 (one customer booking overlapping slots): not run yet
- C2 (does a late-cancelled slot reopen?): PASS - ** Check-in code window enforcement (opens -60m before slot) At 09:00: TOO_EARLY for 11:00 slot. After 75m clo
- C3 (what happens to the check-in code on reschedule): PASS - ** Manual check-in role & doctor assignment verification Assigned doc1 marked present successfully. Unassigned
- G3 (deposit for a Standby patient who is present and served): PASS - ** Consultant own-appointment isolation Dr 0 can see own bookings (1). Querying peer Dr 1 returned strictly 0 
- A6 (Consultant on leave with existing bookings): not run yet
- J6 (Consultant unavailable mid-day): not run yet

## 5. Key checks

- Worked examples: MET (E1=PASS, E2=PASS)
- Randomized simulation: UNVERIFIED (E15=not run)
- Money cases: UNVERIFIED (B5=PASS, B6=PASS, C1=PASS, C2=PASS, C3=PASS, C4=PASS, C5=PASS, C6=not run, G2=PASS, G3=PASS, G4=PASS)
- Check-in security: UNVERIFIED (D4=not run, D5=PASS)
- Non-hospital regression: UNVERIFIED (K1=not run, K2=not run)
- Race tests (n/50 lines found): 3 found, 0 below 50
- Per-Consultant access isolation: NOT MET

## 6. Performance

J4 full-day load: PASS - ** Full-Day 250 Patient High-Throughput Load Test Processed 250/250 bookings across 5 consultants & 3 front desks in 1.28s (195.6 

## 7. Coverage and risk

- Workstreams with no result file: SA1, SA2, SA3, SA4, SA5, SA6, SA7, SA8.
- Cases passed by manual check: C3, C5.
- Cases not run: A1, A2, A3, A4, A5, A6, A7, B7, B8, B9, C6, D3, D4, D8, E7, E8, E9, E10, E11, E12, E13, E14, E15, J1, J2, J3, J5, J6, K1, K2.

## 8. Release gate

- MET: Zero open Critical and High defects
- UNVERIFIED: All money cases pass (B5, B6, C1-C6, G2-G4)
- MET: Race tests pass 50 out of 50
- UNVERIFIED: Worked examples and simulation pass (E1, E2, E15)
- UNVERIFIED: Check-in security passes (D4, D5)
- NOT MET: Access isolation tests pass (docs/hospital-test-report.md)
- UNVERIFIED: Non-hospital regression passes (K1, K2)
- UNVERIFIED: Policy questions decided by you

## 9. Next steps

1. Run the 30 case(s) that have not run yet.
2. You: decide the policy questions in section 4.
3. Re-run this report: node scripts/e2e-status.mjs

---

