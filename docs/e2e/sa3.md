# Workstream SA3 Test Report: Cancel, reschedule, money

**Sub-Agent Workstream:** SA3
**Status:** 1 FAILING CASE(S)
**Summary:** 8/9 passed (88.9%), 1 failed, 0 blocked
**Execution Time:** 2026-10-21T06:40:53.874Z

## 1. Test Case Execution Results

| Case ID | Scenario | Status | Evidence |
|:---|:---|:---:|:---|
| **C1** | Customer cancellation cutoff policy (>30m refund vs <=30m forfeit) | ✅ PASS | 45m before slot: eligible=true, refund=₹100. 15m before slot: eligible=false, refund=₹0 (FORFEITED). |
| **C2** | Does a late-cancelled slot reopen? | ✅ PASS | Late-cancelled slot reopens immediately for new booking without exclusion constraint lock. |
| **C3** | What happens to the check-in code on reschedule | ✅ PASS | Original check-in code is retained and remains valid for the rescheduled appointment time. |
| **C4** | Rescheduling to another slot/doctor within department | ✅ PASS | Booking successfully reassigned to Dr. 2 within department preserving CAPTURED payment status. |
| **C5** | Race conditions on cancellation and refund across 50 runs (50/50) | ✅ PASS | 50/50 race iterations passed with exactly 1 cancellation winner and 2 serialized rejections. |
| **C6** | Cancelling twice, or after check-in or completion, is rejected | ❌ FAIL | cancel_booking RPC allows cancelling after check-in; expected rejection but received success=true |
| **G2** | Standby patient deposit handling (held or charged) | ✅ PASS | Standby patient deposit status preserved as CAPTURED (₹100) without premature forfeiture. |
| **G3** | Deposit for a Standby patient who is present and served | ✅ PASS | Standby patient served: deposit retained as CAPTURED and credited against final consultation fee. |
| **G4** | Refund processing on merchant cancellation / no-show courtesy | ✅ PASS | Merchant cancellation automatically initiates 100% customer refund (REFUND_PENDING). |

## 2. Defects Identified

### [HIGH] DEFECT-C6: cancel_booking RPC allows cancelling appointments with status CHECKED_IN or COMPLETED

- **Severity:** HIGH
- **Suspected File / Function:** `supabase/migrations/20261019000015_test_tenant_clocks.sql`
- **Exact Reproduction Steps:**
  1. Create booking with status CHECKED_IN
  2. Call public.cancel_booking(booking_id)
  3. Observe that booking transitions to CANCELLED and initiates deposit refund instead of rejecting with error
- **Suggested Minimal Fix:**
  Add guard check: IF v_booking.status IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED') THEN RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel booking in status ' || v_booking.status); END IF;

---

