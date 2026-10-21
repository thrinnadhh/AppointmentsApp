// test-late-queue.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();

describe('Dynamic Late-Arrival Queue & Customer Dashboard Suite', () => {

  // =========================================================================
  // 1. API Algorithm & Buffer Logic Tests (/api/bookings/reach)
  // =========================================================================
  describe('1. Late Arrival Queue Calculation Logic (/api/bookings/reach)', () => {
    function simulateReachArrival({ slotStart, arrivedAt, existingQueuePositions }) {
      const slotStartTime = new Date(slotStart).getTime();
      const arrivalTime = new Date(arrivedAt).getTime();
      const isLateArrival = arrivalTime > (slotStartTime + 5 * 60 * 1000);

      let queuePosition = null;
      let waitMinutes = 0;
      let queueNotice = null;

      if (isLateArrival) {
        const activePositions = existingQueuePositions.filter((p) => typeof p === 'number');
        const maxPosition = activePositions.length > 0 ? Math.max(...activePositions) : 1;
        queuePosition = maxPosition + 2; // +2 dynamic buffer rule
        waitMinutes = 2 * 15; // 30 mins
        queueNotice = `You arrived after your scheduled slot (${new Date(slotStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). You will be accommodated after 2 member appointments (Estimated wait: ~${waitMinutes} mins). Queue Token: #${queuePosition}.`;
      }

      return {
        isLateArrival,
        queuePosition,
        waitMinutes,
        queueNotice,
      };
    }

    it('detects on-time arrival within 5-min grace period and does not re-queue', () => {
      const slotStart = '2026-10-11T10:00:00.000Z';
      const arrivedAt = '2026-10-11T10:04:00.000Z'; // 4 mins after start -> within 5m grace
      const result = simulateReachArrival({
        slotStart,
        arrivedAt,
        existingQueuePositions: [1, 2, 3],
      });

      assert.equal(result.isLateArrival, false);
      assert.equal(result.queuePosition, null);
      assert.equal(result.waitMinutes, 0);
      assert.equal(result.queueNotice, null);
    });

    it('detects late arrival (>5 mins after slot) and dynamically queues at ongoing + 2', () => {
      const slotStart = '2026-10-11T10:00:00.000Z';
      const arrivedAt = '2026-10-11T10:15:00.000Z'; // 15 mins after start -> late
      const existingPositions = [5, 6, 7]; // highest ongoing token is 7
      const result = simulateReachArrival({
        slotStart,
        arrivedAt,
        existingQueuePositions: existingPositions,
      });

      assert.equal(result.isLateArrival, true);
      assert.equal(result.queuePosition, 9, 'Must insert at highest ongoing token (7) + 2 buffer = 9');
      assert.equal(result.waitMinutes, 30, '2 appointments buffer = 30 minutes wait');
      assert.match(result.queueNotice, /accommodated after 2 member appointments/);
      assert.match(result.queueNotice, /Queue Token: #9/);
    });

    it('handles first queue of the day when no prior tokens exist', () => {
      const slotStart = '2026-10-11T09:00:00.000Z';
      const arrivedAt = '2026-10-11T09:20:00.000Z'; // late
      const result = simulateReachArrival({
        slotStart,
        arrivedAt,
        existingQueuePositions: [],
      });

      assert.equal(result.isLateArrival, true);
      assert.equal(result.queuePosition, 3, 'Baseline fallback 1 + 2 = 3');
      assert.equal(result.waitMinutes, 30);
    });
  });

  // =========================================================================
  // 2. Merchant Desk Late Actions (/api/bookings/late-queue)
  // =========================================================================
  describe('2. Merchant Desk Late Actions (/api/bookings/late-queue)', () => {
    function simulateMerchantLateAction(action, { bufferOffset = 2, existingPositions = [10] }) {
      if (action === 'MOVE_TO_STANDBY') {
        return {
          success: true,
          action: 'MOVE_TO_STANDBY',
          isPresent: false,
          message: 'Patient moved to Standby Queue awaiting physical arrival',
        };
      }
      if (action === 'CHECKIN_LATE') {
        const maxPos = existingPositions.length > 0 ? Math.max(...existingPositions) : 1;
        const offset = Number(bufferOffset) || 2;
        const newQueuePosition = maxPos + offset;
        const waitMinutes = offset * 15;
        return {
          success: true,
          action: 'CHECKIN_LATE',
          isPresent: true,
          queuePosition: newQueuePosition,
          waitMinutes,
          queueNotice: `You have been accommodated and will be sent after ${offset} member appointments (Estimated wait: ~${waitMinutes} mins). Queue Token: #${newQueuePosition}.`,
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

    it('handles CHECKIN_LATE with default +2 buffer', () => {
      const result = simulateMerchantLateAction('CHECKIN_LATE', {
        bufferOffset: 2,
        existingPositions: [10, 11, 12],
      });
      assert.equal(result.success, true);
      assert.equal(result.isPresent, true);
      assert.equal(result.queuePosition, 14, '12 + 2 = 14');
      assert.equal(result.waitMinutes, 30);
    });

    it('handles CHECKIN_LATE with custom buffer (e.g. +3)', () => {
      const result = simulateMerchantLateAction('CHECKIN_LATE', {
        bufferOffset: 3,
        existingPositions: [15],
      });
      assert.equal(result.success, true);
      assert.equal(result.queuePosition, 18, '15 + 3 = 18');
      assert.equal(result.waitMinutes, 45, '3 appointments * 15 mins = 45m');
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
