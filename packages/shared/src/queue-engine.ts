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
  status?: string;
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

export interface PatientETA {
  bookingId: string;
  estimatedStartTime: string;
  estimatedWaitMinutes: number;
  queuePosition: number;
  windowStart: string;
  windowEnd: string;
  hasLeftWindow: boolean;
  statusLabel?: string;
}

/**
 * Calculates arrival tag according to SPEC: +/- 10-minute window around slot_start
 * - < -10 min: 'Early'
 * - -10 min to +10 min: 'On Time'
 * - > +10 min: 'Late'
 * - null / undefined: 'Expected'
 */
export function calculateArrivalTag(slotStart: string, arrivedAt?: string | null): ArrivalTag {
  if (!arrivedAt) return 'Expected';
  const startMs = new Date(slotStart).getTime();
  const arrMs = new Date(arrivedAt).getTime();
  const diffMinutes = (arrMs - startMs) / (60 * 1000);

  if (diffMinutes < -10) return 'Early';
  if (diffMinutes >= -10 && diffMinutes <= 10) return 'On Time';
  return 'Late';
}

/**
 * Notification Rule (SPEC line 21):
 * Customer is notified ONLY when the live ETA leaves their +/- 10 min window.
 */
export function shouldSendEtaNotification(slotStart: string, estimatedStartTime: string): boolean {
  const slotMs = new Date(slotStart).getTime();
  const etaMs = new Date(estimatedStartTime).getTime();
  const windowStartMs = slotMs - 10 * 60 * 1000;
  const windowEndMs = slotMs + 10 * 60 * 1000;
  return etaMs < windowStartMs || etaMs > windowEndMs;
}

/**
 * Pure ETA computation function.
 * Given the current time and list of bookings, computes deterministic start time,
 * wait minutes, queue position, arrival window, and whether notification should fire.
 * Never mutates input objects or database.
 */
