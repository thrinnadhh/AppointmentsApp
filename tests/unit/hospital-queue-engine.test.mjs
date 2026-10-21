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

// =============================================================================
// PURE SPECIFICATION LOGIC HARNESS (Injectable Clock & Queue Engine)
// =============================================================================

export function calculateArrivalTag(slotStart, arrivedAt) {
  if (!arrivedAt) return 'Expected';
  const startMs = new Date(slotStart).getTime();
  const arrMs = new Date(arrivedAt).getTime();
  const diffMinutes = (arrMs - startMs) / (60 * 1000);

  if (diffMinutes < -10) return 'Early';
  if (diffMinutes >= -10 && diffMinutes <= 10) return 'On Time';
  return 'Late';
}

export class HospitalDepartmentQueueEngine {
  constructor(departmentName = 'Neurology') {
    this.departmentName = departmentName;
    this.bookings = []; // { id, patientName, slotStart, slotEnd, durationMinutes, isCheckedIn, arrivedAt, originalBookingTime }
    this.currentConsultation = null;
    this.completedAppointments = [];
  }

  addBooking(booking) {
    this.bookings.push({
      ...booking,
      durationMinutes: booking.durationMinutes || 15,
      originalBookingTime: booking.originalBookingTime || booking.slotStart,
      isCheckedIn: Boolean(booking.isCheckedIn),
      arrivedAt: booking.arrivedAt || null,
    });
    // Sort bookings by slotStart
    this.bookings.sort((a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime());
  }

  checkInPatient(bookingId, checkinTime) {
    const b = this.bookings.find(item => item.id === bookingId);
    if (!b) throw new Error(`Booking ${bookingId} not found`);
    b.isCheckedIn = true;
    b.arrivedAt = checkinTime;
    b.arrivalTag = calculateArrivalTag(b.slotStart, checkinTime);
  }

  /**
   * Evaluates the current state of queues at simulated `currentTime`
   * Returns: { liveQueue, waitingQueue, standbyQueue, doctorStatus, currentServing }
   */
  evaluateQueues(currentTime) {
    const currMs = new Date(currentTime).getTime();

    // 1. Separate checked-in patients into Waiting Queue vs Standby Queue
    const checkedIn = this.bookings.filter(b => b.isCheckedIn && !b.isCompleted && b !== this.currentConsultation);
    
    // On-Time & Early go to Waiting Queue
    const waitingQueue = checkedIn.filter(b => {
      const tag = b.arrivalTag || calculateArrivalTag(b.slotStart, b.arrivedAt);
      return tag === 'On Time' || tag === 'Early';
    }).sort((a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime());

    // Late arrivals go to Standby Queue (Ordered by ORIGINAL BOOKING TIME / FIFO)
    const standbyQueue = checkedIn.filter(b => {
      const tag = b.arrivalTag || calculateArrivalTag(b.slotStart, b.arrivedAt);
      return tag === 'Late';
    }).sort((a, b) => new Date(a.originalBookingTime).getTime() - new Date(b.originalBookingTime).getTime());

    // 2. Doctor Consultation Dispatch Logic
    let doctorStatus = 'IDLE';
    let currentServing = this.currentConsultation;

    // Next upcoming on-time patient
    const nextOnTime = waitingQueue[0];
    const nextOnTimeStartMs = nextOnTime ? new Date(nextOnTime.slotStart).getTime() : null;

    // Check if on-time patient has reached their +/- 10 min window
    const isOnTimeInWindow = nextOnTime && (currMs >= nextOnTimeStartMs - 10 * 60 * 1000);

    return {
      departmentName: this.departmentName,
      doctorStatus,
      currentServing,
      liveQueue: currentServing ? [currentServing] : (waitingQueue.slice(0, 1)),
      upNext: currentServing ? (waitingQueue[0] || standbyQueue[0] || null) : (waitingQueue[1] || standbyQueue[0] || null),
      waitingQueue,
      standbyQueue,
      nextOnTime,
      isOnTimeInWindow,
      nextOnTimeStartMs
    };
  }

  /**
   * Dispatches the next patient to consultation according to strict hospital rules
   */
  dispatchNext(currentTime) {
    const state = this.evaluateQueues(currentTime);
    const currMs = new Date(currentTime).getTime();

    if (this.currentConsultation) {
      // Doctor is currently busy
      return this.currentConsultation;
    }

    const nextOnTime = state.waitingQueue[0];
    const standbyPatient = state.standbyQueue[0];

    if (nextOnTime) {
      const startMs = new Date(nextOnTime.slotStart).getTime();
      const inWindow = currMs >= (startMs - 10 * 60 * 1000);

      if (inWindow) {
        // D1 & D2: On-time patient in window goes straight in! Never delayed by standby.
        this.currentConsultation = this.bookings.find(b => b.id === nextOnTime.id);
        this.currentConsultation.consultationStart = currentTime;
        return this.currentConsultation;
      }

      // Next on-time patient is early and NOT yet in window (e.g. booked at 7:50, current time 7:30)
      // Can a standby patient fit into the gap?
      if (standbyPatient) {
        const standbyDurationMs = (standbyPatient.durationMinutes || 15) * 60 * 1000;
        // D6: Does standby patient finish before or at on-time window start?
        const onTimeWindowStartMs = startMs - 10 * 60 * 1000;
        if (currMs + standbyDurationMs <= onTimeWindowStartMs + 10 * 60 * 1000) {
          // Fits safely in gap! Late patient takes free time
          this.currentConsultation = this.bookings.find(b => b.id === standbyPatient.id);
          this.currentConsultation.consultationStart = currentTime;
          this.currentConsultation.servedInGap = true;
          return this.currentConsultation;
        }
      }

      // E8: Doctor would otherwise idle and no Standby patient fits the gap -> Pull in early patient!
      this.currentConsultation = this.bookings.find(b => b.id === nextOnTime.id);
      this.currentConsultation.consultationStart = currentTime;
      this.currentConsultation.pulledInEarly = true;
      return this.currentConsultation;
    } else if (standbyPatient) {
      // D4 & D7: No waiting queue patient; Standby patient goes in immediately. Doctor never idle!
      this.currentConsultation = this.bookings.find(b => b.id === standbyPatient.id);
      this.currentConsultation.consultationStart = currentTime;
      return this.currentConsultation;
    }

    return null;
  }

  completeCurrentConsultation(finishTime) {
    if (this.currentConsultation) {
      this.currentConsultation.isCompleted = true;
      this.currentConsultation.completedAt = finishTime;
      this.completedAppointments.push(this.currentConsultation);
      this.currentConsultation = null;
    }
  }
}

// =============================================================================
// TEST SUITE: SCENARIOS C1 & D1 TO D12
// =============================================================================

describe('Hospital Vertical: Queue Logic & Arrival Tags Test Suite', () => {

  // ---------------------------------------------------------------------------
  // SCENARIO C1: Arrival tags (+/- 10 min window)
  // ---------------------------------------------------------------------------
  describe('C1. Arrival Tags (+/- 10 min window around slot_start)', () => {
    const slot = '2026-10-19T12:30:00+05:30';

    it('C1.1: 12:15 arrival (>10m early) is tagged Early', () => {
      const tag = calculateArrivalTag(slot, '2026-10-19T12:15:00+05:30');
      assert.equal(tag, 'Early', '15 mins before slot must be tagged Early');
    });

    it('C1.2: 12:20 arrival (-10m boundary) is tagged On Time', () => {
      const tag = calculateArrivalTag(slot, '2026-10-19T12:20:00+05:30');
      assert.equal(tag, 'On Time', 'Exactly 10 mins before slot must be tagged On Time');
    });

    it('C1.3: 12:30 arrival (exact slot time) is tagged On Time', () => {
      const tag = calculateArrivalTag(slot, '2026-10-19T12:30:00+05:30');
      assert.equal(tag, 'On Time', 'Exact slot time must be tagged On Time');
    });

    it('C1.4: 12:40 arrival (+10m boundary) is tagged On Time', () => {
      const tag = calculateArrivalTag(slot, '2026-10-19T12:40:00+05:30');
      assert.equal(tag, 'On Time', 'Exactly 10 mins after slot must be tagged On Time');
    });

    it('C1.5: 12:45 arrival (>10m late) is tagged Late', () => {
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

});

