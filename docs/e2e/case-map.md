# Master Case Map: 68 Planned E2E Cases

| Case ID | Workstream | Scenario | Status | Short Evidence |
|:---|:---|:---|:---:|:---|
| **A1** | SA1 (`sa1.md`) | Admin creates departments: visible on admin and merchant screens. | PASS | Created department 'Radiology-SA1'; verified visible on admin and merchant queries. |
| **A2** | SA1 (`sa1.md`) | Admin adds Consultants and services (name, fee, duration): active services appear to customers, inactive ones do not. | PASS | Active service 'Dr. Active-SA1' (₹150, 20m) displayed; inactive service 'Dr. Inactive-SA1' hidden from customer. |
| **A3** | SA1 (`sa1.md`) | Admin sets each Consultant's weekly schedule and session hours: no booking is possible outside them. | PASS | Consultant session hours configured (09:00-13:00, 16:00-20:00); slot at 02:00 IST validated as strictly outside session. |
| **A4** | SA1 (`sa1.md`) | Admin adds Front Desk members and assigns them to one or more Consultants: effective immediately. | PASS | Front Desk added to department and assigned to Consultant; effective immediately (booking readable via RLS). |
| **A5** | SA1 (`sa1.md`) | A 4th member in a department is rejected (limit 3); two simultaneous adds never exceed 3. | PASS | 4th member rejected by trg_check_department_member_limit; concurrent adds preserved count at exactly 3. |
| **A6** | SA1 (`sa1.md`) | A Consultant marks leave for a day: no new bookings. Report what happens to existing bookings. | PASS | Consultant marked leave for 2026-10-21; existing booking remains CONFIRMED for staff reassignment without data loss. |
| **A7** | SA1 (`sa1.md`) | Real customer mobile app booking lifecycle | NOT RUN | needs device |
| **B1** | SA2 (`sa2.md`) | 7-minute hold countdown & expiry with virtual test clock | PASS | Slot released after 8-min clock advance; re-held by next customer. |
| **B2** | SA2 (`sa2.md`) | Payment initiation extends hold duration | PASS | Hold extended by +5 minutes upon payment session initiation. |
| **B3** | SA2 (`sa2.md`) | Double-booking exclusion constraint across 50 runs with 3 concurrent customers | PASS | 50/50 runs passed. Exactly 1 winner and 2 exclusion conflicts per iteration. |
| **B4** | SA2 (`sa2.md`) | Payment capture transitions HELD to CONFIRMED | PASS | Booking transitioned to CONFIRMED with CAPTURED status upon payment capture. |
| **B5** | SA2 (`sa2.md`) | Customer cancellation refund cutoff policy (>30m vs <=30m) | PASS | >30m cutoff refunded ₹100; <=30m cutoff refunded ₹0. |
| **B6** | SA2 (`sa2.md`) | Merchant cancellation gives 100% refund and increments provider strike | PASS | Refund: ₹110 (100% of ₹110); provider strikes increased from 0 to 2. |
| **B7** | SA2 (`sa2.md`) | The same customer books overlapping slots: report the current behavior. | PASS | Same doctor: rejected by exclusion constraint (code 23P01); different doctors: allowed by current schema (both confirmed). |
| **B8** | SA2 (`sa2.md`) | The last slot of a session, and bookings near midnight IST, behave correctly. | PASS | Last session slot confirmed; midnight IST slot confirmed with strictly positive 15m duration. |
| **B9** | SA2 (`sa2.md`) | A customer sees only their own bookings and their own code. | PASS | Customer 1 retrieved own booking and code; Customer 2 booking strictly filtered by RLS. |
| **C1** | SA3 (`sa3.md`) | Customer cancellation cutoff policy (>30m refund vs <=30m forfeit) | PASS | 45m before slot: eligible=true, refund=₹100. 15m before slot: eligible=false, refund=₹0 (FORFEITED). |
| **C2** | SA3 (`sa3.md`) | Does a late-cancelled slot reopen? | PASS | Late-cancelled slot reopens immediately for new booking without exclusion constraint lock. |
| **C3** | SA3 (`sa3.md`) | What happens to the check-in code on reschedule | PASS | Original check-in code is retained and remains valid for the rescheduled appointment time. |
| **C4** | SA3 (`sa3.md`) | Rescheduling to another slot/doctor within department | PASS | Booking successfully reassigned to Dr. 2 within department preserving CAPTURED payment status. |
| **C5** | SA3 (`sa3.md`) | Race conditions on cancellation and refund across 50 runs (50/50) | PASS | 50/50 race iterations passed with exactly 1 cancellation winner and 2 serialized rejections. |
| **C6** | SA3 (`sa3.md`) | Cancelling twice, or after check-in or completion, is rejected. | FAIL | cancel_booking RPC allows cancelling after check-in; expected rejection but received success=true |
| **D1** | SA4 (`sa4.md`) | On-time protection against late arrivals | PASS | On-time patient P_ON_TIME retained priority over late arrival P_LATE. |
| **D2** | SA4 (`sa4.md`) | Early/On-Time patient enters directly when doctor is free | PASS | Patient arriving at 12:25 for 12:30 slot placed in live queue directly. |
| **D3** | SA4 (`sa4.md`) | Arrival tags: 11 min before = Early; 10 min before = On Time; 10 min after = On Time; 11 min after = Late; not arrived = Expected | PASS | Exact boundary verification: -11m=Early, -10m=On Time, +10m=On Time, +11m=Late, null=Expected. |
| **D4** | SA4 (`sa4.md`) | Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for an unauthorized code. | FAIL | RPC verify_checkin_code failed with SQLSTATE 42883: function public.hospital_role(uuid) does not exist |
| **D5** | SA4 (`sa4.md`) | Standby Queue ordering follows original booking time (FIFO) | PASS | Late A (booked 09:00, arrived 10:10) placed ahead of Late B (booked 09:30, arrived 10:05). |
| **D6** | SA4 (`sa4.md`) | Sliding schedule optimization fills gap before next on-time window | PASS | Late patient slides into 07:30 gap and completes before 07:50 patient window opens. |
| **D7** | SA4 (`sa4.md`) | Doctor idle prevention dispatches standby patient when waiting queue empty | PASS | Standby patient immediately dispatched to prevent doctor idleness. |
| **D8** | SA4 (`sa4.md`) | A patient checks in and then leaves: Front Desk sets No Show and the queue closes the gap. | PASS | Front Desk set NO_SHOW on departed patient; remaining queue immediately moved up closing gap. |
| **E1** | SA5 (`sa5.md`) | Consultant starts consultation moving booking to IN_CONSULTATION | PASS | Booking transitioned from CHECKED_IN to IN_CONSULTATION. |
| **E2** | SA5 (`sa5.md`) | Single active consultation constraint across 50 runs (idx_single_in_consultation_per_doctor) | PASS | 50/50 runs passed. Doctor strictly prohibited from having >1 concurrent IN_CONSULTATION. |
| **E3** | SA5 (`sa5.md`) | End consultation moving booking to COMPLETED | PASS | Booking transitioned to COMPLETED status upon consultation finish. |
| **E4** | SA5 (`sa5.md`) | Front Desk admits patient to queue | PASS | Booking admitted successfully by assigned Front Desk staff. |
| **E5** | SA5 (`sa5.md`) | Illegal status transitions rejected by state machine | PASS | Server rejected illegal restart of COMPLETED booking. |
| **E6** | SA5 (`sa5.md`) | Optimistic locking with expected_version check | PASS | Concurrent start requests resolved with statuses [200, 409]. Stale writer rejected. |
| **E7** | SA5 (`sa5.md`) | The doctor is idle only when nobody eligible is present. | PASS | Doctor remained idle when queues were empty and immediately consulted eligible standby patient upon arrival. |
| **E8** | SA5 (`sa5.md`) | An early patient is pulled in only when the doctor would otherwise idle and no Standby patient fits. | FAIL | dispatchNext returned null instead of pulling in early patient when doctor would otherwise idle and no standby patient fits |
| **E9** | SA5 (`sa5.md`) | End of day: when no booked patients remain, the fit check is lifted and Standby patients are served in order; nobody is dropped. | PASS | Fit check lifted at end of day; all 3 standby patients served in booking order with 0 dropped. |
| **E10** | SA5 (`sa5.md`) | Two Consultants have independent queues. One Front Desk assigned to both works both without cross-effects. | PASS | Front desk accessed both queues; mutation on Doctor A queue caused zero cross-effects on Doctor B queue. |
| **E11** | SA5 (`sa5.md`) | Each Consultant has at most one In Consultation at any time. Start and End durations are never negative or missing. | PASS | Verified duration is valid positive (15m) and single-active invariant held. |
| **E12** | SA5 (`sa5.md`) | Manual override by Admin or Consultant moves a patient up, is audit logged, and leaves a consistent order. | PASS | Patient moved to position 1, other positions shifted consistently (1, 2, 3), and QUEUE_OVERRIDE audit log verified. |
| **E13** | SA5 (`sa5.md`) | Illegal status jumps are rejected for every role. | PASS | CONFIRMED->COMPLETED, customer status manipulation, and CANCELLED->CHECKED_IN all rejected across roles. |
| **E14** | SA5 (`sa5.md`) | A 30-minute overrun pushes later ETAs but never reorders on-time patients behind late ones. | PASS | Doctor overrun by 30m delayed start time but on-time patient was dispatched ahead of standby late patient. |
| **E15** | SA6 (`sa6.md`) | Randomized simulation: at least 1,000 random days against the real dispatcher logic. Assert: one consultation at a time per doctor; no present on-time patient overtaken by a Standby patient; Standby order equals booking order; every checked-in patient is eventually served; no doctor idle while an eligible patient is present (except fit-check waits). Print the seed of any failing day. | PASS | 1000/1000 days passed. Assertions verified: 1 consultation at a time per doctor; no present on-time patient overtaken; Standby FIFO booking order preserved; all checked-in patients served; zero illegal doctor idleness. |
| **F1** | SA7 (`sa7.md`) | Customer cancellation cutoff policy (>30m refund vs <=30m forfeit) | PASS | 45m before slot: eligible=true, refund=₹100. 15m before slot: eligible=false, refund=₹0 (FORFEITED). |
| **F2** | SA7 (`sa7.md`) | Merchant emergency cancellation full refund & customer notification | PASS | Refund ₹111.80 issued to customer. Notification log created with event MERCHANT_CANCELLED. |
| **F3** | SA7 (`sa7.md`) | Merchant strike progression (Grace Period for Strikes 1 & 2) | PASS | Strikes incremented 1 -> 2 with zero penalty applied. Penalty balance remains ₹0.00. |
| **F4** | SA7 (`sa7.md`) | Merchant Strike 3 penalty debit (₹100) | PASS | Strike 3 reached. ₹100 penalty debited to hospital penalty_balance. |
| **F5** | SA7 (`sa7.md`) | Last-minute merchant cancellation (<=30m) 2x strike penalty | PASS | Cancellation within 15 minutes added 2 strikes immediately. |
| **F6** | SA7 (`sa7.md`) | Strike 5 booking freeze & cancellation idempotency | PASS | At strike 5, hospital is_booking_frozen=true. Duplicate cancellation rejected with error. |
| **G1** | SA2 (`sa2.md`) | Hospital Admin cross-department visibility | PASS | Admin retrieved all 63 bookings across all hospital departments. |
| **G2** | SA3 (`sa3.md`) | Standby patient deposit handling (held or charged) | PASS | Standby patient deposit status preserved as CAPTURED (₹100) without premature forfeiture. |
| **G3** | SA3 (`sa3.md`) | Deposit for a Standby patient who is present and served | PASS | Standby patient served: deposit retained as CAPTURED and credited against final consultation fee. |
| **G4** | SA3 (`sa3.md`) | Refund processing on merchant cancellation / no-show courtesy | PASS | Merchant cancellation automatically initiates 100% customer refund (REFUND_PENDING). |
| **G5** | SA7 (`sa7.md`) | Audit logging on doctor-front desk assignment changes | PASS | Audit log recorded action=ASSIGNMENT_CREATED for user to assigned doctor. |
| **H1** | SA1 (`sa1.md`) | Department creation with module configuration | PASS | Created custom department 'Cardiology-H1-SA1' with modules [appointments, queue_schedule, check_in]. |
| **H2** | SA1 (`sa1.md`) | Member invite and acceptance lifecycle | PASS | Member invited (expires in 7 days); member accepted -> status changed to active. |
| **I1** | P2 (`phase2.md`) | Admin Dashboards data reconciliation | PASS | Reconciled: 989 completed bookings, 13 active Tirupati providers across categories, audit logs intact. |
| **I2** | P2 (`phase2.md`) | Multi-City addition & data isolation | PASS | Added city 'kurnool'. Tirupati hospital data and tenant isolation verified 100% untouched. |
| **J1** | SA8 (`sa8.md`) | Network drop mid-booking and mid-check-in: no half-created records; retry is safe. | PASS | Network drop simulated mid-booking and mid-checkin; 0 orphan records; safe retry succeeded idempotently. |
| **J2** | SA8 (`sa8.md`) | Network drop / app backgrounding mid-payment recovery | NOT RUN | needs device |
| **J3** | SA8 (`sa8.md`) | Reception QR / check-in code scanner & attendance display | NOT RUN | needs device |
| **J4** | P2 (`phase2.md`) | Full-Day 250 Patient High-Throughput Load Test | PASS | Processed 250/250 bookings across 5 consultants & 3 front desks in 1.28s (195.6 ops/sec). Latency: p50=11ms, p95=38ms. 0 errors. |
| **J5** | SA8 (`sa8.md`) | Midnight rollover and sessions near the end of the day behave correctly in IST. | PASS | Clock advanced past 23:59:59 IST into next calendar day; active sessions remained intact; zero negative durations. |
| **J6** | SA8 (`sa8.md`) | A Consultant becomes unavailable mid-day: report how the remaining queue is handled. | PASS | Consultant deactivated mid-day; remaining 4 queued bookings safely preserved in CONFIRMED for staff reassignment. |
| **K1** | SA8 (`sa8.md`) | Salon, vet care, turf/gaming and dining bookings still work end to end. | PASS | Verified booking, payment hold, confirmation, and schedule retrieval across all 4 non-hospital verticals. |
| **K2** | SA8 (`sa8.md`) | Deposit and refund flows for non-hospital bookings are unchanged. | PASS | Salon deposit and 100% cancellation refund policy verified unchanged by hospital migrations. |

## Summary of Planned Cases (68 Total)
- **PASS:** 62
- **FAIL:** 3 (C6, D4, E8)
- **BLOCKED:** 0
- **FLAKY:** 0
- **NOT RUN:** 3 (A7, J2, J3 — all "needs device")
