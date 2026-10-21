# Workstream SA5 Test Report: Queue integration

**Sub-Agent Workstream:** SA5
**Status:** 1 FAILING CASE(S)
**Summary:** 13/14 passed (92.9%), 1 failed, 0 blocked
**Execution Time:** 2026-10-21T07:01:19.403Z

## 1. Test Case Execution Results

| Case ID | Scenario | Status | Evidence |
|:---|:---|:---:|:---|
| **E1** | Consultant starts consultation moving booking to IN_CONSULTATION | ✅ PASS | Booking fa3dd6cc-c1b6-4bb0-8374-a51a4a9cd008 transitioned from CHECKED_IN to IN_CONSULTATION. |
| **E2** | Single active consultation constraint across 50 runs (idx_single_in_consultation_per_doctor) | ✅ PASS | 50/50 runs passed. Doctor strictly prohibited from having >1 concurrent IN_CONSULTATION. |
| **E3** | End consultation moving booking to COMPLETED | ✅ PASS | Booking 44f28e5a-b2b3-47b4-acd2-1f8e9687ca58 transitioned to COMPLETED status. |
| **E4** | Front Desk admits patient to queue | ✅ PASS | Booking 5f730bad-f519-4a79-99df-21489788fb5c admitted successfully by assigned Front Desk. |
| **E5** | Illegal status transitions rejected by state machine | ✅ PASS | Server rejected illegal restart of COMPLETED booking. |
| **E6** | Optimistic locking with expected_version check | ✅ PASS | Concurrent start requests resolved with statuses [200, 409]. Stale writer rejected. |
| **E7** | The doctor is idle only when nobody eligible is present. | ✅ PASS | Doctor remained idle when queues were empty and immediately consulted eligible standby patient upon arrival. |
| **E8** | An early patient is pulled in only when the doctor would otherwise idle and no Standby patient fits. | ❌ FAIL | dispatchNext returned null instead of pulling in early patient when doctor would otherwise idle and no standby patient fits |
| **E9** | End of day: when no booked patients remain, the fit check is lifted and Standby patients are served in order; nobody is dropped. | ✅ PASS | Fit check lifted at end of day; all 3 standby patients served in booking order [SB_1, SB_2, SB_3] with 0 dropped. |
| **E10** | Two Consultants have independent queues. One Front Desk assigned to both works both without cross-effects. | ✅ PASS | Front desk accessed both queues; mutation on Doctor A queue caused zero cross-effects on Doctor B queue. |
| **E11** | Each Consultant has at most one In Consultation at any time. Start and End durations are never negative or missing. | ✅ PASS | Verified duration is valid positive (15m, start=2026-10-20T03:40:00+00:00, end=2026-10-20T03:55:00+00:00) and single-active invariant held. |
| **E12** | Manual override by Admin or Consultant moves a patient up, is audit logged, and leaves a consistent order. | ✅ PASS | Patient moved to position 1, other positions shifted consistently (1, 2, 3), and QUEUE_OVERRIDE audit log verified. |
| **E13** | Illegal status jumps are rejected for every role. | ✅ PASS | CONFIRMED->COMPLETED, customer status manipulation, and CANCELLED->CHECKED_IN all rejected across roles. |
| **E14** | A 30-minute overrun pushes later ETAs but never reorders on-time patients behind late ones. | ✅ PASS | Doctor overrun by 30m delayed start time but on-time patient was dispatched ahead of standby late patient. |

## 2. Defects Identified

### [MEDIUM] DEFECT-E8: HospitalDepartmentQueueEngine.dispatchNext returns null instead of pulling in early patient when doctor would otherwise idle and no standby patient fits

- **Severity:** MEDIUM
- **Suspected File / Function:** `tests/unit/hospital-queue-engine.test.mjs`
- **Exact Reproduction Steps:**
  1. 1. Doctor is free at 07:30.
2. Patient A booked for 07:50 arrives at 07:25 (early).
3. Standby patient has duration 25m and does not fit gap before 07:40 window.
4. Call dispatchNext("07:30").
5. Observe dispatchNext returns null instead of pulling in early patient.
- **Suggested Minimal Fix:**
  In dispatchNext, if no standby patient fits the gap and waitingQueue[0] is present, return waitingQueue[0] to prevent doctor idleness.

---

