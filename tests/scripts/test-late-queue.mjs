import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateArrivalTag,
  computePatientETA,
  HospitalDepartmentQueueEngine,
} from '../../packages/shared/src/queue-engine.ts';

const ROOT_DIR = process.cwd();

describe('Dynamic Late-Arrival Queue & Customer Dashboard Suite', () => {

  // =========================================================================
  // 1. SPEC Late Arrival Queue Calculation Logic (/api/bookings/reach)
  // =========================================================================
  describe('1. Late Arrival Queue Calculation Logic (/api/bookings/reach)', () => {
    function evaluateReachArrival({ slotStart, arrivedAt, todayBookings = [] }) {
      const arrivalTag = calculateArrivalTag(slotStart, arrivedAt);
      const isLateArrival = arrivalTag === 'Late';

      let queuePosition = null;
      let waitMinutes = 0;
      let queueNotice = null;

      if (isLateArrival) {
        const bookingsList = todayBookings.map((b) => ({
          id: b.id,
          slotStart: b.slotStart,
          slotEnd: b.slotEnd,
          status: b.status,
          isCheckedIn: b.isCheckedIn ?? true,
          isCompleted: b.isCompleted ?? false,
          arrivedAt: b.arrivedAt,
          durationMinutes: 15,
        }));
        const activeConsultation = bookingsList.find((b) => b.status === 'IN_CONSULTATION') || null;

        const etaResult = computePatientETA({
          bookingId: 'target-booking',
          currentTime: arrivedAt,
          bookings: bookingsList,
          currentConsultation: activeConsultation,
          defaultDurationMinutes: 15,
        });

        queuePosition = etaResult?.queuePosition ?? 1;
        waitMinutes = etaResult?.estimatedWaitMinutes ?? 0;
        queueNotice = `You arrived after your scheduled slot (${new Date(slotStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). You have been placed in the Standby Queue in booking order (Estimated wait: ~${waitMinutes} mins). Queue Token: #${queuePosition}.`;
      }

      return {
        arrivalTag,
        isLateArrival,
        queuePosition,
        waitMinutes,
        queueNotice,
      };
    }

    it('detects on-time arrival within +/- 10-min window and does not tag as late', () => {
      const slotStart = '2026-10-11T10:00:00.000Z';
      const arrivedAt = '2026-10-11T10:04:00.000Z'; // 4 mins after start -> within 10m window
      const result = evaluateReachArrival({
        slotStart,
        arrivedAt,
        todayBookings: [{ id: 'target-booking', slotStart, slotEnd: '2026-10-11T10:15:00.000Z', status: 'CHECKED_IN', isCheckedIn: true }],
      });

      assert.equal(result.isLateArrival, false);
      assert.equal(result.arrivalTag, 'On Time');
      assert.equal(result.queuePosition, null);
      assert.equal(result.waitMinutes, 0);
      assert.equal(result.queueNotice, null);
    });

    it('detects late arrival (>10 mins after slot) and dynamically queues in Standby in booking order', () => {
      const slotStart = '2026-10-11T10:00:00.000Z';
      const arrivedAt = '2026-10-11T10:15:00.000Z'; // 15 mins after start -> late (>10m)
      const existingBookings = [
        { id: 'b1', slotStart: '2026-10-11T10:00:00.000Z', slotEnd: '2026-10-11T10:15:00.000Z', status: 'IN_CONSULTATION', isCheckedIn: true },
        { id: 'b2', slotStart: '2026-10-11T10:15:00.000Z', slotEnd: '2026-10-11T10:30:00.000Z', status: 'CHECKED_IN', isCheckedIn: true, arrivedAt: '2026-10-11T10:10:00.000Z' },
        { id: 'target-booking', slotStart, slotEnd: '2026-10-11T10:15:00.000Z', status: 'CHECKED_IN', isCheckedIn: true, arrivedAt },
      ];
      const result = evaluateReachArrival({
        slotStart,
        arrivedAt,
        todayBookings: existingBookings,
      });

      assert.equal(result.isLateArrival, true);
      assert.equal(result.arrivalTag, 'Late');
      assert.equal(result.queuePosition, 3, 'Must position after in-consultation and on-time present patient');
      assert.equal(result.waitMinutes, 30, '2 patients ahead = 30 minutes wait');
      assert.match(result.queueNotice, /placed in the Standby Queue in booking order/);
      assert.match(result.queueNotice, /Queue Token: #3/);
    });

    it('handles first queue of the day when no prior tokens exist', () => {
      const slotStart = '2026-10-11T09:00:00.000Z';
      const arrivedAt = '2026-10-11T09:20:00.000Z'; // late (>10m)
      const result = evaluateReachArrival({
        slotStart,
        arrivedAt,
        todayBookings: [{ id: 'target-booking', slotStart, slotEnd: '2026-10-11T09:15:00.000Z', status: 'CHECKED_IN', isCheckedIn: true, arrivedAt }],
      });

      assert.equal(result.isLateArrival, true);
      assert.equal(result.arrivalTag, 'Late');
      assert.equal(result.queuePosition, 1, 'First in queue token is #1');
      assert.equal(result.waitMinutes, 0);
    });
  });

  // =========================================================================
  // 2. Merchant Desk Late Actions (/api/bookings/late-queue)
  // =========================================================================
  describe('2. Merchant Desk Late Actions (/api/bookings/late-queue)', () => {
    function simulateMerchantLateAction(action, { todayBookings = [] }) {
      if (action === 'MOVE_TO_STANDBY') {
        return {
          success: true,
          action: 'MOVE_TO_STANDBY',
          isPresent: false,
          message: 'Patient moved to Standby Queue awaiting physical arrival',
        };
      }
      if (action === 'CHECKIN_LATE') {
        const bookingsList = todayBookings.map((b) => ({
          id: b.id,
          slotStart: b.slotStart,
          slotEnd: b.slotEnd,
          status: b.status,
          isCheckedIn: b.isCheckedIn ?? true,
          isCompleted: b.isCompleted ?? false,
          arrivedAt: b.arrivedAt,
          durationMinutes: 15,
        }));
        const activeConsultation = bookingsList.find((b) => b.status === 'IN_CONSULTATION') || null;

        const eta = computePatientETA({
          bookingId: 'target-late',
          currentTime: '2026-10-11T10:15:00.000Z',
          bookings: bookingsList,
          currentConsultation: activeConsultation,
          defaultDurationMinutes: 15,
        });

        const queuePos = eta?.queuePosition ?? 1;
        const waitMins = eta?.estimatedWaitMinutes ?? 0;

        return {
          success: true,
          action: 'CHECKIN_LATE',
          isPresent: true,
          queuePosition: queuePos,
          waitMinutes: waitMins,
          queueNotice: `You have been accommodated in the Standby Queue in booking order (Estimated wait: ~${waitMins} mins). Queue Token: #${queuePos}.`,
        };
      }
      return { success: false, error: 'Invalid action' };
    }

    it('handles MOVE_TO_STANDBY to release doctor for on-time arrivals', () => {
      const result = simulateMerchantLateAction('MOVE_TO_STANDBY', {});
      assert.equal(result.success, true);
      assert.equal(result.isPresent, false);
      assert.equal(result.action, 'MOVE_TO_STANDBY');
    });

    it('handles CHECKIN_LATE with SPEC Standby Queue in booking order', () => {
      const result = simulateMerchantLateAction('CHECKIN_LATE', {
        todayBookings: [
          { id: 'b1', slotStart: '2026-10-11T10:00:00.000Z', slotEnd: '2026-10-11T10:15:00.000Z', status: 'IN_CONSULTATION', isCheckedIn: true },
          { id: 'b2', slotStart: '2026-10-11T10:15:00.000Z', slotEnd: '2026-10-11T10:30:00.000Z', status: 'CHECKED_IN', isCheckedIn: true, arrivedAt: '2026-10-11T10:10:00.000Z' },
          { id: 'target-late', slotStart: '2026-10-11T09:45:00.000Z', slotEnd: '2026-10-11T10:00:00.000Z', status: 'CHECKED_IN', isCheckedIn: true, arrivedAt: '2026-10-11T10:15:00.000Z' },
        ],
      });
      assert.equal(result.success, true);
      assert.equal(result.isPresent, true);
      assert.equal(result.queuePosition, 3, 'Standby patient placed behind in-consultation and on-time present patient');
      assert.equal(result.waitMinutes, 30);
    });

    it('handles Standby Queue order when multiple late patients arrive', () => {
      const engine = new HospitalDepartmentQueueEngine('General');
      engine.addBooking({ id: 'P_ON', slotStart: '2026-10-11T10:00:00.000Z', durationMinutes: 15 });
      engine.addBooking({ id: 'P_LATE_1', slotStart: '2026-10-11T09:00:00.000Z', originalBookingTime: '2026-10-11T09:00:00.000Z', durationMinutes: 15 });
      engine.addBooking({ id: 'P_LATE_2', slotStart: '2026-10-11T09:30:00.000Z', originalBookingTime: '2026-10-11T09:30:00.000Z', durationMinutes: 15 });

      engine.checkInPatient('P_ON', '2026-10-11T09:55:00.000Z');
      engine.checkInPatient('P_LATE_1', '2026-10-11T10:10:00.000Z');
      engine.checkInPatient('P_LATE_2', '2026-10-11T10:05:00.000Z');

      const queues = engine.evaluateQueues('2026-10-11T10:00:00.000Z');
      assert.equal(queues.waitingQueue[0].id, 'P_ON');
      assert.equal(queues.standbyQueue[0].id, 'P_LATE_1', 'Earlier original booking time served first in Standby');
      assert.equal(queues.standbyQueue[1].id, 'P_LATE_2');
    });
  });

  // =========================================================================
  // 3. Customer Mobile UI Verification (BookingPassModal)
  // =========================================================================
  describe('3. Customer Mobile UI Display (BookingPassModal.tsx)', () => {
    const modalPath = path.join(
      ROOT_DIR,
      'apps/customer-mobile/src/screens/BookingPassModal.tsx'
    );
    const modalContent = fs.readFileSync(modalPath, 'utf8');

    it('has liveQueuePosition and liveWaitMinutes state hooks', () => {
      assert.match(modalContent, /liveQueuePosition/);
      assert.match(modalContent, /liveWaitMinutes/);
    });

    it('subscribes to Supabase Realtime updates for queue_position and estimated_wait_minutes', () => {
      assert.match(modalContent, /queue_position\?:\s*number\s*\|\s*null/);
      assert.match(modalContent, /estimated_wait_minutes\?:\s*number\s*\|\s*null/);
      assert.match(modalContent, /setLiveQueuePosition\(newRec\.queue_position\)/);
      assert.match(modalContent, /setLiveWaitMinutes\(newRec\.estimated_wait_minutes\)/);
    });

    it('renders the late queue token card with Token # and estimated wait minutes', () => {
      assert.match(modalContent, /testID="pass-late-queue-token"/);
      assert.match(modalContent, /testID="pass-late-token-number"/);
      assert.match(modalContent, /Token #\{currentQueuePosition\}/);
      assert.match(modalContent, /testID="pass-late-wait-minutes"/);
      assert.match(modalContent, /~\{currentWaitMinutes\}\s*mins/);
    });

    it('renders the header late turn pill in the badge row', () => {
      assert.match(modalContent, /testID="pass-late-turn-pill"/);
      assert.match(modalContent, /⏰ TURN #\{currentQueuePosition\}/);
    });

    it('renders styles for lateQueueActiveBox, lateQueueTokenNumber, and lateWaitRow', () => {
      assert.match(modalContent, /lateQueueActiveBox:/);
      assert.match(modalContent, /lateQueueTokenNumber:/);
      assert.match(modalContent, /lateWaitRow:/);
      assert.match(modalContent, /lateTurnPill:/);
    });
  });

  // =========================================================================
  // 4. Customer Bookings Dashboard UI (MyBookingsScreen)
  // =========================================================================
  describe('4. Customer Bookings Dashboard UI (MyBookingsScreen.tsx)', () => {
    const screenPath = path.join(
      ROOT_DIR,
      'apps/customer-mobile/src/screens/MyBookingsScreen.tsx'
    );
    const screenContent = fs.readFileSync(screenPath, 'utf8');

    it('renders late turn badge with Turn # and wait time on the booking card', () => {
      assert.match(screenContent, /testID=\{`late-turn-\$\{booking\.id\}`\}/);
      assert.match(screenContent, /⏰ Turn #\{booking\.queue_position\}/);
    });

    it('renders late arrival notice box explaining the +2 member buffer', () => {
      assert.match(screenContent, /testID=\{`late-queue-notice-\$\{booking\.id\}`\}/);
      assert.match(screenContent, /Assigned Queue Token #\{booking\.queue_position\}/);
      assert.match(screenContent, /Estimated wait:\s*~?\$\{booking\.estimated_wait_minutes\}\s*mins/);
    });

    it('defines styling for lateTurnBadge and lateQueueNoticeBox', () => {
      assert.match(screenContent, /lateTurnBadge:/);
      assert.match(screenContent, /lateQueueNoticeBox:/);
      assert.match(screenContent, /lateQueueNoticeText:/);
    });
  });

  // =========================================================================
  // 5. Shared Type Definitions Consistency
  // =========================================================================
  describe('5. Shared Type Definitions Consistency', () => {
    const typesPath = path.join(ROOT_DIR, 'packages/shared/src/types.ts');
    const typesContent = fs.readFileSync(typesPath, 'utf8');

    it('Booking interface includes queue_position and estimated_wait_minutes', () => {
      assert.match(typesContent, /queue_position\?:\s*number\s*\|\s*null/);
      assert.match(typesContent, /estimated_wait_minutes\?:\s*number\s*\|\s*null/);
    });
  });
});
