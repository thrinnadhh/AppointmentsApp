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
 *    - Waiting Queue: On Time & Early checked-in patients (not skipped), sorted by slotStart ASC
 *    - Standby Queue: Late or skipped checked-in patients, sorted by originalBookingTime ASC (FIFO)
 * 3. dispatchNext:
 *    - Active consultation: Returns currentConsultation if doctor is busy.
 *    - On-Time at slot start: On-time patient whose slotStart has arrived goes immediately.
 *    - Gap Fit Check (First-Fit): Before nextWaiting.slotStart, the first Standby patient whose
 *      duration fits in (nextWaiting.slotStart - currentTime) is dispatched into the gap.
 *    - Gap Too Short / Early Pull-Forward: If no Standby patient fits, pull in nextWaiting
 *      (unless an earlier unarrived booking's slot has not started yet and would be overrun).
 *    - No Waiting Queue Left: When no on-time patients are present, Standby[0] goes immediately.
 *    - Idle: If no eligible patients are present, returns null.
 */

export type ArrivalTag = 'Early' | 'On Time' | 'Late' | 'Expected';

export const ON_TIME_GRACE_MINUTES = 5;
export const ON_TIME_GRACE_MS = ON_TIME_GRACE_MINUTES * 60 * 1000;

/**
 * Converts a Date or ISO timestamp into a YYYY-MM-DD calendar date string
 * in the clinic's timezone (defaults to Asia/Kolkata IST).
 */
export function toClinicDateString(
  input: Date | string,
  timeZone = 'Asia/Kolkata'
): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date input for toClinicDateString');
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Creates a Date anchored to a specific YYYY-MM-DD and HH:MM in Asia/Kolkata (+05:30).
 */
export function toClinicAnchorDate(
  dateString: string,
  timeHHMM = '09:00'
): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error(`Invalid clinic dateString: ${dateString}`);
  }
  if (!/^\d{2}:\d{2}$/.test(timeHHMM)) {
    throw new Error(`Invalid clinic timeHHMM: ${timeHHMM}`);
  }
  const d = new Date(`${dateString}T${timeHHMM}:00+05:30`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid clinic anchor date: ${dateString} ${timeHHMM}`);
  }
  return d;
}

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
  wasSkipped?: boolean;
  isWalkIn?: boolean;
  status?: string;
  department?: string;
  [key: string]: any;
}

export interface EvaluatedQueuesState {
  departmentName: string;
  doctorStatus: 'IDLE' | 'BUSY';
  currentServing: HospitalQueueBooking | null;
  activeConsultation: HospitalQueueBooking | null;
  liveQueue: HospitalQueueBooking[];
  upNext: HospitalQueueBooking | null;
  waitingQueue: HospitalQueueBooking[];
  onTimeQueue: HospitalQueueBooking[];
  standbyQueue: HospitalQueueBooking[];
  expiredStandbyQueue: HospitalQueueBooking[];
  nextOnTime: HospitalQueueBooking | null;
  isOnTimeInWindow: boolean;
  nextOnTimeStartMs: number | null;
}

export interface PatientETA {
  bookingId: string;
  patientName?: string;
  slotStart: string;
  estimatedStartTime: string;
  estimatedWaitMinutes: number;
  queuePosition: number;
  arrivalWindowStart: string;
  arrivalWindowEnd: string;
  hasLeftWindow: boolean;
}

export function shouldSendEtaNotification(slotStart: string, estimatedStartTime: string): boolean {
  const slotMs = new Date(slotStart).getTime();
  const etaMs = new Date(estimatedStartTime).getTime();
  const windowStartMs = slotMs - 10 * 60 * 1000;
  const windowEndMs = slotMs + 10 * 60 * 1000;
  return etaMs < windowStartMs || etaMs > windowEndMs;
}


export interface ConsultantQueueEvaluation extends EvaluatedQueuesState {
  resourceId: string | null;
  orderedDispatchQueue: HospitalQueueBooking[];
  positionByBookingId: Map<string, number>;
  waitMinutesByBookingId: Map<string, number>;
}

const ACTIVE_STATUSES = new Set(['CONFIRMED', 'CHECKED_IN', 'WAITING', 'BOOKED']);
const IGNORED_STATUSES = new Set(['CANCELLED', 'NO_SHOW', 'DOCTOR_LEFT']);
const MAX_BOOKING_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

function toIsoStringInput(val: Date | string, label: string): string {
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) {
      throw new Error(`Invalid ${label}: Date is NaN`);
    }
    return val.toISOString();
  }
  if (typeof val !== 'string' || !val.trim()) {
    throw new Error(`Invalid ${label}: must be a non-empty ISO string`);
  }
  const ms = new Date(val).getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ${label} timestamp: ${val}`);
  }
  return val;
}


