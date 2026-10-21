# Workstream SA3 Test Report: Cancel, reschedule, money

**Sub-Agent Workstream:** SA3
**Status:** ALL PASS
**Summary:** 9/9 passed (100.0%), 0 failed, 0 blocked
**Execution Time:** 2026-10-21T07:50:12.665Z

## 1. Test Case Execution Results

| Case ID | Scenario | Status | Evidence |
|:---|:---|:---:|:---|
| **C1** | Customer cancellation cutoff policy (>30m refund vs <=30m forfeit) | ✅ PASS | 45m before slot: eligible=true, refund=₹100. 15m before slot: eligible=false, refund=₹0 (FORFEITED). |
| **C2** | Does a late-cancelled slot reopen? | ✅ PASS | Late-cancelled slot reopens immediately for new booking without exclusion constraint lock. |
| **C3** | What happens to the check-in code on reschedule | ✅ PASS | Original check-in code is retained and remains valid for the rescheduled appointment time. |
| **C4** | Rescheduling to another slot/doctor within department | ✅ PASS | Booking successfully reassigned to Dr. 2 within department preserving CAPTURED payment status. |
| **C5** | Race conditions on cancellation and refund across 50 runs (50/50) | ✅ PASS | 50/50 race iterations passed with exactly 1 cancellation winner and 2 serialized rejections. |
| **C6** | cancel_booking and reschedule reject non-cancellable statuses with zero side effects, and concurrent cancels yield exactly one refund | ✅ PASS | Rejected statuses [CHECKED_IN, WAITING, UP_NEXT, IN_CONSULTATION, COMPLETED, NO_SHOW, CANCELLED] with zero refund/forfeit side effects; 2 simultaneous cancels produced exactly 1 refund. |
| **G2** | Standby patient deposit handling (held or charged) | ✅ PASS | Standby patient deposit status preserved as CAPTURED (₹100) without premature forfeiture. |
| **G3** | Deposit for a Standby patient who is present and served | ✅ PASS | Standby patient served: deposit retained as CAPTURED and credited against final consultation fee. |
| **G4** | Refund processing on merchant cancellation / no-show courtesy | ✅ PASS | Merchant cancellation automatically initiates 100% customer refund (REFUND_PENDING). |

## 2. Defects Identified

*No defects identified in this workstream. All assertions passed specification invariants.*
