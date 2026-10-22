/**
 * queue-engine.ts
 *
 * Canonical Hospital Queue Engine and Dispatcher Logic.
 * Shared production implementation defining patient arrival classification and
 * consultation dispatching rules across the hospital vertical.
 *
 * Rules implemented:
 * 1. calculateArrivalTag: +/- 10-minute window around slot_start
 *    - < -10 min: 'Early'
 *    - -10 min to +10 min: 'On Time'
 *    - > +10 min: 'Late'
 *    - null / undefined: 'Expected'
 * 2. evaluateQueues:
 *    - Waiting Queue: On Time & Early checked-in patients, sorted by slotStart ASC
 *    - Standby Queue: Late checked-in patients, sorted by originalBookingTime ASC (FIFO)
 * 3. dispatchNext:
 *    - Active consultation: Returns currentConsultation if doctor is busy.
 *    - On-Time in window: On-time patient whose +/- 10 min window is open goes immediately.
 *    - Fit Check: If on-time patient is early and window not yet open, a Standby patient
 *      is dispatched only if their duration fits in the gap before the window.
 *    - Early Idle Prevention (E8): If doctor would otherwise idle and no Standby patient fits,
 *      pull in the early on-time patient.
 *    - End of Day / No Booked Left (E9): When no booked patients remain, the fit check is lifted
 *      and Standby patients are served in FIFO booking order.
 *    - Idle: If no eligible patients are present, returns null.
 */

export type ArrivalTag = 'Early' | 'On Time' | 'Late' | 'Expected';

export interface HospitalQueueBooking {
  id: string;
  patientName?: string;
  slotStart: string;
  slotEnd?: string;
  durationMinutes?: number;
  isCheckedIn?: boolean;
  isCompleted?: boolean;
  arrivedAt?: string | null;
  originalBookingTime?: string;
  arrivalTag?: ArrivalTag;
  consultationStart?: string;
  completedAt?: string;
  servedInGap?: boolean;
  pulledInEarly?: boolean;
  isExpired?: boolean;
  expiredAt?: string;
  [key: string]: any;
}

export interface EvaluatedQueuesState {
  departmentName: string;
  doctorStatus: 'IDLE' | 'BUSY';
  currentServing: HospitalQueueBooking | null;
  liveQueue: HospitalQueueBooking[];
  upNext: HospitalQueueBooking | null;
  waitingQueue: HospitalQueueBooking[];
  standbyQueue: HospitalQueueBooking[];
  expiredStandbyQueue: HospitalQueueBooking[];
  nextOnTime: HospitalQueueBooking | null;
  isOnTimeInWindow: boolean;
  nextOnTimeStartMs: number | null;
}

export function calculateArrivalTag(slotStart: string, arrivedAt?: string | null): ArrivalTag {
  if (!arrivedAt) return 'Expected';
  const startMs = new Date(slotStart).getTime();
  const arrMs = new Date(arrivedAt).getTime();
  const diffMinutes = (arrMs - startMs) / (60 * 1000);

  if (diffMinutes < -10) return 'Early';
  if (diffMinutes >= -10 && diffMinutes <= 10) return 'On Time';
  return 'Late';
}

export class HospitalDepartmentQueueEngine {
  departmentName: string;
  bookings: HospitalQueueBooking[];
  currentConsultation: HospitalQueueBooking | null;
  completedAppointments: HospitalQueueBooking[];
  standbyExpiryMinutes: number | null;

  constructor(departmentName = 'Neurology', standbyExpiryMinutes: number | null = null) {
    this.departmentName = departmentName;
    this.bookings = [];
    this.currentConsultation = null;
    this.completedAppointments = [];
    this.standbyExpiryMinutes = standbyExpiryMinutes;
  }

