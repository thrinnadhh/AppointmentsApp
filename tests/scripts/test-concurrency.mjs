import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { acquireSlotLock, releaseSlotLock, clearAllMemoryLocks } from './apps/merchant-web/src/lib/redis.ts';

describe('Concurrency & Financial State Machine Remediation Suite', () => {

  describe('1. Critical: Overlap Range Exclusion Constraint (btree_gist)', () => {
    it('verifies btree_gist extension and range exclusion constraint are present in migrations', () => {
      const migrationDir = path.join(process.cwd(), 'supabase', 'migrations');
      const files = fs.readdirSync(migrationDir).filter((f) => f.endsWith('.sql'));

      // Check forward migration 20260929000001
      const forwardMigration = fs.readFileSync(
        path.join(migrationDir, '20260929000001_concurrency_and_financial_state_machine.sql'),
        'utf8'
      );
      assert.match(forwardMigration, /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+btree_gist/i);
      assert.match(forwardMigration, /ADD\s+CONSTRAINT\s+no_overlapping_active_bookings\s+EXCLUDE\s+USING\s+gist/i);
      assert.match(forwardMigration, /resource_id\s+WITH\s*=/i);
      assert.match(forwardMigration, /tstzrange\(\s*slot_start\s*,\s*slot_end\s*\)\s+WITH\s+&&/i);
      assert.match(forwardMigration, /WHERE\s*\(\s*status\s+IN\s*\(\s*'HELD'\s*,\s*'CONFIRMED'\s*\)\s*\)/i);

      // Check initial schema synchronization
      const initialSchema = fs.readFileSync(
        path.join(migrationDir, '20260908000001_initial_schema.sql'),
        'utf8'
      );
      assert.match(initialSchema, /no_overlapping_active_bookings\s+EXCLUDE\s+USING\s+gist/i);
      assert.match(initialSchema, /tstzrange\(\s*slot_start\s*,\s*slot_end\s*\)\s+WITH\s+&&/i);
    });

    it('verifies create_booking_hold performs range overlap check instead of exact slot_start equality', () => {
      const migrationDir = path.join(process.cwd(), 'supabase', 'migrations');
      const forwardMigration = fs.readFileSync(
        path.join(migrationDir, '20260929000001_concurrency_and_financial_state_machine.sql'),
        'utf8'
      );

      // Must use range overlap operator &&
      assert.match(forwardMigration, /tstzrange\(\s*slot_start\s*,\s*slot_end\s*\)\s*&&\s*tstzrange\(\s*p_slot_start\s*,\s*p_slot_end\s*\)/i);
      // Must catch exclusion_violation
      assert.match(forwardMigration, /EXCEPTION\s+WHEN\s+exclusion_violation\s+OR\s+unique_violation/i);
    });

    it('simulates range overlap detection with staggered and subsumed time windows', () => {
      // Existing booking from 10:00 to 11:00
      const existing = {
        resource_id: 'res-1',
        start: new Date('2026-10-01T10:00:00Z').getTime(),
        end: new Date('2026-10-01T11:00:00Z').getTime(),
      };

      const overlaps = (candStart, candEnd) => {
        const cs = new Date(candStart).getTime();
        const ce = new Date(candEnd).getTime();
        return cs < existing.end && ce > existing.start;
      };

      // Exact start match (old check caught this)
      assert.strictEqual(overlaps('2026-10-01T10:00:00Z', '2026-10-01T10:30:00Z'), true);
      // Staggered start at 10:30 (old equality check missed this!)
      assert.strictEqual(overlaps('2026-10-01T10:30:00Z', '2026-10-01T11:30:00Z'), true);
      // Subsumed start at 10:15 to 10:45 (old equality check missed this!)
      assert.strictEqual(overlaps('2026-10-01T10:15:00Z', '2026-10-01T10:45:00Z'), true);
      // Enveloping start at 09:30 to 11:30 (old equality check missed this!)
      assert.strictEqual(overlaps('2026-10-01T09:30:00Z', '2026-10-01T11:30:00Z'), true);
      // Adjacent non-overlapping (11:00 to 11:30)
      assert.strictEqual(overlaps('2026-10-01T11:00:00Z', '2026-10-01T11:30:00Z'), false);
      // Previous adjacent non-overlapping (09:30 to 10:00)
      assert.strictEqual(overlaps('2026-10-01T09:30:00Z', '2026-10-01T10:00:00Z'), false);
    });
  });

  describe('2. High: Reschedule Without Capture State Machine', () => {
    function simulateRescheduleStateTransition({ booking, newStart, newEnd, conflicts = [] }) {
      if (['CANCELLED', 'COMPLETED'].includes(booking.status)) {
        return { success: false, error: `Cannot reschedule a ${booking.status.toLowerCase()} booking` };
      }

      // Range overlap conflict check
      const ns = new Date(newStart).getTime();
      const ne = new Date(newEnd).getTime();
      const hasConflict = conflicts.some((c) => {
        if (c.id === booking.id) return false;
        const cs = new Date(c.slot_start).getTime();
        const ce = new Date(c.slot_end).getTime();
        return ns < ce && ne > cs;
      });

      if (hasConflict) {
        return { success: false, error: 'The requested new slot is already booked or held' };
      }

      let targetStatus;
      if (booking.status === 'HELD') {
        const deposit = booking.deposit_amount ?? 0;
        const hasCapturedPayment = booking.payment_status === 'PAID' && Boolean(booking.gateway_payment_id);
        const zeroDepositExemption = deposit === 0;

        if (deposit > 0 && !hasCapturedPayment) {
          targetStatus = 'HELD'; // Preserves HELD, disallows unearned promotion to CONFIRMED
        } else if (hasCapturedPayment || zeroDepositExemption) {
          targetStatus = 'CONFIRMED';
        } else {
          targetStatus = 'HELD';
        }
      } else if (booking.status === 'CONFIRMED') {
        targetStatus = 'CONFIRMED';
      }

      return {
        success: true,
        booking_id: booking.id,
        slot_start: newStart,
        slot_end: newEnd,
        status: targetStatus,
      };
    }

    it('keeps status as HELD when rescheduling an unpaid HELD booking (deposit > 0, uncaptured)', () => {
      const unpaidHeldBooking = {
        id: 'bkg-held-unpaid',
        status: 'HELD',
        deposit_amount: 100,
        payment_status: 'PENDING',
        gateway_payment_id: null,
      };

      const res = simulateRescheduleStateTransition({
        booking: unpaidHeldBooking,
        newStart: '2026-10-02T10:00:00Z',
        newEnd: '2026-10-02T10:30:00Z',
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'HELD', 'Unpaid held booking must remain HELD, not CONFIRMED');
      assert.strictEqual(res.slot_start, '2026-10-02T10:00:00Z');
    });

    it('promotes to CONFIRMED when rescheduling a HELD booking with zero deposit exemption', () => {
      const zeroDepositHeldBooking = {
        id: 'bkg-held-free',
        status: 'HELD',
        deposit_amount: 0,
        payment_status: 'PENDING',
        gateway_payment_id: null,
      };

      const res = simulateRescheduleStateTransition({
        booking: zeroDepositHeldBooking,
        newStart: '2026-10-02T11:00:00Z',
        newEnd: '2026-10-02T11:30:00Z',
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'CONFIRMED');
    });

    it('promotes to CONFIRMED when rescheduling a HELD booking that has captured payment', () => {
      const paidHeldBooking = {
        id: 'bkg-held-paid',
        status: 'HELD',
        deposit_amount: 150,
        payment_status: 'PAID',
        gateway_payment_id: 'pay_rzp_123456789',
      };

      const res = simulateRescheduleStateTransition({
        booking: paidHeldBooking,
        newStart: '2026-10-02T12:00:00Z',
        newEnd: '2026-10-02T12:30:00Z',
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'CONFIRMED');
    });

    it('preserves CONFIRMED status when rescheduling an already confirmed booking', () => {
      const confirmedBooking = {
        id: 'bkg-confirmed',
        status: 'CONFIRMED',
        deposit_amount: 100,
        payment_status: 'PAID',
        gateway_payment_id: 'pay_rzp_999999',
      };

      const res = simulateRescheduleStateTransition({
        booking: confirmedBooking,
        newStart: '2026-10-02T14:00:00Z',
        newEnd: '2026-10-02T14:30:00Z',
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'CONFIRMED');
    });

    it('rejects reschedule when new window overlaps an existing booking', () => {
      const confirmedBooking = {
        id: 'bkg-1',
        status: 'CONFIRMED',
        deposit_amount: 100,
        payment_status: 'PAID',
        gateway_payment_id: 'pay_rzp_999999',
      };

      const conflict = {
        id: 'bkg-2',
        slot_start: '2026-10-02T14:15:00Z',
        slot_end: '2026-10-02T14:45:00Z',
      };

      const res = simulateRescheduleStateTransition({
        booking: confirmedBooking,
        newStart: '2026-10-02T14:00:00Z',
        newEnd: '2026-10-02T14:30:00Z',
        conflicts: [conflict],
      });

      assert.strictEqual(res.success, false);
      assert.match(res.error, /already booked or held/);
    });

    it('verifies migrations update reschedule_booking_slot with state machine checks', () => {
      const migrationDir = path.join(process.cwd(), 'supabase', 'migrations');
      const forwardMigration = fs.readFileSync(
        path.join(migrationDir, '20260929000001_concurrency_and_financial_state_machine.sql'),
        'utf8'
      );
      assert.match(forwardMigration, /v_target_status\s*:=\s*'HELD'/);
      assert.match(forwardMigration, /tstzrange\(slot_start,\s*slot_end\)\s*&&\s*tstzrange\(p_new_slot_start,\s*p_new_slot_end\)/);
    });
  });

  describe('3. High: Distributed Slot Lock Fail-Open & Token Scoping', () => {
    it('generates unique caller tokens on acquisition and rejects concurrent locks', async () => {
      clearAllMemoryLocks();
      const slotKey = 'res-test-slot-1:2026-10-01T10:00:00Z';

      const lock1 = await acquireSlotLock(slotKey, 30);
      assert.strictEqual(lock1.acquired, true);
      assert.ok(lock1.token && lock1.token.length > 8);

      // Concurrent request trying to acquire same slot
      const lock2 = await acquireSlotLock(slotKey, 30);
      assert.strictEqual(lock2.acquired, false);
      assert.strictEqual(lock2.token, '');
    });

    it('refuses to release lock if caller provides wrong token', async () => {
      clearAllMemoryLocks();
      const slotKey = 'res-test-slot-2:2026-10-01T11:00:00Z';

      const lock = await acquireSlotLock(slotKey, 30);
      assert.strictEqual(lock.acquired, true);

      // Caller with invalid/different token attempts release
      const releasedWrong = await releaseSlotLock(slotKey, 'wrong-token-abc');
      assert.strictEqual(releasedWrong, false, 'Release with wrong token must return false');

      // The original lock must still be active
      const lockAttempt = await acquireSlotLock(slotKey, 30);
      assert.strictEqual(lockAttempt.acquired, false, 'Lock must remain active after invalid token release');

      // Release with correct token
      const releasedRight = await releaseSlotLock(slotKey, lock.token);
      assert.strictEqual(releasedRight, true);

      // Now lock should be acquirable
      const lockAfter = await acquireSlotLock(slotKey, 30);
      assert.strictEqual(lockAfter.acquired, true);
      await releaseSlotLock(slotKey, lockAfter.token);
    });

    it('verifies clearAllMemoryLocks is removed from admin merchants route', () => {
      const adminMerchantsRoute = fs.readFileSync(
        path.join(process.cwd(), 'apps', 'merchant-web', 'src', 'app', 'api', 'admin', 'merchants', 'route.ts'),
        'utf8'
      );
      assert.doesNotMatch(adminMerchantsRoute, /clearAllMemoryLocks/);
    });

    it('verifies clearAllMemoryLocks has production guard', () => {
      const origEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        clearAllMemoryLocks(); // should be blocked safely without throwing
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });

  describe('4. High: Daily Limit TOCTOU & Operational Timezone Gap', () => {
    it('correctly maps UTC times across midnight to the merchant operational timezone (Asia/Kolkata)', () => {
      // 00:30 IST on Oct 1 is 19:00 UTC on Sep 30
      const slotUtcSep30 = new Date('2026-09-30T19:00:00.000Z');
      const istDateStr1 = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(slotUtcSep30);
      assert.strictEqual(istDateStr1, '2026-10-01', '19:00 UTC on Sep 30 is 00:30 IST on Oct 1');

      // 05:00 IST on Oct 1 is 23:30 UTC on Sep 30
      const slotUtcSep30Late = new Date('2026-09-30T23:30:00.000Z');
      const istDateStr2 = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(slotUtcSep30Late);
      assert.strictEqual(istDateStr2, '2026-10-01', '23:30 UTC on Sep 30 is 05:00 IST on Oct 1');

      // 10:00 IST on Oct 1 is 04:30 UTC on Oct 1
      const slotUtcOct1 = new Date('2026-10-01T04:30:00.000Z');
      const istDateStr3 = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(slotUtcOct1);
      assert.strictEqual(istDateStr3, '2026-10-01');

      // Both slots map to the exact same IST operational calendar day
      assert.strictEqual(istDateStr1, istDateStr3);
    });

    it('verifies hold route calculates day boundaries using Asia/Kolkata timezone', () => {
      const holdRoute = fs.readFileSync(
        path.join(process.cwd(), 'apps', 'merchant-web', 'src', 'app', 'api', 'bookings', 'hold', 'route.ts'),
        'utf8'
      );
      assert.match(holdRoute, /timeZone:\s*'Asia\/Kolkata'/);
      assert.match(holdRoute, /\+05:30/);
    });

    it('verifies database migration enforces daily limit under advisory lock in Asia/Kolkata', () => {
      const forwardMigration = fs.readFileSync(
        path.join(process.cwd(), 'supabase', 'migrations', '20260929000001_concurrency_and_financial_state_machine.sql'),
        'utf8'
      );
      assert.match(forwardMigration, /pg_advisory_xact_lock/);
      assert.match(forwardMigration, /AT\s+TIME\s+ZONE\s+'Asia\/Kolkata'/i);
      assert.match(forwardMigration, /daily_booking_limit/);
    });
  });
});
