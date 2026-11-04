/**
 * queue-scheduler.ts
 * 
 * Intelligent Rolling 10-Slot Queue & Monthly Patient Attendance Engine
 * Adheres strictly to DESIGN.md tokens (#047857 primary, no purple).
 * 
 * Implements:
 * 1. Rolling 10-slot "Who's Next" live queue backed by HospitalDepartmentQueueEngine.
 * 2. Case 1: All 10 present & reception PIN verified flow sequentially.
 * 3. Case 2: Empty/unbooked windows (e.g. P11, P12, P13) displayed as FREE slots.
 * 4. Case 3: Late patient placed into free gap WITHOUT disturbing on-time patient (P14).
 * 5. Case 4: If late patient would disturb P14's time, late patient waits for next free slot.
 * 6. Case 5: If no late patient and current slot is absent/empty, next present on-time patient
 *    is pulled forward to the doctor without idle delay (Rule 3).
 * 7. Monthly Patient Attendance: Present (Green) vs Absent / No-Show (Red) calendar matrix in IST.
 */

import {
  HospitalDepartmentQueueEngine,
  calculateArrivalTag,
  evaluateConsultantQueue,
  ON_TIME_GRACE_MINUTES,
  ON_TIME_GRACE_MS,
  toClinicAnchorDate,
  toClinicDateString,
  computeQueueETAs,
  computePatientETA,
  shouldSendEtaNotification,
  type ArrivalTag,
  type ConsultantQueueEvaluation,
  type HospitalQueueBooking,
  type EvaluatedQueuesState,
  type PatientETA,
} from '@appointments/shared/queue-engine';

export {
  HospitalDepartmentQueueEngine,
  calculateArrivalTag,
  evaluateConsultantQueue,
  ON_TIME_GRACE_MINUTES,
  ON_TIME_GRACE_MS,
  toClinicAnchorDate,
  toClinicDateString,
  computeQueueETAs,
  computePatientETA,
  shouldSendEtaNotification,
  type ArrivalTag,
  type ConsultantQueueEvaluation,
  type HospitalQueueBooking,
  type EvaluatedQueuesState,
  type PatientETA,
};

export type QueueSlotType = 
  | 'SERVING'
  | 'BOOKED_PRESENT'
  | 'BOOKED_AWAITING_PIN'
  | 'FREE_GAP'
  | 'LATE_ACCOMMODATED'
  | 'LATE_WAITING';

export interface QueueSlot {
  slotIndex: number; // 1 to 10+
  slotStart: string; // ISO
  slotEnd: string;   // ISO
  formattedStartTime: string; // e.g. "12:00 PM"
  formattedEndTime: string;   // e.g. "12:02 PM"
  type: QueueSlotType;
  tokenNumber: number | null;
  referenceCode: string | null;
  bookingId: string | null;
  booking?: ScheduledBookingInput | null;
  patientName: string | null;
  isPresent: boolean;
  isCurrentPatient: boolean;
  statusLabel: string;
  statusDescription: string;
  isGuaranteedUndisturbed: boolean;
  isFastTracked: boolean;
  isUpNext?: boolean;
}

export interface DayAttendance {
  dateString: string; // YYYY-MM-DD
  dayNumber: number;  // 1 to 31
  isCurrentMonth: boolean;
  isToday: boolean;
  status: 'PRESENT' | 'ABSENT' | 'UPCOMING' | 'MIXED' | 'NONE';
  totalAppointments: number;
  presentCount: number;
  absentCount: number;
  upcomingCount: number;
  queueTokensSummary: string; // e.g. "Tokens #1 to #10" or "No Queue Scheduled"
  hasGaps: boolean;
  hasLateQueue: boolean;
  appointments: {
    bookingId: string;
    tokenNumber: number;
    time: string;
    doctorName: string;
    department: string;
    customerName: string;
    referenceCode: string;
    isPresent: boolean;
    status: string;
    isLateQueue?: boolean;
    queuePosition?: number | null;
  }[];
  rollingQueueSlots?: QueueSlot[];
}

export interface MonthlyAttendanceSummary {
  year: number;
  month: number; // 1 to 12
  monthName: string;
  days: DayAttendance[];
  totalAppointments: number;
  presentCount: number;
  absentCount: number;
  attendanceRatePercentage: number;
  activeDaysCount: number;
  peakDayNumber: number | null;
  peakTokensCount: number;
}

