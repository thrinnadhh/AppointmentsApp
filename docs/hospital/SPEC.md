# Hospital vertical specification
## Roles
- Hospital Admin (owner/in-charge): sees everything in their hospital. Only this role can create departments, add or remove Front Desk members and Consultants (max 3 member emails per department), manage each doctor's services (name, fee, duration), and assign Front Desk members to Consultants.
- Front Desk: assigned to one or more Consultants and can act ONLY on those Consultants' appointments and queues: verify check-in codes, mark present manually, mark No Show, admit patients, start and end consultations.
- Consultant: sees and acts only on their own appointments and queue.
- Customer: sees only their own bookings and their own check-in code.
- Department members see only their department's appointments; per-Consultant assignment is an additional gate. Hospital vertical only; other verticals unchanged.
## Names (identical on every screen)
Roles: Hospital Admin, Front Desk, Consultant. Arrival tags: On Time, Early, Late, Expected. Statuses: Booked, Checked In, Waiting, Up Next, In Consultation, Completed, No Show. Queues: Live Queue, Waiting Queue, Standby Queue (late patients).
## Booking and money
- A booking is confirmed by paying a deposit. The hold lasts one value everywhere (code, tests, jobs, gateway order expiry): 5 minutes unless I change it.
- Customer cancels or reschedules free if at least 60 minutes remain before the slot; otherwise the deposit is forfeited. If the business cancels: full refund.
- No Show means the patient never checked in before the doctor's session ended.
  - Strikes 1 & 2: courtesy 100% deposit refund, no monetary penalty.
  - Booking with 2 strikes: prompt note warns customer that a 3rd no-show incurs a ₹60 deduction (₹50 doctor / ₹10 platform / remainder refund).
  - Strikes 3 to 5: ₹50 goes to the doctor, ₹10 to the platform, and the rest (deposit minus 60) is refunded to customer.
  - Exceeding 5 strikes (6th no-show): account is blocked for 7 days (`blocked_until = NOW() + INTERVAL '7 days'`), display 'Your account is blocked for 7 days', and reset the strike counter to 0.
- A patient who checked in but was not reached is NOT a no-show: free reschedule or full refund.
## Check-in
- 4-digit code per confirmed appointment, generated on the server, unique per shop per date, shown to the customer from 60 minutes before the slot until check-in. Staff verify it through a function only and can never read codes. 5 wrong attempts lock that staff user for 60 seconds. Unauthorized, other-shop and invalid codes return the identical error. Manual mark-present exists as a logged fallback.
## Time and queue
- Arrival window is plus or minus 10 minutes of the booked time. The booked time is a ceiling: starting earlier is always allowed when the patient is present and the doctor is free.
- Priority whenever the doctor is free: (1) On Time patients whose window is open, earliest booked first; (2) the Standby Queue in original booking order, only if the consultation (about the 70th percentile estimate) finishes before the next booked patient's time; (3) early patients whose window has not opened, only to avoid idling; (4) otherwise wait.
- A patient is Late if checked in more than 10 minutes after the booked time; Late patients never displace an On Time patient who is present; with no booked patients left the fit check is lifted and Standby is served in order. Nobody is dropped; a consultation in progress is never interrupted.
- Live ETA is recomputed on every check-in, start and end; the customer is notified only when the ETA leaves their window. When the doctor runs early an optional "come now?" invite goes out; declining changes nothing. Staff can manually override a position for medical urgency (Hospital Admin or Consultant), always logged.
- The old "+2 appointments later" late-queue rule is retired.
## Open decisions (do not decide; list the current behavior of the code for each)
Overlapping bookings by one customer with two doctors; Consultant on leave with existing bookings; Consultant unavailable mid-day; check-in code after reschedule; deposit below 60 rupees; push notifications at launch; production domain.

### Current code behavior for open decisions
- **Overlapping bookings by one customer with two doctors**: Currently ALLOWED. The database range exclusion constraint (`no_overlapping_active_bookings`) only prevents overlaps on the same `resource_id` (`resource_id WITH =, tstzrange(slot_start, slot_end) WITH &&`). There is no cross-resource exclusion constraint or check on `customer_id`.
- **Consultant on leave with existing bookings**: Currently, there is no dedicated doctor leave table or automated rescheduling workflow. Deactivating a consultant sets `resources.is_active = false`, but leaves existing bookings in `CONFIRMED` status. They must be manually reassigned via `/api/bookings/reassign` or emergency-cancelled via `/api/doctor/emergency-cancel`.
- **Consultant unavailable mid-day**: When a consultant is marked inactive mid-day, remaining bookings are preserved in `CONFIRMED` status for manual reassignment (verified in test `J6`). Alternatively, the Hospital Admin can trigger `POST /api/doctor/emergency-cancel` which calls `cancel_doctor_emergency` to cancel all remaining appointments from that moment forward with 100% full refund and 0 merchant strike penalties.
- **Check-in code after reschedule**: In `reschedule_booking_slot` RPC (`supabase/migrations/20261022000011_cancellation_cutoff_60m.sql`), only `slot_start`, `slot_end`, and `updated_at` are updated. The original 4-digit `checkin_code` and `checkin_code_hash` generated during initial booking confirmation are retained without regeneration.
- **Deposit below 60 rupees**: Currently, `record_no_show` RPC implements a 3-strike courtesy model (strikes 1-2 get 100% refund, strike 3+ gets 0% refund). The 50 / 10 / rest split is not yet implemented in SQL; deposits under ₹60 are not handled with the new formula.
- **Push notifications at launch**: Push notifications are implemented in Supabase Edge Function `send-booking-notification` via Expo Push API (`https://exp.host/--/api/v2/push/send`). If a real `ExponentPushToken` is present on the profile, it attempts dispatch; otherwise, it records the event in `notification_logs` and falls back gracefully.
- **Production domain**: No custom production domain is hardcoded in the codebase. Mobile release builds enforce an explicit HTTPS endpoint through `EXPO_PUBLIC_API_BASE_URL` (no LAN/cleartext allowed). Web uses `NEXT_PUBLIC_APP_URL` (defaults to `http://localhost:3000` in dev).

## Conflicts with current codebase
1. **No-Show Tiered Policy & 7-Day Account Block**:
   - *Spec*: Strikes 1-2 courtesy refund; strike 3-5 ₹50 doctor / ₹10 platform / remainder refund; >5 strikes (6th) blocks account for 7 days (`blocked_until = NOW() + 7 days`), displays 'Your account is blocked for 7 days', and resets strike counter to 0.
   - *Status*: Being implemented in Phase 7a database migration `20261024000001_no_show_tiered_policy_and_account_block.sql`.
2. **Check-in Code Customer Visibility Window**:
   - *Spec*: "shown to the customer from 60 minutes before the slot until check-in."
   - *Code Conflict*: In the customer mobile app (`BookingPassModal.tsx` and API responses), the check-in code / reference code is accessible immediately upon booking confirmation on the in-app pass, without a 60-minute pre-slot visibility gate.
3. **Legacy Documentation & Code of Retired "+2" Rule**:
   - *Spec*: "The old '+2 appointments later' late-queue rule is retired."
   - *Code Conflict*: While `HospitalDepartmentQueueEngine.ts` implements the new Standby Queue logic, earlier migration comments (`20260925000001_refund_pending_status_and_60m_window.sql`), legacy test scripts (`test-late-queue.mjs`), and older markdown docs still contain references to the retired "+2" rule.
