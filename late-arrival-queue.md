# Dynamic Late-Arrival Queue & +2 Member Buffer Plan

## Goal
Implement the dynamic queueing and late-arrival buffer system for appointments:
1. When a patient has not arrived at their scheduled appointment slot time, allow the receptionist to move them to the **Late Standby Queue** (freeing up the doctor for on-time arrivals).
2. When the patient physically arrives (via mobile "I've Reached" button or merchant desk check-in), dynamically place them **after 2 member appointments** (+2 buffer rule).
3. Automatically generate and deliver the notification to the patient: *"You will be sent after 2 member appointments (Estimated wait: ~X mins)."* and log it in `notification_logs`.
4. Update the Merchant Dashboard (`/` and `/bookings`) to visually display late queue status, token position, and queue progression.

---

## Tasks
- [x] Task 1: Enhance `apps/merchant-web/src/app/api/bookings/reach/route.ts` to detect late arrival, compute dynamic queue token (`current_ongoing + 2`), update `queue_position` and `estimated_wait_minutes`, and log WhatsApp/SMS notification to `notification_logs`.
- [x] Task 2: Create `apps/merchant-web/src/app/api/bookings/late-queue/route.ts` to support merchant actions:
  - `MOVE_TO_STANDBY`: Moves unarrived patient to standby when scheduled slot starts.
  - `CHECKIN_LATE`: Receptionist checks in a late patient with custom/default 2-appointment buffer.
- [x] Task 3: Update `apps/merchant-web/src/app/bookings/page.tsx` UI:
  - Add "Standby / Not Arrived" action when slot time has passed and patient is not present.
  - Display late queue badges: `⏰ Late Arrival (+2 Buffer: Turn #X)`.
  - Add "Arrive & Queue (+2)" action button and modal showing patient notification preview.
- [x] Task 4: Update `apps/merchant-web/src/app/page.tsx` (live merchant dashboard) to show the standby filter and late-arrival badge in the daily queue.
- [x] Task 5: Verify end-to-end with unit test and browser MCP inspection on `http://localhost:3000/bookings`.

## Done When
- [x] Marking a late patient as arrived calculates `ongoing + 2` position.
- [x] Patient receives notification: *"You will be sent after 2 member appointments"*.
- [x] Record created in `notification_logs`.
- [x] Merchant UI clearly shows patient's late queue position and wait time.
- [x] TypeScript typecheck passes with 0 errors.