export interface ScheduledBookingInput {
  id: string;
  reference_code?: string | null;
  slot_start?: string;
  slot_end?: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  durationMinutes?: number;
  resource_id?: string | null;
  resourceId?: string | null;
  status: string;
  is_present?: boolean;
  customer_name?: string | null;
  customer_id?: string | null;
  queue_position?: number | null;
  is_late_queue?: boolean;
  checked_in_at?: string | null;
  arrived_at?: string | null;
  skipped_at?: string | null;
  wasSkipped?: boolean;
  arrival_tag?: ArrivalTag;
  original_booking_time?: string;

  [key: string]: any;
}

function getSlotStart(b: ScheduledBookingInput): string {
  return String(b.slot_start ?? b.start_time ?? b.slotStart ?? '');
}

function getSlotEnd(b: ScheduledBookingInput): string {
  return String(b.slot_end ?? b.end_time ?? b.slotEnd ?? '');
}

function getCheckedInAt(b: ScheduledBookingInput): string | null {
  return (b.checked_in_at ?? b.arrived_at ?? b.arrivedAt ?? null) as string | null;
}

function getBookingDurationMinutes(
  b: ScheduledBookingInput,
  fallbackMinutes: number
): number {
  const explicit = Number(b.duration_minutes ?? b.durationMinutes);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const s = getSlotStart(b);
  const e = getSlotEnd(b);
  if (s && e) {
    const diff = Math.round((new Date(e).getTime() - new Date(s).getTime()) / 60000);
    if (Number.isFinite(diff) && diff > 0) {
      return diff;
    }
  }
  return fallbackMinutes;
}

export interface BuildRollingQueueParams {

  bookings: ScheduledBookingInput[];
  slotDurationMinutes?: number;
  currentBookingId?: string | null;
  anchorStartTime?: Date;
  resourceId?: string | null;
  now?: Date | string;
  dateString?: string;
  totalSlots?: number;
}

/**
 * Builds a rolling 10-slot queue unified with HospitalDepartmentQueueEngine / evaluateConsultantQueue.
 */