export function calculateArrivalTag(slotStart: string, arrivedAt?: string | null): ArrivalTag {
  if (typeof slotStart !== 'string' || !slotStart.trim()) {
    throw new Error('Invalid slotStart: must be a non-empty ISO date string');
  }
  const startMs = new Date(slotStart).getTime();
  if (Number.isNaN(startMs)) {
    throw new Error(`Invalid slotStart timestamp: ${slotStart}`);
  }

  if (arrivedAt === null || arrivedAt === undefined) {
    return 'Expected';
  }
  if (typeof arrivedAt !== 'string' || !arrivedAt.trim()) {
    throw new Error('Invalid arrivedAt: must be a non-empty ISO date string when provided');
  }
  const arrMs = new Date(arrivedAt).getTime();
  if (Number.isNaN(arrMs)) {
    throw new Error(`Invalid arrivedAt timestamp: ${arrivedAt}`);
  }

  const diffMinutes = (arrMs - startMs) / (60 * 1000);

  if (diffMinutes < -ON_TIME_GRACE_MINUTES) return 'Early';
  if (diffMinutes >= -ON_TIME_GRACE_MINUTES && diffMinutes <= ON_TIME_GRACE_MINUTES) return 'On Time';
  return 'Late';
}


function cloneBooking(b: HospitalQueueBooking): HospitalQueueBooking {
  const copy = { ...b };
  delete copy._slotStartMs;
  delete copy._originalBookingMs;
  delete copy._arrivedAtMs;
  delete copy._tagSlotStart;
  return copy;
}

