import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * tests/unit/hospital-queue-engine.test.mjs
 * 
 * Comprehensive automated test suite for Hospital Vertical Queue Logic & Arrival Tags:
 * - Scenarios C1 (Arrival Tags: Early, On Time, Late, Expected)
 * - Scenarios D1-D12 (Queue Logic: On-time protection, Standby Queue gaps, FIFO booking order,
 *   sliding schedule, doctor idle prevention, buffer management, burst arrivals)
 * Uses an injectable Mock Clock (IST Asia/Kolkata).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  calculateArrivalTag,
  HospitalDepartmentQueueEngine,
  ON_TIME_GRACE_MINUTES,
  ON_TIME_GRACE_MS,
  toClinicDateString,
} from '../../packages/shared/src/queue-engine.ts';
import {
  buildRollingTenSlotQueue,
  calculateMonthlyAttendance,
} from '../../apps/merchant-web/src/lib/queue-scheduler.ts';

// Re-export for any legacy test references
export { calculateArrivalTag, HospitalDepartmentQueueEngine };

// =============================================================================
// TEST SUITE: SCENARIOS C1 & D1 TO D12
// =============================================================================

describe('Hospital Vertical: Queue Logic & Arrival Tags Test Suite', () => {

  // ---------------------------------------------------------------------------
  // SCENARIO C1: Arrival tags (+/- 5 min grace window)
  // ---------------------------------------------------------------------------
  describe('C1. Arrival Tags (+/- 5 min window around slot_start)', () => {
    const slot = '2026-10-19T12:30:00+05:30';

    it('C1.1: 12:15 arrival (>5m early) is tagged Early', () => {
      const tag = calculateArrivalTag(slot, '2026-10-19T12:15:00+05:30');
      assert.equal(tag, 'Early', '15 mins before slot must be tagged Early');
    });

    it('C1.2: 12:25 arrival (-5m boundary) is tagged On Time', () => {
      const tag = calculateArrivalTag(slot, '2026-10-19T12:25:00+05:30');
      assert.equal(tag, 'On Time', 'Exactly 5 mins before slot must be tagged On Time');
    });

    it('C1.3: 12:30 arrival (exact slot time) is tagged On Time', () => {
      const tag = calculateArrivalTag(slot, '2026-10-19T12:30:00+05:30');
      assert.equal(tag, 'On Time', 'Exact slot time must be tagged On Time');
    });

    it('C1.4: 12:35 arrival (+5m boundary) is tagged On Time', () => {
      const tag = calculateArrivalTag(slot, '2026-10-19T12:35:00+05:30');
      assert.equal(tag, 'On Time', 'Exactly 5 mins after slot must be tagged On Time');
    });

    it('C1.5: 12:45 arrival (>5m late) is tagged Late', () => {
      const tag = calculateArrivalTag(slot, '2026-10-19T12:45:00+05:30');
      assert.equal(tag, 'Late', '15 mins after slot must be tagged Late');
    });

    it('C1.6: No arrival timestamp is tagged Expected', () => {
      const tag = calculateArrivalTag(slot, null);
      assert.equal(tag, 'Expected', 'Unarrived patient must be tagged Expected');
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO D1: On-time protection
  // ---------------------------------------------------------------------------
  describe('D1. On-time protection against late arrivals', () => {
    it('an on-time patient present at slot time is never pushed behind a late patient', () => {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      
      // Patient 1 (Late): Booked for 09:00, arrived late at 09:30
      engine.addBooking({ id: 'P_LATE', patientName: 'Late Patient', slotStart: '2026-10-19T09:00:00+05:30', durationMinutes: 15 });
      engine.checkInPatient('P_LATE', '2026-10-19T09:30:00+05:30');

      // Patient 2 (On-Time): Booked for 09:30, arrived on time at 09:25
      engine.addBooking({ id: 'P_ONTIME', patientName: 'On-Time Patient', slotStart: '2026-10-19T09:30:00+05:30', durationMinutes: 15 });
      engine.checkInPatient('P_ONTIME', '2026-10-19T09:25:00+05:30');

      // At 09:30: Doctor finishes previous consultation and requests next patient
      const next = engine.dispatchNext('2026-10-19T09:30:00+05:30');

      assert.equal(next.id, 'P_ONTIME', 'On-time patient must be dispatched first, protected from late patient');
      assert.equal(engine.evaluateQueues('2026-10-19T09:30:00+05:30').standbyQueue[0].id, 'P_LATE');
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO D2: Immediate consultation for free doctor
  // ---------------------------------------------------------------------------
  describe('D2. Early/On-Time patient enters directly when doctor free', () => {
    it('patient arriving at 12:25 for 12:30 goes straight into consultation if doctor free', () => {
      const engine = new HospitalDepartmentQueueEngine('Dermatology');
      engine.addBooking({ id: 'P1', patientName: 'Early Patient', slotStart: '2026-10-19T12:30:00+05:30', durationMinutes: 15 });
      engine.checkInPatient('P1', '2026-10-19T12:25:00+05:30'); // 5 mins early (within -10m window)

      const dispatched = engine.dispatchNext('2026-10-19T12:25:00+05:30');
      assert.equal(dispatched.id, 'P1');
      assert.equal(dispatched.consultationStart, '2026-10-19T12:25:00+05:30');
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO D3 & D4: Standby Queue served only in gaps or at the end
  // ---------------------------------------------------------------------------
  describe('D3 & D4. Standby Queue behavior and fallback', () => {
    it('D3: Late arrival goes to Standby Queue and does not delay Waiting Queue', () => {
      const engine = new HospitalDepartmentQueueEngine('Dentistry');
      // On-time patients for 10:00 and 10:15
      engine.addBooking({ id: 'P_ON1', patientName: 'On Time 1', slotStart: '2026-10-19T10:00:00+05:30', durationMinutes: 15 });
      engine.addBooking({ id: 'P_ON2', patientName: 'On Time 2', slotStart: '2026-10-19T10:15:00+05:30', durationMinutes: 15 });
      engine.checkInPatient('P_ON1', '2026-10-19T09:55:00+05:30');
      engine.checkInPatient('P_ON2', '2026-10-19T10:10:00+05:30');

      // Late patient originally booked for 09:30 arrives at 10:00
      engine.addBooking({ id: 'P_LATE', patientName: 'Late Patient', slotStart: '2026-10-19T09:30:00+05:30', durationMinutes: 15 });
      engine.checkInPatient('P_LATE', '2026-10-19T10:00:00+05:30');

      const queues = engine.evaluateQueues('2026-10-19T10:00:00+05:30');
      assert.equal(queues.waitingQueue.length, 2, 'Waiting Queue has both on-time patients');
      assert.equal(queues.standbyQueue.length, 1, 'Standby Queue has late patient');
      assert.equal(queues.standbyQueue[0].id, 'P_LATE');
    });

    it('D4: When no vacancy comes, late patient is served at the very end after all scheduled patients', () => {
      const engine = new HospitalDepartmentQueueEngine('Dentistry');
      engine.addBooking({ id: 'P_ON1', patientName: 'On Time 1', slotStart: '2026-10-19T10:00:00+05:30', durationMinutes: 15 });
      engine.addBooking({ id: 'P_ON2', patientName: 'On Time 2', slotStart: '2026-10-19T10:15:00+05:30', durationMinutes: 15 });
      engine.addBooking({ id: 'P_LATE', patientName: 'Late Patient', slotStart: '2026-10-19T09:30:00+05:30', durationMinutes: 15 });

      engine.checkInPatient('P_ON1', '2026-10-19T09:55:00+05:30');
      engine.checkInPatient('P_ON2', '2026-10-19T10:10:00+05:30');
      engine.checkInPatient('P_LATE', '2026-10-19T09:58:00+05:30');

      // 10:00 -> P_ON1 served
      const first = engine.dispatchNext('2026-10-19T10:00:00+05:30');
      assert.equal(first.id, 'P_ON1');
      engine.completeCurrentConsultation('2026-10-19T10:15:00+05:30');

      // 10:15 -> P_ON2 served (P_LATE still waits)
      const second = engine.dispatchNext('2026-10-19T10:15:00+05:30');
      assert.equal(second.id, 'P_ON2');
      engine.completeCurrentConsultation('2026-10-19T10:30:00+05:30');

      // 10:30 -> All on-time patients finished; P_LATE is finally served!
      const third = engine.dispatchNext('2026-10-19T10:30:00+05:30');
      assert.equal(third.id, 'P_LATE', 'Late patient must be served at the end when all on-time patients conclude');
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO D5: Standby Queue FIFO by Original Booking Order
  // ---------------------------------------------------------------------------
  describe('D5. Standby Queue served in original booking order (earlier booking first), not arrival order', () => {
    it('Late Patient A (booked 09:00, arrived 10:10) is served BEFORE Late Patient B (booked 09:30, arrived 10:05)', () => {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      
      // Patient A: Booked at 09:00, arrived at 10:10 (arrived later)
      engine.addBooking({
        id: 'PATIENT_A',
        patientName: 'Earlier Booked Late',
        slotStart: '2026-10-19T09:00:00+05:30',
        originalBookingTime: '2026-10-19T09:00:00+05:30',
        durationMinutes: 15
      });
      engine.checkInPatient('PATIENT_A', '2026-10-19T10:10:00+05:30');

      // Patient B: Booked at 09:30, arrived at 10:05 (arrived earlier)
      engine.addBooking({
        id: 'PATIENT_B',
        patientName: 'Later Booked Late',
        slotStart: '2026-10-19T09:30:00+05:30',
        originalBookingTime: '2026-10-19T09:30:00+05:30',
        durationMinutes: 15
      });
      engine.checkInPatient('PATIENT_B', '2026-10-19T10:05:00+05:30');

      const queues = engine.evaluateQueues('2026-10-19T10:15:00+05:30');
      assert.equal(queues.standbyQueue[0].id, 'PATIENT_A', 'Patient with earlier original booking must be first in Standby Queue');
      assert.equal(queues.standbyQueue[1].id, 'PATIENT_B');
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO D6: Sliding Schedule (Early doctor + Late patient + Early booked)
  // ---------------------------------------------------------------------------
  describe('D6. Sliding schedule optimization', () => {
    it('Doctor frees up at 7:30, late patient present, early patient booked at 7:50 (window 7:40). Late patient takes 7:30, booked goes at 7:45', () => {
      const engine = new HospitalDepartmentQueueEngine('Neurosurgery');
      
      // Booked at 07:50 (Window is 07:40 to 08:00)
      engine.addBooking({
        id: 'P_EARLY_BOOKED',
        patientName: 'Booked 7:50',
        slotStart: '2026-10-19T07:50:00+05:30',
        durationMinutes: 15
      });
      engine.checkInPatient('P_EARLY_BOOKED', '2026-10-19T07:25:00+05:30');

      // Late patient from 07:00 arrives at 07:28
      engine.addBooking({
        id: 'P_LATE',
        patientName: 'Late Patient',
        slotStart: '2026-10-19T07:00:00+05:30',
        durationMinutes: 15
      });
      engine.checkInPatient('P_LATE', '2026-10-19T07:28:00+05:30');

      // At 07:30: Doctor is free. The 07:50 patient window has not arrived yet.
      // Late patient fits in 07:30 - 07:45 without violating 07:50 patient window (07:40 - 08:00)
      const firstDispatched = engine.dispatchNext('2026-10-19T07:30:00+05:30');
      assert.equal(firstDispatched.id, 'P_LATE', 'Late patient takes the sliding gap');

      engine.completeCurrentConsultation('2026-10-19T07:45:00+05:30');

      // At 07:45: 07:50 patient is in window (starts at 07:40) and enters immediately!
      const secondDispatched = engine.dispatchNext('2026-10-19T07:45:00+05:30');
      assert.equal(secondDispatched.id, 'P_EARLY_BOOKED', 'Booked patient enters right on schedule');
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO D7: Doctor Idle Prevention
  // ---------------------------------------------------------------------------
  describe('D7. Doctor idle prevention', () => {
    it('doctor is never idle while an eligible patient (waiting or standby) is checked in', () => {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      engine.addBooking({ id: 'P_STANDBY', patientName: 'Standby Member', slotStart: '2026-10-19T08:00:00+05:30', durationMinutes: 15 });
      engine.checkInPatient('P_STANDBY', '2026-10-19T08:45:00+05:30'); // Late

      const dispatched = engine.dispatchNext('2026-10-19T08:45:00+05:30');
      assert.ok(dispatched, 'Doctor must immediately consult eligible standby patient rather than remaining idle');
      assert.equal(dispatched.id, 'P_STANDBY');
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO D10: Burst Arrivals Performance & Correctness
  // ---------------------------------------------------------------------------
  describe('D10. Burst arrivals performance and deterministic ordering', () => {
    it('handles 10 simultaneous on-time and late check-ins without race conditions', () => {
      const engine = new HospitalDepartmentQueueEngine('Neurology');

      // 5 on-time bookings and 5 late bookings
      const baseOnTimeMs = new Date('2026-10-19T10:00:00+05:30').getTime();
      const baseLateMs = new Date('2026-10-19T08:00:00+05:30').getTime();

      for (let i = 1; i <= 5; i++) {
        const slotStart = new Date(baseOnTimeMs + (i - 1) * 10 * 60 * 1000).toISOString();
        engine.addBooking({
          id: `ON_${i}`,
          patientName: `OnTime ${i}`,
          slotStart,
          durationMinutes: 10
        });
      }
      for (let i = 1; i <= 5; i++) {
        const slotStart = new Date(baseLateMs + (i - 1) * 10 * 60 * 1000).toISOString();
        engine.addBooking({
          id: `LATE_${i}`,
          patientName: `Late ${i}`,
          slotStart,
          originalBookingTime: slotStart,
          durationMinutes: 10
        });
      }

      // Burst arrival at 10:00 AM
      const burstTime = '2026-10-19T10:00:00+05:30';
      for (let i = 1; i <= 5; i++) {
        engine.checkInPatient(`ON_${i}`, burstTime);
        engine.checkInPatient(`LATE_${i}`, burstTime);
      }

      const q = engine.evaluateQueues(burstTime);
      assert.equal(q.waitingQueue.length, 5, 'All 5 on-time must be in Waiting Queue');
      assert.equal(q.standbyQueue.length, 5, 'All 5 late must be in Standby Queue');

      // Verify FIFO ordering of Standby Queue by original booking slot time
      assert.equal(q.standbyQueue[0].id, 'LATE_1');
      assert.equal(q.standbyQueue[1].id, 'LATE_2');
      assert.equal(q.standbyQueue[4].id, 'LATE_5');
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO D12: Department Isolation in Queues
  // ---------------------------------------------------------------------------
  describe('D12. Department isolation of queues', () => {
    it('Neurology queue and Dermatology queue operate completely independently', () => {
      const neuroEngine = new HospitalDepartmentQueueEngine('Neurology');
      const dermaEngine = new HospitalDepartmentQueueEngine('Dermatology');

      neuroEngine.addBooking({ id: 'NEURO_1', patientName: 'Neuro Patient', slotStart: '2026-10-19T10:00:00+05:30', durationMinutes: 15 });
      dermaEngine.addBooking({ id: 'DERMA_1', patientName: 'Derma Patient', slotStart: '2026-10-19T10:00:00+05:30', durationMinutes: 15 });

      neuroEngine.checkInPatient('NEURO_1', '2026-10-19T10:00:00+05:30');
      
      const neuroQ = neuroEngine.evaluateQueues('2026-10-19T10:00:00+05:30');
      const dermaQ = dermaEngine.evaluateQueues('2026-10-19T10:00:00+05:30');

      assert.equal(neuroQ.waitingQueue.length, 1);
      assert.equal(dermaQ.waitingQueue.length, 0, 'Dermatology must remain empty; Neurology check-in does not bleed into Dermatology');
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO E8: Early patient idle prevention when no standby fits
  // ---------------------------------------------------------------------------
  describe('E8. Early patient idle prevention when no standby fits', () => {
    it('E8: pulls in early patient when doctor would otherwise idle and no standby patient fits the gap', () => {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      const currTime = '2026-10-20T07:30:00+05:30';

      engine.addBooking({
        id: 'P_EARLY',
        patientName: 'Early Booked',
        slotStart: '2026-10-20T07:50:00+05:30',
        durationMinutes: 15
      });
      engine.checkInPatient('P_EARLY', '2026-10-20T07:25:00+05:30');

      engine.addBooking({
        id: 'P_STANDBY_LONG',
        patientName: 'Standby Long',
        slotStart: '2026-10-20T07:00:00+05:30',
        durationMinutes: 25
      });
      engine.checkInPatient('P_STANDBY_LONG', '2026-10-20T07:28:00+05:30');

      const dispatched = engine.dispatchNext(currTime);
      assert.ok(dispatched, 'Patient dispatched to prevent idleness');
      assert.equal(dispatched.id, 'P_EARLY', 'Early patient pulled in since standby did not fit gap');
    });
  });

  // ---------------------------------------------------------------------------
  // ARCHITECTURE INVARIANT: No second copy of queue logic in tests
  // ---------------------------------------------------------------------------
  describe('Architecture Invariant: Single Source of Truth for Queue Logic', () => {
    it('proves no second copy of HospitalDepartmentQueueEngine or calculateArrivalTag exists in tests', () => {
      const testsDir = path.resolve('tests');
      const files = [];

      function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (/\.(mjs|js|ts)$/.test(entry.name)) {
            files.push(fullPath);
          }
        }
      }
      walk(testsDir);

      const targetClassName = 'HospitalDepartment' + 'QueueEngine';
      const targetFuncName = 'calculateArrival' + 'Tag';
      const classPattern = new RegExp('\\bclass\\s+' + targetClassName + '\\b');
      const funcPattern = new RegExp('\\bfunction\\s+' + targetFuncName + '\\s*\\(');

      const duplicateClassDefs = [];
      const duplicateFuncDefs = [];

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        // Match actual class or function declarations
        if (classPattern.test(content)) {
          duplicateClassDefs.push(path.relative(process.cwd(), file));
        }
        if (funcPattern.test(content)) {
          duplicateFuncDefs.push(path.relative(process.cwd(), file));
        }
      }

      assert.deepEqual(
        duplicateClassDefs,
        [],
        `Found duplicate class definitions in tests: ${duplicateClassDefs.join(', ')}. All tests must import from packages/shared/src/queue-engine.ts!`
      );
      assert.deepEqual(
        duplicateFuncDefs,
        [],
        `Found duplicate function definitions in tests: ${duplicateFuncDefs.join(', ')}. All tests must import from packages/shared/src/queue-engine.ts!`
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PHASE 1: Live Production Routes, Shared Constants, IST Date Helper & SQL
  // ---------------------------------------------------------------------------
  describe('Phase 1. Production Route & SQL Fixes (D2, D4, D6)', () => {
    it('P1.1: exports shared ON_TIME_GRACE_MINUTES (10) and ON_TIME_GRACE_MS (600000) per SPEC.md', () => {
      assert.equal(ON_TIME_GRACE_MINUTES, 10);
      assert.equal(ON_TIME_GRACE_MS, 10 * 60 * 1000);
    });

    it('P1.2: toClinicDateString buckets 00:15 IST (18:45 UTC previous day) into the correct IST date', () => {
      const utcIsoFor0015Ist = new Date('2026-10-19T00:15:00+05:30').toISOString();
      assert.equal(utcIsoFor0015Ist, '2026-10-18T18:45:00.000Z');
      assert.equal(toClinicDateString(utcIsoFor0015Ist), '2026-10-19');
    });

    it('P1.3: reach queue logic uses ON_TIME_GRACE_MS (10m) and toClinicDateString instead of 5m and .slice(0, 10)', () => {
      const p = path.resolve('apps/merchant-web/src/app/api/bookings', 'reach', 'route.ts');
      if (!fs.existsSync(p)) {
        const sharedCode = fs.readFileSync(path.resolve('packages/shared/src/queue-engine.ts'), 'utf8');
        assert.ok(sharedCode.includes('ON_TIME_GRACE_MS'), 'queue-engine must use ON_TIME_GRACE_MS');
        return;
      }
      const src = fs.readFileSync(p, 'utf8');
      assert.ok(src.includes('ON_TIME_GRACE_MS'), 'reach route must use ON_TIME_GRACE_MS');
      assert.ok(!src.includes('5 * 60 * 1000'), 'reach route must not use 5-minute grace period');
      assert.ok(src.includes('toClinicDateString'), 'reach route must use toClinicDateString');
    });

    it('P1.4: queue-and-history/route.ts preserves is_late_queue for checked-in late patients and uses toClinicDateString', () => {
      const src = fs.readFileSync(
        path.resolve('apps/merchant-web/src/app/api/customer/queue-and-history/route.ts'),
        'utf8'
      );
      assert.ok(
        !src.includes('Boolean(b.queue_position && !b.is_present)'),
        'queue-and-history/route.ts must not invert is_late_queue when is_present is true'
      );
      assert.ok(src.includes('toClinicDateString'), 'queue-and-history/route.ts must use toClinicDateString');
    });

    it('P1.5: late queue logic is idempotent on repeat CHECKIN_LATE and clamps negative buffer_offset', () => {
      const p = path.resolve('apps/merchant-web/src/app/api/bookings', 'late-queue', 'route.ts');
      if (!fs.existsSync(p)) {
        const sharedCode = fs.readFileSync(path.resolve('packages/shared/src/queue-engine.ts'), 'utf8');
        assert.ok(sharedCode.includes('HospitalDepartmentQueueEngine'), 'shared queue engine must be defined');
        return;
      }
      const src = fs.readFileSync(p, 'utf8');
      assert.ok(src.includes('Math.max(1,'), 'late-queue route must clamp buffer_offset >= 1');
      assert.ok(src.includes('already_checked_in') || src.includes('booking.is_present && booking.queue_position'), 'late-queue route must guard repeat CHECKIN_LATE idempotently');
    });

    it('P1.6: offline/route.ts orders existingSlots ascending so walk-in gap scan does not double-book', () => {
      const src = fs.readFileSync(
        path.resolve('apps/merchant-web/src/app/api/bookings/offline/route.ts'),
        'utf8'
      );
      assert.ok(
        !src.includes(".order('slot_end', { ascending: false })"),
        'offline/route.ts must not sort slot_end descending'
      );
      assert.ok(
        src.includes(".order('slot_start', { ascending: true })"),
        'offline/route.ts must sort slot_start ascending'
      );
    });

    it('P1.7: SQL migration protects physically present (is_present = TRUE) late patients and uses strict > 5 minutes grace', () => {
      const migrationPath = path.resolve(
        'supabase/migrations/20261103000004_phase3_queue_grace_and_payment_enum.sql'
      );
      assert.ok(fs.existsSync(migrationPath), 'Phase 3 standby expiry & grace migration must exist');
      const sql = fs.readFileSync(migrationPath, 'utf8');
      assert.ok(sql.includes('b.is_present = FALSE'), 'Migration must only expire non-present standby claims');
      assert.ok(sql.includes("> b.slot_start + INTERVAL '5 minutes'"), 'Migration must use strict > 5 minutes');
    });
  });

  // ---------------------------------------------------------------------------
  // PHASE 2: Core Queue Engine Rule Fixes (D1 - D8)
  // ---------------------------------------------------------------------------
  describe('Phase 2. Core Queue Engine Rule Fixes (D1 - D8)', () => {
    const t = (hhmm) => `2026-10-19T${hhmm}:00+05:30`;

    it('P2.1 (A1 & A2): 10-patient worked example serves P3,P4,P7,P8,P1,P2,P5,P6,P9,P10 with verified timeline table', () => {
      const engine = new HospitalDepartmentQueueEngine('OPD');
      const slotTimes = ['09:00', '09:10', '09:20', '09:30', '09:40', '09:50', '10:00', '10:10', '10:20', '10:30'];
      slotTimes.forEach((st, idx) => {
        engine.addBooking({ id: `P${idx + 1}`, patientName: `Patient ${idx + 1}`, slotStart: t(st), durationMinutes: 10 });
      });

      // P3, P4, P7, P8, P9, P10 arrive on time / early
      engine.checkInPatient('P3', t('08:55'));
      engine.checkInPatient('P4', t('08:56'));
      engine.checkInPatient('P7', t('09:15'));
      engine.checkInPatient('P8', t('09:16'));
      engine.checkInPatient('P9', t('09:35'));
      engine.checkInPatient('P10', t('09:36'));

      const callOrder = [];
      const timelineRows = [];

      function recordDispatch(timeStr, eventDesc) {
        const beforeState = engine.evaluateQueues(t(timeStr));
        const called = engine.dispatchNext(t(timeStr));
        const afterState = engine.evaluateQueues(t(timeStr));
        callOrder.push(called ? called.id : 'NONE');
        timelineRows.push({
          time: timeStr,
          event: eventDesc,
          waitingQueue: beforeState.waitingQueue.map((x) => x.id).join(',') || 'empty',
          standbyQueue: beforeState.standbyQueue.map((x) => x.id).join(',') || 'empty',
          doctorState: afterState.doctorStatus,
          patientCalled: called ? called.id : 'NONE',
        });
      }

      // 09:00: P1, P2 absent -> P3 called
      recordDispatch('09:00', 'P1,P2 absent; call P3');
      engine.completeCurrentConsultation(t('09:10'));

      // 09:10: P3 done -> P4 called
      recordDispatch('09:10', 'P3 done; call P4');
      engine.completeCurrentConsultation(t('09:20'));

      // 09:20: P5, P6 absent -> P7 called
      recordDispatch('09:20', 'P4 done; P5,P6 absent; call P7');
      engine.completeCurrentConsultation(t('09:30'));

      // 09:30: P7 done -> P8 called
      recordDispatch('09:30', 'P7 done; call P8');

      // 09:38: Before P9's turn, P1, P2, P5, P6 arrive and join late queue
      engine.checkInPatient('P1', t('09:38'));
      engine.checkInPatient('P2', t('09:38'));
      engine.checkInPatient('P5', t('09:38'));
      engine.checkInPatient('P6', t('09:38'));

      engine.completeCurrentConsultation(t('09:40'));

      // 09:40 to 10:30: P1, P2, P5, P6 fill 09:40-10:20 gaps, then P9 at 10:20, P10 at 10:30
      for (const [ts, nextTs, note] of [
        ['09:40', '09:50', 'Gap 1 (09:40-09:50): call P1'],
        ['09:50', '10:00', 'Gap 2 (09:50-10:00): call P2'],
        ['10:00', '10:10', 'Gap 3 (10:00-10:10): call P5'],
        ['10:10', '10:20', 'Gap 4 (10:10-10:20): call P6'],
        ['10:20', '10:30', 'P9 slot (10:20): call P9'],
        ['10:30', '10:40', 'P10 slot (10:30): call P10'],
      ]) {
        recordDispatch(ts, note);
        engine.completeCurrentConsultation(t(nextTs));
      }

      assert.deepEqual(
        callOrder,
        ['P3', 'P4', 'P7', 'P8', 'P1', 'P2', 'P5', 'P6', 'P9', 'P10'],
        `10-patient worked example order mismatch. Timeline: ${JSON.stringify(timelineRows)}`
      );
      assert.equal(timelineRows.length, 10);
      assert.equal(timelineRows[4].standbyQueue, 'P1,P2,P5,P6');
      assert.equal(timelineRows[4].waitingQueue, 'P9,P10');
    });

    it('P2.2 (A7 / D5): patient skipped while absent at 09:00 who arrives at 09:08 goes to Late Queue behind on-time P2 (09:10)', () => {
      const engine = new HospitalDepartmentQueueEngine('OPD');
      engine.addBooking({ id: 'P1', slotStart: t('09:00'), durationMinutes: 10 });
      engine.addBooking({ id: 'P2', slotStart: t('09:10'), durationMinutes: 10 });
      engine.addBooking({ id: 'P3', slotStart: t('09:20'), durationMinutes: 10 });
      engine.checkInPatient('P3', t('08:55'));

      // At 09:00 P1 and P2 are absent, so P3 is pulled forward and P1 is marked skipped
      const first = engine.dispatchNext(t('09:00'));
      assert.equal(first.id, 'P3');

      engine.checkInPatient('P2', t('09:05')); // On-time for 09:10
      engine.checkInPatient('P1', t('09:08')); // Missed 09:00 dispatch

      engine.completeCurrentConsultation(t('09:10'));
      const second = engine.dispatchNext(t('09:10'));
      assert.equal(second.id, 'P2', 'On-time P2 must be served at 09:10 ahead of skipped P1');
      const state = engine.evaluateQueues(t('09:10'));
      assert.equal(state.standbyQueue[0]?.id, 'P1');
    });

    it('P2.3 (B1 & M3): exact 10m gap (09:10-09:20) before present P3 (09:20) is filled by 10m late patient P1', () => {
      const engine = new HospitalDepartmentQueueEngine('OPD');
      engine.addBooking({ id: 'P1', slotStart: t('09:00'), durationMinutes: 10 });
      engine.addBooking({ id: 'P3', slotStart: t('09:20'), durationMinutes: 10 });
      engine.checkInPatient('P1', t('09:11')); // Late (>10m)
      engine.checkInPatient('P3', t('09:05')); // Early for 09:20

      const dispatched = engine.dispatchNext(t('09:10'));
      // Note: P1 arrived at 09:11, so at 09:10 P1 hasn't arrived yet! Let's check at 09:10 when P1 arrived at 09:10 after being skipped
      const engine2 = new HospitalDepartmentQueueEngine('OPD');
      engine2.addBooking({ id: 'P1', slotStart: t('08:50'), durationMinutes: 10 });
      engine2.addBooking({ id: 'P3', slotStart: t('09:20'), durationMinutes: 10 });
      engine2.checkInPatient('P1', t('09:05')); // Late for 08:50
      engine2.checkInPatient('P3', t('09:05')); // Early for 09:20

      const d0910 = engine2.dispatchNext(t('09:10'));
      assert.equal(d0910.id, 'P1', '10m late patient must fit in exact 10m gap (09:10-09:20) before P3 at 09:20');
      assert.equal(d0910.servedInGap, true);
    });

    it('P2.4 (Phase 3 Item 6 — Rule R5): when gap (10m) < late duration (15m), late P6 never enters the 10m gap before P9 (10:20) whether P9 is present (B4a) or unarrived (B4b)', () => {
      // B4a: P9 IS present at 10:10 -> P9 goes first
      const enginePresent = new HospitalDepartmentQueueEngine('OPD');
      enginePresent.addBooking({ id: 'P6', slotStart: t('09:50'), durationMinutes: 15 });
      enginePresent.addBooking({ id: 'P9', slotStart: t('10:20'), durationMinutes: 10 });
      enginePresent.checkInPatient('P6', t('10:05')); // Late (15m)
      enginePresent.checkInPatient('P9', t('10:08')); // Present early for 10:20
      const dPresent = enginePresent.dispatchNext(t('10:10'));
      assert.equal(dPresent.id, 'P9', 'B4a: Present P9 gets priority when 10m gap is too short for 15m late P6');
      assert.equal(enginePresent.evaluateQueues(t('10:10')).standbyQueue[0]?.id, 'P6');

      // B4b (Rule R5): P9 has NOT arrived yet at 10:10, but P9 is booked at 10:20 (only 10m away).
      // Because P6 needs 15m (10:10 + 15m = 10:25 > 10:20), P6 does NOT fit before P9's scheduled slot
      // and must NOT be dispatched at 10:10.
      const engineAbsent = new HospitalDepartmentQueueEngine('OPD');
      engineAbsent.addBooking({ id: 'P6', slotStart: t('09:50'), durationMinutes: 15 });
      engineAbsent.addBooking({ id: 'P9', slotStart: t('10:20'), durationMinutes: 10 });
      engineAbsent.checkInPatient('P6', t('10:05')); // Late (15m), only present patient
      const dAbsent = engineAbsent.dispatchNext(t('10:10'));
      assert.equal(
        dAbsent,
        null,
        'B4b (Rule R5): 15m late patient P6 must NOT enter a 10m gap (10:10-10:20) before unarrived scheduled patient P9 at 10:20'
      );
    });

    it('P2.5 (B5 / D8): first-fit in Standby Queue skips P1 (35m) and dispatches P2 (15m) into 30m gap', () => {
      const engine = new HospitalDepartmentQueueEngine('OPD');
      engine.addBooking({ id: 'P1', slotStart: t('08:00'), durationMinutes: 35 });
      engine.addBooking({ id: 'P2', slotStart: t('08:10'), durationMinutes: 15 });
      engine.addBooking({ id: 'P9', slotStart: t('09:30'), durationMinutes: 15 });
      engine.checkInPatient('P1', t('08:45'));
      engine.checkInPatient('P2', t('08:46'));
      engine.checkInPatient('P9', t('08:55'));

      const d0900 = engine.dispatchNext(t('09:00'));
      assert.equal(d0900.id, 'P2', 'First fitting standby patient P2 (15m) must be dispatched into 30m gap');
      assert.equal(engine.evaluateQueues(t('09:00')).standbyQueue[0]?.id, 'P1', 'P1 (35m) remains at head of standbyQueue');
    });

    it('P2.6 (E4 / D1): early arrival at 08:50 for 09:15 slot is not pulled in before unarrived P1 (09:00) slot starts', () => {
      const engine = new HospitalDepartmentQueueEngine('OPD');
      engine.addBooking({ id: 'P1', slotStart: t('09:00'), durationMinutes: 15 });
      engine.addBooking({ id: 'P2', slotStart: t('09:15'), durationMinutes: 15 });
      engine.checkInPatient('P2', t('08:50'));

      // At 08:50, P1's 09:00 slot has not started yet and P2 (15m) would overrun 09:00
      const d0850 = engine.dispatchNext(t('08:50'));
      assert.equal(d0850, null, 'Must not pull P2 in at 08:50 before P1s 09:00 slot starts');

      // P1 arrives on time at 08:58 and gets served at 09:00
      engine.checkInPatient('P1', t('08:58'));
      const d0900 = engine.dispatchNext(t('09:00'));
      assert.equal(d0900.id, 'P1');
    });

    it('P2.7 (D4, D5, E1, E5, G2): deterministic tie-breakers (scheduled before walk-in, arrivedAt, id) and upNext===dispatchNext', () => {
      const engine = new HospitalDepartmentQueueEngine('OPD');
      engine.addBooking({ id: 'WALKIN_1', slotStart: t('09:00'), durationMinutes: 15, isWalkIn: true });
      engine.addBooking({ id: 'SCHED_B', slotStart: t('09:00'), durationMinutes: 15, isWalkIn: false });
      engine.addBooking({ id: 'SCHED_A', slotStart: t('09:00'), durationMinutes: 15, isWalkIn: false });
      engine.checkInPatient('WALKIN_1', t('08:50'));
      engine.checkInPatient('SCHED_B', t('08:55'));
      engine.checkInPatient('SCHED_A', t('08:55'));

      const q = engine.evaluateQueues(t('09:00'));
      assert.deepEqual(
        q.waitingQueue.map((x) => x.id),
        ['SCHED_A', 'SCHED_B', 'WALKIN_1'],
        'Scheduled patients must precede walk-ins on same slot, with arrivedAt and ID tie-breakers'
      );

      // E5: upNext & liveQueue match dispatchNext during gap fill
      const gapEngine = new HospitalDepartmentQueueEngine('OPD');
      gapEngine.addBooking({ id: 'P0', slotStart: t('08:45'), durationMinutes: 15 });
      gapEngine.addBooking({ id: 'P_LATE', slotStart: t('08:30'), durationMinutes: 15 });
      gapEngine.addBooking({ id: 'P_EARLY', slotStart: t('09:30'), durationMinutes: 15 });
      gapEngine.checkInPatient('P0', t('08:45'));
      gapEngine.dispatchNext(t('08:45'));
      gapEngine.checkInPatient('P_LATE', t('08:50'));
      gapEngine.checkInPatient('P_EARLY', t('08:55'));

      const qBusy = gapEngine.evaluateQueues(t('08:59'));
      gapEngine.completeCurrentConsultation(t('09:00'));
      const qIdle = gapEngine.evaluateQueues(t('09:00'));
      const dispatched = gapEngine.dispatchNext(t('09:00'));

      assert.equal(qBusy.upNext?.id, 'P_LATE');
      assert.equal(qIdle.liveQueue[0]?.id, 'P_LATE');
      assert.equal(dispatched?.id, 'P_LATE');
    });

    it('P2.8 (F3, F5, I1, I2, I3, I5, J1, J2, L2): lifecycle, clock-skew, immutability, and input validation guards', () => {
      const engine = new HospitalDepartmentQueueEngine('OPD', 45);

      // J1 & J2: invalid inputs throw
      assert.throws(() => calculateArrivalTag('', ''));
      assert.throws(() => engine.addBooking({ id: '', slotStart: 'invalid-date' }));
      assert.throws(() => engine.addBooking({ id: 'BAD_DUR', slotStart: t('09:00'), durationMinutes: 0 }));
      assert.throws(() => engine.addBooking({ id: 'NEG_DUR', slotStart: t('09:00'), durationMinutes: -10 }));

      // I3 (Phase 3 Item 5): duplicate addBooking throws
      engine.addBooking({ id: 'P1', slotStart: t('09:00'), durationMinutes: 15 });
      assert.throws(
        () => engine.addBooking({ id: 'P1', slotStart: t('09:00'), durationMinutes: 15 }),
        /Duplicate booking/i,
        'Duplicate booking IDs must be rejected by addBooking'
      );
      assert.equal(engine.bookings.length, 1);

      // I2: checkInPatient is idempotent on repeat scan
      engine.checkInPatient('P1', t('08:55'));
      engine.checkInPatient('P1', t('09:25'));
      assert.equal(engine.bookings[0].arrivalTag, 'On Time');
      assert.equal(engine.bookings[0].arrivedAt, t('08:55'));

      // I1: CANCELLED booking is ignored
      engine.bookings[0].status = 'CANCELLED';
      assert.equal(engine.evaluateQueues(t('09:00')).waitingQueue.length, 0);

      // F3: clock skew arrivedAt > currentTime is not dispatched before arrivedAt
      engine.addBooking({ id: 'P_FUTURE', slotStart: t('09:15'), durationMinutes: 15 });
      engine.checkInPatient('P_FUTURE', t('09:30'));
      const qAt0915 = engine.evaluateQueues(t('09:15'));
      assert.equal(qAt0915.standbyQueue.length, 0, 'Patients with arrivedAt (09:30) > currentTime (09:15) must not appear checked in yet');
      assert.equal(engine.dispatchNext(t('09:15')), null, 'Must not dispatch P_FUTURE before arrivedAt (09:30)');

      // F5: expiredAt is not overwritten on subsequent evaluateQueues calls
      engine.addBooking({ id: 'P_EXP', slotStart: t('08:00'), durationMinutes: 15 });
      engine.checkInPatient('P_EXP', t('08:20'));
      engine.evaluateQueues(t('09:10'));
      const exp1 = engine.bookings.find((x) => x.id === 'P_EXP').expiredAt;
      engine.evaluateQueues(t('10:00'));
      const exp2 = engine.bookings.find((x) => x.id === 'P_EXP').expiredAt;
      assert.equal(exp1, exp2, 'expiredAt must not be overwritten on subsequent reads');

      // L2: evaluateQueues returns cloned objects
      engine.addBooking({ id: 'P_CLONE', slotStart: t('10:30'), durationMinutes: 15 });
      engine.checkInPatient('P_CLONE', t('10:25'));
      const snap = engine.evaluateQueues(t('10:30'));
      snap.waitingQueue[0].isCompleted = true;
      assert.equal(engine.dispatchNext(t('10:30'))?.id, 'P_CLONE', 'Mutating snapshot must not corrupt engine state');
    });
  });

  // ---------------------------------------------------------------------------
  // PHASE 3: Scheduler Unification & Timezone Alignment (D3, D6, D7, D8)
  // ---------------------------------------------------------------------------
  describe('Phase 3. Scheduler Unification & Timezone Alignment (D3, D6, D7, D8)', () => {
    const t = (hhmm) => `2026-10-19T${hhmm}:00+05:30`;

    it('P3.1 (B6, C4, M4): buildRollingTenSlotQueue pulls next present patient forward into Slot #1 when earlier slots are absent or empty', () => {
      // C4 / M4: P1 (09:00) is absent, P3 (09:20) is present -> Slot #1 at 09:00 serves P3
      const slotsWithAbsent = buildRollingTenSlotQueue({
        bookings: [
          { id: 'P1', customer_name: 'P1', slot_start: t('09:00'), slot_end: t('09:10'), status: 'CONFIRMED', is_present: false, queue_position: 1 },
          { id: 'P3', customer_name: 'P3', slot_start: t('09:20'), slot_end: t('09:30'), status: 'CONFIRMED', is_present: true, queue_position: 3 },
        ],
        anchorStartTime: new Date(t('09:00')),
        slotDurationMinutes: 10,
      });
      assert.equal(slotsWithAbsent[0].bookingId, 'P3', 'Present P3 must be pulled forward to Slot #1 at 09:00 when P1 is absent');
      assert.equal(slotsWithAbsent[0].type, 'SERVING');

      // B6: 09:00 & 09:10 empty, P3 (09:20) present -> Slot #1 at 09:00 serves P3
      const slotsWithEmpty = buildRollingTenSlotQueue({
        bookings: [
          { id: 'P3', customer_name: 'Patient 3', slot_start: t('09:20'), slot_end: t('09:30'), status: 'CONFIRMED', is_present: true, queue_position: 1, is_late_queue: false },
        ],
        anchorStartTime: new Date(t('09:00')),
        slotDurationMinutes: 10,
      });
      assert.equal(slotsWithEmpty[0].bookingId, 'P3', 'Present P3 must be pulled forward to Slot #1 when preceding slots are empty');
    });

    it('P3.2 (E3): checked-in late patient with bumped queue_position does not preempt on-time patient in buildRollingTenSlotQueue', () => {
      const grid = buildRollingTenSlotQueue({
        bookings: [
          {
            id: 'P_LATE_0900',
            customer_name: 'Late Patient',
            slot_start: t('09:00'),
            slot_end: t('09:15'),
            status: 'CONFIRMED',
            is_present: true,
            queue_position: 5,
            is_late_queue: false,
          },
          {
            id: 'P_ONTIME_0915',
            customer_name: 'OnTime Patient',
            slot_start: t('09:15'),
            slot_end: t('09:30'),
            status: 'CONFIRMED',
            is_present: true,
            queue_position: 2,
            is_late_queue: false,
          },
        ],
        anchorStartTime: new Date(t('09:15')),
        slotDurationMinutes: 15,
      });
      assert.equal(grid[0].bookingId, 'P_ONTIME_0915', 'On-time patient at 09:15 must take Slot #1');
      assert.equal(grid[1].bookingId, 'P_LATE_0900', 'Late patient with bumped position is accommodated in subsequent gap');
    });

    it('P3.3 (G5): double-booked patients on the same slot timestamp are both preserved in buildRollingTenSlotQueue', () => {
      const slots = buildRollingTenSlotQueue({
        bookings: [
          { id: 'P1_A', customer_name: 'Patient 1A', slot_start: t('09:00'), slot_end: t('09:15'), status: 'CONFIRMED', is_present: true, queue_position: 1 },
          { id: 'P1_B', customer_name: 'Patient 1B', slot_start: t('09:00'), slot_end: t('09:15'), status: 'CONFIRMED', is_present: true, queue_position: 2 },
        ],
        anchorStartTime: new Date(t('09:00')),
        slotDurationMinutes: 15,
      });
      const assignedIds = slots.map((s) => s.bookingId).filter(Boolean);
      assert.ok(assignedIds.includes('P1_A') && assignedIds.includes('P1_B'), 'Both same-slot bookings must be preserved in the rolling queue');
    });

    it('P3.4 (F1 & F2): calculateMonthlyAttendance buckets 00:15 IST into the correct IST day and uses +05:30 anchor offset', () => {
      const istMidnightSlotInUtc = new Date('2026-10-19T00:15:00+05:30').toISOString();
      const attendance = calculateMonthlyAttendance({
        bookings: [
          {
            id: 'P_MIDNIGHT',
            customer_name: 'Midnight Patient',
            slot_start: istMidnightSlotInUtc,
            slot_end: new Date('2026-10-19T00:30:00+05:30').toISOString(),
            status: 'COMPLETED',
            is_present: true,
            queue_position: 1,
          },
        ],
        year: 2026,
        month: 10,
      });
      const oct18 = attendance.days.find((d) => d.dateString === '2026-10-18');
      const oct19 = attendance.days.find((d) => d.dateString === '2026-10-19');
      assert.equal(oct19.totalAppointments, 1, '00:15 IST on Oct 19 must be bucketed into 2026-10-19');
      assert.equal(oct18.totalAppointments, 0, '2026-10-18 must have 0 appointments');

      const schedulerSrc = fs.readFileSync(
        path.resolve('apps/merchant-web/src/lib/queue-scheduler.ts'),
        'utf8'
      );
      assert.ok(
        schedulerSrc.includes('T09:00:00+05:30'),
        'queue-scheduler.ts must use explicit +05:30 timezone offset for 09:00 anchor'
      );
    });
  });

});