export function buildRollingTenSlotQueue(
  paramsOrBookings: BuildRollingQueueParams | ScheduledBookingInput[],
  maybeOptions?: Omit<BuildRollingQueueParams, 'bookings'>
): QueueSlot[] {
  const normalizedParams: BuildRollingQueueParams = Array.isArray(paramsOrBookings)
    ? { ...(maybeOptions || {}), bookings: paramsOrBookings }
    : paramsOrBookings;

  const {
    bookings,
    slotDurationMinutes = 2,
    currentBookingId = null,
    resourceId = null,
    totalSlots: requestedTotalSlots,
  } = normalizedParams;

  const anchorStartTime =
    normalizedParams.anchorStartTime ??
    (normalizedParams.now
      ? normalizedParams.now instanceof Date
        ? normalizedParams.now
        : new Date(normalizedParams.now)
      : normalizedParams.dateString
        ? toClinicAnchorDate(normalizedParams.dateString, '09:00')
        : new Date());

  const durationMs = slotDurationMinutes * 60 * 1000;
  const anchorTimeIso = anchorStartTime.toISOString();


  // Normalize and filter out cancelled / no-show / completed / other-consultant bookings
  const activeBookings = (bookings || [])
    .filter((b) => {
      if (!b || !b.id) return false;
      const st = String(b.status || '').toUpperCase();
      if (st === 'CANCELLED' || st === 'NO_SHOW' || st === 'DOCTOR_LEFT' || st === 'COMPLETED') {
        return false;
      }
      if (b.doctor_left === true || b.attributes?.doctor_left === true) return false;
      if (resourceId !== null) {
        const bRes = b.resource_id ?? b.resourceId ?? null;
        if (bRes !== resourceId) return false;
      }
      return Boolean(getSlotStart(b));
    })
    .map((b) => ({
      ...b,
      slot_start: getSlotStart(b),
      slot_end: getSlotEnd(b),
      checked_in_at: getCheckedInAt(b),
    }))
    .sort((a, b) => {
      const slotDiff = new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime();
      if (slotDiff !== 0) return slotDiff;
      const arrDiff =
        (a.checked_in_at ? new Date(a.checked_in_at).getTime() : 0) -
        (b.checked_in_at ? new Date(b.checked_in_at).getTime() : 0);
      if (arrDiff !== 0) return arrDiff;
      return String(a.id).localeCompare(String(b.id));

    });


  // Populate canonical evaluateConsultantQueue (per resourceId) to determine standby membership & upNext
  const consultantEval = evaluateConsultantQueue(activeBookings, {
    now: anchorStartTime,
    resourceId,

    defaultDurationMinutes: slotDurationMinutes,
  });
  const engineStandbyIds = new Set(consultantEval.standbyQueue.map((s) => s.id));


  // Separate normal on-time bookings from present late/standby queue bookings (Decision D3 & D7)
  const lateQueuePatients = activeBookings
    .filter((b) => {
      const isPresent = Boolean(b.is_present || b.status === 'CHECKED_IN');
      if (!isPresent) return false;
      if (b.is_late_queue || b.skipped_at || b.wasSkipped) return true;
      if (b.arrival_tag === 'Late') return true;
      if (engineStandbyIds.has(b.id)) return true;
      if (b.checked_in_at) {
        return calculateArrivalTag(b.slot_start, b.checked_in_at) === 'Late';
      }
      // Detect checked-in late patients whose queue_position was bumped above a later slot's position
      if (typeof b.queue_position === 'number') {
        const bStartMs = new Date(b.slot_start).getTime();
        const hasBumpedPosition = activeBookings.some(
          (other) =>
            new Date(other.slot_start).getTime() > bStartMs &&
            typeof other.queue_position === 'number' &&
            b.queue_position! > other.queue_position!
        );
        if (hasBumpedPosition) return true;
      }
      return false;
    })
    .sort((a, b) => {
      const aTime = new Date(a.original_booking_time || a.slot_start).getTime();
      const bTime = new Date(b.original_booking_time || b.slot_start).getTime();
      if (aTime !== bTime) return aTime - bTime;
      const arrDiff =
        (a.checked_in_at ? new Date(a.checked_in_at).getTime() : 0) -
        (b.checked_in_at ? new Date(b.checked_in_at).getTime() : 0);
      if (arrDiff !== 0) return arrDiff;
      return String(a.id).localeCompare(String(b.id));
    });


  const lateQueueIdSet = new Set(lateQueuePatients.map((l) => l.id));
  const onTimeBookings = activeBookings.filter((b) => !lateQueueIdSet.has(b.id));

  // Determine starting slot timestamp: earliest on-time booking or anchor
  let firstSlotMs = anchorStartTime.getTime();
  if (onTimeBookings.length > 0) {
    const firstOnTimeMs = new Date(onTimeBookings[0].slot_start).getTime();
    firstSlotMs = Math.min(firstSlotMs, firstOnTimeMs);
  }
  firstSlotMs = Math.floor(firstSlotMs / 60000) * 60000;

  const totalSlots = Math.max(requestedTotalSlots ?? 10, activeBookings.length);
  const slots: QueueSlot[] = [];
  const remainingLatePatients = [...lateQueuePatients];
  const consumedOnTimeIds = new Set<string>();

  let currentSlotStartMs = firstSlotMs;
  let tokenCounter = 1;

  for (let slotIndex = 1; slotIndex <= totalSlots; slotIndex++) {
    const slotEndMs = currentSlotStartMs + durationMs;
    const slotStartIso = new Date(currentSlotStartMs).toISOString();
    const slotEndIso = new Date(slotEndMs).toISOString();

    const formattedStartTime = new Date(currentSlotStartMs).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const formattedEndTime = new Date(slotEndMs).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    // 1. Find an unconsumed on-time booking for this exact window or shifted from a double-booked earlier slot
    let bookedPatient = onTimeBookings.find((b) => {
      if (consumedOnTimeIds.has(b.id)) return false;
      const bStart = new Date(b.slot_start).getTime();
      const isExactWindow = Math.abs(bStart - currentSlotStartMs) < durationMs / 2;
      const isShiftedSameSlot =
        bStart < currentSlotStartMs && Boolean(b.is_present || b.status === 'CHECKED_IN');
      return isExactWindow || isShiftedSameSlot;
    });

    let pulledForward = false;

    const bookedIsPresent = bookedPatient
      ? Boolean(bookedPatient.is_present || bookedPatient.status === 'CHECKED_IN')
      : false;

    // Look ahead to find the next unconsumed on-time patient after this slot to protect their scheduled time (R5)
    const earliestNextOnTime = onTimeBookings.find(
      (b) =>
        !consumedOnTimeIds.has(b.id) &&
        b.id !== bookedPatient?.id &&
        new Date(b.slot_start).getTime() > currentSlotStartMs
    );
    const earliestNextOnTimeStartMs = earliestNextOnTime
      ? new Date(earliestNextOnTime.slot_start).getTime()
      : null;

    // Does any waiting late patient fit before earliestNextOnTimeStartMs using their OWN duration? (Item 4)
    const anyLateFitsInCurrentGap =
      remainingLatePatients.length > 0 &&
      remainingLatePatients.some((candidate) => {
        const candDurationMs =
          getBookingDurationMinutes(candidate, slotDurationMinutes) * 60 * 1000;
        return (
          !earliestNextOnTimeStartMs ||
          currentSlotStartMs + candDurationMs <= earliestNextOnTimeStartMs
        );
      });

    // 2. Rule 3 & Rule 5: At Slot #1, if current slot is empty or its patient is absent,
    //    and no late patient fits into this gap, pull the next present on-time patient forward.
    if (slotIndex === 1 && !bookedIsPresent && !anyLateFitsInCurrentGap) {
      const nextPresentOnTime = onTimeBookings.find(
        (b) =>
          !consumedOnTimeIds.has(b.id) &&
          Boolean(b.is_present || b.status === 'CHECKED_IN')
      );
      if (nextPresentOnTime) {
        bookedPatient = nextPresentOnTime;
        pulledForward = true;
      }
    }

    // 3. If still no bookedPatient, check if an earlier absent booking was displaced by a pull-forward
    if (!bookedPatient) {
      bookedPatient = onTimeBookings.find((b) => {
        if (consumedOnTimeIds.has(b.id)) return false;
        const bStart = new Date(b.slot_start).getTime();
        return bStart < currentSlotStartMs;
      });
    }

    // Recompute next unconsumed on-time patient after resolving bookedPatient
    const nextOnTimePatient = onTimeBookings.find(
      (b) =>
        !consumedOnTimeIds.has(b.id) &&
        b.id !== bookedPatient?.id &&
        new Date(b.slot_start).getTime() > currentSlotStartMs
    );
    const nextOnTimeStartMs = nextOnTimePatient
      ? new Date(nextOnTimePatient.slot_start).getTime()
      : null;

    if (bookedPatient) {
      consumedOnTimeIds.add(bookedPatient.id);
      const isPresent = Boolean(bookedPatient.is_present || bookedPatient.status === 'CHECKED_IN');
      const isActualConsultation = bookedPatient.status === 'IN_CONSULTATION' || Boolean(currentBookingId && bookedPatient.id === currentBookingId);
      const isServing = isActualConsultation || (slotIndex === 1 && isPresent);
      const isCurrent = Boolean(currentBookingId && bookedPatient.id === currentBookingId);
      let slotType: QueueSlotType;
      let statusLabel: string;
      let statusDescription: string;

      const isUpNext = Boolean(consultantEval?.upNext?.id === bookedPatient.id && !isActualConsultation);

      if (isActualConsultation) {
        slotType = 'SERVING';
        statusLabel = 'In Consultation';
        statusDescription = pulledForward
          ? 'Arrived early — passes directly to doctor (preceding slot absent)'
          : 'With Doctor right now';
      } else if (isServing) {
        slotType = 'SERVING';
        statusLabel = isUpNext ? 'Up Next' : 'Now In Consultation';
        statusDescription = 'Arrived early — passes directly to doctor (preceding slot absent)';
      } else if (isPresent) {
        slotType = 'BOOKED_PRESENT';
        statusLabel = isUpNext ? 'Up Next' : 'Present & Ready';
        statusDescription = 'Reception PIN verified. Next in line.';
      } else {
        slotType = 'BOOKED_AWAITING_PIN';
        statusLabel = 'Awaiting Reception PIN';
        statusDescription = 'Arriving shortly. Token reserved.';
      }

      slots.push({
        slotIndex,
        slotStart: slotStartIso,
        slotEnd: slotEndIso,
        formattedStartTime,
        formattedEndTime,
        type: slotType,
        tokenNumber: bookedPatient.queue_position || tokenCounter++,
        referenceCode: bookedPatient.reference_code || `P${tokenCounter}`,
        bookingId: bookedPatient.id,
        booking: bookedPatient,
        patientName: bookedPatient.customer_name || `Patient P${tokenCounter}`,
        isPresent,
        isCurrentPatient: isCurrent,
        statusLabel,
        statusDescription,
        isGuaranteedUndisturbed: true,
        isFastTracked: pulledForward,
        isUpNext,
      });
    } else {
      // Slot has NO on-time booking (Empty Gap)
      // Item 4: First-Fit using each late candidate's OWN consultation duration against nextOnTimeStartMs (R5)
      let accommodatedLatePatient: ScheduledBookingInput | null = null;

      if (remainingLatePatients.length > 0) {
        const fittingIndex = remainingLatePatients.findIndex((candidate) => {
          const candDurationMs =
            getBookingDurationMinutes(candidate, slotDurationMinutes) * 60 * 1000;
          return !nextOnTimeStartMs || currentSlotStartMs + candDurationMs <= nextOnTimeStartMs;
        });


        if (fittingIndex !== -1) {
          const [picked] = remainingLatePatients.splice(fittingIndex, 1);
          accommodatedLatePatient = picked || null;
        }
      }

      if (accommodatedLatePatient) {
        const isCurrent = Boolean(currentBookingId && accommodatedLatePatient.id === currentBookingId);

        slots.push({
          slotIndex,
          slotStart: slotStartIso,
          slotEnd: slotEndIso,
          formattedStartTime,
          formattedEndTime,
          type: 'LATE_ACCOMMODATED',
          tokenNumber: accommodatedLatePatient.queue_position || tokenCounter++,
          referenceCode: accommodatedLatePatient.reference_code || `LATE-${tokenCounter}`,
          bookingId: accommodatedLatePatient.id,

          booking: accommodatedLatePatient,
          patientName: accommodatedLatePatient.customer_name || 'Late Patient (Accommodated)',

          isPresent: true,
          isCurrentPatient: isCurrent,
          statusLabel: 'Late Accommodated in Gap',
          statusDescription: nextOnTimePatient
            ? `Placed in gap; ${nextOnTimePatient.reference_code || 'next patient'} time undisturbed`
            : 'Fitted into available gap in Standby Queue order',
          isGuaranteedUndisturbed: false,
          isFastTracked: false,
          isUpNext: Boolean(consultantEval?.upNext?.id === accommodatedLatePatient.id),
        });
      } else if (remainingLatePatients.length > 0 && nextOnTimeStartMs) {
        slots.push({
          slotIndex,
          slotStart: slotStartIso,
          slotEnd: slotEndIso,
          formattedStartTime,
          formattedEndTime,
          type: 'LATE_WAITING',
          tokenNumber: null,
          referenceCode: null,
          bookingId: null,

          booking: null,
          patientName: 'Late Queue (Waiting for Free Window)',

          isPresent: false,
          isCurrentPatient: false,
          statusLabel: 'Late Member Waiting',
          statusDescription: `Gap tight: Waiting for free slot so ${nextOnTimePatient?.reference_code || 'P14'} is not disturbed`,
          isGuaranteedUndisturbed: true,
          isFastTracked: false,
        });
      } else {


        slots.push({
          slotIndex,
          slotStart: slotStartIso,
          slotEnd: slotEndIso,
          formattedStartTime,
          formattedEndTime,
          type: 'FREE_GAP',
          tokenNumber: null,
          referenceCode: null,
          bookingId: null,
          booking: null,
          patientName: 'Free Vacant Slot',
          isPresent: false,
          isCurrentPatient: false,
          statusLabel: 'Vacant Slot',
          statusDescription: 'Open slot available for walk-in or standby accommodation',
          isGuaranteedUndisturbed: true,
          isFastTracked: false,
        });
      }
    }

    currentSlotStartMs = slotEndMs;
  }

  return slots;
}