function attachBookingsHelpers(arr: HospitalQueueBooking[]): HospitalQueueBooking[] {
  Object.defineProperties(arr, {
    size: {
      get() {
        return arr.length;
      },
      enumerable: false,
      configurable: true,
    },
    get: {
      value(id: string) {
        return arr.find((item) => item.id === id);
      },
      enumerable: false,
      configurable: true,
    },
  });
  return arr;
}


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
      patientName: currentConsultation.patientName,
      slotStart: currentConsultation.slotStart,
      estimatedStartTime: estStartIso,
      estimatedWaitMinutes: 0,
      queuePosition: queuePositionCounter++,
      arrivalWindowStart: wStartIso,
      arrivalWindowEnd: wEndIso,
      hasLeftWindow: shouldSendEtaNotification(currentConsultation.slotStart, estStartIso),
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

    // Priority 2: Standby patient if fits gap before next booked patient, OR if no booked patients left
    if (!nextPatient && nextStandby) {
      const standbyDurationMs = (nextStandby.durationMinutes || defaultDurationMinutes) * 60 * 1000;

      const futureBooked = upcomingBooked.filter(
        (b) => new Date(b.slotStart).getTime() >= simMs
      );
      const nextBookedTimeMs =
        futureBooked.length > 0
          ? Math.min(...futureBooked.map((b) => new Date(b.slotStart).getTime()))
          : null;

      if (nextBookedTimeMs === null) {
        nextPatient = nextStandby;
      } else if (simMs + standbyDurationMs <= nextBookedTimeMs) {
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

      etaMap.set(nextPatient.id, {
        bookingId: nextPatient.id,
        patientName: nextPatient.patientName,
        slotStart: nextPatient.slotStart,
        estimatedStartTime: estStartIso,
        estimatedWaitMinutes: waitMins,
        queuePosition: queuePositionCounter++,
        arrivalWindowStart: wStartIso,
        arrivalWindowEnd: wEndIso,
        hasLeftWindow: shouldSendEtaNotification(nextPatient.slotStart, estStartIso),
      });

      simMs += (nextPatient.durationMinutes || defaultDurationMinutes) * 60 * 1000;
      const idx = remaining.findIndex((b) => b.id === nextPatient!.id);
      if (idx !== -1) remaining.splice(idx, 1);
    } else {
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
          const candidate = remainingStandby[0];
          const slotStartMs = new Date(candidate.slotStart).getTime();
          const estStartIso = new Date(simMs).toISOString();
          const waitMins = Math.max(0, Math.round((simMs - currMs) / (60 * 1000)));

          etaMap.set(candidate.id, {
            bookingId: candidate.id,
            patientName: candidate.patientName,
            slotStart: candidate.slotStart,
            estimatedStartTime: estStartIso,
            estimatedWaitMinutes: waitMins,
            queuePosition: queuePositionCounter++,
            arrivalWindowStart: new Date(slotStartMs - 10 * 60 * 1000).toISOString(),
            arrivalWindowEnd: new Date(slotStartMs + 10 * 60 * 1000).toISOString(),
            hasLeftWindow: shouldSendEtaNotification(candidate.slotStart, estStartIso),
          });

          simMs += (candidate.durationMinutes || defaultDurationMinutes) * 60 * 1000;
          const idx = remaining.findIndex((b) => b.id === candidate.id);
          if (idx !== -1) remaining.splice(idx, 1);
        } else {
          const nextBooked = remaining.sort(
            (a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime()
          )[0];
          const slotStartMs = new Date(nextBooked.slotStart).getTime();
          simMs = Math.max(simMs, slotStartMs);
          const estStartIso = new Date(simMs).toISOString();
          const waitMins = Math.max(0, Math.round((simMs - currMs) / (60 * 1000)));

          etaMap.set(nextBooked.id, {
            bookingId: nextBooked.id,
            patientName: nextBooked.patientName,
            slotStart: nextBooked.slotStart,
            estimatedStartTime: estStartIso,
            estimatedWaitMinutes: waitMins,
            queuePosition: queuePositionCounter++,
            arrivalWindowStart: new Date(slotStartMs - 10 * 60 * 1000).toISOString(),
            arrivalWindowEnd: new Date(slotStartMs + 10 * 60 * 1000).toISOString(),
            hasLeftWindow: shouldSendEtaNotification(nextBooked.slotStart, estStartIso),
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

  constructor(departmentName: string | Date = 'Neurology', standbyExpiryMinutes: number | null = null) {
    this.departmentName =
      departmentName instanceof Date ? 'OPD' : String(departmentName || 'Neurology');
    this.bookings = attachBookingsHelpers([]);
    this.currentConsultation = null;
    this.completedAppointments = [];
    this.standbyExpiryMinutes = standbyExpiryMinutes;
  }

  addBooking(booking: HospitalQueueBooking): void {
    if (!booking || typeof booking.id !== 'string' || !booking.id.trim() || booking.id.length > 128) {
      throw new Error('Invalid booking id: must be 1-128 characters');
    }

    const rawSlotStart = booking.slotStart ?? booking.slotStartTime;
    const slotStartIso = toIsoStringInput(rawSlotStart, 'booking slotStart');
    const slotStartMs = new Date(slotStartIso).getTime();

    let durationMinutes = 15;
    if (booking.durationMinutes !== undefined && booking.durationMinutes !== null) {
      if (
        typeof booking.durationMinutes !== 'number' ||
        !Number.isFinite(booking.durationMinutes) ||
        booking.durationMinutes <= 0
      ) {
        throw new Error(`Invalid durationMinutes: ${booking.durationMinutes}`);
      }
      durationMinutes = booking.durationMinutes;
    }

    const rawOriginalBookingTime = booking.originalBookingTime ?? slotStartIso;
    const originalBookingIso = toIsoStringInput(rawOriginalBookingTime, 'originalBookingTime');
    const originalBookingMs = new Date(originalBookingIso).getTime();

    let arrivedAtIso: string | null = null;
    let arrivedAtMs: number | null = null;
    if (booking.arrivedAt !== undefined && booking.arrivedAt !== null) {
      arrivedAtIso = toIsoStringInput(booking.arrivedAt, 'arrivedAt');
      arrivedAtMs = new Date(arrivedAtIso).getTime();
    }

    // Engine hygiene (Item 5): ignore CANCELLED, NO_SHOW, and doctor_left
    const statusUpper = typeof booking.status === 'string' ? booking.status.toUpperCase() : undefined;
    const doctorLeft = Boolean(
      booking.doctor_left === true ||
        booking.doctorLeft === true ||
        booking.attributes?.doctor_left === true ||
        statusUpper === 'DOCTOR_LEFT'
    );
    if (doctorLeft || (statusUpper && IGNORED_STATUSES.has(statusUpper))) {
      return;
    }

    // Engine hygiene (Item 5): reject duplicate booking IDs
    const existingIdx = this.bookings.findIndex((b) => b.id === booking.id);
    if (existingIdx !== -1) {
      throw new Error(`Duplicate booking id: ${booking.id}`);
    }

    const isCheckedIn =
      booking.isCheckedIn !== undefined ? Boolean(booking.isCheckedIn) : Boolean(arrivedAtIso);
    const wasSkipped = Boolean(booking.wasSkipped || booking.skipped_at || booking.skippedAt);
    const isWalkIn =
      booking.isWalkIn !== undefined
        ? Boolean(booking.isWalkIn)
        : Boolean(booking.bookingType === 'WALK_IN' || booking.booking_type === 'WALK_IN');

    const normalized: HospitalQueueBooking = {
      ...booking,
      slotStart: slotStartIso,
      durationMinutes,
      originalBookingTime: originalBookingIso,
      isCheckedIn,
      wasSkipped,
      isWalkIn,
      arrivedAt: arrivedAtIso,
      _slotStartMs: slotStartMs,
      _originalBookingMs: originalBookingMs,
      _arrivedAtMs: arrivedAtMs,
      _tagSlotStart: arrivedAtIso ? slotStartIso : undefined,
    };

    const last = this.bookings[this.bookings.length - 1];
    this.bookings.push(normalized);
    if (last && slotStartMs < last._slotStartMs) {
      this.bookings.sort((a, b) => a._slotStartMs - b._slotStartMs);
    }
  }

  checkInPatient(bookingId: string, checkinTime: string | Date): ArrivalTag {
    const checkinIso = toIsoStringInput(checkinTime, 'checkinTime');
    const arrMs = new Date(checkinIso).getTime();

    const b = this.bookings.find((item) => item.id === bookingId);
    if (!b) throw new Error(`Booking ${bookingId} not found`);

    // Idempotent check-in: preserve original check-in timestamp and tag on duplicate scan
    if (b.isCheckedIn && b.arrivedAt) {
      return b.arrivalTag || calculateArrivalTag(b.slotStart, b.arrivedAt);
    }

    b.isCheckedIn = true;
    b.arrivedAt = checkinIso;
    b._arrivedAtMs = arrMs;
    b._tagSlotStart = b.slotStart;
    b.arrivalTag = b.wasSkipped ? 'Late' : calculateArrivalTag(b.slotStart, checkinIso);
    return b.arrivalTag;
  }


  private isEligibleActiveBooking(b: HospitalQueueBooking, currMs: number): boolean {
    if (b.isCompleted || b === this.currentConsultation) return false;
    if (
      b.doctor_left === true ||
      b.doctorLeft === true ||
      b.attributes?.doctor_left === true
    ) {
      return false;
    }
    if (b.status && (IGNORED_STATUSES.has(b.status) || !ACTIVE_STATUSES.has(b.status))) {
      return false;
    }


    if (
      b.department &&
      this.departmentName &&
      b.department.toLowerCase() !== this.departmentName.toLowerCase() &&
      !['opd', 'opd clinic', 'general opd', 'consultant'].includes(
        this.departmentName.toLowerCase()
      )
    ) {
      return false;
    }

    const slotStartMs =
      typeof b._slotStartMs === 'number' && b._tagSlotStart === b.slotStart
        ? b._slotStartMs
        : new Date(b.slotStart).getTime();
    b._slotStartMs = slotStartMs;

    if (Math.abs(currMs - slotStartMs) > MAX_BOOKING_AGE_MS) {
      return false;
    }

    return true;
  }

  private resolveInternalQueues(currMs: number, currentTimeIso: string): {
    waitingQueue: HospitalQueueBooking[];
    standbyQueue: HospitalQueueBooking[];
    expiredStandbyQueue: HospitalQueueBooking[];
    unarrivedBookings: HospitalQueueBooking[];
  } {
    const checkedIn: HospitalQueueBooking[] = [];
    const unarrivedBookings: HospitalQueueBooking[] = [];

    for (const b of this.bookings) {
      if (!this.isEligibleActiveBooking(b, currMs)) continue;

      if (b.skipped_at || b.skippedAt) {
        b.wasSkipped = true;
      }

      const arrMs =
        b.arrivedAt != null
          ? typeof b._arrivedAtMs === 'number'
            ? b._arrivedAtMs
            : new Date(b.arrivedAt).getTime()
          : null;
      b._arrivedAtMs = arrMs;

      // Clock-skew guard: late arrivals or past-slot arrivals with arrivedAt > currMs are not present yet
      const isFutureLateOrPastSlot =
        arrMs !== null &&
        arrMs > currMs &&
        (b.wasSkipped ||
          b._slotStartMs <= currMs ||
          calculateArrivalTag(b.slotStart, b.arrivedAt) === 'Late');

      if (!b.isCheckedIn || isFutureLateOrPastSlot) {
        if (!b.isCheckedIn) {
          unarrivedBookings.push(b);
        }
        continue;
      }

      // Recompute tag if slotStart was rescheduled after check-in
      if (b.wasSkipped) {
        b.arrivalTag = 'Late';
      } else if (b.arrivedAt && b._tagSlotStart && b._tagSlotStart !== b.slotStart) {
        b.arrivalTag = calculateArrivalTag(b.slotStart, b.arrivedAt);
        b._tagSlotStart = b.slotStart;
        b._slotStartMs = new Date(b.slotStart).getTime();
      } else if (!b.arrivalTag) {
        b.arrivalTag = calculateArrivalTag(b.slotStart, b.arrivedAt);
        b._tagSlotStart = b.slotStart;
      }

      b._originalBookingMs = new Date(b.originalBookingTime || b.slotStart).getTime();
      checkedIn.push(b);
    }

    const waitingQueue = checkedIn
      .filter((b) => !b.wasSkipped && (b.arrivalTag === 'On Time' || b.arrivalTag === 'Early'))
      .sort((a, b) => {
        const slotDiff = a._slotStartMs - b._slotStartMs;
        if (slotDiff !== 0) return slotDiff;
        const walkInDiff = Number(Boolean(a.isWalkIn)) - Number(Boolean(b.isWalkIn));
        if (walkInDiff !== 0) return walkInDiff;
        const arrDiff = (a._arrivedAtMs ?? 0) - (b._arrivedAtMs ?? 0);
        if (arrDiff !== 0) return arrDiff;
        return String(a.id).localeCompare(String(b.id));
      });

    // R6: Late-queue order: original slot order, scheduled before walk-in, arrival time, then id
    const lateArrivals = checkedIn
      .filter((b) => Boolean(b.wasSkipped) || b.arrivalTag === 'Late')
      .sort((a, b) => {
        const origDiff = a._originalBookingMs - b._originalBookingMs;
        if (origDiff !== 0) return origDiff;
        const walkInDiff = Number(Boolean(a.isWalkIn)) - Number(Boolean(b.isWalkIn));
        if (walkInDiff !== 0) return walkInDiff;
        const arrDiff = (a._arrivedAtMs ?? 0) - (b._arrivedAtMs ?? 0);
        if (arrDiff !== 0) return arrDiff;
        return String(a.id).localeCompare(String(b.id));
      });



    const standbyQueue: HospitalQueueBooking[] = [];
    const expiredStandbyQueue: HospitalQueueBooking[] = [];

    for (const b of lateArrivals) {
      const arrivalMs = b._arrivedAtMs ?? b._slotStartMs;
      const waitMinutes = (currMs - arrivalMs) / (60 * 1000);
      if (this.standbyExpiryMinutes !== null && waitMinutes > this.standbyExpiryMinutes) {
        b.isExpired = true;
        if (!b.expiredAt) {
          b.expiredAt = currentTimeIso;
        }
        expiredStandbyQueue.push(b);
      } else {
        standbyQueue.push(b);
      }
    }

    return { waitingQueue, standbyQueue, expiredStandbyQueue, unarrivedBookings };
  }

  private selectNextCandidate(
    evalMs: number,
    waitingQueue: HospitalQueueBooking[],
    standbyQueue: HospitalQueueBooking[],
    unarrivedBookings: HospitalQueueBooking[]
  ): { item: HospitalQueueBooking; mode: 'ON_TIME' | 'GAP' | 'EARLY' | 'STANDBY' } | null {
    const eligibleWaiting = waitingQueue.filter(
      (w) => w._arrivedAtMs == null || w._arrivedAtMs <= evalMs
    );
    const eligibleStandby = standbyQueue.filter(
      (s) => s._arrivedAtMs == null || s._arrivedAtMs <= evalMs
    );
    const futureUnarrived = unarrivedBookings.filter(
      (u) => !u.wasSkipped && u._slotStartMs > evalMs
    );
    const nextUnarrivedStartMs =
      futureUnarrived.length > 0
        ? Math.min(...futureUnarrived.map((u) => u._slotStartMs))
        : null;

    const nextOnTime = eligibleWaiting[0];

    if (nextOnTime) {
      const startMs = nextOnTime._slotStartMs;

      // 1. R1 / R4: On-time patient's slot start has arrived (or passed): immediate priority
      if (evalMs >= startMs) {
        return { item: nextOnTime, mode: 'ON_TIME' };
      }

      // 2. R5: Next present on-time patient is in the future (evalMs < startMs):
      //    Check if any Standby patient fits before the protected boundary (nextOnTime AND any earlier unarrived slot).
      const protectedStartMs =
        nextUnarrivedStartMs !== null ? Math.min(startMs, nextUnarrivedStartMs) : startMs;

      const fittingStandby = eligibleStandby.find((s) => {
        const standbyDurationMs = (s.durationMinutes || 15) * 60 * 1000;
        return evalMs + standbyDurationMs <= protectedStartMs;
      });

      if (fittingStandby) {
        return { item: fittingStandby, mode: 'GAP' };
      }

      // 3. No Standby patient fits in the remaining gap before protectedStartMs:
      //    Rule 3 / Rule 5 pulls nextOnTime forward UNLESS an earlier unarrived booking's
      //    slot has not started yet (evalMs < e.slotStart) and would be overrun.
      const nextDurationMs = (nextOnTime.durationMinutes || 15) * 60 * 1000;
      const overrunsFutureEarlierSlot = unarrivedBookings.some((e) => {
        const eStartMs = e._slotStartMs;
        return (
          !e.wasSkipped &&
          eStartMs < startMs &&
          evalMs < eStartMs &&
          evalMs + nextDurationMs > eStartMs
        );
      });

      if (overrunsFutureEarlierSlot) {
        return null;
      }

      return { item: nextOnTime, mode: 'EARLY' };
    }

    if (eligibleStandby.length > 0) {
      // R5: A late patient enters a gap ONLY if their consultation fits before the next scheduled slot,
      // INCLUDING scheduled patients who have not arrived yet.
      if (nextUnarrivedStartMs !== null) {
        const fittingStandby = eligibleStandby.find((s) => {
          const standbyDurationMs = (s.durationMinutes || 15) * 60 * 1000;
          return evalMs + standbyDurationMs <= nextUnarrivedStartMs;
        });
        if (fittingStandby) {
          return { item: fittingStandby, mode: 'GAP' };
        }
        return null;
      }
      return { item: eligibleStandby[0], mode: 'STANDBY' };
    }

    return null;
  }

  /**
   * Evaluates the current state of queues at simulated currentTime
   */
  evaluateQueues(currentTime: string | Date): EvaluatedQueuesState {
    const currentTimeIso = toIsoStringInput(currentTime, 'currentTime');
    const currMs = new Date(currentTimeIso).getTime();

    const { waitingQueue, standbyQueue, expiredStandbyQueue, unarrivedBookings } =
      this.resolveInternalQueues(currMs, currentTimeIso);

    const doctorStatus: 'IDLE' | 'BUSY' = this.currentConsultation ? 'BUSY' : 'IDLE';
    const currentServing = this.currentConsultation ? cloneBooking(this.currentConsultation) : null;

    const nextOnTime = waitingQueue[0] ? cloneBooking(waitingQueue[0]) : null;
    const nextOnTimeStartMs = waitingQueue[0] ? waitingQueue[0]._slotStartMs : null;

    const isOnTimeInWindow = Boolean(
      nextOnTime && nextOnTimeStartMs !== null && currMs >= nextOnTimeStartMs
    );

    const idleCandidate = this.selectNextCandidate(
      currMs,
      waitingQueue,
      standbyQueue,
      unarrivedBookings
    );

    let busyNextCandidate = idleCandidate;
    if (this.currentConsultation) {
      const consultStartMs = this.currentConsultation.consultationStart
        ? new Date(this.currentConsultation.consultationStart).getTime()
        : currMs;
      const finishMs = Math.max(
        currMs,
        consultStartMs + (this.currentConsultation.durationMinutes || 15) * 60 * 1000
      );
      busyNextCandidate = this.selectNextCandidate(
        finishMs,
        waitingQueue,
        standbyQueue,
        unarrivedBookings
      );
    }

    const liveQueue = currentServing
      ? [currentServing]
      : idleCandidate
        ? [cloneBooking(idleCandidate.item)]
        : [];

    const upNext = currentServing
      ? busyNextCandidate
        ? cloneBooking(busyNextCandidate.item)
        : null
      : idleCandidate
        ? cloneBooking(idleCandidate.item)
        : null;

    const clonedWaiting = waitingQueue.map(cloneBooking);

    return {
      departmentName: this.departmentName,
      doctorStatus,
      currentServing,

      activeConsultation: currentServing,
      liveQueue,
      upNext,
      waitingQueue: clonedWaiting,
      onTimeQueue: clonedWaiting,
      standbyQueue: standbyQueue.map(cloneBooking),
      expiredStandbyQueue: expiredStandbyQueue.map(cloneBooking),

      nextOnTime,
      isOnTimeInWindow,
      nextOnTimeStartMs,
    };
  }

  /**
   * Dispatches the next patient to consultation according to strict hospital rules.
   * If options.peekOnly is true, determines who would be next WITHOUT starting consultation.
   */

  dispatchNext(currentTime: string | Date): HospitalQueueBooking | null {
    const currentTimeIso = toIsoStringInput(currentTime, 'currentTime');
    const currMs = new Date(currentTimeIso).getTime();

    if (this.currentConsultation) {
      const consultStartMs = this.currentConsultation.consultationStart
        ? new Date(this.currentConsultation.consultationStart).getTime()
        : currMs;
      const consultEndMs =
        consultStartMs + (this.currentConsultation.durationMinutes || 15) * 60 * 1000;
      if (currMs >= consultEndMs) {
        this.completeCurrentConsultation(new Date(consultEndMs).toISOString());
      } else {
        return this.currentConsultation;
      }
    }

    const { waitingQueue, standbyQueue, unarrivedBookings } = this.resolveInternalQueues(
      currMs,
      currentTimeIso
    );

    const decision = this.selectNextCandidate(
      currMs,
      waitingQueue,
      standbyQueue,
      unarrivedBookings
    );

    if (!decision) {
      return null;
    }

    const chosen = decision.item;
    const chosenStartMs = chosen._slotStartMs;

    // R7: Mark absent bookings whose turn was skipped by this dispatch
    let skippedAtOrBeforeNow = 0;
    for (const b of unarrivedBookings) {
      if (!b.wasSkipped && b._slotStartMs <= currMs) {
        b.wasSkipped = true;
        b.skippedAt = currentTimeIso;
        skippedAtOrBeforeNow++;
      }
    }

    if (skippedAtOrBeforeNow === 0) {
      const earliestFutureAbsentAhead = unarrivedBookings.find(
        (b) => !b.wasSkipped && b._slotStartMs < chosenStartMs
      );
      if (earliestFutureAbsentAhead) {
        earliestFutureAbsentAhead.wasSkipped = true;
        earliestFutureAbsentAhead.skippedAt = currentTimeIso;
      }
    }

    this.currentConsultation = chosen;
    this.currentConsultation.consultationStart = currentTimeIso;
    if (decision.mode === 'GAP') {
      this.currentConsultation.servedInGap = true;
    } else if (decision.mode === 'EARLY') {
      this.currentConsultation.pulledInEarly = true;
    }

    return this.currentConsultation;

  }

  completeCurrentConsultation(finishTime: string | Date): void {
    const finishIso = toIsoStringInput(finishTime, 'finishTime');
    if (this.currentConsultation) {
      this.currentConsultation.isCompleted = true;
      this.currentConsultation.completedAt = finishIso;
      this.completedAppointments.push(this.currentConsultation);
      this.currentConsultation = null;
    }
  }
}


/**
 * Pure per-consultant queue evaluator (Phase 3 Item 1).
 * Computes queue state, ordered dispatch sequence, 1-indexed positions, and wait estimates
 * strictly per consultant (resource_id), never mixing doctors across a hospital.
 */
export function evaluateConsultantQueue(
  rows: Record<string, any>[],
  options: {
    now?: Date | string;
    resourceId?: string | null;
    clinicDateStr?: string | null;
    defaultDurationMinutes?: number;
    standbyExpiryMinutes?: number | null;
  } = {}
): ConsultantQueueEvaluation {
  const nowIso = toIsoStringInput(options.now ?? new Date(), 'now');
  const nowMs = new Date(nowIso).getTime();
  const resourceId = options.resourceId ?? null;
  const clinicDateStr = options.clinicDateStr ?? null;
  const defaultDuration = options.defaultDurationMinutes ?? 15;

  const filtered = (rows || []).filter((r) => {
    if (!r || typeof r.id !== 'string') return false;
    if (resourceId !== null) {
      const rResId = r.resource_id ?? r.resourceId ?? null;
      if (rResId !== resourceId) return false;
    }
    const statusUpper = typeof r.status === 'string' ? r.status.toUpperCase() : 'CONFIRMED';
    if (IGNORED_STATUSES.has(statusUpper)) return false;
    if (
      r.doctor_left === true ||
      r.doctorLeft === true ||
      r.attributes?.doctor_left === true
    ) {
      return false;
    }
    const slotStartRaw = r.start_time ?? r.slot_start ?? r.slotStart;
    if (!slotStartRaw) return false;
    if (clinicDateStr && toClinicDateString(slotStartRaw) !== clinicDateStr) {
      return false;
    }
    return true;
  });

  // Identify served (IN_CONSULTATION / COMPLETED) bookings to derive stateless R7 skip state
  const servedBookings = filtered
    .filter((r) => {
      const st = String(r.status || '').toUpperCase();
      return st === 'IN_CONSULTATION' || st === 'COMPLETED' || Boolean(r.isCompleted);
    })
    .map((r) => {
      const slotMs = new Date(r.start_time ?? r.slot_start ?? r.slotStart).getTime();
      const consultMs = new Date(
        r.consultation_started_at ??
          r.consultationStart ??
          r.updated_at ??
          r.start_time ??
          r.slot_start ??
          r.slotStart
      ).getTime();
      return { id: r.id, slotMs, consultMs };
    });

  const engine = new HospitalDepartmentQueueEngine(
    resourceId || 'Consultant',
    options.standbyExpiryMinutes ?? null
  );
  const simEngine = new HospitalDepartmentQueueEngine(
    resourceId || 'Consultant',
    options.standbyExpiryMinutes ?? null
  );

  let activeRowNormalized: HospitalQueueBooking | null = null;

  for (const r of filtered) {
    const statusUpper = typeof r.status === 'string' ? r.status.toUpperCase() : 'CONFIRMED';
    if (statusUpper === 'COMPLETED' || r.isCompleted) {
      continue;
    }

    const slotStartIso = toIsoStringInput(
      r.start_time ?? r.slot_start ?? r.slotStart,
      'slotStart'
    );
    const slotEndRaw = r.end_time ?? r.slot_end ?? r.slotEnd;
    const slotStartMs = new Date(slotStartIso).getTime();
    let durationMinutes = Number(r.duration_minutes ?? r.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      if (slotEndRaw) {
        const diffMin = Math.round((new Date(slotEndRaw).getTime() - slotStartMs) / 60000);
        durationMinutes = diffMin > 0 ? diffMin : defaultDuration;
      } else {
        durationMinutes = defaultDuration;
      }
    }

    const isPresent = Boolean(
      r.is_present ?? r.isCheckedIn ?? (statusUpper === 'CHECKED_IN' || statusUpper === 'IN_CONSULTATION')
    );
    const rawArrived = r.arrived_at ?? r.checked_in_at ?? r.arrivedAt ?? null;
    const arrivedAtIso =
      rawArrived != null ? toIsoStringInput(rawArrived, 'arrivedAt') : isPresent ? slotStartIso : null;
    const arrivedMs = arrivedAtIso ? new Date(arrivedAtIso).getTime() : null;

    if (statusUpper === 'IN_CONSULTATION') {
      const consultStartIso = toIsoStringInput(
        r.consultation_started_at ?? r.consultationStart ?? r.updated_at ?? slotStartIso,
        'consultationStart'
      );
      activeRowNormalized = {
        ...r,
        id: r.id,
        patientName: r.customer_name ?? r.patientName,
        slotStart: slotStartIso,
        slotEnd: slotEndRaw ? toIsoStringInput(slotEndRaw, 'slotEnd') : undefined,
        durationMinutes,
        isCheckedIn: true,
        arrivedAt: arrivedAtIso,
        consultationStart: consultStartIso,
        status: 'IN_CONSULTATION',
      };
      continue;
    }

    // Stateless R7 check: was this booking skipped while absent?
    let wasSkipped = Boolean(r.skipped_at || r.skippedAt || r.wasSkipped || r.is_late_queue);
    if (!wasSkipped) {
      const skippedByLaterServed = servedBookings.some(
        (served) =>
          served.id !== r.id &&
          served.slotMs > slotStartMs &&
          (arrivedMs === null || arrivedMs > served.consultMs)
      );
      if (skippedByLaterServed) {
        wasSkipped = true;
      }
    }

    const bookingInput: HospitalQueueBooking = {
      ...r,
      id: r.id,
      patientName: r.customer_name ?? r.patientName,
      slotStart: slotStartIso,
      slotEnd: slotEndRaw ? toIsoStringInput(slotEndRaw, 'slotEnd') : undefined,
      durationMinutes,
      isCheckedIn: isPresent,
      arrivedAt: isPresent ? arrivedAtIso : null,
      wasSkipped,
      isWalkIn: Boolean(
        r.isWalkIn || r.booking_type === 'WALK_IN' || r.bookingType === 'WALK_IN'
      ),
      status: 'CONFIRMED',
    };

    engine.addBooking(bookingInput);
    simEngine.addBooking({ ...bookingInput });
  }

  if (activeRowNormalized) {
    engine.currentConsultation = activeRowNormalized;
  }

  const baseState = engine.evaluateQueues(nowIso);

  const orderedDispatchQueue: HospitalQueueBooking[] = [];
  const positionByBookingId = new Map<string, number>();
  const waitMinutesByBookingId = new Map<string, number>();

  let simMs = nowMs;
  if (activeRowNormalized) {
    positionByBookingId.set(activeRowNormalized.id, 0);
    waitMinutesByBookingId.set(activeRowNormalized.id, 0);
    const cStartMs = activeRowNormalized.consultationStart
      ? new Date(activeRowNormalized.consultationStart).getTime()
      : nowMs;
    const cEndMs = cStartMs + (activeRowNormalized.durationMinutes || defaultDuration) * 60 * 1000;
    simMs = Math.max(nowMs, cEndMs);
  }

  const totalPresentWaiting =
    baseState.waitingQueue.length + baseState.standbyQueue.length;

  for (let step = 0; step < totalPresentWaiting + 20; step++) {
    const simIso = new Date(simMs).toISOString();
    const simSnap = simEngine.evaluateQueues(simIso);
    if (simSnap.waitingQueue.length === 0 && simSnap.standbyQueue.length === 0) {
      break;
    }

    const next = simEngine.dispatchNext(simIso);
    if (!next) {
      // Blocked by an unarrived future slot (R5): advance clock to that slot's end
      const futureUnarrived = simEngine.bookings
        .filter((b) => !b.isCompleted && !b.isCheckedIn && !b.wasSkipped && b._slotStartMs > simMs)
        .sort((a, b) => a._slotStartMs - b._slotStartMs);
      if (futureUnarrived.length > 0) {
        const u = futureUnarrived[0];
        u.wasSkipped = true;
        simMs = u._slotStartMs + (u.durationMinutes || defaultDuration) * 60 * 1000;
        continue;
      }
      break;
    }

    const cloned = cloneBooking(next);
    orderedDispatchQueue.push(cloned);
    const pos = orderedDispatchQueue.length;
    positionByBookingId.set(cloned.id, pos);
    const waitMin = Math.max(0, Math.ceil((simMs - nowMs) / 60000));
    waitMinutesByBookingId.set(cloned.id, waitMin);

    simMs += (next.durationMinutes || defaultDuration) * 60 * 1000;
    simEngine.completeCurrentConsultation(new Date(simMs).toISOString());
  }

  return {
    ...baseState,
    resourceId,
    orderedDispatchQueue,
    positionByBookingId,
    waitMinutesByBookingId,
  };
}