  addBooking(booking: HospitalQueueBooking): void {
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

  checkInPatient(bookingId: string, checkinTime: string): void {
    const b = this.bookings.find((item) => item.id === bookingId);
    if (!b) throw new Error(`Booking ${bookingId} not found`);
    b.isCheckedIn = true;
    b.arrivedAt = checkinTime;
    b.arrivalTag = calculateArrivalTag(b.slotStart, checkinTime);
  }

  /**
   * Evaluates the current state of queues at simulated currentTime
   * Returns: { liveQueue, waitingQueue, standbyQueue, expiredStandbyQueue, doctorStatus, currentServing, upNext, ... }
   */
  evaluateQueues(currentTime: string): EvaluatedQueuesState {
    const currMs = new Date(currentTime).getTime();

    // 1. Separate checked-in patients into Waiting Queue vs Standby Queue
    const checkedIn = this.bookings.filter(
      (b) => b.isCheckedIn && !b.isCompleted && b !== this.currentConsultation
    );

    // On-Time & Early go to Waiting Queue
    const waitingQueue = checkedIn
      .filter((b) => {
        const tag = b.arrivalTag || calculateArrivalTag(b.slotStart, b.arrivedAt);
        return tag === 'On Time' || tag === 'Early';
      })
      .sort((a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime());

    // Late arrivals go to Standby Queue (Ordered by ORIGINAL BOOKING TIME / FIFO)
    const lateArrivals = checkedIn
      .filter((b) => {
        const tag = b.arrivalTag || calculateArrivalTag(b.slotStart, b.arrivedAt);
        return tag === 'Late';
      })
      .sort(
        (a, b) =>
          new Date(a.originalBookingTime || a.slotStart).getTime() -
          new Date(b.originalBookingTime || b.slotStart).getTime()
      );

    // 45-Minute Standby Auto-Expiry: Filter out standby patients whose wait time exceeds threshold
    const standbyQueue: HospitalQueueBooking[] = [];
    const expiredStandbyQueue: HospitalQueueBooking[] = [];

    for (const b of lateArrivals) {
      const arrivalMs = new Date(b.arrivedAt || b.slotStart).getTime();
      const waitMinutes = (currMs - arrivalMs) / (60 * 1000);
      if (this.standbyExpiryMinutes !== null && waitMinutes > this.standbyExpiryMinutes) {
        b.isExpired = true;
        b.expiredAt = currentTime;
        expiredStandbyQueue.push(b);
      } else {
        standbyQueue.push(b);
      }
    }

    // 2. Doctor Consultation Dispatch Logic
    const doctorStatus: 'IDLE' | 'BUSY' = this.currentConsultation ? 'BUSY' : 'IDLE';
    const currentServing = this.currentConsultation;

    // Next upcoming on-time patient
    const nextOnTime = waitingQueue[0] || null;
    const nextOnTimeStartMs = nextOnTime ? new Date(nextOnTime.slotStart).getTime() : null;

    // Check if on-time patient has reached their +/- 10 min window
    const isOnTimeInWindow = Boolean(
      nextOnTime && nextOnTimeStartMs && currMs >= nextOnTimeStartMs - 10 * 60 * 1000
    );

    return {
      departmentName: this.departmentName,
      doctorStatus,
      currentServing,
      liveQueue: currentServing ? [currentServing] : waitingQueue.slice(0, 1),
      upNext: currentServing
        ? waitingQueue[0] || standbyQueue[0] || null
        : waitingQueue[1] || standbyQueue[0] || null,
      waitingQueue,
      standbyQueue,
      expiredStandbyQueue,
      nextOnTime,
      isOnTimeInWindow,
      nextOnTimeStartMs,
    };
  }

  /**
   * Dispatches the next patient to consultation according to strict hospital rules
   */
  dispatchNext(currentTime: string): HospitalQueueBooking | null {
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
      const inWindow = currMs >= startMs - 10 * 60 * 1000;

      if (inWindow) {
        // D1 & D2: On-time patient in window goes straight in! Never delayed by standby.
        this.currentConsultation = this.bookings.find((b) => b.id === nextOnTime.id) || null;
        if (this.currentConsultation) {
          this.currentConsultation.consultationStart = currentTime;
        }
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
          this.currentConsultation = this.bookings.find((b) => b.id === standbyPatient.id) || null;
          if (this.currentConsultation) {
            this.currentConsultation.consultationStart = currentTime;
            this.currentConsultation.servedInGap = true;
          }
          return this.currentConsultation;
        }
      }

      // E8: Doctor would otherwise idle and no Standby patient fits the gap -> Pull in early patient!
      this.currentConsultation = this.bookings.find((b) => b.id === nextOnTime.id) || null;
      if (this.currentConsultation) {
        this.currentConsultation.consultationStart = currentTime;
        this.currentConsultation.pulledInEarly = true;
      }
      return this.currentConsultation;
    } else if (standbyPatient) {
      // D4 & D7: No waiting queue patient; Standby patient goes in immediately. Doctor never idle!
      this.currentConsultation = this.bookings.find((b) => b.id === standbyPatient.id) || null;
      if (this.currentConsultation) {
        this.currentConsultation.consultationStart = currentTime;
      }
      return this.currentConsultation;
    }

    return null;
  }

  completeCurrentConsultation(finishTime: string): void {
    if (this.currentConsultation) {
      this.currentConsultation.isCompleted = true;
      this.currentConsultation.completedAt = finishTime;
      this.completedAppointments.push(this.currentConsultation);
      this.currentConsultation = null;
    }
  }
}