/**
 * Calculates calendar month attendance breakdown (Present vs Absent / No-Show) in IST (Asia/Kolkata)
 */
export function calculateMonthlyAttendance(params: {
  bookings: ScheduledBookingInput[];
  year: number;
  month: number; // 1 to 12
}): MonthlyAttendanceSummary {
  const { bookings, year, month } = params;

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month - 1] || 'Current Month';

  // Get total days in month
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = toClinicDateString(new Date());

  // Group bookings by clinic timezone date string (YYYY-MM-DD in Asia/Kolkata)
  const bookingsByDate: Record<string, ScheduledBookingInput[]> = {};
  for (const b of bookings) {
    const slotStartIso = b.slot_start || b.start_time || '';
    const dateKey = toClinicDateString(slotStartIso);
    if (!bookingsByDate[dateKey]) bookingsByDate[dateKey] = [];
    bookingsByDate[dateKey].push(b);
  }

  const days: DayAttendance[] = [];
  let totalAppointments = 0;
  let presentCount = 0;
  let absentCount = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const padDay = day < 10 ? `0${day}` : `${day}`;
    const padMonth = month < 10 ? `0${month}` : `${month}`;
    const dateString = `${year}-${padMonth}-${padDay}`;

    const dayBookings = bookingsByDate[dateString] || [];
    let dayPresent = 0;
    let dayAbsent = 0;
    let dayUpcoming = 0;

    const hasLateQueue = dayBookings.some((b) => Boolean(b.queue_position || b.is_late_queue));

    const appointmentDetails = dayBookings.map((b, idx) => {
      const isPres = Boolean(b.is_present || b.status === 'CHECKED_IN' || b.status === 'COMPLETED');
      const isAbs = b.status === 'NO_SHOW';
      const isUp = b.status === 'CONFIRMED' || b.status === 'HELD';

      if (isPres) dayPresent++;
      else if (isAbs) dayAbsent++;
      else if (isUp) dayUpcoming++;

      const slotStartIso = b.slot_start || b.start_time || '';
      const timeFormatted = new Date(slotStartIso).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });

      return {
        bookingId: b.id,
        tokenNumber: idx + 1,
        time: timeFormatted,
        doctorName: (b as any).doctor_name || 'Specialist Doctor',
        department: (b as any).department || 'Outpatient Clinic',
        customerName: b.customer_name || `Patient #${idx + 1}`,
        referenceCode: b.reference_code || 'TPT-REF',
        isPresent: isPres,
        status: b.status,
        isLateQueue: Boolean(b.queue_position || b.is_late_queue),
        queuePosition: b.queue_position,
      };
    });

    totalAppointments += dayBookings.length;
    presentCount += dayPresent;
    absentCount += dayAbsent;

    let dayStatus: DayAttendance['status'] = 'NONE';
    if (dayBookings.length > 0) {
      if (dayPresent > 0 && dayAbsent === 0 && dayUpcoming === 0) {
        dayStatus = 'PRESENT';
      } else if (dayAbsent > 0 && dayPresent === 0) {
        dayStatus = 'ABSENT';
      } else if (dayUpcoming > 0 && dayPresent === 0 && dayAbsent === 0) {
        dayStatus = 'UPCOMING';
      } else {
        dayStatus = 'MIXED';
      }
    }

    const queueTokensSummary = dayBookings.length > 0
      ? `Tokens #1 to #${dayBookings.length}`
      : 'No Queue Scheduled';

    // Build rolling 10-slot queue for the day anchored at 09:00 IST (+05:30)
    let rollingQueueSlots: QueueSlot[] = [];
    if (dayBookings.length > 0) {
      rollingQueueSlots = buildRollingTenSlotQueue({
        bookings: dayBookings,
        slotDurationMinutes: 2,
        anchorStartTime: new Date(`${dateString}T09:00:00+05:30`),
      });
    }

    const hasGaps = rollingQueueSlots.some((s) => s.type === 'FREE_GAP');

    days.push({
      dateString,
      dayNumber: day,
      isCurrentMonth: true,
      isToday: dateString === todayStr,
      status: dayStatus,
      totalAppointments: dayBookings.length,
      presentCount: dayPresent,
      absentCount: dayAbsent,
      upcomingCount: dayUpcoming,
      queueTokensSummary,
      hasGaps,
      hasLateQueue,
      appointments: appointmentDetails,
      rollingQueueSlots,
    });
  }

  const attendanceRatePercentage =
    totalAppointments > 0 ? Math.round((presentCount / totalAppointments) * 100) : 100;

  const activeDays = days.filter((d) => d.totalAppointments > 0);
  const activeDaysCount = activeDays.length;

  let peakDayNumber: number | null = null;
  let peakTokensCount = 0;
  for (const d of activeDays) {
    if (d.totalAppointments > peakTokensCount) {
      peakTokensCount = d.totalAppointments;
      peakDayNumber = d.dayNumber;
    }
  }

  return {
    year,
    month,
    monthName,
    days,
    totalAppointments,
    presentCount,
    absentCount,
    attendanceRatePercentage,
    activeDaysCount,
    peakDayNumber,
    peakTokensCount,
  };
}