export function computeQueueETAs(params: {
  currentTime: string;
  bookings: HospitalQueueBooking[];
  currentConsultation?: HospitalQueueBooking | null;
  defaultDurationMinutes?: number;
}): Map<string, PatientETA> {
  const {
    currentTime,
    bookings,
    currentConsultation = null,
    defaultDurationMinutes = 15,
  } = params;

  const etaMap = new Map<string, PatientETA>();
  const currMs = new Date(currentTime).getTime();

  // Active unserved bookings (exclude CANCELLED, NO_SHOW, and COMPLETED)
  const activeBookings = bookings.filter(
    (b) => b.status !== 'CANCELLED' && b.status !== 'NO_SHOW' && !b.isCompleted
  );

  let simMs = currMs;
  let queuePositionCounter = 1;

  // 1. If doctor is actively busy with currentConsultation
  if (currentConsultation) {
    const durMs = (currentConsultation.durationMinutes || defaultDurationMinutes) * 60 * 1000;
    const startMs = currentConsultation.consultationStart
      ? new Date(currentConsultation.consultationStart).getTime()
      : currMs;
    const finishMs = Math.max(currMs, startMs + durMs);

    const slotStartMs = new Date(currentConsultation.slotStart).getTime();
    const estStartIso = new Date(startMs).toISOString();
    const wStartIso = new Date(slotStartMs - 10 * 60 * 1000).toISOString();
    const wEndIso = new Date(slotStartMs + 10 * 60 * 1000).toISOString();

    etaMap.set(currentConsultation.id, {
      bookingId: currentConsultation.id,
      estimatedStartTime: estStartIso,
      estimatedWaitMinutes: 0,
      queuePosition: queuePositionCounter++,
      windowStart: wStartIso,
      windowEnd: wEndIso,
      hasLeftWindow: shouldSendEtaNotification(currentConsultation.slotStart, estStartIso),
      statusLabel: 'In Consultation',
    });

    simMs = finishMs;
  }

  // Work on remaining bookings not currently in consultation
  const remaining = activeBookings
    .filter((b) => !currentConsultation || b.id !== currentConsultation.id)
    .map((b) => ({
      ...b,
      durationMinutes: b.durationMinutes || defaultDurationMinutes,
      originalBookingTime: b.originalBookingTime || b.slotStart,
      arrivalTag: b.arrivalTag || calculateArrivalTag(b.slotStart, b.arrivedAt),
    }));

  while (remaining.length > 0) {
    // Identify patients checked in by simMs
    const checkedIn = remaining.filter((b) => {
      if (b.isCheckedIn) {
        if (!b.arrivedAt) return true;
        return new Date(b.arrivedAt).getTime() <= simMs;
      }
      return false;
    });

    // Waiting queue: On Time & Early, sorted by slotStart ASC
    const waitingQueue = checkedIn
      .filter((b) => b.arrivalTag === 'On Time' || b.arrivalTag === 'Early')
      .sort((a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime());

    // Standby queue: Late, sorted by originalBookingTime ASC (FIFO)
    const standbyQueue = checkedIn
      .filter((b) => b.arrivalTag === 'Late')
      .sort(
        (a, b) =>
          new Date(a.originalBookingTime!).getTime() -
          new Date(b.originalBookingTime!).getTime()
      );

    // Booked patients remaining (not late standby)
    const upcomingBooked = remaining.filter((b) => b.arrivalTag !== 'Late');

    let nextPatient: typeof remaining[0] | null = null;
    const nextOnTime = waitingQueue[0];
    const nextStandby = standbyQueue[0];

    // Priority 1: On-time patient whose window is open
    if (nextOnTime) {
      const onTimeStartMs = new Date(nextOnTime.slotStart).getTime();
      const windowOpen = simMs >= onTimeStartMs - 10 * 60 * 1000;
      if (windowOpen) {
        nextPatient = nextOnTime;
      }
    }

    // Priority 2: Standby patient if fits gap before next booked patient, OR if no booked patients left (fit check lifted!)
    if (!nextPatient && nextStandby) {
      const standbyDurationMs = (nextStandby.durationMinutes || defaultDurationMinutes) * 60 * 1000;

      // Find earliest upcoming booked patient time (excluding standby itself)
      const futureBooked = upcomingBooked.filter(
        (b) => new Date(b.slotStart).getTime() >= simMs
      );
      const nextBookedTimeMs =
        futureBooked.length > 0
          ? Math.min(...futureBooked.map((b) => new Date(b.slotStart).getTime()))
          : null;

      if (nextBookedTimeMs === null) {
        // Fit check lifted at end of day! No booked patients left
        nextPatient = nextStandby;
      } else if (simMs + standbyDurationMs <= nextBookedTimeMs) {
        // Fits in gap before next booked patient's time
        nextPatient = nextStandby;
      }
    }

    // Priority 3: Early patient whose window has not opened, only to avoid doctor idling
    if (!nextPatient && nextOnTime) {
      nextPatient = nextOnTime;
    }

    if (nextPatient) {
      const slotStartMs = new Date(nextPatient.slotStart).getTime();
      const estStartIso = new Date(simMs).toISOString();
      const waitMins = Math.max(0, Math.round((simMs - currMs) / (60 * 1000)));
      const wStartIso = new Date(slotStartMs - 10 * 60 * 1000).toISOString();
      const wEndIso = new Date(slotStartMs + 10 * 60 * 1000).toISOString();

      const isUpNext = queuePositionCounter === (currentConsultation ? 2 : 1);

      etaMap.set(nextPatient.id, {
        bookingId: nextPatient.id,
        estimatedStartTime: estStartIso,
        estimatedWaitMinutes: waitMins,
        queuePosition: queuePositionCounter++,
        windowStart: wStartIso,
        windowEnd: wEndIso,
        hasLeftWindow: shouldSendEtaNotification(nextPatient.slotStart, estStartIso),
        statusLabel: isUpNext
          ? 'Up Next'
          : nextPatient.arrivalTag === 'Late'
          ? 'Standby Queue'
          : 'Waiting',
      });

      // Advance simMs by duration
      simMs += (nextPatient.durationMinutes || defaultDurationMinutes) * 60 * 1000;

      // Remove from remaining
      const idx = remaining.findIndex((b) => b.id === nextPatient!.id);
      if (idx !== -1) remaining.splice(idx, 1);
    } else {
      // Priority 4: Otherwise wait - advance clock to next event
      let nextEventMs = Infinity;

      for (const b of remaining) {
        if (!b.isCheckedIn && b.arrivedAt) {
          const arrMs = new Date(b.arrivedAt).getTime();
          if (arrMs > simMs && arrMs < nextEventMs) nextEventMs = arrMs;
        }
        if (b.arrivalTag !== 'Late') {
          const windowStart = new Date(b.slotStart).getTime() - 10 * 60 * 1000;
          if (windowStart > simMs && windowStart < nextEventMs) nextEventMs = windowStart;
          const slotStart = new Date(b.slotStart).getTime();
          if (slotStart > simMs && slotStart < nextEventMs) nextEventMs = slotStart;
        }
      }

      if (nextEventMs === Infinity || nextEventMs <= simMs) {
        const remainingStandby = remaining.filter((b) => b.arrivalTag === 'Late');
        if (remainingStandby.length > 0) {
          // Fit check lifted for remaining standby (no future slots to wait on)
          const candidate = remainingStandby[0];
          const slotStartMs = new Date(candidate.slotStart).getTime();
          const estStartIso = new Date(simMs).toISOString();
          const waitMins = Math.max(0, Math.round((simMs - currMs) / (60 * 1000)));

          const isUpNext = queuePositionCounter === (currentConsultation ? 2 : 1);

          etaMap.set(candidate.id, {
            bookingId: candidate.id,
            estimatedStartTime: estStartIso,
            estimatedWaitMinutes: waitMins,
            queuePosition: queuePositionCounter++,
            windowStart: new Date(slotStartMs - 10 * 60 * 1000).toISOString(),
            windowEnd: new Date(slotStartMs + 10 * 60 * 1000).toISOString(),
            hasLeftWindow: shouldSendEtaNotification(candidate.slotStart, estStartIso),
            statusLabel: isUpNext ? 'Up Next' : 'Standby Queue',
          });

          simMs += (candidate.durationMinutes || defaultDurationMinutes) * 60 * 1000;
          const idx = remaining.findIndex((b) => b.id === candidate.id);
          if (idx !== -1) remaining.splice(idx, 1);
        } else {
          // Unarrived booked patients
          const nextBooked = remaining.sort(
            (a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime()
          )[0];
          const slotStartMs = new Date(nextBooked.slotStart).getTime();
          simMs = Math.max(simMs, slotStartMs);
          const estStartIso = new Date(simMs).toISOString();
          const waitMins = Math.max(0, Math.round((simMs - currMs) / (60 * 1000)));

          const isUpNext = queuePositionCounter === (currentConsultation ? 2 : 1);

          etaMap.set(nextBooked.id, {
            bookingId: nextBooked.id,
            estimatedStartTime: estStartIso,
            estimatedWaitMinutes: waitMins,
            queuePosition: queuePositionCounter++,
            windowStart: new Date(slotStartMs - 10 * 60 * 1000).toISOString(),
            windowEnd: new Date(slotStartMs + 10 * 60 * 1000).toISOString(),
            hasLeftWindow: shouldSendEtaNotification(nextBooked.slotStart, estStartIso),
            statusLabel: isUpNext ? 'Up Next' : 'Booked',
          });

          simMs += (nextBooked.durationMinutes || defaultDurationMinutes) * 60 * 1000;
          const idx = remaining.findIndex((b) => b.id === nextBooked.id);
          if (idx !== -1) remaining.splice(idx, 1);
        }
      } else {
        simMs = nextEventMs;
      }
    }
  }

  return etaMap;
}

/**
 * Convenience helper to compute pure ETA for a single patient booking.
 */
export function computePatientETA(params: {
  bookingId: string;
  currentTime: string;
  bookings: HospitalQueueBooking[];
  currentConsultation?: HospitalQueueBooking | null;
  defaultDurationMinutes?: number;
}): PatientETA | null {
  const etas = computeQueueETAs(params);
  return etas.get(params.bookingId) || null;
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
   * Internal helper: determines the next eligible booking to dispatch according to strict SPEC ordering rules.
   */
  selectNextCandidate(
    currentTime: string,
    waitingQueue: HospitalQueueBooking[],
    standbyQueue: HospitalQueueBooking[],
    upcomingBooked: HospitalQueueBooking[]
  ): HospitalQueueBooking | null {
    const currMs = new Date(currentTime).getTime();

    const nextOnTime = waitingQueue[0];
    const standbyPatient = standbyQueue[0];

    // Priority 1: On-time patient whose +/- 10 min window is open
    if (nextOnTime) {
      const startMs = new Date(nextOnTime.slotStart).getTime();
      const inWindow = currMs >= startMs - 10 * 60 * 1000;
      if (inWindow) {
        return nextOnTime;
      }
    }

    // Priority 2: Standby Queue in original booking order (FIFO),
    // only if consultation finishes before next booked patient's time (fit check)
    // OR if no booked patients left (fit check lifted at end of day)
    if (standbyPatient) {
      const standbyDurationMs = (standbyPatient.durationMinutes || 15) * 60 * 1000;

      // Find future booked patients
      const futureBooked = upcomingBooked.filter((b) => new Date(b.slotStart).getTime() >= currMs);
      const nextBookedTimeMs =
        futureBooked.length > 0
          ? Math.min(...futureBooked.map((b) => new Date(b.slotStart).getTime()))
          : null;

      if (nextBookedTimeMs === null) {
        // Fit check lifted at end of day / no booked patients left!
        return standbyPatient;
      } else if (currMs + standbyDurationMs <= nextBookedTimeMs) {
        // Fits in gap before next booked patient's time
        return standbyPatient;
      }
    }

    // Priority 3: Early patient whose window has not opened, only to avoid doctor idling
    if (nextOnTime) {
      return nextOnTime;
    }

    // Priority 4: Otherwise wait
    return null;
  }

  getNextEligibleBooking(currentTime: string): HospitalQueueBooking | null {
    const currMs = new Date(currentTime).getTime();

    // 1. Separate checked-in patients into Waiting Queue vs Standby Queue
    const checkedIn = this.bookings.filter(
      (b) => b.isCheckedIn && !b.isCompleted && b !== this.currentConsultation
    );

    const waitingQueue = checkedIn
      .filter((b) => {
        const tag = b.arrivalTag || calculateArrivalTag(b.slotStart, b.arrivedAt);
        return tag === 'On Time' || tag === 'Early';
      })
      .sort((a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime());

    const standbyQueue = checkedIn
      .filter((b) => {
        const tag = b.arrivalTag || calculateArrivalTag(b.slotStart, b.arrivedAt);
        if (tag !== 'Late') return false;
        if (this.standbyExpiryMinutes !== null) {
          const arrivalMs = new Date(b.arrivedAt || b.slotStart).getTime();
          const waitMinutes = (currMs - arrivalMs) / (60 * 1000);
          if (waitMinutes > this.standbyExpiryMinutes) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          new Date(a.originalBookingTime || a.slotStart).getTime() -
          new Date(b.originalBookingTime || b.slotStart).getTime()
      );

    const upcomingBooked = this.bookings.filter((b) => {
      if (b.isCompleted || b === this.currentConsultation) return false;
      const tag = b.arrivalTag || calculateArrivalTag(b.slotStart, b.arrivedAt);
      return tag !== 'Late';
    });

    return this.selectNextCandidate(currentTime, waitingQueue, standbyQueue, upcomingBooked);
  }

  /**
   * Evaluates the current state of queues at simulated currentTime.
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

    // Standby Queue: Nobody is dropped per SPEC ("Nobody is dropped")
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

    // Determine upNext using candidate selection
    let nextCandidate: HospitalQueueBooking | null = null;
    const upcomingBooked = this.bookings.filter((b) => {
      if (b.isCompleted || b === this.currentConsultation) return false;
      const tag = b.arrivalTag || calculateArrivalTag(b.slotStart, b.arrivedAt);
      return tag !== 'Late';
    });

    if (currentServing) {
      const durMs = (currentServing.durationMinutes || 15) * 60 * 1000;
      const startMs = currentServing.consultationStart
        ? new Date(currentServing.consultationStart).getTime()
        : currMs;
      const finishIso = new Date(Math.max(currMs, startMs + durMs)).toISOString();
      nextCandidate = this.selectNextCandidate(finishIso, waitingQueue, standbyQueue, upcomingBooked);
    } else {
      nextCandidate = this.selectNextCandidate(currentTime, waitingQueue, standbyQueue, upcomingBooked);
    }

    return {
      departmentName: this.departmentName,
      doctorStatus,
      currentServing,
      liveQueue: currentServing ? [currentServing] : (nextCandidate ? [nextCandidate] : []),
      upNext: nextCandidate,
      waitingQueue,
      standbyQueue,
      expiredStandbyQueue,
      nextOnTime,
      isOnTimeInWindow,
      nextOnTimeStartMs,
    };
  }

  /**
   * Dispatches the next patient to consultation according to strict hospital rules.
   * If options.peekOnly is true, determines who would be next WITHOUT starting consultation.
   */
  dispatchNext(
    currentTime: string,
    options?: { peekOnly?: boolean }
  ): HospitalQueueBooking | null {
    if (this.currentConsultation && !options?.peekOnly) {
      // Doctor is currently busy
      return this.currentConsultation;
    }

    let evalTime = currentTime;
    if (this.currentConsultation && options?.peekOnly) {
      const durMs = (this.currentConsultation.durationMinutes || 15) * 60 * 1000;
      const startMs = this.currentConsultation.consultationStart
        ? new Date(this.currentConsultation.consultationStart).getTime()
        : new Date(currentTime).getTime();
      evalTime = new Date(Math.max(new Date(currentTime).getTime(), startMs + durMs)).toISOString();
    }

    const candidate = this.getNextEligibleBooking(evalTime);
    if (!candidate) return null;

    const booking = this.bookings.find((b) => b.id === candidate.id) || candidate;

    if (!options?.peekOnly) {
      this.currentConsultation = booking;
      this.currentConsultation.consultationStart = currentTime;

      const tag = booking.arrivalTag || calculateArrivalTag(booking.slotStart, booking.arrivedAt);
      if (tag === 'Late') {
        this.currentConsultation.servedInGap = true;
      } else {
        const startMs = new Date(booking.slotStart).getTime();
        const currMs = new Date(currentTime).getTime();
        if (currMs < startMs - 10 * 60 * 1000) {
          this.currentConsultation.pulledInEarly = true;
        }
      }
    }

    return booking;
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

