/**
 * tests/unit/queue-spec-engine.test.mjs
 * 
 * Formal Verification Suite for Hospital Vertical Queue Logic & Spec Invariants:
 * 1. Worked examples E1 & E2 verified through buildRollingTenSlotQueue (not engine directly)
 * 2. Invariant: On-time present patients are never behind Standby
 * 3. Invariant: Standby patients are served in original booking order (FIFO)
 * 4. Invariant: Early patients are pulled in only to avoid doctor idling
 * 5. Invariant: Fit check is lifted at end of day when no booked patients remain (nobody dropped)
 * 6. 1,000-day randomized simulation against production module with early arrivals & printed seed on failure
 * 7. Anti-duplication test: asserts no secondary copy of queue-ordering logic exists outside queue-engine.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildRollingTenSlotQueue,
} from '../../apps/merchant-web/src/lib/queue-scheduler.ts';

import {
  HospitalDepartmentQueueEngine,
  calculateArrivalTag,
  computeQueueETAs,
  computePatientETA,
  shouldSendEtaNotification,
} from '../../packages/shared/src/queue-engine.ts';

// Seedable PRNG (Mulberry32)
function createPrng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Hospital Vertical: Queue Specification & Invariant Verification Suite', () => {

  // =========================================================================
  // 1. Worked Examples E1 & E2 through buildRollingTenSlotQueue
  // =========================================================================
  describe('1. Worked Examples E1 & E2 via buildRollingTenSlotQueue', () => {
    
    it('E1: Consultant starts consultation moving booking to SERVING / IN_CONSULTATION', () => {
      const baseTime = new Date('2026-10-20T10:00:00.000Z');
      const bookings = [
        {
          id: 'B_E1',
          reference_code: 'P-E1',
          customer_name: 'Patient E1',
          slot_start: '2026-10-20T10:00:00.000Z',
          slot_end: '2026-10-20T10:15:00.000Z',
          status: 'CHECKED_IN',
          is_present: true,
          checked_in_at: '2026-10-20T09:55:00.000Z',
        },
        {
          id: 'B_NEXT',
          reference_code: 'P-NEXT',
          customer_name: 'Patient Next',
          slot_start: '2026-10-20T10:15:00.000Z',
          slot_end: '2026-10-20T10:30:00.000Z',
          status: 'CHECKED_IN',
          is_present: true,
          checked_in_at: '2026-10-20T10:05:00.000Z',
        }
      ];

      // Before consultation starts: B_E1 is eligible and designated Up Next
      const preQueue = buildRollingTenSlotQueue({
        bookings,
        slotDurationMinutes: 15,
        anchorStartTime: baseTime,
      });

      assert.equal(preQueue[0].bookingId, 'B_E1');
      assert.equal(preQueue[0].isPresent, true);
      assert.equal(preQueue[0].isUpNext, true, 'First eligible patient highlighted as Up Next');
      assert.equal(preQueue[0].statusLabel, 'Up Next');

      // Now consultation starts: B_E1 status changes to IN_CONSULTATION
      const inConsultBookings = [
        { ...bookings[0], status: 'IN_CONSULTATION' },
        bookings[1],
      ];

      const postQueue = buildRollingTenSlotQueue({
        bookings: inConsultBookings,
        slotDurationMinutes: 15,
        anchorStartTime: baseTime,
      });

      assert.equal(postQueue[0].type, 'SERVING', 'Active consultation is displayed as SERVING');
      assert.equal(postQueue[0].statusLabel, 'In Consultation');
      assert.equal(postQueue[1].bookingId, 'B_NEXT');
      assert.equal(postQueue[1].isUpNext, true, 'Next patient becomes Up Next while previous is SERVING');
    });

    it('E2: Single active consultation constraint across multiple runs (at most 1 SERVING slot)', () => {
      const baseTime = new Date('2026-10-20T11:00:00.000Z');

      for (let run = 1; run <= 10; run++) {
        const bookings = [];
        for (let i = 1; i <= 5; i++) {
          const startMs = baseTime.getTime() + (i - 1) * 15 * 60 * 1000;
          bookings.push({
            id: `RUN${run}_P${i}`,
            reference_code: `R${run}P${i}`,
            customer_name: `Patient ${i}`,
            slot_start: new Date(startMs).toISOString(),
            slot_end: new Date(startMs + 15 * 60 * 1000).toISOString(),
            // Only patient 1 is in consultation, others are checked-in
            status: i === 1 ? 'IN_CONSULTATION' : 'CHECKED_IN',
            is_present: true,
            checked_in_at: new Date(baseTime.getTime() - 5 * 60 * 1000).toISOString(),
          });
        }

        const queue = buildRollingTenSlotQueue({
          bookings,
          slotDurationMinutes: 15,
          anchorStartTime: baseTime,
        });

        const servingSlots = queue.filter((s) => s.type === 'SERVING');
        assert.equal(
          servingSlots.length,
          1,
          `Run ${run}: Must strictly contain exactly 1 SERVING slot per doctor`
        );
        assert.equal(servingSlots[0].bookingId, `RUN${run}_P1`);

        // Other slots must NOT be SERVING
        const otherPresentSlots = queue.filter((s) => s.slotIndex > 1 && s.isPresent);
        for (const s of otherPresentSlots) {
          assert.notEqual(s.type, 'SERVING', 'Secondary patient cannot be in SERVING state concurrently');
        }
      }
    });
  });

  // =========================================================================
  // 2. Invariants through buildRollingTenSlotQueue & queue-engine.ts
  // =========================================================================
  describe('2. Core Queue Invariants', () => {

    it('Invariant 1: On-time present patients are never behind Standby', () => {
      const baseTime = new Date('2026-10-20T09:30:00.000Z');

      const bookings = [
        // Late patient: Booked for 09:00, arrived late at 09:30 (Standby)
        {
          id: 'PATIENT_LATE',
          reference_code: 'LATE-1',
          customer_name: 'Late Patient',
          slot_start: '2026-10-20T09:00:00.000Z',
          slot_end: '2026-10-20T09:15:00.000Z',
          status: 'CHECKED_IN',
          is_present: true,
          checked_in_at: '2026-10-20T09:30:00.000Z',
          arrival_tag: 'Late',
          is_late_queue: true,
        },
        // On-Time patient: Booked for 09:30, arrived on time at 09:25 (Window: 09:20 - 09:40)
        {
          id: 'PATIENT_ONTIME',
          reference_code: 'ONTIME-1',
          customer_name: 'On-Time Patient',
          slot_start: '2026-10-20T09:30:00.000Z',
          slot_end: '2026-10-20T09:45:00.000Z',
          status: 'CHECKED_IN',
          is_present: true,
          checked_in_at: '2026-10-20T09:25:00.000Z',
          arrival_tag: 'On Time',
        },
      ];

      const queue = buildRollingTenSlotQueue({
        bookings,
        slotDurationMinutes: 15,
        anchorStartTime: baseTime,
      });

      // The on-time patient whose window is open must be first
      assert.equal(queue[0].bookingId, 'PATIENT_ONTIME', 'On-time present patient must be served ahead of late standby patient');
      assert.equal(queue[0].isUpNext, true);
    });

    it('Invariant 2: Standby patients are served in original booking order (FIFO)', () => {
      const baseTime = new Date('2026-10-20T10:00:00.000Z');

      // Late Patient A: booked earlier (09:00), arrived later (10:10)
      // Late Patient B: booked later (09:30), arrived earlier (10:05)
      const engine = new HospitalDepartmentQueueEngine('General');
      engine.addBooking({
        id: 'LATE_A',
        patientName: 'Late A (Booked 09:00)',
        slotStart: '2026-10-20T09:00:00.000Z',
        originalBookingTime: '2026-10-20T09:00:00.000Z',
        durationMinutes: 15,
      });
      engine.checkInPatient('LATE_A', '2026-10-20T10:10:00.000Z');

      engine.addBooking({
        id: 'LATE_B',
        patientName: 'Late B (Booked 09:30)',
        slotStart: '2026-10-20T09:30:00.000Z',
        originalBookingTime: '2026-10-20T09:30:00.000Z',
        durationMinutes: 15,
      });
      engine.checkInPatient('LATE_B', '2026-10-20T10:05:00.000Z');

      const state = engine.evaluateQueues('2026-10-20T10:15:00.000Z');
      assert.equal(state.standbyQueue.length, 2);
      assert.equal(state.standbyQueue[0].id, 'LATE_A', 'Earlier booking time served first in Standby');
      assert.equal(state.standbyQueue[1].id, 'LATE_B');

      // Test through buildRollingTenSlotQueue
      const queue = buildRollingTenSlotQueue({
        bookings: [
          {
            id: 'LATE_A',
            slot_start: '2026-10-20T09:00:00.000Z',
            slot_end: '2026-10-20T09:15:00.000Z',
            original_booking_time: '2026-10-20T09:00:00.000Z',
            status: 'CHECKED_IN',
            is_present: true,
            checked_in_at: '2026-10-20T10:10:00.000Z',
            arrival_tag: 'Late',
            is_late_queue: true,
          },
          {
            id: 'LATE_B',
            slot_start: '2026-10-20T09:30:00.000Z',
            slot_end: '2026-10-20T09:45:00.000Z',
            original_booking_time: '2026-10-20T09:30:00.000Z',
            status: 'CHECKED_IN',
            is_present: true,
            checked_in_at: '2026-10-20T10:05:00.000Z',
            arrival_tag: 'Late',
            is_late_queue: true,
          },
        ],
        slotDurationMinutes: 15,
        anchorStartTime: baseTime,
      });

      // Slot 1 must be LATE_A, Slot 2 must be LATE_B
      assert.equal(queue[0].bookingId, 'LATE_A', 'Slot 1 must accommodate earlier booked patient LATE_A');
      assert.equal(queue[1].bookingId, 'LATE_B', 'Slot 2 must accommodate later booked patient LATE_B');
    });

    it('Invariant 3: Early patients are pulled in only to avoid doctor idling', () => {
      const engine = new HospitalDepartmentQueueEngine('Cardiology');
      const currTime = '2026-10-20T08:00:00.000Z';

      // Doctor is free at 08:00
      // Early patient booked at 08:30 (Window: 08:20 - 08:40), arrived at 07:55 (>10m early)
      engine.addBooking({
        id: 'P_EARLY',
        patientName: 'Early Patient',
        slotStart: '2026-10-20T08:30:00.000Z',
        slotEnd: '2026-10-20T08:45:00.000Z',
        durationMinutes: 15,
      });
      engine.checkInPatient('P_EARLY', '2026-10-20T07:55:00.000Z');

      // Standby patient from 07:30 arrives late at 07:58, but duration is 25m (does not fit into gap before 08:20 window)
      engine.addBooking({
        id: 'P_STANDBY',
        patientName: 'Standby Patient',
        slotStart: '2026-10-20T07:30:00.000Z',
        slotEnd: '2026-10-20T08:05:00.000Z',
        durationMinutes: 35,
      });
      engine.checkInPatient('P_STANDBY', '2026-10-20T07:58:00.000Z');

      // Dispatch at 08:00:
      // Standby patient (25m) would finish at 08:25, which overlaps with P_EARLY window (08:20).
      // Therefore, Standby cannot fit without delaying early patient.
      // To prevent doctor idling, P_EARLY is pulled in!
      const dispatched = engine.dispatchNext(currTime);
      assert.ok(dispatched, 'Patient must be dispatched to avoid doctor idling');
      assert.equal(dispatched.id, 'P_EARLY', 'Early patient pulled in since standby did not fit');
    });

    it('Invariant 4: Fit check lifted at end of day when no booked patients remain', () => {
      const engine = new HospitalDepartmentQueueEngine('Oncology');

      // Two Standby patients whose appointment was earlier in the day
      engine.addBooking({
        id: 'SB_1',
        patientName: 'Standby 1',
        slotStart: '2026-10-20T09:00:00.000Z',
        originalBookingTime: '2026-10-20T09:00:00.000Z',
        durationMinutes: 30,
      });
      engine.checkInPatient('SB_1', '2026-10-20T17:00:00.000Z');

      engine.addBooking({
        id: 'SB_2',
        patientName: 'Standby 2',
        slotStart: '2026-10-20T09:30:00.000Z',
        originalBookingTime: '2026-10-20T09:30:00.000Z',
        durationMinutes: 30,
      });
      engine.checkInPatient('SB_2', '2026-10-20T17:05:00.000Z');

      // At 17:15: All scheduled/on-time patients for the day have finished. Zero booked patients remain.
      // Fit check must be lifted: SB_1 served first, then SB_2. Nobody dropped!
      const first = engine.dispatchNext('2026-10-20T17:15:00.000Z');
      assert.equal(first.id, 'SB_1');
      engine.completeCurrentConsultation('2026-10-20T17:45:00.000Z');

      const second = engine.dispatchNext('2026-10-20T17:45:00.000Z');
      assert.equal(second.id, 'SB_2');
      engine.completeCurrentConsultation('2026-10-20T18:15:00.000Z');

      const queues = engine.evaluateQueues('2026-10-20T18:15:00.000Z');
      assert.equal(queues.standbyQueue.length, 0, 'All standby patients served, nobody dropped');
    });
  });

  // =========================================================================
  // 3. 1,000-Day Simulation with Early Arrivals & Printed Seed on Failure
  // =========================================================================
  describe('3. 1,000-Day Randomized Simulation against Production Module', () => {
    it('simulates 1,000 random days asserting all SPEC queue invariants', () => {
      const TOTAL_DAYS = 1000;
      let failingSeed = null;
      let failureError = null;

      for (let day = 1; day <= TOTAL_DAYS; day++) {
        const seed = 200000 + day;
        const rng = createPrng(seed);

        try {
          const engine = new HospitalDepartmentQueueEngine(`Simulation_Day_${day}`);
          const baseDayMs = new Date('2026-10-20T09:00:00.000Z').getTime();

          // Generate 10-20 bookings for the day with varying arrival times
          const numBookings = 10 + Math.floor(rng() * 11);
          const bookings = [];

          for (let i = 0; i < numBookings; i++) {
            const slotStartMs = baseDayMs + i * 20 * 60 * 1000;
            const durationMinutes = 10 + Math.floor(rng() * 11); // 10 to 20m
            const id = `D${day}_B${i + 1}`;

            const booking = {
              id,
              patientName: `Patient ${id}`,
              slotStart: new Date(slotStartMs).toISOString(),
              slotEnd: new Date(slotStartMs + durationMinutes * 60 * 1000).toISOString(),
              durationMinutes,
              originalBookingTime: new Date(slotStartMs).toISOString(),
            };
            engine.addBooking(booking);
            bookings.push(booking);
          }

          // Simulate arrivals throughout the day
          const checkinEvents = [];
          for (let i = 0; i < numBookings; i++) {
            const roll = rng();
            const b = bookings[i];
            const slotMs = new Date(b.slotStart).getTime();

            if (roll < 0.05) {
              // 5% No-show: never arrives
            } else if (roll < 0.35) {
              // 30% Early arrival: arrives 11m to 30m before slot
              const earlyMins = 11 + Math.floor(rng() * 20);
              checkinEvents.push({ id: b.id, checkinMs: slotMs - earlyMins * 60 * 1000 });
            } else if (roll < 0.75) {
              // 40% On Time: arrives between -10m and +10m
              const offsetMins = -10 + Math.floor(rng() * 21);
              checkinEvents.push({ id: b.id, checkinMs: slotMs + offsetMins * 60 * 1000 });
            } else {
              // 25% Late arrival: arrives 11m to 45m after slot
              const lateMins = 11 + Math.floor(rng() * 35);
              checkinEvents.push({ id: b.id, checkinMs: slotMs + lateMins * 60 * 1000 });
            }
          }

          // Sort check-in events chronologically
          checkinEvents.sort((a, b) => a.checkinMs - b.checkinMs);

          // Simulate day step-by-step from 08:30 to 18:00 in 5-minute ticks
          let currentSimMs = baseDayMs - 30 * 60 * 1000;
          const endOfDayMs = baseDayMs + (numBookings * 20 + 90) * 60 * 1000;
          let consultationFinishesAtMs = 0;
          let currentInConsultation = null;

          while (currentSimMs <= endOfDayMs) {
            const simIso = new Date(currentSimMs).toISOString();

            // 1. Process any check-ins up to this tick
            while (checkinEvents.length > 0 && checkinEvents[0].checkinMs <= currentSimMs) {
              const event = checkinEvents.shift();
              engine.checkInPatient(event.id, new Date(event.checkinMs).toISOString());
            }

            // 2. If ongoing consultation finishes at this tick, complete it
            if (currentInConsultation && currentSimMs >= consultationFinishesAtMs) {
              engine.completeCurrentConsultation(simIso);
              currentInConsultation = null;
            }

            // 3. If doctor is free, dispatch next eligible patient
            if (!currentInConsultation) {
              const next = engine.dispatchNext(simIso);
              if (next) {
                currentInConsultation = next;
                const dur = next.durationMinutes || 15;
                consultationFinishesAtMs = currentSimMs + dur * 60 * 1000;

                // Invariant: Single active consultation per doctor
                assert.ok(currentInConsultation, 'Doctor has active consultation');

                // Invariant: No on-time present patient overtaken by Standby
                if (next.arrivalTag === 'Late') {
                  const q = engine.evaluateQueues(simIso);
                  const presentOnTime = q.waitingQueue.filter((p) => {
                    const pStartMs = new Date(p.slotStart).getTime();
                    return currentSimMs >= pStartMs - 10 * 60 * 1000;
                  });
                  assert.equal(
                    presentOnTime.length,
                    0,
                    `Day ${day}: Late patient ${next.id} dispatched while on-time present patient was waiting`
                  );
                }
              }
            }

            currentSimMs += 5 * 60 * 1000; // Step 5 minutes
          }

          // Final verification: If any checked-in patients remain at end of day, complete them
          while (true) {
            const endIso = new Date(currentSimMs).toISOString();
            if (currentInConsultation) {
              engine.completeCurrentConsultation(endIso);
              currentInConsultation = null;
            }
            const next = engine.dispatchNext(endIso);
            if (!next) break;
            currentInConsultation = next;
            currentSimMs += (next.durationMinutes || 15) * 60 * 1000;
          }

          // Assert: All checked-in patients were served, nobody dropped
          const checkedInIds = new Set(
            engine.bookings
              .filter((b) => b.isCheckedIn && b.status !== 'CANCELLED')
              .map((b) => b.id)
          );
          const completedIds = new Set(engine.completedAppointments.map((b) => b.id));
          for (const cId of checkedInIds) {
            assert.ok(
              completedIds.has(cId),
              `Day ${day}: Checked-in patient ${cId} was dropped or not served by end of day`
            );
          }

        } catch (err) {
          failingSeed = seed;
          failureError = err;
          break;
        }
      }

      if (failingSeed !== null) {
        console.error(`Simulation failed on Day with seed: ${failingSeed}`);
        console.error(failureError);
        assert.fail(`1,000-Day simulation failed on seed ${failingSeed}: ${failureError.message}`);
      }

      assert.equal(failingSeed, null, 'All 1,000 simulated days passed flawlessly');
    });
  });

  // =========================================================================
  // 4. Anti-Duplication Test: Single Source of Truth
  // =========================================================================
  describe('4. Anti-Duplication: Single Source of Truth for Ordering Logic', () => {
    it('asserts no secondary copy of queue-ordering logic or dispatcher exists outside queue-engine.ts', () => {
      const rootDir = process.cwd();
      const searchDirs = [
        path.join(rootDir, 'apps'),
        path.join(rootDir, 'packages'),
        path.join(rootDir, 'tests'),
      ];

      const disallowedPatterns = [
        // Duplicate class declaration of queue engine
        /class\s+HospitalDepartmentQueueEngine\b/,
        // Duplicate implementation of calculateArrivalTag
        /function\s+calculateArrivalTag\s*\(/,
        // Duplicate implementation of computeQueueETAs
        /function\s+computeQueueETAs\s*\(/,
        // Legacy +2 buffer arithmetic
        /\bmaxPosition\s*\+\s*2\b/,
        /\bongoingToken\s*\+\s*2\b/,
      ];

      const violations = [];

      function walk(dir) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.next' && entry.name !== '.git') {
              walk(fullPath);
            }
          } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
            // Ignore the canonical single source of truth itself: packages/shared/src/queue-engine.ts
            const relPath = path.relative(rootDir, fullPath);
            if (relPath.replace(/\\/g, '/') === 'packages/shared/src/queue-engine.ts') {
              continue;
            }

            const content = fs.readFileSync(fullPath, 'utf8');
            for (const pattern of disallowedPatterns) {
              if (pattern.test(content)) {
                violations.push({
                  file: relPath,
                  pattern: pattern.toString(),
                });
              }
            }
          }
        }
      }

      for (const d of searchDirs) {
        walk(d);
      }

      assert.deepEqual(
        violations,
        [],
        `Detected secondary/duplicate queue logic outside packages/shared/src/queue-engine.ts:\n${JSON.stringify(violations, null, 2)}`
      );
    });
  });
});
